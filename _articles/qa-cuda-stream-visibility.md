---
layout: article
title: "CUDA 流与可见性"
date: 2026-11-09
column: "HPCPlatform"
section: "问答与易错点"
order: 9
permalink: /articles/qa-cuda-stream-visibility/
tags: ["HPCPlatform", "CUDA", "Stream"]
topics: ["system", "operator"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<code>src/backends/cuda/cuda_stream.cpp</code>、<code>include/hpcplatform/core/context.h</code>（<code>Wrap</code>）、<code>tests/consistency/test_cuda_backend.cpp</code>（<code>CudaWrapAdoptsExternalDeviceMemory</code>）</p><p>这是本项目真实踩过并写进测试的坑。如果你要把 <code>cudaMalloc</code> / <code>cv::cuda::GpuMat</code> / 其他运行时的 device 指针喂给 hpcplatform，必读。</p></blockquote>
<hr>
<h2>1. 现象</h2>
<pre><code class="language-cpp">void* dptr;
cudaMalloc(&amp;dptr, bytes);
cudaMemcpy(dptr, host_ptr, bytes, cudaMemcpyHostToDevice);  // 默认流

auto t = cuda_ctx-&gt;Wrap(dptr, shape, dtype, MemoryKind::kDevice,
                        [](void* p, size_t){ cudaFree(p); });
auto out = Add(OpContext{cuda_ctx.get()}, t, t);   // 读出来的是垃圾！</code></pre>
<p><code>Wrap</code> 成功、指针也对（<code>t.data() == dptr</code>）、<code>MemoryStats</code> 也没多分配——但 <code>Add</code> 的结果是未初始化的垃圾值。</p>
<hr>
<h2>2. 根因：non-blocking 流与默认流没有隐式顺序</h2>
<p>hpcplatform 的 CUDA 流创建时带 <code>cudaStreamNonBlocking</code> 标志（<code>src/backends/cuda/cuda_stream.cpp</code>）。这意味着：</p>
<ul><li>hpcplatform 的流与 CUDA 默认流（stream 0）<strong>不隐式同步</strong>；</li><li>你在默认流上 <code>cudaMemcpy</code> 产生的数据，和 hpcplatform 流上 launch 的内核之间，<strong>没有 CUDA 自动建立的 happens-before 关系</strong>。</li></ul>
<p>虽然 <code>cudaMemcpy</code>（同步版本）会阻塞 CPU 直到拷贝完成，但那只是 <strong>host 侧</strong>的等待；在 GPU 的<strong>流序</strong>层面，默认流的写与 non-blocking 流的读之间没有强制顺序。在某些系统/时序下可能碰巧对，但<strong>不保证、不可移植</strong>——在本项目的验证机上它就是错的。</p>
<blockquote><p>对比：如果数据是通过 <code>Context::Copy</code>（H2D）产生的，它用的就是 hpcplatform 自己的流，且返回前同步——同一条流内的操作天然有序，所以不需要额外处理。问题只出在"外部流产生的数据"。</p></blockquote>
<hr>
<h2>3. 责任在谁：调用方</h2>
<p>库<strong>不会</strong>替你同步外部内存，因为它根本不知道外部数据是在哪条流上产生的（可能是默认流，可能是另一个库的流，可能是图形 API 的队列）。这是调用方的责任：</p>
<blockquote><p>把外部 device 内存交给 <code>Wrap</code> / 算子之前，必须先确保它对 hpcplatform 的流可见。</p></blockquote>
<hr>
<h2>4. 两种正确做法</h2>
<h3>做法 A：全局设备同步（最简单）</h3>
<pre><code class="language-cpp">cudaMemcpy(dptr, host_ptr, bytes, cudaMemcpyHostToDevice);
cudaDeviceSynchronize();          // 等所有流上的所有操作完成
auto t = cuda_ctx-&gt;Wrap(dptr, ...);
auto out = Add(OpContext{cuda_ctx.get()}, t, t);   // 正确</code></pre>
<p><code>cudaDeviceSynchronize()</code> 等整个设备空闲，保证数据可见。简单但重（会等无关工作）。适合功能正确性优先的场景。</p>
<h3>做法 B：事件等待（更精确，只同步这条依赖）</h3>
<pre><code class="language-cpp">cudaEvent_t ready;
cudaEventCreate(&amp;ready);
cudaEventRecord(ready, producer_stream);   // 在产生数据的流上记录事件
cudaStreamWaitEvent(hpcplatform_raw_stream, ready, 0);  // hpcplatform 流等该事件
// 然后 Wrap + 调用算子</code></pre>
<p>只让 hpcplatform 流等这一次外部写，不阻塞其他流。需要拿到 hpcplatform 流的原生句柄（当前未直接暴露，可通过后端扩展）。</p>
<hr>
<h2>5. 测试如何守护这个契约</h2>
<p><code>tests/consistency/test_cuda_backend.cpp</code> 中的 <code>CudaWrapAdoptsExternalDeviceMemory</code>：</p>
<ol><li>用裸 <code>cudaMalloc</code> + <code>cudaMemcpy</code>（默认流）准备外部 device 数据；</li><li>调用 <code>cudaDeviceSynchronize()</code> 建立可见性；</li><li><code>Wrap</code> 收养该指针（deleter 为 <code>cudaFree</code>）；</li><li>断言 <code>MemoryStats</code> 没多分配、<code>buffer()-&gt;kind() == kDevice</code>；</li><li>喂给 GPU <code>Add</code>，拷回 host 验证结果是 <code>2×</code> 输入；</li><li>作用域结束后断言 deleter（<code>cudaFree</code>）恰好触发一次。</li></ol>
<p>这同时覆盖了：零拷贝输入路径正确、外部内存可见性契约、收养语义的释放。无 GPU 时该测试 SKIP，不影响 <code>ctest</code> 全绿。</p>
<hr>
<h2>6. 与"寿命"的区别（别搞混）</h2>
<p>这是两个独立的保证，都要满足：</p>
<table><thead><tr><th>维度</th><th>保证什么</th><th>谁负责</th></tr></thead><tbody><tr><td><strong>寿命</strong></td><td>指针在 Tensor 活着时不被释放</td><td>deleter（收养）或调用方（借用）</td></tr><tr><td><strong>可见性</strong></td><td>数据在流序上对内核可读</td><td>调用方同步外部流</td></tr></tbody></table>
<p>寿命对了但可见性不对 → 读到垃圾（本文）；可见性对了但寿命不对 → 读到已释放内存（use-after-free）。两者都要。</p>
<hr>
<h2>7. 一句话总结</h2>
<blockquote><p>hpcplatform 的 CUDA 流是 non-blocking 的，和默认流不隐式同步。外部流产生的 device 内存在 <code>Wrap</code>/喂算子前，调用方必须先 <code>cudaDeviceSynchronize()</code> 或用事件建立顺序——库不替你做，因为它不知道外部流的存在。</p></blockquote>
      <div class="article-nav"><a href="qa-context-copy.html"><span class="lbl">上一篇</span>Context::Copy 语义</a><a class="next" href="qa-error-model.html"><span class="lbl">下一篇</span>错误模型</a>

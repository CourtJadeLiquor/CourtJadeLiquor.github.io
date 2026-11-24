---
layout: article
title: "错误模型"
date: 2026-11-10
column: "HPCPlatform"
section: "问答与易错点"
order: 10
permalink: /articles/qa-error-model/
tags: ["HPCPlatform", "Status", "Result"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<code>include/hpcplatform/core/error.h</code></p><p>易混点：<code>Result::value()</code> 不抛异常、六种错误码怎么选、<code>hpcplatform_RETURN_IF_ERROR</code> 的用法。</p></blockquote>
<hr>
<h2>1. 为什么不用异常</h2>
<p>core 层明确<strong>不抛异常</strong>，错误用 <code>Status</code> / <code>Result&lt;T&gt;</code> 表达（<span class="code-link" title="仓库路径">error.h</span> 注释写明动机）：</p>
<ol><li>部分 NPU / 嵌入式工具链以 <code>-fno-exceptions</code> 编译，异常不可用；</li><li>异常让 C ABI 边界与跨语言绑定变复杂（为后续 Python 绑定留出空间）；</li><li>异常会打断"错误码即契约"的可判定性——库希望每种失败都有确定的 <code>StatusCode</code>，调用方据此决策。</li></ol>
<p>代价是调用方必须<strong>显式检查</strong>返回值，不能靠 try/catch 偷懒。这是刻意的。</p>
<hr>
<h2>2. Status 与 Result</h2>
<h3><code>Status</code></h3>
<pre><code class="language-cpp">class Status {
  bool ok() const;
  StatusCode code() const;
  const std::string&amp; message() const;
};</code></pre>
<p>工厂方法：<code>Status::Ok()</code> / <code>InvalidArgument(...)</code> / <code>OutOfMemory(...)</code> / <code>Unsupported(...)</code> / <code>NotImplemented(...)</code> / <code>BadState(...)</code> / <code>Internal(...)</code>。</p>
<h3><code>Result&lt;T&gt;</code></h3>
<p>要么是值，要么是 <code>Status</code>：</p>
<pre><code class="language-cpp">template &lt;typename T&gt;
class Result {
  bool ok() const;
  const Status&amp; status() const;
  T&amp; value();              // ⚠️ 不抛异常
  T ValueOr(T fallback) const;
};</code></pre>
<p><strong>最重要的一个坑</strong>：<code>Result::value()</code> <strong>不会抛异常</strong>。如果 <code>!ok()</code>，调用 <code>value()</code> 拿到的是一个<strong>默认构造的 <code>T</code></strong>（不是错误、不是异常），用了就是静默错误。所以：</p>
<pre><code class="language-cpp">auto r = ctx-&gt;AllocateTensor(...);
if (!r.ok()) { /* 处理 r.status() */ return; }   // 必须先查
Tensor t = r.value();                             // 再取值</code></pre>
<blockquote><p>新手常写 <code>Tensor t = ctx-&gt;AllocateTensor(...).value();</code> 一步到位——失败时 <code>t</code> 是个空壳（<code>buffer_ == nullptr</code>），后续 <code>t.Data&lt;float&gt;()</code> 返回 <code>nullptr</code>，解引用就崩。<strong>永远先查 <code>ok()</code>。</strong></p></blockquote>
<hr>
<h2>3. <code>hpcplatform_RETURN_IF_ERROR</code></h2>
<p>最常用的错误传播宏（<span class="code-link" title="仓库路径">error.h</span>）：</p>
<pre><code class="language-cpp">#define hpcplatform_RETURN_IF_ERROR(expr)              \
  do {                                          \
    ::hpcplatform::Status hpcplatform_status = (expr);         \
    if (!hpcplatform_status.ok()) return hpcplatform_status;   \
  } while (0)</code></pre>
<p>用法（算子公共函数里随处可见）：</p>
<pre><code class="language-cpp">hpcplatform_RETURN_IF_ERROR(ValidateInvocation(context, input));
auto kernel = FindKernel(...);
if (!kernel.ok()) return kernel.status();   // Result 没有宏，手动查</code></pre>
<blockquote><p><code>hpcplatform_RETURN_IF_ERROR</code> 只接返回 <code>Status</code> 的表达式；返回 <code>Result&lt;T&gt;</code> 的要手动 <code>if (!x.ok()) return x.status();</code>，因为还需要把 <code>T</code> 取出来。</p></blockquote>
<hr>
<h2>4. 六种错误码怎么选</h2>
<p><code>StatusCode</code>（<span class="code-link" title="仓库路径">error.h</span>）：</p>
<table><thead><tr><th>码</th><th>什么时候用</th><th>典型场景</th></tr></thead><tbody><tr><td><code>kOk</code></td><td>成功</td><td>—</td></tr><tr><td><code>kInvalidArgument</code></td><td><strong>调用方传参非法</strong>，重试同样参数还是错</td><td>shape 含非正维度、后端要非 naive level、View 非连续输入</td></tr><tr><td><code>kOutOfMemory</code></td><td>分配失败</td><td><code>posix_memalign</code> / <code>cudaMalloc</code> 返回错误</td></tr><tr><td><code>kUnsupported</code></td><td><strong>当前构建/后端不支持这个能力</strong>，但换构建或后端可能行</td><td>没编 AVX2 却请求 <code>kSimdAvx2</code></td></tr><tr><td><code>kNotImplemented</code></td><td><strong>功能根本没实现</strong></td><td>NPU 后端的任意算子、跨 GPU P2P 拷贝</td></tr><tr><td><code>kBadState</code></td><td>对象状态不对，不是参数问题</td><td>对未定义的 Tensor 调 <code>View</code>（<code>buffer_ == nullptr</code>）</td></tr><tr><td><code>kInternal</code></td><td>不该发生的内部错误（兜底）</td><td>理论上不可达的分支</td></tr></tbody></table>
<p>最容易混的是 <code>kUnsupported</code> vs <code>kNotImplemented</code> vs <code>kInvalidArgument</code>，口诀见 <a href="qa-op-dispatch.html"><code>op_dispatch.md</code></a> §3：<strong>参数错 → Invalid；没编进来 → Unsupported；没这功能 → NotImplemented。</strong></p>
<hr>
<h2>5. 错误信息要写什么</h2>
<p>错误信息应包含<strong>足够定位的上下文</strong>：op 名、后端名、level 名、具体哪个参数。例如分发表的未命中信息（<span class="code-link" title="仓库路径">op_registry.cpp</span>）：</p>
<ul><li><code>cpu kernel 'add' is not built for level simd_avx2</code></li><li><code>op 'add' is not implemented for backend npu</code></li><li><code>opencv backend accepts only CpuKernelLevel::kNaive; requested openmp</code></li></ul>
<p>这样调用方拿到 <code>Status::message()</code> 就能直接定位，不用猜。</p>
<hr>
<h2>6. 新增代码的错误处理纪律</h2>
<ol><li>可能失败的函数返回 <code>Status</code> 或 <code>Result&lt;T&gt;</code>，<strong>不要抛异常</strong>，也不要用 <code>assert</code> 替代（<code>assert</code> 在 Release 被裁掉）。</li><li>跨 API 边界的错误必须转成 <code>Status</code>：第三方错误（<code>cudaError_t</code>、<code>cv::Status</code>）用后端的包装函数转成 <code>Status</code>（CUDA 是 <code>CudaStatus</code>）。</li><li>调用方拿到 <code>Result&lt;T&gt;</code> 先查 <code>ok()</code>，再碰 <code>value()</code>。</li><li>错误码选择按 §4 的语义，不要图省事一律 <code>kInternal</code>。</li></ol>
<hr>
<h2>7. 一句话总结</h2>
<blockquote><p>core 不抛异常，所有失败走 <code>Status</code>/<code>Result</code>；<code>Result::value()</code> 失败时不抛而是给默认值，所以<strong>必须先查 <code>ok()</code></strong>；错误码要选准——参数错、没编进、没实现、状态错、内部错各有归属，信息里带上 op/后端/level 才好定位。</p></blockquote>
      <div class="article-nav"><a href="qa-cuda-stream-visibility.html"><span class="lbl">上一篇</span>CUDA 流与可见性</a><a class="next" href="qa-testing.html"><span class="lbl">下一篇</span>构建与对拍测试</a>

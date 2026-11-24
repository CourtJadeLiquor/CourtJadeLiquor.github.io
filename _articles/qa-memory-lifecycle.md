---
layout: article
title: "内存生命周期"
date: 2026-11-06
column: "HPCPlatform"
section: "问答与易错点"
order: 6
permalink: /articles/qa-memory-lifecycle/
tags: ["HPCPlatform", "内存管理"]
topics: ["language", "system", "architecture"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<code>include/hpcplatform/core/memory.h</code>、<code>include/hpcplatform/core/tensor.h</code>、<code>src/core/tensor.cpp</code>、各后端 <code>*_memory_manager.*</code></p><p>配套：<a href="qa-cpubackends.html"><code>cpubackends.md</code></a> 讲 CPU 侧的三层结构，本文讲通用模型与 <code>Wrap</code>。</p></blockquote>
<hr>
<h2>1. 那个让人心里一紧的场景</h2>
<pre><code class="language-cpp">Result&lt;Tensor&gt; MakeFoo() {
  auto ctx = Context::Create(BackendType::kCUDA).value();
  return ctx-&gt;AllocateTensor(Shape{2, 3}, DataType::kFloat32);
  // ctx 在这里析构 —— 返回的 Tensor 还安全吗？
}

auto t = MakeFoo().value();   // 还能用吗？会悬垂吗？</code></pre>
<p><strong>答案：安全。</strong> 这是 hpcplatform 刻意保证的。但很多人第一次看到会怀疑，所以值得讲清机制。</p>
<hr>
<h2>2. 三个角色，三种寿命</h2>
<p>理解这件事的关键是分清谁持有谁：</p>


{% highlight text %}
Context ──shared_ptr──&gt; Backend ──持有──&gt; MemoryManager
                         │
                         └── 内部持有 ──&gt; shared_ptr&lt;AllocatorState&gt;   ← 真正的池/统计状态
                                              ▲
Tensor ──shared_ptr──&gt; Buffer ──deleter(闭包)──┘ 捕获 shared_ptr&lt;AllocatorState&gt;
Tensor ──weak_ptr────&gt; Backend   (owner_)
{% endhighlight %}


<table><thead><tr><th>角色</th><th>寿命</th><th>作用</th></tr></thead><tbody><tr><td><code>Context</code> / <code>Backend</code></td><td>调用方控制</td><td>提供分配策略与默认流</td></tr><tr><td><code>AllocatorState</code>（后端内部）</td><td>被 <code>Backend</code> 和所有活着的 <code>Buffer</code> 共同持有</td><td>持有空闲块池与统计计数器</td></tr><tr><td><code>Buffer</code></td><td>被 <code>Tensor</code> 持有（<code>shared_ptr</code>）</td><td>持有数据指针 + deleter</td></tr><tr><td><code>Tensor</code></td><td>调用方控制</td><td>描述符</td></tr></tbody></table>
<p><strong>核心 trick</strong>：<code>Buffer</code> 的 deleter 捕获的不是 <code>Backend*</code>（裸指针），而是 <code>shared_ptr&lt;AllocatorState&gt;</code>。所以：</p>
<ul><li><code>Context</code> 析构 → <code>Backend</code> 析构 → <code>Backend</code> 对 <code>AllocatorState</code> 的引用没了；</li><li>但只要还有 <code>Tensor</code> 活着，它的 <code>Buffer</code> 就还持有 <code>AllocatorState</code> 的一份引用 → 池与统计状态继续存活；</li><li>最后一个 <code>Tensor</code> 释放 → <code>Buffer</code> 析构 → deleter 把内存（或整池）正确还给 OS/驱动 → <code>AllocatorState</code> 才真正析构。</li></ul>
<p>一句话：<strong>分配策略（Backend）可以死，回收责任（随 Buffer 延续的 AllocatorState）不能死。</strong></p>
<hr>
<h2>3. <code>owner_</code> 为什么用 weak_ptr，不用 shared_ptr</h2>
<p><code>Tensor::owner_</code> 是 <code>std::weak_ptr&lt;Backend&gt;</code>（<span class="code-link" title="仓库路径">tensor.h</span> 注释："Expires with the Context"）。</p>
<ul><li>如果用 <code>shared_ptr&lt;Backend&gt;</code>，<code>Tensor</code> 会把 <code>Context</code>/<code>Backend</code> <strong>续命</strong>——Context 明明该析构了却因为还有 Tensor 而活着，池无法释放，违背调用方预期。</li><li>用 <code>weak_ptr</code>：<code>Tensor</code> 不延长 Context 寿命，但 <code>Clone</code> / 跨后端拷贝时可以 <code>lock()</code> 试探——如果 Backend 还在就用它分配；如果已过期（Context 死了），<code>ResolveOwningBackend</code> 会<strong>创建一个临时后端</strong>兜底完成深拷贝（<span class="code-link" title="仓库路径">tensor.cpp</span> 的 <code>Clone</code> 路径）。</li></ul>
<blockquote><p>这就是 "tensor 比 context 长寿" 测试（<code>CudaTensorCanOutliveItsContext</code>）验证的东西：Context 先死，Tensor 后死，全程无 use-after-free。ASAN 构建全绿覆盖此路径。</p></blockquote>
<hr>
<h2>4. <code>Wrap</code>：借用 vs 收养</h2>
<p><code>Context::Wrap</code> 把外部内存包成 Tensor，<strong>不分配不拷贝</strong>。释放语义完全由 deleter 决定（<span class="code-link" title="仓库路径">context.h</span>）：</p>
<table><thead><tr><th>deleter</th><th>语义</th><th>什么时候释放</th><th>适用场景</th></tr></thead><tbody><tr><td>空（<code>nullptr</code>）</td><td><strong>借用 borrow</strong></td><td>永不释放（调用方负责）</td><td><code>cv::Mat</code> 还在外部管、你只想临时读一下</td></tr><tr><td>非空</td><td><strong>收养 adopt</strong></td><td>最后一个 <code>Tensor</code>/<code>Buffer</code> 引用死亡时调 deleter</td><td>你想把 <code>cudaMalloc</code> 的指针交给 Tensor 管生命周期</td></tr></tbody></table>
<p><code>Buffer::~Buffer</code> 的逻辑很简单（<span class="code-link" title="仓库路径">memory.h</span>）：deleter 非空且 <code>data_ != nullptr</code> 就调用。</p>
<p><strong>两个必须记住的后果</strong>：</p>
<ol><li><strong>借用时，内存活多久由你决定，Tensor 不管。</strong> 如果你 Wrap 了一个栈上数组，然后让 Tensor 逃出作用域——就是 use-after-free。借用只适合"外部 owner 明确比 Tensor 长寿"的场景。</li><li><strong>Wrap 不经过 <code>MemoryManager::Allocate</code>，所以 <code>MemoryStats</code> 不变。</strong> 外部内存不算管理器的分配，统计里看不到它。这是刻意的：管理器只统计自己分配的内存。收养的 deleter 也直接释放（如 <code>cudaFree</code>），不回池。</li></ol>
<hr>
<h2>5. 外部内存的"数据可见性"是另一个问题（易混淆）</h2>
<p>寿命和可见性是两件事：</p>
<ul><li><strong>寿命</strong>：deleter 保证指针在 Tensor 活着时不被释放（收养），或你保证（借用）。</li><li><strong>可见性</strong>：如果外部内存在另一条流上产生（如默认流上的 <code>cudaMemcpy</code>），数据对 hpcplatform 的 non-blocking 流未必立即可见。</li></ul>
<p>寿命对了，可见性不对，内核照样读到垃圾。详见 <a href="qa-cuda-stream-visibility.html"><code>cuda_stream_visibility.md</code></a>。</p>
<hr>
<h2>6. 一句话总结</h2>
<blockquote><p><code>Buffer</code> 持数据、<code>AllocatorState</code> 持池、两者通过 <code>shared_ptr</code> 解耦，所以 <code>Context</code> 先死不影响已分配 Tensor 的释放；<code>owner_</code> 用 <code>weak_ptr</code> 不续命 Context，<code>Clone</code> 在 Context 死后用临时后端兜底。<code>Wrap</code> 的 deleter 为空是借用、非空是收养，且不进统计。</p></blockquote>
      <div class="article-nav"><a href="qa-tensor-views.html"><span class="lbl">上一篇</span>Tensor 视图与 stride</a><a class="next" href="qa-op-dispatch.html"><span class="lbl">下一篇</span>算子分发与错误码</a>

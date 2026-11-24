---
layout: article
title: "Context::Copy 语义"
date: 2026-11-08
column: "HPCPlatform"
section: "问答与易错点"
order: 8
permalink: /articles/qa-context-copy/
tags: ["HPCPlatform", "Context", "Copy"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<code>src/core/copy.cpp</code>、<code>include/hpcplatform/core/context.h</code>、<code>src/core/backend.h</code></p><p>易混点：Copy 到底拷了什么、跨后端怎么决定谁来拷、拷完能不能立刻用。</p></blockquote>
<hr>
<h2>1. Copy 拷贝的是【逻辑元素】，不是裸字节</h2>
<p><code>Context::Copy(dst, src)</code> 的契约是：把 <code>src</code> 的<strong>逻辑元素</strong>搬到 <code>dst</code>（<span class="code-link" title="仓库路径">context.h</span> 注释："Copies logical elements, including non-contiguous views"）。</p>
<p>这意味着：</p>
<ul><li><code>src</code> 可以是<strong>非连续视图</strong>（<code>Slice</code> 后的张量）——Copy 会按 <code>src</code> 的 stride 逐元素读，按 <code>dst</code> 的 stride 逐元素写，而不是粗暴 <code>memcpy</code> 整块。</li><li>要求 <code>dst</code> 与 <code>src</code> 的 shape / dtype / 元素数匹配；不匹配返回错误。</li><li>连续 host↔host 才会走快速 <code>memcpy</code>；其他情况逐元素搬运。</li></ul>
<blockquote><p>所以"把一个 slice 视图拷到新张量"是安全的，结果就是视图看到的那些元素，不会把 stride 间隙里的垃圾也带过去。</p></blockquote>
<hr>
<h2>2. 谁来执行拷贝：由【目标上下文】选路</h2>
<p><code>dst</code> 属于哪个 Context，就由那个 Context 的后端决定拷贝路径：</p>
<table><thead><tr><th>src \ dst</th><th>host (native/opencv)</th><th>device (cuda)</th></tr></thead><tbody><tr><td>host</td><td>直接 memcpy / 逐元素</td><td>H2D：目标后端的 <code>CopyBuffer</code>（CUDA 用 <code>cudaMemcpyAsync</code>）</td></tr><tr><td>device</td><td>D2H：源后端的 <code>CopyBuffer</code></td><td>D2D：同设备内拷贝</td></tr></tbody></table>
<p>后端的 <code>Backend::CopyBuffer</code>（<span class="code-link" title="仓库路径">backend.h</span>）有一条硬规则：</p>
<blockquote><p>实现碰不到某类内存时，<strong>必须返回 <code>kUnsupported</code>，而不是在调用方背后经 host staging</strong>。</p></blockquote>
<p>含义：如果一个新后端不会做 D2H，它应该老实返回 <code>kUnsupported</code>，让调用方知道，而不是偷偷先拷到 host 再拷到 device（那样会引入隐藏拷贝、破坏性能预期）。新增后端只需正确实现 <code>CopyBuffer</code>，就能参与 <code>Context::Copy</code> 的选路。</p>
<p><strong>跨不同 GPU（peer-to-peer）</strong>：当前明确返回 <code>kUnsupported</code>，不经 host 中转。需要的话调用方自己显式分两段拷。</p>
<hr>
<h2>3. 同步契约：Copy 返回即完成</h2>
<p><code>Context::Copy</code> 在返回前<strong>同步完成</strong>：</p>
<ul><li>CUDA 路径会 <code>cudaStreamSynchronize</code>，所以返回后 <code>dst</code> 的数据已经在目标内存里、立即可读；</li><li>CPU 路径本身同步。</li></ul>
<p>这是当前的公开契约。好处是生命周期简单：Copy 返回后你可以立即读 <code>dst</code>、可以立即让 <code>src</code> 析构。代价是 host 侧不能重叠 Copy 与计算（无异步流水）。若未来加异步 Copy，会是<strong>新的显式入口</strong>，不会偷偷改掉现有 <code>Copy</code> 的语义（<a href="architecture.html">架构设计</a> §1"显式优先于隐式"）。</p>
<hr>
<h2>4. 常见误用</h2>
<table><thead><tr><th>误用</th><th>后果</th><th>正确做法</th></tr></thead><tbody><tr><td>跨设备 Copy 却不传目标 Context（在源 Context 上拷）</td><td>路径选错 / 报错</td><td>在 <code>dst</code> 所在的 Context 上调用 <code>Copy(&amp;dst, src)</code></td></tr><tr><td>期望 Copy 自动处理 dtype 转换</td><td>不转换，dtype 不符报错</td><td>先 <code>Cast</code> 再 Copy，或用算子输出直接是目标 dtype</td></tr><tr><td>期望 Copy 自动处理 layout（NCHW↔NHWC）</td><td>不转换</td><td>显式 <code>Transpose</code> / <code>Permute</code></td></tr><tr><td>Copy 后立刻在另一条流上用 <code>dst</code> 但没同步</td><td>（当前 Copy 已同步，无碍；但若是自己写的异步路径则可能读到旧值）</td><td>遵循"返回即完成"的公开契约</td></tr></tbody></table>
<hr>
<h2>5. 与 <code>Clone</code> 的关系</h2>
<p><code>Tensor::Clone()</code> 内部就是"在 owning backend 上分配新张量 + <code>CopyTensorData</code>"（<span class="code-link" title="仓库路径">tensor.cpp</span>）。区别：</p>
<ul><li><code>Clone()</code>：自动找归属后端（Context 死了会建临时后端兜底），总是深拷贝到同后端。</li><li><code>Context::Copy</code>：你指定目标 Context，可跨后端。</li></ul>
<blockquote><p>记忆点：<strong>同后端深拷贝用 <code>Clone</code>，跨后端/跨设备搬运用 <code>Context::Copy</code>。</strong></p></blockquote>
<hr>
<h2>6. 一句话总结</h2>
<blockquote><p>Copy 搬的是逻辑元素（非连续也正确），路由由目标 Context 的后端决定，碰不到的内存返回 <code>kUnsupported</code> 不偷转；返回前同步，立即可读。dtype/layout 不自动转，要转自己显式调算子。</p></blockquote>
      <div class="article-nav"><a href="qa-op-dispatch.html"><span class="lbl">上一篇</span>算子分发与错误码</a><a class="next" href="qa-cuda-stream-visibility.html"><span class="lbl">下一篇</span>CUDA 流与可见性</a>

---
layout: article
title: "算子分发与错误码"
date: 2026-11-07
column: "HPCPlatform"
section: "问答与易错点"
order: 7
permalink: /articles/qa-op-dispatch/
tags: ["HPCPlatform", "注册表", "错误码"]
topics: ["architecture", "operator"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<code>src/framework/op_registry.{h,cpp}</code>、<code>src/ops/common/op_common.h</code>、<code>src/ops/register_ops.cpp</code></p><p>这是全库最容易"以为跑了 A 其实跑了 B"的地方，也是 hpcplatform 最在意的地方。</p></blockquote>
<hr>
<h2>1. 分发的键：三元组</h2>
<p>一次算子调用能精确命中哪个内核，由三个维度共同决定（<span class="code-link" title="仓库路径">op_registry.cpp</span>）：</p>


{% highlight text %}
(OpKind, BackendType, CpuKernelLevel)  →  一个函数指针 OpKernelFn
{% endhighlight %}


<ul><li><code>OpKind</code>：哪个算子（<code>kAdd</code> / <code>kMul</code> / …），来自算子公共函数内部写死；</li><li><code>BackendType</code>：哪个后端，来自<strong>输入张量</strong>的 <code>input.backend()</code>（不是你传的 OpContext！）；</li><li><code>CpuKernelLevel</code>：哪个 CPU 版本，来自 <code>OpContext.cpu_level</code>。</li></ul>
<blockquote><p>注意后端取自输入张量。所以 <code>Add(cuda_ctx_op, gpu_tensor, ...)</code> 会查 <code>(kAdd, kCUDA, kNaive)</code>——即使你心里想跑 CPU，只要输入在 GPU 上，就走 CUDA 内核。要跑 CPU，先把张量 <code>Copy</code> 到 CPU 上下文。这是"数据在哪就在哪算"，不做隐式跨设备调度。</p></blockquote>
<hr>
<h2>2. 一次调用的顺序（以 Add 为例）</h2>
<p><span class="code-link" title="仓库路径">add.cpp</span> 的固定骨架：</p>


{% highlight text %}
1. ValidateInvocation(ctx, input)        ← 先校验：input 的 backend/device 必须匹配 ctx
2. ValidateBinaryInputs(input, &amp;other)   ← shape / dtype / 广播
3. FindKernel(kAdd, input.backend(), ctx.cpu_level)
4. AllocateOutput(...)                   ← 在 ctx 的后端上分配输出
5. kernel(ctx, input, &amp;other, nullptr, &amp;output)
{% endhighlight %}


<p>第 1 步很关键：<strong>输入张量必须属于这个 OpContext 的后端/设备</strong>，否则直接 <code>kInvalidArgument</code>，连查表都不查。这也是为什么 <code>Wrap</code> 出来的张量能直接喂算子——它的 <code>backend()</code>/<code>device()</code> 被设成了 Context 的（<a href="qa-memory-lifecycle.html"><code>memory_lifecycle.md</code></a> §4）。</p>
<p>第 4 步：输出分配在 <strong>OpContext 的后端</strong>上。通常输入和 ctx 同后端，所以输出也在那；但如果故意构造（输入在 A、ctx 是 B），第 1 步就会拦下。</p>
<hr>
<h2>3. 查不到时返回什么：三个错误码的精确边界</h2>
<p><code>FindKernel</code>（<span class="code-link" title="仓库路径">op_registry.cpp</span>）对未命中分三种情况，<strong>绝不能混</strong>：</p>


{% highlight text %}
请求 (op, backend, level)
  │
  ├─ backend 不是 kNativeCpu 且 level != kNaive ?
  │     └─ 是 → kInvalidArgument  "该后端只接受 kNaive"
  │
  └─ 查表命中 ?
        ├─ 命中 → 返回内核函数
        └─ 未命中
              ├─ backend == kNativeCpu ?
              │     └─ 是 → kUnsupported  "这个 CPU level 没编译进来"
              └─ 否 → kNotImplemented  "这个后端没实现这个算子"
{% endhighlight %}


<table><thead><tr><th>错误码</th><th>什么时候</th><th>你该怎么理解 / 怎么办</th></tr></thead><tbody><tr><td><code>kInvalidArgument</code></td><td>非 CPU 后端传了非 <code>kNaive</code></td><td>你传参错了。OpenCV/CUDA 没有多版本，传 <code>kOpenMP</code> 是非法参数，改回 <code>kNaive</code>。</td></tr><tr><td><code>kUnsupported</code></td><td>CPU 后端请求了<strong>没编译</strong>的 level</td><td>当前二进制没编这个版本。要么换构建开关重编，要么换一个已编的 level。<strong>库不会替你降到 naive。</strong></td></tr><tr><td><code>kNotImplemented</code></td><td>后端压根<strong>没实现</strong>该算子</td><td>这个后端就是不支持（如 NPU 的一切）。换后端，或等实现。</td></tr></tbody></table>
<p>口诀：<strong>参数错 → Invalid；没编进来 → Unsupported；没这功能 → NotImplemented。</strong></p>
<blockquote><p>为什么要分这么细？因为调用方写降级逻辑时需要知道：是"我参数写错了"（改代码）、"换个编译选项"（改构建）、还是"这条路真的不通"（换方案）。如果库只回一个模糊错误，上层就只能猜。另外——<strong>降级是调用方的事，库本身不做任何静默降级</strong>。</p></blockquote>
<hr>
<h2>4. 为什么不做"自动降级到 naive"</h2>
<p>这是 hpcplatform 的核心立场（<a href="architecture.html">架构设计</a> §1"显式优先于隐式"），也是最常被挑战的设计：</p>
<ul><li>如果请求 AVX2 但没编，自动跑 naive——功能上"能用"，但你<strong>以为在测 AVX2 的性能，实际测的是 naive</strong>，实验结论作废。</li><li>科研场景下，"静默换实现"比"报错"危险得多：报错你立刻知道，静默你可能发表了错误数字。</li><li>所以库选择<strong>失败得明确</strong>：返回 <code>kUnsupported</code>，让你有意识地决定"重编"还是"真的要跑 naive"（真要跑就显式传 <code>kNaive</code>）。</li></ul>
<hr>
<h2>5. 注册是延迟的、按编译宏守卫的</h2>
<p>内核表在第一次 <code>FindKernel</code> 时通过 <code>std::call_once</code> 填充（<span class="code-link" title="仓库路径">op_registry.cpp</span>）。每个算子的 <code>Register*Kernels()</code> 里，每个版本都用 <code>#ifdef</code> 包住：</p>
<pre><code class="language-cpp">#ifdef hpcplatform_ARCH_AVX2
RegisterKernel(kAdd, kNativeCpu, kSimdAvx2, &amp;AddCpuAvx2);
#endif</code></pre>
<p>含义：<strong>编译期没开的宏，这个版本根本不会出现在运行期的表里</strong>。所以"请求未编译 level → 表里没有 → <code>kUnsupported</code>"是编译期就决定的，运行期无法绕过。这保证了二进制的能力边界是封闭的、可审计的。</p>
<hr>
<h2>6. 快速自检：我怎么知道实际跑了哪个</h2>
<ul><li><strong>编译期</strong>：看构建时开了哪些宏（<code>build/CMakeCache.txt</code> 里的 <code>hpcplatform_WITH_OPENMP</code> / <code>hpcplatform_ENABLE_TBB</code> / <code>hpcplatform_ARCH_AVX2</code> 等）。</li><li><strong>运行期</strong>：<code>Backend::SupportsKernelLevel(level)</code> 告诉你这个后端/构建能不能跑某 level（由编译宏 + 已注册内核共同决定，不虚报）。</li><li><strong>行为验证</strong>：<code>tests/consistency/test_cpu_kernels.cpp</code> 拿 naive 当 oracle 逐位对拍其他版本——如果某版本结果与 naive 不一致（元素级应为 bit-exact），测试会红。</li></ul>
<hr>
<h2>7. 一句话总结</h2>
<blockquote><p>命中靠三元组 <code>(op, 输入张量的 backend, ctx.cpu_level)</code>；查不到分三种错——非 CPU 要非 naive 是 <code>kInvalidArgument</code>、CPU 没编进是 <code>kUnsupported</code>、后端没实现是 <code>kNotImplemented</code>；库永远不静默换实现，要降级你自己显式传 <code>kNaive</code>。</p></blockquote>
      <div class="article-nav"><a href="qa-memory-lifecycle.html"><span class="lbl">上一篇</span>内存生命周期</a><a class="next" href="qa-context-copy.html"><span class="lbl">下一篇</span>Context::Copy 语义</a>

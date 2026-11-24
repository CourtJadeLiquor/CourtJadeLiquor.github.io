---
layout: article
title: "问答与易错点总览"
date: 2026-11-03
column: "HPCPlatform"
section: "问答与易错点"
order: 3
permalink: /articles/qa-overview/
tags: ["HPCPlatform", "QA"]
topics: ["architecture", "system", "operator"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>文档视角：<strong>学习者与贡献者</strong>——回答"这个模块为什么这么设计、关键组件是什么、它怎么和全局串起来、我该怎么调用/测试/扩展"。</p><p>配套阅读：<a href="architecture.html">架构设计</a> 给出 v2 目标架构全貌，扩展指南见其 §11。</p><p>本文档记录的是<strong>容易理解混淆的点</strong>，不是 API 罗列——API 以头文件注释为准。</p><p>注意：文中引用的部分代码路径描述 v1 现状，随 v2 迁移逐步刷新（机制本身不变）。</p></blockquote>
<hr>
<h2>索引</h2>
<table><thead><tr><th>文档</th><th>解决的困惑</th></tr></thead><tbody><tr><td><a href="qa-cpubackends.html"><code>cpubackends.md</code></a></td><td>CPU 内存为什么不能只用 <code>std::vector</code>/<code>unique_ptr</code>？Buffer / MemoryManager / AllocatorState 三层各管什么？</td></tr><tr><td><a href="qa-tensor-views.html"><code>tensor_views.md</code></a></td><td>为什么 View/Slice/Permute 不拷贝？stride 和 offset 怎么算？Reshape 什么时候偷偷深拷贝？</td></tr><tr><td><a href="qa-memory-lifecycle.html"><code>memory_lifecycle.md</code></a></td><td>Tensor 为什么能比 Context 活得久？Wrap 的"借用"和"收养"有什么区别？</td></tr><tr><td><a href="qa-op-dispatch.html"><code>op_dispatch.md</code></a></td><td>算子到底是怎么被选中的？<code>kUnsupported</code> / <code>kNotImplemented</code> / <code>kInvalidArgument</code> 到底什么时候返回哪个？</td></tr><tr><td><a href="qa-context-copy.html"><code>context_copy.md</code></a></td><td><code>Context::Copy</code> 拷贝的是字节还是元素？跨后端怎么选路？什么时候同步？</td></tr><tr><td><a href="qa-cuda-stream-visibility.html"><code>cuda_stream_visibility.md</code></a></td><td>为什么 Wrap 进来的 CUDA 内存数据不对？non-blocking 流和外部内存的可见性责任在谁？</td></tr><tr><td><a href="qa-error-model.html"><code>error_model.md</code></a></td><td>为什么不用异常？<code>Status</code> / <code>Result</code> 怎么用？六种错误码怎么选？</td></tr><tr><td><a href="qa-testing.html"><code>testing.md</code></a></td><td>全特性构建树怎么跑？怎么用 GoogleTest/CTest 写对拍测试？容差怎么定？</td></tr></tbody></table>
<blockquote><p>扩展指南（加算子 / 加后端实现 / 加 CPU 优化版本）统一由<a href="architecture.html">架构设计 §11</a> 承载，不再单独成文。</p></blockquote>
<hr>
<h2>这份文档的写法约定</h2>
<ul><li><strong>先讲"为什么"，再讲"是什么"</strong>：每个易错点先解释设计动机，因为混淆往往来自不知道取舍。</li><li><strong>每条结论锚定到代码</strong>：给出关键文件路径，方便读者核实（路径以仓库根为基准）。</li><li><strong>不替代码说谎</strong>：如果某处是"当前行为、未来可能变"，会明确标注，不包装成永恒真理。</li><li><strong>PDF 友好</strong>：标准 Markdown，可直接导出。</li></ul>
      <div class="article-nav"><a href="operator-config.html"><span class="lbl">上一篇</span>配置驱动算子对象</a><a class="next" href="qa-cpubackends.html"><span class="lbl">下一篇</span>CPU 内存与后端分层</a>

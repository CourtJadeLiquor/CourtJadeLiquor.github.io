---
layout: article
title: "版本演进 v1 → v2"
date: 2026-11-12
column: "HPCPlatform"
section: "版本演进"
order: 12
permalink: /articles/roadmap/
tags: ["HPCPlatform", "Roadmap"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "版本演进"
---

<blockquote><p>只记录<strong>已经稳定</strong>的版本。进行中的设计、未落地的计划不写入本文；有稳定改动时再增补对应版本小节。</p><p>当前架构说明见 <a href="architecture.html"><code>../architecture.md</code></a>。</p></blockquote>
<h2>版本概览</h2>
<table><thead><tr><th>版本</th><th>状态</th><th>主题</th></tr></thead><tbody><tr><td>v1</td><td>历史稳定版</td><td>集中式算子与后端内核</td></tr><tr><td>v2</td><td>当前稳定版</td><td>算子自治、后端服务化、框架工具层</td></tr></tbody></table>
<hr>
<h2>v1</h2>
<p><strong>定位</strong>：以算子功能覆盖为主，所有算子共享少量集中式注册与后端内核文件。</p>
<p><strong>公共 API 面</strong>：<code>add</code> / <code>mul</code> / <code>cast</code> / <code>normalize</code> / <code>resize</code> / <code>crop</code> / <code>transpose</code> / <code>warp_affine</code>。</p>
<p><strong>结构特征</strong>：</p>
<ul><li>算子注册集中在 <code>src/ops/op_registry.cpp</code>。</li><li>参数结构体集中在 <code>src/ops/op_params.h</code>。</li><li>CUDA / OpenCV 内核分别集中在 <code>src/backends/cuda/cuda_kernels.cu</code>、<code>src/backends/opencv/opencv_kernels.cpp</code>。</li><li>工具函数散落在 <code>src/ops/</code> 顶层。</li></ul>
<p><strong>主要问题</strong>：新增一个算子需要改动多个共享热点文件（注册、参数、两个后端内核、根 CMake），协作冲突成本高；后端内核文件反向包含算子内部头，依赖方向混乱。</p>
<hr>
<h2>v2</h2>
<p><strong>重构重点</strong>：</p>
<ol><li><strong>算子自治</strong>：每个算子一个独立文件夹，入口、全部版本实现、构建、测试、基准、README 自包含。</li><li><strong>后端服务化</strong>：<code>backends</code> 只提供内存、流、拷贝、设备封装与数据转换，不再承载算子实现。</li><li><strong>依赖倒置</strong>：<code>Backend</code> 接口归入 <code>core</code>；后端实现依赖 core，core 不反向依赖后端；算子只依赖后端服务头。</li><li><strong>框架工具层</strong>：注册表、图像工具、dtype 分发、性能剖析与内存统计集中到 <code>src/framework/</code>。</li><li><strong>范围收敛</strong>：删除元素级算子，保留并强化图像/变换类多版本算子。</li></ol>
<h3>API 变更</h3>
<p><strong>新增</strong></p>
<ul><li><code>GaussianBlur(...)</code>：可分离高斯平滑，支持 HW/HWC/CHW/NHWC 与 u8/f32/f64。</li><li><code>LaplacianPyramid(...)</code> 与 <code>FourierTransform(...)</code>、<code>WaveletTransform(...)</code> 等算子公共头。</li><li><code>Tensor::Wrap(...)</code>：接管外部内存的统一工厂。</li><li><code>Context::AllocateTensor(...)</code> 等沿用现有命名。</li></ul>
<p><strong>删除</strong></p>
<ul><li>公共头与实现：<code>add</code> / <code>mul</code> / <code>cast</code> / <code>normalize</code> / <code>crop</code> / <code>transpose</code> / <code>warp_affine</code>。</li><li><code>Context::backend()</code> 公共访问器：后端能力不再对调用者暴露。</li><li>公共头 <code>include/hpcplatform/backends/backend.h</code>：<code>Backend</code> 转为 core 内部契约。</li></ul>
<p><strong>行为/兼容性变更</strong></p>
<ul><li><code>OpKind</code> 收缩并重编号为 <code>kResize=1</code>、<code>kGaussianBlur=2</code> 等，随后恢复 append-only 纪律。</li><li>公共头不再包含任何 <code>src/**</code> 内容。</li></ul>
<h3>代码移动</h3>
<table><thead><tr><th>原位置</th><th>新位置</th></tr></thead><tbody><tr><td><code>src/ops/op_registry.{h,cpp}</code></td><td><code>src/framework/op_registry.{h,cpp}</code></td></tr><tr><td><code>src/ops/image_utils.h</code></td><td><code>src/framework/image_utils.h</code></td></tr><tr><td><code>src/ops/op_common.h</code></td><td><code>src/ops/common/op_common.h</code></td></tr><tr><td><code>src/ops/cpu_resize.h</code></td><td><code>src/ops/resize/resize_cpu.h</code></td></tr><tr><td><code>include/hpcplatform/backends/backend.h</code></td><td><code>src/core/backend.h</code></td></tr><tr><td><code>src/backends/service.h</code></td><td><code>src/core/backend.h</code></td></tr><tr><td><code>src/backends/backend_copy.cpp</code></td><td><code>src/core/copy.cpp</code></td></tr><tr><td><code>src/backends/backend_factory.cpp</code></td><td><code>src/backends/factory.cpp</code></td></tr><tr><td><code>src/backends/backends_internal.h</code></td><td><code>src/backends/backend_internal.h</code></td></tr><tr><td><code>src/ops/registry.cpp</code></td><td><code>src/ops/register_ops.cpp</code></td></tr><tr><td>CUDA 内核（集中文件）</td><td>各算子 <code>*_cuda.cu</code></td></tr><tr><td>OpenCV 内核（集中文件）</td><td>各算子 <code>*_opencv.cpp</code></td></tr></tbody></table>
<h3>内部设施</h3>
<ul><li>新增 <code>src/framework/{compiler,dtype_dispatch,profiling,stats}.h</code>。</li><li>新增 <code>src/core/copy.h</code>：<code>CopyTensorData</code> / <code>ResolveOwningBackend</code> 内部声明。</li><li>新增 <code>tests/perf/test_operator_perf.cpp</code>：基于 profiling/stats 的算子性能评估样例。</li><li><code>tests/</code> 重组为 <code>core/</code>、<code>backends/</code>、<code>perf/</code> 与各算子内部 <code>tests/</code>。</li></ul>
<h3>构建与测试</h3>
<ul><li>可选后端由 <code>hpcplatform_WITH_CUDA</code>、<code>hpcplatform_WITH_OPENCV</code>、<code>hpcplatform_WITH_YAML</code> 以及 <code>hpcplatform_ENABLE_TBB</code>、<code>hpcplatform_ENABLE_OPENMP</code>、<code>hpcplatform_ENABLE_SIMD</code> 门控（均为默认 ON）。</li><li>AVX2 翻译单元使用独立 OBJECT 库，避免 <code>-mavx2</code> 影响整个静态库。</li><li>测试基线（历史）：默认 / 全后端 / ASan 三棵树。<strong>已废弃</strong>：现为单一全特性构建树（<code>build_debug</code> / <code>build_release</code>）+ GoogleTest + CTest，见 <a href="qa-testing.html"><code>docs/qa/testing.md</code></a>。</li></ul>
<hr>
<h2>记录约定</h2>
<p>后续每个稳定版本按以下顺序补充，保持简短：</p>
<ol><li><strong>版本定位</strong>：一句话说明该版本主题。</li><li><strong>API 变更</strong>：新增 / 删除 / 行为变更。</li><li><strong>代码移动</strong>：仅记录跨目录或改名。</li><li><strong>重构重点</strong>：影响架构或协作方式的变化。</li><li><strong>验证基线</strong>：构建树与测试结果。</li></ol>
      <div class="article-nav"><a href="qa-testing.html"><span class="lbl">上一篇</span>构建与对拍测试</a><span></span>

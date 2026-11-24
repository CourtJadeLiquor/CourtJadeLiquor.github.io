---
layout: article
title: "配置驱动算子对象"
date: 2026-11-02
column: "HPCPlatform"
section: "总览"
order: 2
permalink: /articles/operator-config/
tags: ["HPCPlatform", "配置驱动", "Operator"]
topics: ["architecture", "operator"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "总览"
---

<p>让算法研究者通过一份配置文件实例化算子对象、调参、切换执行环境（实验机 CPU / 生产机 CUDA），而无需改代码。库只负责把配置变成<strong>已绑定参数的算子对象</strong>；执行流程由调用方自行编排，库不构建计算图，也不假设图像算法。</p>
<p>完整架构背景见 <a href="architecture.html"><code>architecture.md</code></a> §2.1、§7.3、§10。</p>
<hr>
<h2>1. 构建</h2>
<p>默认关闭，不引入任何第三方依赖：</p>
<pre><code class="language-bash">cmake -S . -B build -DCMAKE_BUILD_TYPE=Release</code></pre>
<p>启用配置驱动层（需要 yaml-cpp，例如 <code>apt install libyaml-cpp-dev</code>）：</p>
<pre><code class="language-bash">cmake -S . -B build -Dhpcplatform_WITH_YAML=ON</code></pre>
<p>未启用时，公共 API 仍可链接，但 <code>LoadOperators*</code> 返回 <code>kUnsupported</code>（消息含 <code>hpcplatform_WITH_YAML</code>），默认构建零回归。</p>
<hr>
<h2>2. 快速开始</h2>
<pre><code class="language-cpp">#include "hpcplatform/hpcplatform.h"
using namespace hpcplatform;

// 从文件加载；也可用 LoadOperatorsFromString(yaml_text) 内联配置。
auto loaded = LoadOperators("config.yaml");
if (!loaded.ok()) { /* loaded.status() */ return 1; }
OperatorMap ops = std::move(loaded.value());

// 按名字取具体类型的算子对象；类型不匹配或名字不存在返回 nullptr。
auto* resize = GetOperator&lt;ResizeOperator&gt;(ops, "downscale");
auto* blur   = GetOperator&lt;GaussianBlurOperator&gt;(ops, "smooth");

auto ctx = Context::Create(BackendType::kNativeCpu).value();
auto input = ctx-&gt;AllocateTensor(Shape{1, 8, 8, 3}, DataType::kFloat32).value();

// 调用方自行编排：先缩放、再模糊。每个对象已绑定自己的参数。
auto small   = resize-&gt;Run(input);          // Result&lt;Tensor&gt;
auto blurred = blur-&gt;Run(small.value());    // Result&lt;Tensor&gt;</code></pre>
<p>可运行示例见 <span class="code-link" title="仓库路径"><code>samples/05_config_operator.cpp</code></span> 与 <span class="code-link" title="仓库路径"><code>samples/configs/operators.yaml</code></span>。</p>
<hr>
<h2>3. 配置契约</h2>
<p>顶层是一个 <code>operators</code> 列表，每个元素描述一个算子对象实例：</p>
<pre><code class="language-yaml">operators:
  - name: downscale          # 实例名，必填且唯一；map 的键，GetOperator 按此查找
    op: resize               # 算子类型，必填；必须是已注册的描述符名
    backend: native_cpu      # 后端，必填：native_cpu / opencv / cuda / npu
    cpu_level: naive         # 可选，默认 naive
                              #   CPU 后端：naive / openmp / simd_generic / simd_avx2 / simd_neon / tbb
                              #   非 CPU 后端必须为 naive（否则 kInvalidArgument）
    device_index: 0          # 可选，默认 0；非 CPU 后端用于选卡
    params:                  # 算子专属参数，全部按标量字符串解析
      output_height: 2
      output_width: 2
      interpolation: bilinear
      layout: nhwc</code></pre>
<p>字段规则：</p>
<ul><li><code>name</code>：必填、非空、在文件内唯一；重名 → <code>kInvalidArgument</code>。</li><li><code>op</code>：必填；未注册的名字 → <code>kInvalidArgument</code>。</li><li><code>backend</code>：必填；非法名字 → <code>kInvalidArgument</code>；该后端未编译进当前构建 → <code>kUnsupported</code>。</li><li><code>cpu_level</code>：可选，省略视为 <code>naive</code>；非法名字 → <code>kInvalidArgument</code>。</li><li><code>device_index</code>：可选，省略为 <code>0</code>；非负整数，非法 → <code>kInvalidArgument</code>。</li><li><code>params</code>：可选（缺省为空 map）；键和值都必须是标量。每个算子的描述符自行校验必填项与类型。</li><li>YAML 语法错误 → <code>kInvalidArgument</code>。</li></ul>
<hr>
<h2>4. 环境优先级</h2>
<p>执行环境按以下优先级解析，高优先级命中后低优先级<strong>完全被忽略</strong>：</p>
<table><thead><tr><th>优先级</th><th>触发条件</th><th>行为</th></tr></thead><tbody><tr><td>1</td><td>环境变量 <code>hpcplatform_BACKEND</code> 非空</td><td>所有对象共享<strong>同一个</strong> <code>Context</code>；<code>backend</code> / <code>cpu_level</code> / <code>device_index</code> 全部来自环境变量，配置里的环境字段被忽略</td></tr><tr><td>2</td><td>调用 <code>LoadOperators(path, shared_context)</code> 传入非空 <code>shared_context</code></td><td>所有对象共享该 <code>Context</code>；配置环境字段被忽略；<code>cpu_level</code> 取 <code>naive</code></td></tr><tr><td>3</td><td>（默认）</td><td>每个条目按自己的 <code>backend</code> / <code>cpu_level</code> / <code>device_index</code> 各自 <code>Context::Create</code>，对象各自持有独立 <code>Context</code></td></tr></tbody></table>
<p>环境变量：</p>
<ul><li><code>hpcplatform_BACKEND</code>：<code>native_cpu</code> / <code>opencv</code> / <code>cuda</code> / <code>npu</code>。</li><li><code>hpcplatform_CPU_LEVEL</code>（可选）：省略为 <code>naive</code>。</li><li><code>hpcplatform_DEVICE_INDEX</code>（可选）：省略为 <code>0</code>。</li></ul>
<p><strong>无静默回退</strong>：优先级 1 或 2 请求的后端若无法创建（未编译、设备不可用），整个 <code>LoadOperators</code> 返回错误，不会降级到配置里的后端或 CPU。例如在未编译 CUDA 的构建里设置 <code>hpcplatform_BACKEND=cuda</code> → 失败。</p>
<p>传入 <code>nullptr</code> 作为 <code>shared_context</code> → <code>kInvalidArgument</code>（不是"不共享"，而是参数错误）。</p>
<hr>
<h2>5. 对象模型</h2>
<ul><li><code>Operator</code>（<code>include/hpcplatform/operator.h</code>）是元数据基类，不含 <code>Run</code>（不假设输入输出元数）：<ul><li><code>name()</code> / <code>kind()</code> / <code>backend()</code> / <code>cpu_level()</code> / <code>context()</code>。</li><li>持有 <code>std::shared_ptr&lt;Context&gt;</code>，可与其他对象共享。</li></ul></li><li>每个具体算子在自己的公共头追加派生类（如 <code>ResizeOperator</code>、<code>GaussianBlurOperator</code>），提供<strong>强类型</strong> <code>Run(...)</code>，内部调用已有的公共自由函数，因此 <code>Run</code> 的结果与直接调用<strong>位精确一致</strong>。</li><li><code>OperatorMap = std::map&lt;std::string, std::unique_ptr&lt;Operator&gt;&gt;</code>。</li><li><code>GetOperator&lt;T&gt;(const OperatorMap&amp;, name)</code>：名字不存在或动态类型不是 <code>T</code> 返回 <code>nullptr</code>，由调用方决定如何处理。</li></ul>
<hr>
<h2>6. 错误语义（fail-fast）</h2>
<p><code>LoadOperators*</code> 在构造<strong>任何</strong>对象之前，先对所有条目做完整校验：</p>
<ol><li><code>op</code> 名能找到描述符；</li><li><code>ValidateParams</code> 通过；</li><li>环境能解析（<code>Context::Create</code> 成功 / 共享 context 合法）；</li><li><code>FindKernel(desc-&gt;Kind(), backend, cpu_level)</code> 可用（顺带强制：非 CPU 后端 + 非 naive 级别 → <code>kInvalidArgument</code>，与 <code>ValidateInvocation</code> 一致）。</li></ol>
<p>任一条失败 → 立即返回错误，<code>OperatorMap</code> 保持空，<strong>不产生任何半成品对象</strong>。全部通过后才逐条 <code>Construct</code> 填入 map。</p>
<p>错误码三分类（与全局错误模型一致）：</p>
<table><thead><tr><th>错误码</th><th>触发场景</th></tr></thead><tbody><tr><td><code>kInvalidArgument</code></td><td>未知 op、缺/错参数、重名、YAML 语法错、非法 backend/cpu_level/device_index 名字、非 CPU + 非 naive 级别组合、null shared_context</td></tr><tr><td><code>kUnsupported</code></td><td>请求的 backend 未编译进当前构建（如无 CUDA 构建里请求 cuda）</td></tr><tr><td><code>kNotImplemented</code></td><td>backend 已编译但该 <code>(op, level)</code> 没有内核实现</td></tr></tbody></table>
<hr>
<h2>7. 支持的算子参数</h2>
<h3><code>resize</code></h3>
<table><thead><tr><th>参数</th><th>类型</th><th>约束</th></tr></thead><tbody><tr><td><code>output_height</code></td><td>整数</td><td><code>&gt; 0</code></td></tr><tr><td><code>output_width</code></td><td>整数</td><td><code>&gt; 0</code></td></tr><tr><td><code>interpolation</code></td><td>字符串</td><td><code>nearest</code> / <code>bilinear</code></td></tr><tr><td><code>layout</code></td><td>字符串</td><td><code>nhwc</code> / <code>nchw</code></td></tr></tbody></table>
<p><code>Run(const Tensor&amp; input)</code> 返回 <code>Result&lt;Tensor&gt;</code>，等价于 <code>hpcplatform::Resize(ctx, input, output_height, output_width, interpolation, layout)</code>。</p>
<h3><code>gaussian_blur</code></h3>
<table><thead><tr><th>参数</th><th>类型</th><th>约束</th></tr></thead><tbody><tr><td><code>kernel_size</code></td><td>整数</td><td>奇数且 <code>&gt;= 3</code></td></tr><tr><td><code>sigma</code></td><td>浮点数</td><td>有限且 <code>&gt; 0</code></td></tr><tr><td><code>layout</code></td><td>字符串</td><td><code>nhwc</code> / <code>nchw</code></td></tr></tbody></table>
<p><code>Run(const Tensor&amp; input)</code> 返回 <code>Result&lt;Tensor&gt;</code>，等价于 <code>hpcplatform::GaussianBlur(ctx, input, kernel_size, sigma, layout)</code>。</p>
<h3><code>laplacian_pyramid</code></h3>
<table><thead><tr><th>参数</th><th>类型</th><th>约束</th></tr></thead><tbody><tr><td><code>levels</code></td><td>整数</td><td><code>&gt;= 1</code>，且每级尺寸保持 <code>&gt;= 2x2</code></td></tr><tr><td><code>kernel_size</code></td><td>整数</td><td>奇数且 <code>&gt;= 3</code></td></tr><tr><td><code>sigma</code></td><td>浮点数</td><td>有限且 <code>&gt; 0</code></td></tr><tr><td><code>layout</code></td><td>字符串</td><td><code>nhwc</code> / <code>nchw</code></td></tr></tbody></table>
<p><code>Run(const Tensor&amp; input)</code> 返回 <code>Result&lt;LaplacianPyramid&gt;</code>（<code>levels</code> 含 <code>levels + 1</code> 个张量：前 <code>levels</code> 个为带通层，最后一个为最粗残差），等价于 <code>hpcplatform::BuildLaplacianPyramid(ctx, input, levels, kernel_size, sigma, layout)</code>。只接受 <code>f32</code> / <code>f64</code> 输入。</p>
<h3><code>fourier_transform</code></h3>
<table><thead><tr><th>参数</th><th>类型</th><th>约束</th></tr></thead><tbody><tr><td><code>layout</code></td><td>字符串</td><td><code>nhwc</code> / <code>nchw</code></td></tr></tbody></table>
<p><code>Run(const Tensor&amp; input)</code> 返回 <code>Result&lt;ComplexImage&gt;</code>（<code>real</code> / <code>imag</code> 两个同形张量），等价于 <code>hpcplatform::FourierTransform(ctx, input, layout)</code>。只接受 <code>f32</code> / <code>f64</code> 输入。</p>
<h3><code>wavelet_transform</code></h3>
<table><thead><tr><th>参数</th><th>类型</th><th>约束</th></tr></thead><tbody><tr><td><code>kind</code></td><td>字符串</td><td><code>haar</code> / <code>db4</code></td></tr><tr><td><code>layout</code></td><td>字符串</td><td><code>nhwc</code> / <code>nchw</code></td></tr></tbody></table>
<p><code>Run(const Tensor&amp; input)</code> 返回 <code>Result&lt;WaveletBands&gt;</code>（<code>ll</code> / <code>lh</code> / <code>hl</code> / <code>hh</code>），等价于 <code>hpcplatform::WaveletTransform(ctx, input, kind, layout)</code>。输入 H/W 必须为偶数，只接受 <code>f32</code> / <code>f64</code>。</p>
<p>新增算子仍按同一描述符模式接入，接入步骤见 <a href="architecture.html"><code>architecture.md</code></a> §10。</p>
<hr>
<h2>8. 环境切换示例</h2>
<p>同一份配置，不改代码即可换后端：</p>
<pre><code class="language-bash"># 实验机：CPU
./05_config_operator samples/configs/operators.yaml

# 生产机：整块切到 CUDA（需 CUDA 构建）
hpcplatform_BACKEND=cuda hpcplatform_DEVICE_INDEX=0 ./05_config_operator samples/configs/operators.yaml</code></pre>
<p>设置 <code>hpcplatform_BACKEND</code> 后，配置里每个条目的 <code>backend</code> 字段都被忽略，所有对象共享同一个 CUDA <code>Context</code>。</p>
      <div class="article-nav"><a href="architecture.html"><span class="lbl">上一篇</span>架构设计</a><a class="next" href="qa-overview.html"><span class="lbl">下一篇</span>问答与易错点总览</a>

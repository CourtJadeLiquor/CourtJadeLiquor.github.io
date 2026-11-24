---
layout: article
title: "构建与对拍测试"
date: 2026-11-11
column: "HPCPlatform"
section: "问答与易错点"
order: 11
permalink: /articles/qa-testing/
tags: ["HPCPlatform", "构建", "测试"]
breadcrumbs:
  - name: "首页"
    url: "/"
  - name: "专栏"
    url: "/columns.html"
  - name: "HPCPlatform"
    url: "/column-hpcplatform.html"
  - name: "问答与易错点"
---

<blockquote><p>相关代码：<span class="code-link" title="仓库路径"><code>tests/test_utils.h</code></span>、<span class="code-link" title="仓库路径"><code>tests/CMakeLists.txt</code></span>、根 <span class="code-link" title="仓库路径"><code>CMakeLists.txt</code></span>、各算子文件夹内的 <code>CMakeLists.txt</code>。</p><p>测试框架是 <strong>GoogleTest</strong>，由 <strong>CTest</strong> 统一注册与调度；<code>gtest_main</code> 提供 <code>main()</code>，测试文件只写 <code>TEST(...)</code>。</p></blockquote>
<hr>
<h2>1. 单一全特性构建树</h2>
<p>所有 <code>hpcplatform_*</code> 开关默认 ON：OpenCV、CUDA、yaml-cpp（配置驱动算子）、TBB、OpenMP、SIMD、单测、样例与基准。<strong>不再为每个可选后端维护独立构建树</strong>——旧的 <code>default</code> / <code>full</code> / <code>asan</code> 三棵树验证矩阵已废弃。</p>
<p>构建类型由目录名推断，也不用手写 <code>-DCMAKE_BUILD_TYPE</code>：</p>
<table><thead><tr><th>目录</th><th>构建类型</th><th>Sanitizer</th></tr></thead><tbody><tr><td><code>build_debug</code></td><td>Debug</td><td>默认 ON（ASan + UBSan）</td></tr><tr><td><code>build_release</code></td><td>Release</td><td>默认 OFF</td></tr></tbody></table>
<pre><code class="language-bash">cmake -S . -B build_debug
cmake --build build_debug -j
ctest --test-dir build_debug --output-on-failure</code></pre>
<p>Release 构建同理：</p>
<pre><code class="language-bash">cmake -S . -B build_release
cmake --build build_release -j
ctest --test-dir build_release --output-on-failure</code></pre>
<p>常用选项：</p>
<pre><code class="language-bash">ctest --test-dir build_debug -R test_resize          # 只跑匹配的用例
ctest --test-dir build_debug --rerun-failed          # 重跑上次失败的用例
ctest --test-dir build_debug -N                      # 只列出用例</code></pre>
<p>明确需要裁剪特性时仍可单独关掉开关（例如没有 CUDA 的机器 <code>-Dhpcplatform_WITH_CUDA=OFF</code>），但这属于例外，不再是默认验证路径。</p>
<h3>1.1 本环境的已知坑</h3>
<ul><li><strong><code>env -u LD_LIBRARY_PATH</code></strong>：IDE 可能往 <code>LD_LIBRARY_PATH</code> 里塞一个旧版 <code>libstdc++</code>，导致测试运行时报符号错误。解法：跑 <code>ctest</code> 前加 <code>env -u LD_LIBRARY_PATH</code>。</li><li><strong>CUDA 与 LeakSanitizer</strong>：NVIDIA 驱动在 <code>cuDriverGetVersion()</code> 后会保留进程级状态，LSan 会把它当成泄漏。<code>hpcplatform_ENABLE_SANITIZERS</code> 且 <code>hpcplatform_WITH_CUDA</code> 时，<code>hpcplatform_add_test</code> 会自动给测试设置 <code>ASAN_OPTIONS=detect_leaks=0</code>；ASan/UBSan 的错误检测仍然开启。</li><li><strong>没有 GPU / 内存不足</strong>：CUDA 用例会打印 SKIP 并把用例判为通过，不会把整份 <code>ctest</code> 搞红，见第 3 节。</li></ul>
<hr>
<h2>2. GoogleTest 约定</h2>
<h3>2.1 文件与用例</h3>
<pre><code class="language-cpp">#include "test_utils.h"   // 已包含 &lt;gtest/gtest.h&gt; 与 hpcplatform_EXPECT_OK

#include "hpcplatform/hpcplatform.h"

namespace {
  
using namespace hpcplatform;

TEST(hpcplatform, ShapeRankAndNumel) {
  const Shape shape{2, 3, 4};
  EXPECT_EQ(shape.Rank(), 3);
  EXPECT_EQ(shape.Numel(), static_cast&lt;int64_t&gt;(24));
}

}  // namespace</code></pre>
<ul><li>套件名统一用 <code>hpcplatform</code>，用例名用原测试函数名（PascalCase），例如 <code>TEST(hpcplatform, ResizeU8LevelsAreBitExact)</code>。</li><li>每个测试文件编成一个独立可执行文件，由 <code>gtest_main</code> 提供入口，<strong>不再写 <code>main()</code></strong>。</li><li><code>EXPECT_*</code> 非致命；<code>ASSERT_*</code> 致命。hpcplatform 不用异常，<code>Result::value()</code> 在失败时返回默认构造值，所以<strong>用 <code>.value()</code> 前先判 <code>ok()</code></strong>，拿不准时用 <code>ASSERT_TRUE(result.ok())</code> 直接短路。</li></ul>
<h3>2.2 Status 断言</h3>
<p><code>tests/test_utils.h</code> 只保留一个项目侧宏：</p>
<pre><code class="language-cpp">hpcplatform_EXPECT_OK(expr);   // 等价于 EXPECT_TRUE(expr.ok())，失败时附带 Status 消息</code></pre>
<p>其余断言全部使用 GoogleTest 原生宏（<code>EXPECT_TRUE/FALSE/EQ/NE/...</code>、<code>EXPECT_THAT</code> 等）。</p>
<h3>2.3 新增测试</h3>
<ol><li>新建 <code>tests/core/test_xxx.cpp</code>（核心层）、<code>tests/backends/test_xxx.cpp</code>（后端）或 <code>src/ops/&lt;op&gt;/tests/test_xxx.cpp</code>（算子内）。</li><li>引入 <code>test_utils.h</code>，写若干 <code>TEST(hpcplatform, ...)</code>。</li><li>登记构建：<ul><li>核心层：把文件名加进 <span class="code-link" title="仓库路径"><code>tests/core/CMakeLists.txt</code></span> 的 <code>hpcplatform_CORE_TEST_SOURCES</code>；</li><li>后端层：仿照 <span class="code-link" title="仓库路径"><code>tests/backends/CMakeLists.txt</code></span> 用 <code>if(hpcplatform_WITH_xxx)</code> 包住 <code>hpcplatform_add_test(...)</code>；</li><li>算子内：在算子 <code>CMakeLists.txt</code> 的 <code>if(hpcplatform_BUILD_TESTS)</code> 里加一行 <code>hpcplatform_add_test(...)</code>。</li></ul></li><li><code>hpcplatform_add_test(target sources...)</code> 负责链接 <code>hpcplatform</code> 与 <code>GTest::gtest_main</code>、添加 include 路径并调用 <code>add_test()</code>。</li></ol>
<hr>
<h2>3. 没有 GPU / 后端未编译：跳过</h2>
<p>可选后端不可用时，测试必须自己跳过并返回成功：</p>
<pre><code class="language-cpp">TEST(hpcplatform, CudaSomething) {
  auto ctx = GetCudaContext();
  if (!ctx) return;   // 辅助函数已打印 SKIP，用例仍算 PASS
  ...
}</code></pre>
<p>新写的用例更推荐 GoogleTest 原生的跳过方式，CTest 会显示为 <code>Skipped</code>：</p>
<pre><code class="language-cpp">TEST(hpcplatform, CudaSomething) {
  auto ctx = GetCudaContext();
  if (!ctx) GTEST_SKIP() &lt;&lt; "CUDA is unavailable";
  ...
}</code></pre>
<p>要点：</p>
<ul><li><code>Context::Create</code> 失败时返回 <code>kUnsupported</code>（不抛异常），用 <code>ok()</code> 判断。</li><li>跳过要让人在日志里看得见，不要静默返回。</li><li>后端未编译进来时，对应测试目标本身就不构建（CMake 门控），而不是运行时跳过。</li></ul>
<hr>
<h2>4. 容差约定：什么时候位精确，什么时候放容差</h2>
<h3>4.1 CPU 各版本之间：位精确（bit-exact）</h3>
<p>同一算子的不同 CPU 实现（naive / OpenMP / TBB / SIMD / AVX2）必须逐字节相同，对拍直接 <code>memcmp</code>：</p>
<pre><code class="language-cpp">EXPECT_EQ(std::memcmp(actual.data(), reference.data(), reference.ByteSize()), 0);</code></pre>
<ul><li>整数与浮点都要求位精确，这强制 SIMD/并行版本的计算顺序与 naive 一致。</li><li>想放宽？先按<a href="architecture.html">架构设计 §6.2</a> 的位精确纪律走评审决策，不能在测试里私自改容差。</li><li>现有例子：<code>ResizeU8LevelsAreBitExact</code>、<code>GaussianBlurCpuLevelsAreBitExact</code>、<code>FourierCpuLevelsAreBitExact</code>、<code>WaveletCpuLevelsAreBitExact</code>。</li></ul>
<h3>4.2 跨后端：有限容差</h3>
<p>CPU ↔ CUDA / OpenCV 之间，因浮点运算顺序、硬件融合乘加等差异，不要求位精确。两个后端测试文件各自定义 <code>ExpectEquivalent(...)</code>：CUDA 见 <span class="code-link" title="仓库路径"><code>test_cuda_backend.cpp</code></span>，OpenCV 见 <span class="code-link" title="仓库路径"><code>test_opencv_backend.cpp</code></span>。</p>
<p>实际取值规则（新增同类测试照此对齐，不要自己发明新数值）：</p>
<table><thead><tr><th>场景</th><th>容差</th><th>说明</th></tr></thead><tbody><tr><td>f32 / f64 跨后端</td><td><code>1e-4</code> 相对误差</td><td><code>ExpectEquivalent</code> 的默认值，resize/warp 也用默认</td></tr><tr><td>u8 跨后端（OpenCV）</td><td>允许 ±1；显式传 <code>0.0</code> 则位精确</td><td><code>allowed_error = tolerance == 0.0 ? 0 : 1</code></td></tr><tr><td>u8 / 整数 跨后端（CUDA）</td><td>位精确（<code>memcmp</code>）</td><td>CUDA 版 <code>ExpectEquivalent</code> 只对 f32/f64 走容差分支</td></tr><tr><td>原始字节拷贝往返</td><td>显式传 <code>0.0</code> → 位精确</td><td></td></tr><tr><td>f16 转换往返</td><td><code>0.001</code></td><td>f16 精度有限，放宽到 1e-3</td></tr></tbody></table>
<blockquote><p>相对误差指 <code>|a-b| &lt;= tol * max(1.0, |a|)</code>；<code>max(1.0, ...)</code> 让接近 0 的值退化为绝对误差，避免除以极小值放大误报。</p></blockquote>
<h3>4.3 不确定就从严</h3>
<p>拿不准该用多少容差时，先按位精确写，跑不过再分析是否确属硬件差异。放松容差要在测试注释里写清理由，不能为了让测试变绿而调大。</p>
<hr>
<h2>5. 基准（benchmark）</h2>
<p><code>hpcplatform_BUILD_BENCHMARKS=ON</code>（默认开）时，各算子文件夹内的 <code>benchmark/</code> 会编出各自的基准可执行：</p>
<ul><li><code>src/ops/resize/benchmark/</code> → <code>resize_benchmark</code></li><li><code>src/ops/gaussian_blur/benchmark/</code> → <code>gaussian_blur_benchmark</code></li><li><code>src/ops/laplacian_pyramid/benchmark/</code> → <code>laplacian_pyramid_benchmark</code></li><li><code>src/ops/fourier/benchmark/</code> → <code>fourier_benchmark</code></li><li><code>src/ops/wavelet/benchmark/</code> → <code>wavelet_benchmark</code></li></ul>
<p>基准是<strong>手工性能工具，不注册进 CTest</strong>，不影响 <code>ctest</code> 的通过判定；用 Release 树跑才有意义：</p>
<pre><code class="language-bash">./build_release/src/ops/resize/resize_benchmark
./build_release/src/ops/gaussian_blur/gaussian_blur_benchmark
./build_release/src/ops/laplacian_pyramid/laplacian_pyramid_benchmark
./build_release/src/ops/fourier/fourier_benchmark
./build_release/src/ops/wavelet/wavelet_benchmark</code></pre>
<p>基准的解读纪律（怎么对比才算公平、怎么避免 <code>-march=native</code> 污染结论）见<a href="architecture.html">架构设计 §8.2</a> 的剖析与基准约定。</p>
      <div class="article-nav"><a href="qa-error-model.html"><span class="lbl">上一篇</span>错误模型</a><a class="next" href="roadmap.html"><span class="lbl">下一篇</span>版本演进 v1 → v2</a>

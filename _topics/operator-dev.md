---
title: "算子开发"
description: "以图像与变换算子为样本，讨论 Tensor 抽象、多后端分发与逐层优化，全部资料来自真实项目文档。"
tagline: "高性能算子与 HPCPlatform"
icon: '<svg viewBox="0 0 24 24"><path d="M12 3 21 7.5v9L12 21 3 16.5v-9L12 3Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>'
permalink: /topics/operator-dev.html
---

## 写作计划

- Tensor / Buffer / Context 基础抽象
- CPU 多后端：标量 / SIMD / TBB
- CUDA 后端：kernel 组织、shared memory、stream 可见性
- 算子分发：注册表 + 错误模型
- 构建与测试：cmake + gtest + 对拍

### 关联专栏

- [HPCPlatform 算子平台]({{ '/column-hpcplatform.html' | relative_url }}) — 12 篇完整文档

# 架构决策记录 (Architecture Decision Records - 中文版)

> English version is available at [../README.md](../README.md).

本项目采用架构决策记录（Architecture Decision Record, ADR）来沉淀核心设计决策、背景动因及其权衡（Trade-offs），确保项目演进过程中的架构一致性与可追溯性。

## ADR 索引清单

| 编号 | 标题 | 状态 | 日期 | 核心摘要 |
| :--- | :--- | :--- | :--- | :--- |
| [ADR-0001](./0001-purge-fuzzy-semantic-cache.md) | 彻底物理移除本地模糊语义缓存 | **已接受 (Accepted)** | 2026-09-29 | 根除 System Prompt 主导导致的余弦相似度虚高与回答串味问题，确保穿透透明与零残留 |
| [ADR-0002](./0002-dynamic-model-discovery-via-opencode.md) | 基于 OpenCode 的 100% 动态模型发现与自适应分层 | **已接受 (Accepted)** | 2026-09-29 | 彻底废除静态 providers/models 硬编码，完全由本地 OpenCode 运行时接管模型发现、分层与鉴权代理 |
| [ADR-0003](./0003-language-neutral-routing-engine.md) | 语言中立的多维复杂度与结构化路由引擎 | **已接受 (Accepted)** | 2026-09-29 | 摒弃中英文自然语言词表硬编码，改用语法标点密度、LaTeX 形式数学、跨语言技术缩写与动态规则 |
| [ADR-0004](./0004-hierarchical-classification-and-data-flywheel.md) | 多层分类架构与数据飞轮演进体系 | **已实现 (Accepted)** | 2026-09-29 | 落地 Layer 0 结构规则 -> Layer 1 本地 CPU 经验小模型 -> Layer 2 专职裁决模型 (TypeSafe Jev) -> 级联降级真值闭环 |
| [ADR-0005](./0005-auto-initializing-base-model-scaffold.md) | 本地空白底座模型自动初始化与确定性穿透 | **已实现 (Accepted)** | 2026-09-29 | 自动落盘未训练微张量底座 (W=0, b=0)，数学严格保证置信度 0.33 < 0.85，100% 确定性穿透至 Layer 2 并支持飞轮原地自演进 |
| [ADR-0006](./0006-monotonic-session-ratchet-and-prefix-fingerprinting.md) | 多轮会话单调递增升档与前缀指纹追踪 | **已实现 (Accepted)** | 2026-09-29 | 解决中途乱切导致的智力倒退与 KV Cache 归零问题，无粘性头下利用前缀链哈希 100% 精准定位并执行只升不降 |
| [ADR-0007](./0007-symmetrical-pipeline-naming-classifier-and-judge.md) | 层级对称性流水线命名演进：Layer 1 分类器冲锋与 Layer 2 裁决者断后 | **已实现 (Accepted)** | 2026-09-29 | 消除突兀空间命名，确立 layer1-classifier（极速冲锋）与 layer2-judge（专职语义裁决）对称体系并彻底清理旧存根 |


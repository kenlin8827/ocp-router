# ADR-0007: 层级对称性流水线命名演进：Layer 1 分类器冲锋与 Layer 2 裁决者断后

## 状态
已接受并实现 (Accepted & Implemented) - 2026-09-29

## 上下文 (Context)
在三层全模型驱动路由架构演进中，`src/router/` 目录下的核心文件命名逐渐暴露了不对称与概念割裂的问题：
1. **空间位置与流水线层级混搭**：`local-classifier.ts` 使用空间物理位置（`local` 本地），而 `layer2-decision.ts` 使用层级编号（`layer2`）。两者并列在同一目录下显得突兀；
2. **名词术语不一致**：一个使用 `classifier`（分类器），另一个使用 `decision`（决策）；
3. **心智模型不够直观**：初次阅读代码的开发者难以一眼看出 `local-classifier` 即是 `layer2-decision` 的前置第一层（Layer 1）。

## 决策 (Decision)
全面推行**严格对称、层级分明、职能聚焦**的标准命名规范：

1. **统一核心模块命名**：
   - `src/router/layer1-classifier.ts`（类名 `Layer1Classifier`）：Layer 1 极速冲锋层，基于本地 CPU 微张量（<0.1ms）完成 8 维统计特征推理与置信度门控。
   - `src/router/layer2-judge.ts`（类名 `Layer2Judge`）：Layer 2 专职裁决层，携带多轮历史对话上下文，执行高精度语义意图与难度裁决。
2. **统一模型底座文件名**：
   - 默认模型底座标准化为 `models/layer1-classifier.json`，并支持向后自动兼容读取 `local-classifier.json`。
3. **统一飞轮蒸馏训练脚本**：
   - 新增 `scripts/train-layer1-classifier.ts`（对应命令 `bun run train:layer1`），与 Layer 1 模块精准呼应。
4. **彻底物理移除旧遗留文件（零残留原则 Zero Cruft）**：
   - 贯彻 ADR-0001 的零硬编码与彻底物理清理哲学，原遗留文件 `src/router/local-classifier.ts`、`src/router/layer2-decision.ts`、`models/local-classifier.json` 与 `scripts/train-local-classifier.ts` **全部彻底删除**，绝不保留死代码与跳转存根（stubs）；
   - 代码库内所有引用与导出全部原子化更新至 `layer1-classifier` 与 `layer2-judge`，消除认知断层；
   - 模型加载器（Loader）保留对历史外部存量模型文件的容错探测回退能力。

```
决策流向图：
[Layer 0: 协议结构约束]
       │
       ▼
[Layer 1: layer1-classifier.ts (分类器冲锋)] ──(高置信度 >= 0.85)──► 直接秒级路由
       │
       ▼ (置信度不足或未训练空白底座)
[Layer 2: layer2-judge.ts (裁决者断后)] ──────────────────────────► 权威语义判决
```

## 后果与影响 (Consequences)
- **正面影响**：
  - 目录树形成标准的阶梯流水线，语义直观、层级对称、一目了然（“分类器冲锋，裁决者断后”）；
  - 代码、模型资产、配置文件与架构文档实现 100% 概念统一；
  - 彻底消灭僵尸代理与存根文件，保持开源项目代码库的极简与清爽。

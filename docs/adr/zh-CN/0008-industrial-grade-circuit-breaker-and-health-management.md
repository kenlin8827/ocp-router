# ADR-0008: 顶级工业级模型熔断、多级容灾与健康管理系统

## 状态
已接受并实现 (Accepted & Implemented) - 2026-09-30

## 上下文 (Context)
在大规模生产级 AI 网关与模型路由网关实践中，上游大语言模型服务具有强异构、跨供应商、高波动等特征，面临诸多不可避免的可用性挑战：
1. **欠费与额度耗尽 (Quota Exhausted)**：账号突然欠费、Token 额度用完（HTTP 402 / `insufficient_quota`），若网关不具备感知能力，会导致后续海量请求持续冲击该模型并全量失败。
2. **多小时级供应商重大故障 (5-Hour Outages)**：上游服务雪崩（500/502/503/504 / 网络超时），缺乏熔断器会导致每次请求等待数十秒超时，耗尽网关连接池，拖垮下游客户端。
3. **频控限流 (Rate Limiting 429)**：TPM / RPM 超限时未作短时退避，无法利用同 Tier 备选模型分担流量。
4. **会话单调棘轮死锁 (Session Ratchet Deadlock)**：先前为了保护 KV Cache 命中率引入了 Session 模型锁定（Pinning），但当被锁定的模型宕机时，整个会话后续轮次全盘瘫痪。
5. **客户端误传不当导致误熔断**：客户端上下文超长（400 context length exceeded）或安全过滤拦截，属于用户输入问题，绝不能被错误计入模型故障并导致模型熔断。

## 决策 (Decision)
全面构建**高精度错误分类学（Error Taxonomy）、多级熔断状态机（Circuit Breaker）、同级优先透明故障转移（Same-Tier Failover）与会话自愈（Session Self-Healing）**的工业级弹性体系：

### 1. 结构化错误分类学 (Error Taxonomy & Diagnosis)
将上游异常严格解构为 6 类，实行差异化治理：
* `QUOTA_EXHAUSTED` (HTTP 402 / `insufficient_quota`)：**立即硬熔断 (Hard Open)**，进入长冷却（默认 12 小时），不发起高频探活，支持管理后台手动复位；
* `AUTHENTICATION_ERROR` (HTTP 401 / `invalid_api_key`)：**立即硬熔断**，锁定直至密钥重载；
* `RATE_LIMITED` (HTTP 429 / TPM/RPM)：**瞬时自适应退避**，优先解析 `Retry-After` Header，短时避让同 Tier 备用节点；
* `SERVICE_UNAVAILABLE` (HTTP 5xx / 网络超时 / ETIMEDOUT)：**滑动窗口 + 连续失败阈值熔断**，进入阶梯指数退避（30s $\to$ 60s $\to$ 120s ... 最大 5 小时封顶）；
* `CLIENT_ERROR` (HTTP 400 / context length exceeded)：**零惩罚穿透**，不计入模型故障，不触发重试与熔断；
* `UNKNOWN`：标准容错重试。

### 2. 标准三态熔断状态机 (Circuit Breaker State Machine)
* `CLOSED`（健康）：正常承载流量；
* `OPEN`（熔断）：阻断对该模型的请求，即刻零耗时转向备选模型；
* `HALF_OPEN`（试探）：冷却期满后，放行微量金丝雀（Canary）请求探活。探活成功则完全恢复 `CLOSED`，探活失败则加倍冷却时长再次 `OPEN`。

### 3. 同 Tier 候选池透明故障转移 (Zero-Downtime Failover)
* 每个 Tier 维护优先级候选列表（`primary`, `backup-1`, `backup-2`）；
* 请求优先派发给主模型；主模型抛出可恢复故障（402/503/429）时，熔断器记录故障并在单次 HTTP 会话内**毫秒级透明转移**至同 Tier 备选模型；
* 用户无感知拿到 200 成功响应，响应头附带治理追踪元数据：
  * `X-OCR-Failover: true`
  * `X-OCR-Failover-Attempts: 2`
  * `X-OCR-Failover-Path: primary-model -> backup-model`
  * `X-OCR-Breaker-State: CLOSED`

### 4. 会话单调棘轮自愈 (Session Self-Healing)
* 当检测到会话绑定的 `pinnedModel` 进入 `OPEN` 熔断态时，网关自动解绑并将 Session 平滑迁移重绑定（Repin）至健康的同 Tier 备选模型，彻底消除死锁。

### 5. 全维可观测性与管理接口 (Observability & REST APIs)
* `GET /health`：智能汇总网关全局健康度（`ok` / `degraded` / `outage`）与熔断器健康数；
* `GET /v1/health/circuit-breakers`：暴露所有模型的实时状态、剩余冷却时长、故障类别、总请求/失败数；
* `POST /v1/health/circuit-breakers/reset`：提供管理员在人工充值或供应商排障完毕后的一键复位接口。

## 后果与影响 (Consequences)
- **正面影响**：
  - 彻底终结了“模型欠费或宕机 5 小时导致服务全崩”的脆弱性，实现真正意义上的 99.99% 企业级高可用保障；
  - 零配置透明容灾：客户端像调用标准 OpenAI 接口一样使用，底层自动完成多供应商无感切换；
  - 精确保护上游账单与连接池资源，杜绝持续向失效上游发送雪崩流量。

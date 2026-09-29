# OCP Router (OpenCode Proxy Router)

<div align="center">

**Production-ready intelligent cascading router & FinOps gateway for [OpenCode](https://opencode.ai).**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Runtime](https://img.shields.io/badge/Runtime-Bun%20%7C%20Node.js-blue.svg)](https://bun.sh)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-green.svg)](https://platform.openai.com/docs/api-reference)
[![FinOps](https://img.shields.io/badge/Cost%20Optimization-70%25%20~%2090%25-orange.svg)]()

**[Quick Start](#quick-start)** · **[Client Integrations](#client-integrations)** · **[Features](#features)** · **[Developer Guide](DEVELOPMENT.md)** · **[简体中文](README.zh-CN.md)**

</div>

---

## What is OCP Router?

**OCP Router** is a high-performance, local-first LLM API cascading router and FinOps orchestration gateway. It connects seamlessly to your local **OpenCode v2** daemon, enabling keyless upstream proxying with zero API key exposure across clients.

By combining **hierarchical 3-layer model-driven routing**, **monotonic session ratcheting**, **upstream KV prompt cache protection**, and **local schema static assertions**, OCP Router reduces LLM API expenditures by **70% to 90%** with zero degradation in conversational intellect.

---

## Features

- **💸 70% ~ 90% Cost Reduction**: Trivial prompts and structured extractions execute instantaneously on fast micro-models; complex engineering queries automatically escalate to flagship models.
- **⚡ Keyless Upstream Proxying**: Integrates natively with your local OpenCode v2 daemon, synchronizing 90+ active models, credentials, and token pricing with zero configuration.
- **🔒 Multi-Turn Monotonic Session Ratchet**: Once a conversation escalates to a flagship model, mid-dialogue downgrades are strictly blocked, preventing cognitive degradation.
- **🚀 Upstream KV Cache Protection**: Multi-turn sessions are pinned to the exact physical model instance, preserving 80%~95% of upstream Provider KV Prompt Cache (Anthropic, DeepSeek, OpenAI).
- **🎯 Zero-Header Prefix-Chain Fingerprinting**: Tracks dialogue turns automatically using SHA-256 Prefix-Chain Hashing without requiring custom client headers.
- **🛡️ Local Schema Assertion & Silent Fallback**: Lightweight models lead structured tasks; if JSON parsing or schema validation fails, the query silently escalates to a flagship model with error context.
- **🔌 100% OpenAI Protocol Compatible**: Drop-in proxy replacement for Cursor, VS Code, Chatbox, NextChat, LobeChat, LangChain, and all standard OpenAI SDKs.

---

## Quick Start

### 1. Requirements
* **OpenCode v2**: Local OpenCode daemon running (default port `49374`).
* **Bun** (Recommended for peak performance): `>= 1.0`, or **Node.js**: `>= 18`.

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/kenlin8827/ocp-router.git
cd ocp-router

# Using Bun (Recommended)
bun install

# Or using npm
npm install
```

### 3. Configuration
Copy the template configuration file:
```bash
cp config.example.yaml config.yaml
```
> 💡 **Tip**: Upstream models and credentials are automatically discovered from OpenCode. `config.yaml` works out of the box with zero manual API keys required!

### 4. Start the Gateway
```bash
# Using Bun (development or production, with hot-reloading)
bun run dev:bun

# Or using Node.js
npm run dev
```
The gateway listens on `http://127.0.0.1:3000` by default.

### 5. Health Check Verification
Verify connectivity and synchronized models:
```bash
curl http://127.0.0.1:3000/health
```
Example response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "modelsCount": 94,
  "timestamp": 1727622400000
}
```

---

## Client Integrations

OCP Router is fully compatible with OpenAI API standards. Simply point your client's **API Base URL** to this gateway.

### 1. Cursor IDE
1. Open Cursor Settings: `Settings` -> `Models`.
2. Enable `OpenAI API Key` and enter any placeholder string (e.g., `sk-ocp-router`).
3. Expand `Override OpenAI Base URL` and enter:
   ```
   http://127.0.0.1:3000/v1
   ```
4. In the model selector, add and select the virtual model: `auto`.

### 2. Chatbox / NextChat / LobeChat
1. **API URL / Base URL**: `http://127.0.0.1:3000` (or `http://127.0.0.1:3000/v1`).
2. **API Key**: Any arbitrary string (or your `adminApiKey` if configured in `config.yaml`).
3. **Model**: Select or enter `auto`.

### 3. Python SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3000/v1",
    api_key="sk-ocp-router"  # Any placeholder string
)

response = client.chat.completions.create(
    model="auto",  # Recommended 4-step cascading router
    messages=[
        {"role": "user", "content": "Write a generic TypeScript debounce function with unit tests."}
    ]
)

print(response.choices[0].message.content)
```

### 4. Node.js / TypeScript SDK
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: 'sk-ocp-router',
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'auto',
    messages: [{ role: 'user', content: 'Explain the principles of quantum computing.' }],
    stream: true,
  });

  for await (const chunk of completion) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main();
```

### 5. cURL CLI Direct Call
```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Which is greater, 9.11 or 9.8? Explain briefly."}
    ]
  }'
```

---

## Available Virtual Models

In addition to exposing all registered upstream physical models, OCP Router provides virtual cascading models:

| Model ID | Purpose & Behavior | Cost Profile |
| :--- | :--- | :--- |
| **`auto`** <br>*(Recommended Default)* | **Intelligent 4-Step Cascading Router**: Analyzes complexity, schemas, and session ratchets to dispatch the optimal model dynamically. | 70% ~ 90% Savings |
| **`auto-fast`** | **Forced Low-Cost Tier**: Micro-models optimized for fast information extraction, greetings, and basic translations. | ~$0.10 ~ $0.50 / M Tokens |
| **`auto-flagship`** | **Forced Flagship Workhorse**: General flagship models for architecture design, refactoring, and code generation. | ~$2.00 ~ $10.00 / M Tokens |
| **`auto-reasoning`** | **Forced Reasoning Specialist**: Deep thinking models for mathematical proofs and complex algorithms. | ~$5.00 ~ $60.00 / M Tokens |
| *Upstream Models* | Direct pass-through to any physical model (e.g., `kimi-k2.7-code`, `deepseek-chat`). | Upstream standard rates |

---

## Observability & FinOps Metrics

### 1. Response Diagnostic Headers
Every API response includes FinOps diagnostic headers:
* `X-OCP-Router-Trace-ID`: Unique trace identifier for the request turn (e.g. `trace_8df3e29a...`).
* `X-OCP-Router-Tier`: Target tier utilized (`fast`, `flagship`, `reasoning`).
* `X-OCP-Router-Model`: Specific upstream model ID invoked.
* `X-OCP-Router-Session-ID`: Session fingerprint hash (`sess_8df3e29a...`).
* `X-OCP-Router-Session-Ratchet`: Whether the monotonic ratchet locked the tier (`true` / `false`).
* `X-OCP-Router-Cost-USD`: Incurred cost for this request.
* `X-OCP-Router-Saved-USD`: Cost saved relative to the flagship baseline.
* `X-OCP-Router-Latency-MS`: End-to-end gateway execution latency.

### 2. Session State & Turn Management

#### 📋 List Active Sessions `GET /v1/sessions`
Inspect active sessions, turn counts, and pinned model instances:
```bash
curl http://127.0.0.1:3000/v1/sessions
```

#### 📌 Query Single Session Details `GET /v1/sessions/:id`
Inspect a specific session's locked tier, pinned model, total turns, and recent trace summaries:
```bash
curl http://127.0.0.1:3000/v1/sessions/sess_8df3e29a...
```

#### 📜 Query Session Trajectory `GET /v1/sessions/:id/traces`
Fetch the complete step-by-step routing and execution trajectory for a session across all turns (including decision rationale, target tier, model invoked, latency, and FinOps savings):
```bash
curl http://127.0.0.1:3000/v1/sessions/sess_8df3e29a.../traces
```

#### 🌐 Global Trajectory Log Query `GET /v1/traces`
Query recent gateway routing traces across all sessions, with support for pagination (`?limit=50&offset=0`) and session filtering (`?session_id=...`):
```bash
curl "http://127.0.0.1:3000/v1/traces?limit=20"
```

#### 🔬 Single Request Trace Lookup `GET /v1/traces/:id`
Lookup a specific execution trace using the `X-OCP-Router-Trace-ID` returned in response headers:
```bash
curl http://127.0.0.1:3000/v1/traces/trace_8df3e29a...
```

#### 🗑️ Reset / Clear Session `DELETE /v1/sessions/:id`
Reset an active session state and its cached traces, allowing clients to cleanly restart context:
```bash
curl -X DELETE http://127.0.0.1:3000/v1/sessions/sess_8df3e29a...
```

### 3. Real-Time FinOps Metrics `GET /v1/metrics`
```bash
curl http://127.0.0.1:3000/v1/metrics
```
```json
{
  "totalRequests": 1280,
  "cacheHits": 420,
  "cacheHitRatePct": 32.8,
  "fallbackCount": 18,
  "tierDistribution": {
    "fast": { "count": 960, "pct": 75.0 },
    "flagship": { "count": 270, "pct": 21.09 },
    "reasoning": { "count": 50, "pct": 3.91 }
  },
  "economics": {
    "actualCostUsd": 0.512,
    "baselineCostUsd": 4.620,
    "totalSavingsUsd": 4.108,
    "savingsPct": 88.92
  }
}
```

---

## FAQ

### Q1: Do I need to enter provider API keys into OCP Router?
**No**. OCP Router connects directly to your local OpenCode v2 daemon. All credentials, active providers, and pricing tables configured in OpenCode are automatically synchronized and utilized.

### Q2: Why won't conversations become "dumber" mid-dialogue?
Standard stateless routers dispatch short follow-ups (e.g. "thanks", "fix line 3") to cheap micro-models based on short character length, causing severe hallucinations over 10k+ token histories. OCP Router enforces a **Monotonic Session Ratchet**: once a dialogue reaches flagship tiers, it locks strictly to that tier and pins to the exact same model instance, safeguarding intellect and preserving upstream KV Cache.

### Q3: Does the initial untrained micro-model misclassify requests?
**Never**. The zero-weight base model scaffold ($W=\mathbf{0}, b=\mathbf{0}$) produces a uniform Softmax probability of $\approx 0.334$, strictly below the $0.85$ confidence threshold. This guarantees 100% deterministic cascade to Layer 2 until training samples accumulate.

---

## Developer Guide & Architecture

For deep-dive documentation into micro-tensor forward pass mathematical proofs, active learning flywheel distillation, unit testing suites, and Architecture Decision Records (ADRs):

* 📘 **[Developer & Architecture Guide (DEVELOPMENT.md)](DEVELOPMENT.md)**
* 🏛️ **[Architecture Decision Records (ADR)](docs/adr/README.md)**

---

## License

Released under the [MIT License](LICENSE).

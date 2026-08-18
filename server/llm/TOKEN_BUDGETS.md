# OpenAI 兼容通道：max_tokens 策略

## 复盘：几类「像同一个问题」的现象

| 现象 | 常见根因 | 与 token 上限关系 |
|------|----------|-------------------|
| `400 exceeded model token limit`（requested 远大于单段 8192） | **总上下文预算**：输入 + `max_tokens` 共用窗口（Moonshot 8k 等） | **强相关**：`effectiveMaxCompletionTokens` 压 `max_tokens`；若 **仅输入已超总窗口**，须换 **32k/128k** 或缩短上下文——由 `throwIfPromptExceedsSharedContext` 在发请求前给出中文说明 |
| 流式中断、网关长文（通信故障、拦截 OpenAI 等） | 中继策略/配额/路由，非本地 JSON 逻辑 | **弱相关**：换通道或模型，非 `max_tokens` 能单独解决 |
| 输出很短、`parsePartial` | `max_tokens` 过小、网关截断、或模型能力 | **可能相关**：先查本表与 `inferSharedContextWindowTokens` 是否把 `max_tokens` 压太低 |

结论：**不全是同一类 bug**；其中 **「输入 + max_tokens 超过模型总窗口」** 与 **「网关/代理策略」** 要分开排查。本仓库通过 `OPENAI_COMPATIBLE[].tokenBudget` + `effectiveMaxCompletionTokens()` 规避第一类。

## 策略枚举（`providers.js`）

- **`completion_independent`**：与 OpenAI Chat Completions 常见语义一致——在上下文窗口内，**completion 的 `max_tokens` 主要约束生成长度**，不应用「prompt 字符数 + max_tokens ≤ 8k」这类过严钳制（除非厂商文档明确要求）。
- **`shared_context_window`**：**输入 token + `max_tokens` 不得超过模型总上下文**。适用于 Moonshot（Kimi）等文档明确如此计费的 API。

## 新增或调整通道时的检查清单

1. 打开厂商 **Chat Completions / OpenAI 兼容** 文档，确认：
   - 模型上下文长度（如 8k / 32k / 128k）；
   - `max_tokens` 是否与 **prompt 共享** 同一额度。
2. 在 `OPENAI_COMPATIBLE` 中为该 `id` 设置：
   - `tokenBudget`: `completion_independent` | `shared_context_window`；
   - `maxTokens`: 希望的上限（对 `shared` 通道仍会被 `effectiveMaxCompletionTokens` 按 prompt 压降）；
   - 可选 `tokenBudgetNote` 简短说明依据。
3. 若模型名可推断档位（如 `*-8k`、`*-32k`、`kimi-k2.5` / `kimi-k2.6`），`inferSharedContextWindowTokens()` 已做通用推断；**特殊命名**需在代码里补分支或改为在配置里写死 `context`（未来可扩展）。
4. 在本文件追加一行：**厂商 + 文档链接 + 结论 + 日期**。

## 官方文档入口（维护时请核对并更新链接）

- **Moonshot / Kimi**：模型 **id** 与参数以官方 API 文档为准，例如 [Chat Completions（含模型枚举）](https://platform.moonshot.ai/docs/api/chat)；国内控制台文档入口 [platform.moonshot.cn](https://platform.moonshot.cn/docs)（站内检索 model、context、max_tokens）。**`kimi-k2.6` 等 id 须与文档/OpenAPI 完全一致**（含大小写与点号）。
- **OpenAI**：[Models](https://platform.openai.com/docs/models) 与 Chat Completions 参数说明。
- **Anthropic Claude（OpenAI 兼容层）**：[OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk)（`max_tokens` 等字段以兼容层文档为准）。
- **DeepSeek**：[API 文档](https://api-docs.deepseek.com/)（`max_tokens` 与上下文窗口说明）。
- **通义 Qwen（DashScope 兼容）**：[OpenAI 兼容接口](https://help.aliyun.com/zh/dashscope/developer-reference/compatibility-of-openai-with-dashscope)。
- **文心千帆**：以当前千帆 OpenAI 兼容版文档为准，**未在本文写死结论前勿改 `ernie` 的 tokenBudget**。

## 当前登记（与代码一致）

| providerId | tokenBudget | 备注 |
|------------|---------------|------|
| openai, anthropic, qwen, doubao, glm, minimax, deepseek, ernie | completion_independent | 遇厂商特殊限制再改 |
| kimi | shared_context_window | Moonshot：`max_tokens` + 输入 ≤ 模型上下文；`kimi-k2.5` / `kimi-k2.6` 在代码中按 **256k（262144 tokens）** 推断总窗（见上官方 Chat 文档 OpenAPI 列表，维护时核对）；**K2.5/K2.6 请求体 `temperature` 须为 1**（见 `openAiCompatTemperature`，否则 400） |

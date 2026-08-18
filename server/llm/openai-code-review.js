/**
 * CodeReviewSkill — OpenAI-compatible 实现
 *
 * 支持 tool calling（Phase 2 agent 循环）。
 * 回退：若模型不支持 tools，降级为单轮（旧行为，但使用新提示词）。
 *
 * QC-15 单层输出（与文章原文 IO 对齐）：
 *   - 输出格式：{ conclusion: 'pass'|'fail'|'uncertain', confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed }
 *   - maxTokens 全端点强制下限 8192（Q1 决议保留）
 *   - Token 双档闸门：60K chars 软警告 / 70K chars 硬上限（marker 由 dispatchToolCall 副作用暴露）
 *   - runRuleProposalPass2：独立 LLM 调用反推规则草稿（maxTokens 强下限 8192，dispatcher pass_2_token_budget_anchor）
 */
import OpenAI from 'openai'
import {
  CODE_REVIEW_SYSTEM_PROMPT,
  buildCodeReviewUserContent,
  RULE_PROPOSAL_PASS2_SYSTEM_PROMPT,
  buildRuleProposalPass2UserContent,
} from '../prompt-code-review.js'
import {
  CODE_REVIEW_TOOLS,
  dispatchToolCall,
  MAX_TOOL_CALLS,
  createAgentSessionMeta,
} from '../vcs/code-review-agent.js'
import { logLlmDebug, safeBaseUrlLabel } from './debug-llm.js'
import { setLastOpenAiCompatibleMeta } from './llmLastMeta.js'
import { openAiCompatTemperature } from './providers.js'

/** ST-003 Q1 决议：code_review 端点 maxTokens 强下限 8192（QC-15 后保留） */
const ENFORCED_MIN_MAX_TOKENS_REVIEW = 8192

/**
 * 剥离 DeepSeek DSML 标记、<think> 标签等 reasoning 残余，提取纯 JSON。
 *
 * DeepSeek v4 pro thinking-mode 会在 content 中混入
 * `<｜｜DSML｜｜...>` 全角标记或 `<think>...</think>`，导致 JSON 解析失败。
 * 策略：先 regex 清理已知标记，再尝试提取第一个 JSON 对象。
 */
function stripReasoningMarkers(text) {
  let s = String(text ?? '')
  // <think>...</think> 标签（跨行）
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // 已闭合的 DSML 标签
  s = s.replace(/<[｜|]+DSML[｜|]+[^>]*>/g, '')
  s = s.trim()
  // 如果文本含 JSON 对象，从第一个 { 开始截取（去除前缀垃圾如未闭合 DSML）
  const firstBrace = s.indexOf('{')
  const lastBrace = s.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1)
  }
  return s
}

function makeClient({ apiKey, baseURL }) {
  if (!apiKey) throw new Error('缺少 API Key')
  if (!baseURL) throw new Error('缺少 Base URL')
  const timeoutMs = Number(process.env.LLM_CODE_REVIEW_TIMEOUT_MS) || 600_000
  return new OpenAI({ apiKey, baseURL, timeout: timeoutMs })
}

/**
 * 主入口：代码走查（QC-15 单层输出 { conclusion, evidence, confidence, ... }）
 *
 * @param {{ apiKey: string, baseURL: string, model: string, maxTokens?: number, providerId?: string }} opts
 * @param {{
 *   rule: string,
 *   boundaryHint?: string,
 *   moduleLabel?: string,
 *   dirHints?: string[],
 *   fileKeywords?: string[],
 *   repos?: { repoId: string, repoName: string }[],
 *   fallback?: boolean,
 *   extraDirHints?: string[],
 *   codeContextText?: string,
 * }} params
 * @param {{ repoContext: { repos: object[], dirHints?: string[], fileKeywords?: string[], fallback?: boolean } }} agentCtx
 * @returns {Promise<string>}  LLM 最终输出的 JSON 字符串
 */
export async function runCodeReviewOpenAICompatible(opts, params, agentCtx) {
  const client = makeClient(opts)
  const temperature = openAiCompatTemperature(opts.providerId, opts.model, 0.2)
  // ST-003 Q1：maxTokens 强下限 8192
  const maxTokens = Math.max(opts.maxTokens || 0, ENFORCED_MIN_MAX_TOKENS_REVIEW)

  const userContent = buildCodeReviewUserContent(params)
  const messages = [
    { role: 'system', content: CODE_REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  logLlmDebug('code-review agent start', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    repos: (params.repos || []).map((r) => r.repoId),
    dirHints: params.dirHints,
    enforcedMaxTokens: maxTokens,
  })

  let toolCallsUsed = 0
  let totalInputChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
  let finalText = null

  // ST-003 Token 双档闸门：会话级累计上下文
  const sessionMeta = createAgentSessionMeta()
  let toolsForcedDisabled = false  // hardCap 触发后强制禁用 tools

  // ── Agent 循环 ────────────────────────────────────────────────
  for (let round = 0; round < MAX_TOOL_CALLS + 2; round++) {
    const supportsTools = !toolsForcedDisabled && toolCallsUsed < MAX_TOOL_CALLS
    const body = {
      model: opts.model,
      temperature,
      max_tokens: maxTokens,
      messages: [...messages],
      ...(supportsTools ? { tools: CODE_REVIEW_TOOLS, tool_choice: 'auto' } : {}),
    }

    let completion
    try {
      completion = await client.chat.completions.create(body)
    } catch (e) {
      if (/tools|function|tool_choice/i.test(String(e.message))) {
        const fallbackBody = { ...body }
        delete fallbackBody.tools
        delete fallbackBody.tool_choice
        completion = await client.chat.completions.create(fallbackBody)
      } else {
        throw e
      }
    }

    const choice = completion.choices[0]
    const msg = choice?.message
    if (!msg) throw new Error('模型返回为空')

    // ── 模型请求工具调用 ───────────────────────────────────────
    if (msg.tool_calls && msg.tool_calls.length > 0 && toolCallsUsed < MAX_TOOL_CALLS && !toolsForcedDisabled) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
        ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
      })

      for (const tc of msg.tool_calls) {
        toolCallsUsed++
        let args = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* skip */ }

        logLlmDebug(`code-review tool call [${toolCallsUsed}]`, {
          tool: tc.function.name,
          args,
        })

        const result = agentCtx
          ? dispatchToolCall(tc.function.name, args, agentCtx.repoContext, sessionMeta)
          : JSON.stringify({ error: '无仓库上下文' })

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        })

        totalInputChars += String(result).length

        // ── ST-003 Token 双档闸门：识别 marker 并处理 ───────
        let parsedTool
        try { parsedTool = JSON.parse(result) } catch { parsedTool = null }
        if (parsedTool && parsedTool.__hardCap) {
          toolsForcedDisabled = true
          logLlmDebug('code-review token hardCap fired', { totalChars: parsedTool.__totalChars })
          // 给本批次剩余未处理的 tool_calls 补充空响应，避免 API 报
          // "insufficient tool messages following tool_calls message"
          const remaining = msg.tool_calls.slice(msg.tool_calls.indexOf(tc) + 1)
          for (const rem of remaining) {
            messages.push({
              role: 'tool',
              tool_call_id: rem.id,
              content: JSON.stringify({ skipped: true, reason: 'token hard cap reached' }),
            })
          }
          messages.push({
            role: 'system',
            content: `🛑 工具调用累计字符已达硬上限（${parsedTool.__totalChars || 'N/A'} chars）。立即停止所有工具调用，根据已读取的代码内容输出最终 JSON 结论。`,
          })
          break
        }
        if (parsedTool && parsedTool.__softWarn) {
          // 软警告：注入提示给 LLM（不强制收尾）
          messages.push({
            role: 'system',
            content: `⚠️ 工具调用累计字符接近上限（${parsedTool.__totalChars || 'N/A'} chars / 70K hardCap）。请在下一轮直接输出最终 JSON 结论，避免再调用更多工具。`,
          })
          logLlmDebug('code-review token softWarn fired', { totalChars: parsedTool.__totalChars })
        }
      }
      continue
    }

    // ── 模型直接输出文字（最终结论） ──────────────────────────
    finalText = stripReasoningMarkers(msg.content || '')
    break
  }

  // 收尾保险：finalText 缺失或不含 JSON（含被 thinking-mode 污染的情况，如把
  // tool_call arguments 泄漏到 content）。强制再请求一次禁用 tools，要求 JSON 结论。
  const hasJsonShape = (s) => typeof s === 'string' && s.includes('{') && s.includes('}')
  if (!finalText || !hasJsonShape(finalText)) {
    logLlmDebug('code-review forcing finalize (no valid JSON shape)', { toolCallsUsed, finalTextPreview: String(finalText || '').slice(0, 120) })
    messages.push({
      role: 'system',
      content: '🛑 工具调用预算已用尽。请立即基于已读取的代码内容，输出最终 JSON 结论 { conclusion, confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed }。不要再调用工具。',
    })
    try {
      const finalCompletion = await client.chat.completions.create({
        model: opts.model,
        temperature,
        max_tokens: maxTokens,
        messages: [...messages],
      })
      const finalMsg = finalCompletion.choices[0]?.message
      finalText = stripReasoningMarkers(finalMsg?.content || '')
    } catch (e) {
      logLlmDebug('code-review forced finalize failed', { error: String(e) })
    }
  }

  // 兜底：仍然没有合法 JSON → 构造 uncertain 响应避免抛错中断批次
  if (!finalText || !hasJsonShape(finalText)) {
    logLlmDebug('code-review fallback uncertain (no valid JSON)', { toolCallsUsed })
    finalText = JSON.stringify({
      conclusion: 'uncertain',
      confidence: 0,
      reasoning: `Agent 循环未能产出最终结论：模型在 ${toolCallsUsed} 次工具调用后既未输出 JSON 也未触发硬上限。可能是 thinking-mode 输出全部进入 reasoning_content。`,
      evidence: [],
      gaps: '模型未给出可解析的最终结论文本',
      filesRead: [],
      toolCallsUsed,
    })
  }

  finalText = injectToolCallsUsed(finalText, toolCallsUsed)

  setLastOpenAiCompatibleMeta({
    kind: 'openai-compatible-code-review-agent',
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    approxInputChars: totalInputChars,
    toolCallsUsed,
    outputChars: finalText.length,
    softWarnFired: sessionMeta.softWarnFired,
    hardCapFired: sessionMeta.hardCapFired,
  })

  return finalText
}

/** 若 LLM 输出的 JSON 中 toolCallsUsed 为 0 或缺失，用实际值替换 */
function injectToolCallsUsed(text, count) {
  try {
    const obj = JSON.parse(text.trim())
    if (typeof obj === 'object' && obj !== null) {
      obj.toolCallsUsed = count
      return JSON.stringify(obj)
    }
  } catch { /* not valid json yet, return as-is */ }
  return text
}

/* ================================================================
 * ST-003 AI.1/AI.2 · Pass 2 提案反推 LLM 调用（独立调用，maxTokens 默认 4096）
 * ================================================================ */

/**
 * Pass 2 独立 LLM 调用：反推 Unity 项目域规则草稿
 *
 * 与主走查（Pass 1）的区别：
 *   - 单次 LLM 调用，无 tool calling（不需要再读代码，已有 reasoning 输入）
 *   - maxTokens 强下限 8192（dispatcher pass_2_token_budget_anchor：宁愿 token 翻倍也保 schema 完整；1 个月后看账单与产出比再考虑降级 B）
 *   - system prompt = RULE_PROPOSAL_PASS2_SYSTEM_PROMPT
 *
 * @param {{ apiKey: string, baseURL: string, model: string, maxTokens?: number, providerId?: string }} opts
 * @param {{
 *   moduleLabel: string,
 *   rule: string,
 *   violatedFindings: Array<{ claim: string, evidence: Array<{file:string,method?:string,description?:string}> }>,
 *   readDirs: string[],
 *   hitFiles: string[],
 * }} pass2Params
 * @returns {Promise<string>}  LLM 输出的 JSON 字符串（含 keywords / hints / fileKeywords / evidence / affectsModules?）
 */
export async function runRuleProposalPass2(opts, pass2Params) {
  const client = makeClient(opts)
  const temperature = openAiCompatTemperature(opts.providerId, opts.model, 0.2)
  // dispatcher pass_2_token_budget_anchor：Pass 2 maxTokens 强下限 8192（与 Pass 1 同锚点）
  const maxTokens = Math.max(opts.maxTokens || 0, ENFORCED_MIN_MAX_TOKENS_REVIEW)

  const userContent = buildRuleProposalPass2UserContent(pass2Params)
  const messages = [
    { role: 'system', content: RULE_PROPOSAL_PASS2_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  logLlmDebug('rule-proposal pass-2 start', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    moduleLabel: pass2Params.moduleLabel,
    violatedCount: pass2Params.violatedFindings?.length || 0,
  })

  const completion = await client.chat.completions.create({
    model: opts.model,
    temperature,
    max_tokens: maxTokens,
    messages,
  })

  const text = completion.choices?.[0]?.message?.content || ''
  return text
}

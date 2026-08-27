import OpenAI from 'openai'
import { agentSessionDebugLog } from '../agent-session-debug.js'
import { CONTRACT_SYSTEM_PROMPT, buildContractUserContent } from '../prompt-contract.js'
import { logLlmDebug, safeBaseUrlLabel } from './debug-llm.js'
import { setLastOpenAiCompatibleMeta } from './llmLastMeta.js'
import {
  effectiveMaxCompletionTokens,
  openAiCompatTemperature,
  throwIfPromptExceedsSharedContext,
} from './providers.js'

function buildMessages(params) {
  const userText = buildContractUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  const tail =
    '\n\n请严格输出 JSON 对象，键为 "contracts"，值为契约数组。不要输出其它文字。'
  return [
    { role: 'system', content: CONTRACT_SYSTEM_PROMPT },
    { role: 'user', content: userText + tail },
  ]
}

function makeClient({ apiKey, baseURL, model, defaultHeaders, timeoutMs: customTimeoutMs }) {
  if (!apiKey) throw new Error('缺少 API Key')
  if (!baseURL) throw new Error('缺少 Base URL')
  if (!model) throw new Error('缺少模型名')
  const timeoutMs = customTimeoutMs || Number(process.env.LLM_CONTRACTS_TIMEOUT_MS) || 900_000
  return new OpenAI({ apiKey, baseURL, defaultHeaders, timeout: timeoutMs })
}

function isLikelyJsonModeUnsupported(e) {
  const msg = e instanceof Error ? e.message : String(e)
  return /response_format|json_object|unsupported/i.test(msg)
}

/**
 * 流式契约生成（与用例流式一致，减轻中间代理对「长时间无字节」的误判）
 * @param {{ apiKey: string, baseURL: string, model: string, maxTokens?: number, providerId?: string }} opts
 * @param {{ documents: {name:string,text:string,role?:string}[], focusText?: string, depth?: string, timezone?: string, maxTotalChars?: number }} params
 * @param {AbortSignal} [signal]
 */
export async function* streamContractsWithOpenAICompatible(opts, params, signal) {
  if (opts.streaming === false) {
    yield { kind: 'content', text: await generateContractsWithOpenAICompatible(opts, params) }
    return
  }
  const client = makeClient(opts)
  const messages = buildMessages(params)
  const approxPromptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
  let maxTokens = opts.maxTokens || 8192
  if (opts.providerId) {
    throwIfPromptExceedsSharedContext(opts.providerId, opts.model, approxPromptChars)
    maxTokens = effectiveMaxCompletionTokens(opts.providerId, opts.model, maxTokens, approxPromptChars)
  }

  // 流式模式不使用 json_object response_format：部分模型/中转会在内部把整个 JSON
  // 攒好再发流，导致前端等到生成结束才收到第一个字节。提示词已要求输出 JSON，够用。
  const createStream = async () => {
    const body = {
      model: opts.model,
      temperature: openAiCompatTemperature(opts.providerId, opts.model, 0.45),
      max_tokens: maxTokens,
      messages,
      stream: true,
    }
    return client.chat.completions.create(body, { signal })
  }

  logLlmDebug('chat.completions contracts (stream) request', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    json_object: false,
    approxPromptChars,
  })

  const stream = await createStream()
  const jsonModeDowngraded = false

  let lastFinishReason = ''
  let yieldedChars = 0
  const baseLabel = safeBaseUrlLabel(opts.baseURL)
  for await (const chunk of stream) {
    if (signal?.aborted) break
    const choice = chunk.choices[0]
    if (choice?.finish_reason) lastFinishReason = choice.finish_reason
    const delta = choice?.delta?.content
    const reasoning = choice?.delta?.reasoning_content
    if (reasoning) {
      yield { kind: 'reasoning', text: reasoning }
    }
    if (delta) {
      yieldedChars += delta.length
      yield { kind: 'content', text: delta }
    }
  }
  logLlmDebug('chat.completions contracts (stream) end', {
    finish_reason: lastFinishReason || '(none)',
    json_object_downgraded: jsonModeDowngraded,
    yieldedChars,
  })
  setLastOpenAiCompatibleMeta({
    kind: 'openai-compatible-contracts-stream',
    baseURL: baseLabel,
    model: opts.model,
    max_tokens: maxTokens,
    approxPromptChars,
    json_object_downgraded: jsonModeDowngraded,
    finish_reason: lastFinishReason || null,
    outputChars: yieldedChars,
    clientAborted: Boolean(signal?.aborted),
  })
}

/**
 * @param {{ apiKey: string, baseURL: string, model: string, maxTokens?: number, providerId?: string }} opts
 * @param {{ documents: {name:string,text:string,role?:string}[], focusText?: string, depth?: string, timezone?: string, maxTotalChars?: number }} params
 */
export async function generateContractsWithOpenAICompatible(opts, params) {
  const client = makeClient(opts)
  const messages = buildMessages(params)
  const approxPromptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
  let maxTokens = opts.maxTokens || 8192
  if (opts.providerId) {
    throwIfPromptExceedsSharedContext(opts.providerId, opts.model, approxPromptChars)
    maxTokens = effectiveMaxCompletionTokens(opts.providerId, opts.model, maxTokens, approxPromptChars)
  }

  const create = async (useJsonObject) => {
    const body = {
      model: opts.model,
      temperature: openAiCompatTemperature(opts.providerId, opts.model, 0.45),
      max_tokens: maxTokens,
      messages,
      ...(useJsonObject ? { response_format: { type: 'json_object' } } : {}),
    }
    return client.chat.completions.create(body)
  }

  logLlmDebug('chat.completions contracts (non-stream) request', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    json_object: true,
    approxPromptChars,
  })

  const llmT0 = Date.now()
  // #region agent log
  agentSessionDebugLog({
    hypothesisId: 'H2',
    location: 'server/llm/openai-contracts.js',
    message: 'llm_request_start',
    data: {
      model: opts.model,
      approxPromptChars,
      max_tokens: maxTokens,
    },
  })
  // #endregion

  let completion
  let jsonModeDowngraded = false
  try {
    completion = await create(true)
  } catch (e) {
    if (isLikelyJsonModeUnsupported(e)) {
      jsonModeDowngraded = true
      logLlmDebug('json_object rejected (contracts), retrying without response_format', {
        error: e instanceof Error ? e.message : String(e),
      })
      try {
        completion = await create(false)
      } catch (e2) {
        // #region agent log
        agentSessionDebugLog({
          hypothesisId: 'H2',
          location: 'server/llm/openai-contracts.js',
          message: 'llm_request_fail',
          data: {
            ms: Date.now() - llmT0,
            err: e2 instanceof Error ? e2.message : String(e2),
          },
        })
        // #endregion
        throw e2
      }
    } else {
      // #region agent log
      agentSessionDebugLog({
        hypothesisId: 'H2',
        location: 'server/llm/openai-contracts.js',
        message: 'llm_request_fail',
        data: {
          ms: Date.now() - llmT0,
          err: e instanceof Error ? e.message : String(e),
        },
      })
      // #endregion
      throw e
    }
  }

  const ch0 = completion.choices[0]
  const text = ch0?.message?.content
  const finish = ch0?.finish_reason
  const contentChars = text ? String(text).length : 0
  // #region agent log
  agentSessionDebugLog({
    hypothesisId: 'H2',
    location: 'server/llm/openai-contracts.js',
    message: 'llm_request_done',
    data: {
      ms: Date.now() - llmT0,
      finish_reason: finish ?? null,
      contentChars,
      json_object_downgraded: jsonModeDowngraded,
    },
  })
  // #endregion
  logLlmDebug('chat.completions contracts (non-stream) response', {
    finish_reason: finish,
    json_object_downgraded: jsonModeDowngraded,
    contentChars,
  })
  setLastOpenAiCompatibleMeta({
    kind: 'openai-compatible-contracts-non-stream',
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    approxPromptChars,
    json_object_downgraded: jsonModeDowngraded,
    finish_reason: finish ?? null,
    outputChars: contentChars,
  })
  if (!text) throw new Error('模型返回为空')
  return text
}

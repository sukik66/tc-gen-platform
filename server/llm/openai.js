import OpenAI from 'openai'
import { SYSTEM_PROMPT, buildUserContent } from '../prompt.js'
import { logLlmDebug, safeBaseUrlLabel } from './debug-llm.js'
import { setLastOpenAiCompatibleMeta } from './llmLastMeta.js'
import {
  effectiveMaxCompletionTokens,
  openAiCompatTemperature,
  throwIfPromptExceedsSharedContext,
} from './providers.js'

function buildMessages(params) {
  const userText = buildUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  const tail =
    '\n\n请严格输出 JSON 对象，键为 "cases"，值为用例数组。不要输出其它文字。'
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userText + tail },
  ]
}

function makeClient({ apiKey, baseURL, model }) {
  if (!apiKey) throw new Error('缺少 API Key')
  if (!baseURL) throw new Error('缺少 Base URL')
  if (!model) throw new Error('缺少模型名')
  const timeoutMs = Number(process.env.LLM_OPENAI_COMPAT_TIMEOUT_MS) || 900_000
  return new OpenAI({ apiKey, baseURL, timeout: timeoutMs })
}

/**
 * 非流式调用（保持向后兼容）
 */
export async function generateWithOpenAICompatible(opts, params) {
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
      temperature: openAiCompatTemperature(opts.providerId, opts.model, 0.5),
      max_tokens: maxTokens,
      messages,
      ...(useJsonObject ? { response_format: { type: 'json_object' } } : {}),
    }
    return client.chat.completions.create(body)
  }

  logLlmDebug('chat.completions (non-stream) request', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    json_object: true,
    approxPromptChars,
  })

  let completion
  let jsonModeDowngraded = false
  try {
    completion = await create(true)
  } catch (e) {
    if (isLikelyJsonModeUnsupported(e)) {
      jsonModeDowngraded = true
      logLlmDebug('json_object rejected, retrying without response_format', {
        error: e instanceof Error ? e.message : String(e),
      })
      completion = await create(false)
    } else {
      throw e
    }
  }

  const ch0 = completion.choices[0]
  const text = ch0?.message?.content
  const finish = ch0?.finish_reason
  const contentChars = text ? String(text).length : 0
  logLlmDebug('chat.completions (non-stream) response', {
    finish_reason: finish,
    json_object_downgraded: jsonModeDowngraded,
    contentChars,
  })
  setLastOpenAiCompatibleMeta({
    kind: 'openai-compatible-non-stream',
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

/**
 * 流式调用 — 返回 async iterable，每次 yield 一段 delta 文本
 * @param {{ apiKey: string; baseURL: string; model: string, maxTokens?: number, providerId?: string }} opts
 * @param {object} params
 * @param {AbortSignal} [signal]
 */
export async function* streamWithOpenAICompatible(opts, params, signal) {
  const client = makeClient(opts)
  const messages = buildMessages(params)
  const approxPromptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
  let maxTokens = opts.maxTokens || 8192
  if (opts.providerId) {
    throwIfPromptExceedsSharedContext(opts.providerId, opts.model, approxPromptChars)
    maxTokens = effectiveMaxCompletionTokens(opts.providerId, opts.model, maxTokens, approxPromptChars)
  }

  const createStream = async (useJsonObject) => {
    const body = {
      model: opts.model,
      temperature: openAiCompatTemperature(opts.providerId, opts.model, 0.5),
      max_tokens: maxTokens,
      messages,
      stream: true,
      ...(useJsonObject ? { response_format: { type: 'json_object' } } : {}),
    }
    return client.chat.completions.create(body, { signal })
  }

  logLlmDebug('chat.completions (stream) request', {
    baseURL: safeBaseUrlLabel(opts.baseURL),
    model: opts.model,
    max_tokens: maxTokens,
    json_object: true,
    approxPromptChars,
  })

  let stream
  let jsonModeDowngraded = false
  try {
    stream = await createStream(true)
  } catch (e) {
    if (isLikelyJsonModeUnsupported(e)) {
      jsonModeDowngraded = true
      logLlmDebug('json_object rejected, retrying stream without response_format', {
        error: e instanceof Error ? e.message : String(e),
      })
      stream = await createStream(false)
    } else {
      throw e
    }
  }

  let lastFinishReason = ''
  let yieldedChars = 0
  const baseLabel = safeBaseUrlLabel(opts.baseURL)
  for await (const chunk of stream) {
    if (signal?.aborted) break
    const choice = chunk.choices[0]
    if (choice?.finish_reason) lastFinishReason = choice.finish_reason
    const delta = choice?.delta?.content
    if (delta) {
      yieldedChars += delta.length
      yield delta
    }
  }
  const clientAborted = Boolean(signal?.aborted)
  logLlmDebug('chat.completions (stream) end', {
    finish_reason: lastFinishReason || '(none)',
    json_object_downgraded: jsonModeDowngraded,
    yieldedChars,
  })
  setLastOpenAiCompatibleMeta({
    kind: 'openai-compatible-stream',
    baseURL: baseLabel,
    model: opts.model,
    max_tokens: maxTokens,
    approxPromptChars,
    json_object_downgraded: jsonModeDowngraded,
    finish_reason: lastFinishReason || null,
    outputChars: yieldedChars,
    clientAborted,
  })
}

/** 兼容部分国产网关不支持 response_format */
function isLikelyJsonModeUnsupported(e) {
  const msg = e instanceof Error ? e.message : String(e)
  return /response_format|json_object|unsupported|not support|400/i.test(msg)
}

/** @deprecated 请使用 resolveOpenAiCompatible + generateWithOpenAICompatible */
export async function generateWithOpenAI(params) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('未配置 OPENAI_API_KEY')
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || 'gpt-5.4'
  return generateWithOpenAICompatible({ apiKey, baseURL, model }, params)
}

/**
 * 使用 .env 中 ANTHROPIC_* 探测 jbt/model123 类网关下哪些 model id 可用。
 * 用法：node scripts/probe-model123-anthropic.mjs
 * 不打印 API Key。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { resolveOpenAiCompatible } from '../server/llm/providers.js'
import { safeBaseUrlLabel } from '../server/llm/debug-llm.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const r = resolveOpenAiCompatible('anthropic')
if (!r.ok) {
  console.error(JSON.stringify({ phase: 'resolve', error: r.hint }))
  process.exit(1)
}

const client = new OpenAI({
  apiKey: r.apiKey,
  baseURL: r.baseURL,
  timeout: 45_000,
})

const baseLabel = safeBaseUrlLabel(r.baseURL)
console.log(JSON.stringify({ phase: 'config', baseURL: baseLabel, configuredModel: r.model }))

// 先尝试 OpenAI 风格的模型列表（若网关支持）
try {
  const list = await client.models.list()
  const ids = (list.data || []).map((m) => m.id).filter(Boolean)
  if (ids.length) {
    console.log(JSON.stringify({ phase: 'models_list', count: ids.length, sample: ids.slice(0, 40) }))
  } else {
    console.log(JSON.stringify({ phase: 'models_list', count: 0, note: 'empty or unsupported' }))
  }
} catch (e) {
  console.log(
    JSON.stringify({
      phase: 'models_list',
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240),
    }),
  )
}

/** 常见 Anthropic 官方风格 + 你当前配置 + 中转常见别名 */
const candidates = [
  r.model,
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest',
  'claude-sonnet-4-latest',
]

const uniq = [...new Set(candidates.filter(Boolean))]

for (const model of uniq) {
  try {
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 24,
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply exactly: OK' }],
    })
    const text = completion.choices?.[0]?.message?.content ?? ''
    console.log(
      JSON.stringify({
        model,
        ok: true,
        finish_reason: completion.choices?.[0]?.finish_reason ?? null,
        reply_preview: String(text).replace(/\s+/g, ' ').slice(0, 80),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = e?.status ?? e?.response?.status
    console.log(
      JSON.stringify({
        model,
        ok: false,
        httpStatus: status ?? null,
        error: msg.slice(0, 280),
      }),
    )
  }
}

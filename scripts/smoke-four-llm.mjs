/**
 * 对 .env 中已配置的 OpenAI 兼容四通道各发一条最小 chat，验证网络与模型名。
 * 用法（仓库根）：node scripts/smoke-four-llm.mjs
 * 不输出 API Key。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { safeBaseUrlLabel } from '../server/llm/debug-llm.js'
import {
  openAiCompatTemperature,
  resolveOpenAiCompatible as resolve,
} from '../server/llm/providers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
dotenv.config({ path: path.join(root, '.env') })

function labelBase(u) {
  try {
    return safeBaseUrlLabel(u)
  } catch {
    return String(u).slice(0, 48)
  }
}

const ids = ['anthropic', 'openai', 'kimi', 'deepseek']
const timeoutMs = 120_000

for (const id of ids) {
  const r = resolve(id)
  if (!r.ok) {
    console.log(JSON.stringify({ provider: id, ok: false, phase: 'resolve', error: r.hint }))
    continue
  }
  const client = new OpenAI({
    apiKey: r.apiKey,
    baseURL: r.baseURL,
    timeout: timeoutMs,
  })
  try {
    const temp = openAiCompatTemperature(id, r.model, 0)
    /** Kimi K2 / DeepSeek-R1 类：思维链占 token，过小易 length 且无可见正文 */
    const needsHeadroom =
      temp === 1 || (id === 'deepseek' && /reasoner/i.test(String(r.model || '')))
    const completion = await client.chat.completions.create({
      model: r.model,
      max_tokens: needsHeadroom ? 512 : 48,
      temperature: temp,
      messages: [{ role: 'user', content: '只回复一个英文单词：OK' }],
    })
    const text = completion.choices?.[0]?.message?.content ?? ''
    const finish = completion.choices?.[0]?.finish_reason ?? null
    console.log(
      JSON.stringify({
        provider: id,
        ok: true,
        model: r.model,
        baseURL: labelBase(r.baseURL),
        finish_reason: finish,
        reply_preview: String(text).replace(/\s+/g, ' ').slice(0, 120),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = e?.status ?? e?.response?.status
    console.log(
      JSON.stringify({
        provider: id,
        ok: false,
        model: r.model,
        baseURL: labelBase(r.baseURL),
        httpStatus: status ?? null,
        error: msg.slice(0, 500),
      }),
    )
  }
}

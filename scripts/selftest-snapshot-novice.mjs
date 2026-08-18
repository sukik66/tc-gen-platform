/**
 * 自测：快照生成体 + /api/preview-enhanced-prompt（不调 LLM，仅验证管线与 Prompt 体积）。
 * 前置：npm run snapshot:novice-tutorial；API 已监听 API_PORT（默认 8787）。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const snap = path.join(root, 'fixtures', 'generation-snapshots', 'novice-tutorial-stream-request.generated.json')
const port = process.env.API_PORT || '8787'
const base = `http://127.0.0.1:${port}`

if (!fs.existsSync(snap)) {
  console.error('[selftest] 请先执行: npm run snapshot:novice-tutorial')
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(snap, 'utf8'))
const { llmProvider: _drop, ...previewBody } = raw

const health = await fetch(`${base}/api/health`)
if (!health.ok) {
  console.error('[selftest] /api/health', health.status)
  process.exit(1)
}
console.log('[selftest] health', await health.json())

const pr = await fetch(`${base}/api/preview-enhanced-prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(previewBody),
})
const pj = await pr.json().catch(() => ({}))
if (!pr.ok) {
  console.error('[selftest] preview', pr.status, pj)
  process.exit(1)
}
const m = pj.meta || {}
console.log('[selftest] preview ok', {
  documentCount: m.documentCount,
  totalPromptChars: m.totalPromptChars,
  codeChangeLength: m.codeChangeLength,
  ragContextLength: m.ragContextLength,
})
if (!m.totalPromptChars || m.totalPromptChars < 500) {
  console.error('[selftest] totalPromptChars 异常偏小')
  process.exit(1)
}
console.log('[selftest] PASS')

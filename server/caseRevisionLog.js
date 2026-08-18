/**
 * 自动生成：用户在一次 AI 生成后对用例的修改摘要（jsonl 追加，供后续 prompt 注入）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(__dirname, '..', 'data', 'case-revision-log.jsonl')
const MAX_FILE_BYTES = 2_000_000

function ensureDir() {
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function slimCase(c) {
  return {
    id: c.id,
    priority: c.priority,
    caseType: c.caseType,
    module: c.module,
    subModule: c.subModule,
    summary: c.summary,
    description: c.description,
    expected: c.expected,
    remarks: c.remarks,
    steps: Array.isArray(c.steps) ? c.steps.join('\n') : '',
    preconditions: Array.isArray(c.preconditions) ? c.preconditions.join('\n') : '',
  }
}

function hashCases(cases) {
  const rows = cases.map(slimCase).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return JSON.stringify(rows)
}

/**
 * 对比两次用例列表，产出可序列化的修改摘要（自动、无需人工填表）
 * @param {object[]} before
 * @param {object[]} after
 */
export function diffCasesForLog(before, after) {
  const A = new Map(before.map((c) => [String(c.id), c]))
  const B = new Map(after.map((c) => [String(c.id), c]))
  const added = []
  const removed = []
  const modified = []
  const fields = [
    'priority',
    'caseType',
    'module',
    'subModule',
    'summary',
    'description',
    'expected',
    'remarks',
  ]

  for (const [id, b] of B) {
    if (!A.has(id)) {
      added.push({ id, summary: String(b.summary || '').slice(0, 200) })
      continue
    }
    const a = A.get(id)
    const fieldChanges = []
    for (const f of fields) {
      const va = String(a[f] ?? '')
      const vb = String(b[f] ?? '')
      if (va !== vb) {
        fieldChanges.push({
          field: f,
          beforePreview: va.slice(0, 160),
          afterPreview: vb.slice(0, 160),
        })
      }
    }
    const sa = Array.isArray(a.steps) ? a.steps.join('\n') : ''
    const sb = Array.isArray(b.steps) ? b.steps.join('\n') : ''
    if (sa !== sb) {
      fieldChanges.push({
        field: 'steps',
        beforePreview: sa.slice(0, 200),
        afterPreview: sb.slice(0, 200),
      })
    }
    const pa = Array.isArray(a.preconditions) ? a.preconditions.join('\n') : ''
    const pb = Array.isArray(b.preconditions) ? b.preconditions.join('\n') : ''
    if (pa !== pb) {
      fieldChanges.push({
        field: 'preconditions',
        beforePreview: pa.slice(0, 160),
        afterPreview: pb.slice(0, 160),
      })
    }
    if (fieldChanges.length) modified.push({ id, changes: fieldChanges.slice(0, 12) })
  }

  for (const [id, a] of A) {
    if (!B.has(id)) removed.push({ id, summary: String(a.summary || '').slice(0, 200) })
  }

  return { added, removed, modified, stats: { added: added.length, removed: removed.length, modified: modified.length } }
}

export function appendRevisionLog(entry) {
  ensureDir()
  const line = `${JSON.stringify(entry)}\n`
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8')
    const st = fs.statSync(LOG_FILE)
    if (st.size > MAX_FILE_BYTES) {
      const raw = fs.readFileSync(LOG_FILE, 'utf8')
      const lines = raw.split('\n').filter(Boolean)
      const keep = lines.slice(-800)
      fs.writeFileSync(LOG_FILE, `${keep.join('\n')}\n`, 'utf8')
    }
  } catch (e) {
    console.error('[case-revision-log]', e)
  }
}

/** 供 prompt 注入：最近若干条自动记录的修改倾向 */
export function readRecentRevisionHintsForPrompt(maxEntries = 8, maxChars = 3500) {
  if (!fs.existsSync(LOG_FILE)) return ''
  let raw
  try {
    raw = fs.readFileSync(LOG_FILE, 'utf8')
  } catch {
    return ''
  }
  const lines = raw.split('\n').filter(Boolean)
  const tail = lines.slice(-maxEntries)
  const parts = []
  let len = 0
  for (const line of tail.reverse()) {
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const { ts, stats, highlights } = o
    const one = `[${ts}] 自动记录：增${stats?.added ?? 0} 删${stats?.removed ?? 0} 改${stats?.modified ?? 0}。要点：${(highlights || []).slice(0, 4).map((h) => `${h.field}(${h.id || ''})`).join('；')}`
    if (len + one.length > maxChars) break
    parts.push(one)
    len += one.length
  }
  if (!parts.length) return ''
  return `--- 近期用户修正倾向（系统自动从编辑差异抽取，生成时请对齐，避免重复同类错误）---\n${parts.join('\n')}`
}

export { hashCases, slimCase }

/**
 * 质量契约 · 后端 JSON 文件持久化存储
 *
 * 数据存储在 data/quality-contracts.json，与用例库同策略：
 * 原子写入（先写临时文件再 rename），防止中断导致数据损坏。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'quality-contracts.json')

function uid() {
  return 'qc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function iso() {
  return new Date().toISOString()
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) return { drafts: [] }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return { drafts: [] }
  }
}

function save(data) {
  ensureDir()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

export function listDrafts(filters) {
  const data = load()
  let list = data.drafts
  if (filters?.projectId) list = list.filter((d) => d.projectId === filters.projectId)
  if (filters?.moduleId) list = list.filter((d) => d.moduleId === filters.moduleId)
  return list
}

export function createDraft(input) {
  const data = load()
  const now = iso()
  const draft = {
    id: uid(),
    projectId: input.projectId || '',
    moduleId: input.moduleId || '',
    status: input.status || 'draft',
    moduleLabel: input.moduleLabel || '未分类模块',
    rule: input.rule || '',
    boundaryHint: input.boundaryHint || '',
    priority: input.priority || 'P1',
    verifyMethods: Array.isArray(input.verifyMethods) ? input.verifyMethods : [],
    verifyRationale: input.verifyRationale || '',
    codeContext: input.codeContext || null,
    createdAt: now,
    updatedAt: now,
  }
  data.drafts.push(draft)
  save(data)
  return draft
}

export function updateDraft(id, patch) {
  const data = load()
  const idx = data.drafts.findIndex((d) => d.id === id)
  if (idx < 0) return null
  const allowed = [
    'projectId', 'moduleId', 'status', 'moduleLabel', 'rule',
    'boundaryHint', 'priority', 'verifyMethods', 'verifyRationale', 'codeContext',
  ]
  for (const key of allowed) {
    if (key in patch) data.drafts[idx][key] = patch[key]
  }
  data.drafts[idx].updatedAt = iso()
  save(data)
  return data.drafts[idx]
}

export function deleteDraft(id) {
  const data = load()
  data.drafts = data.drafts.filter((d) => d.id !== id)
  save(data)
}

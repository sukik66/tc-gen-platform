/**
 * 质量契约草稿 · 后端 JSON 文件持久化（与用例库一致）
 * 数据：data/quality-contracts.json
 * 每条契约须归属用例库中的 projectId + moduleId（读 case-library.json 校验，避免循环 import）
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'quality-contracts.json')
const CASE_LIBRARY_FILE = path.join(DATA_DIR, 'case-library.json')

function uid() {
  return randomUUID()
}

function iso() {
  return new Date().toISOString()
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) {
    return { drafts: [] }
  }
  try {
    const o = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    if (!o || !Array.isArray(o.drafts)) return { drafts: [] }
    return o
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

function loadCaseLibrary() {
  ensureDir()
  if (!fs.existsSync(CASE_LIBRARY_FILE)) {
    return { projects: [], modules: [] }
  }
  try {
    const o = JSON.parse(fs.readFileSync(CASE_LIBRARY_FILE, 'utf8'))
    return {
      projects: Array.isArray(o.projects) ? o.projects : [],
      modules: Array.isArray(o.modules) ? o.modules : [],
    }
  } catch {
    return { projects: [], modules: [] }
  }
}

/** @param {string} projectId @param {string} moduleId */
export function validateProjectModule(projectId, moduleId) {
  const pid = String(projectId || '').trim()
  const mid = String(moduleId || '').trim()
  if (!pid || !mid) {
    throw new Error('契约必须指定 projectId 与 moduleId（与用例库项目/模块对齐）')
  }
  const { projects, modules } = loadCaseLibrary()
  const proj = projects.find((p) => p.id === pid)
  if (!proj) throw new Error('项目不存在，请先在用例库创建项目')
  const mod = modules.find((m) => m.id === mid && m.projectId === pid)
  if (!mod) throw new Error('模块不存在或不属于该项目')
}

/**
 * @param {{ projectId?: string, moduleId?: string }} [filters]
 */
export function listDrafts(filters = {}) {
  const { drafts } = load()
  let list = [...drafts]
  if (filters.projectId) {
    list = list.filter((d) => d.projectId === filters.projectId)
  }
  if (filters.moduleId) {
    list = list.filter((d) => d.moduleId === filters.moduleId)
  }
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** @param {Record<string, unknown>} input 契约字段（不含 id / createdAt / updatedAt） */
export function createDraft(input) {
  const body = input && typeof input === 'object' ? input : {}
  validateProjectModule(String(body.projectId || ''), String(body.moduleId || ''))
  const status = body.status === 'active' ? 'active' : 'draft'
  const data = load()
  const now = iso()
  const row = {
    ...body,
    projectId: String(body.projectId).trim(),
    moduleId: String(body.moduleId).trim(),
    status,
    id: uid(),
    createdAt: now,
    updatedAt: now,
  }
  data.drafts.push(row)
  save(data)
  return row
}

/** @param {string} id @param {Record<string, unknown>} patch */
export function updateDraft(id, patch) {
  const data = load()
  const idx = data.drafts.findIndex((d) => d.id === id)
  if (idx < 0) throw new Error('契约不存在')
  const cur = data.drafts[idx]
  const merged = { ...cur, ...patch, id: cur.id, createdAt: cur.createdAt, updatedAt: iso() }
  const nextPid = String(merged.projectId || '').trim() || String(cur.projectId || '').trim()
  const nextMid = String(merged.moduleId || '').trim() || String(cur.moduleId || '').trim()
  if (nextPid && nextMid) {
    validateProjectModule(nextPid, nextMid)
    merged.projectId = nextPid
    merged.moduleId = nextMid
  }
  if (merged.status !== 'active') merged.status = 'draft'
  data.drafts[idx] = merged
  save(data)
  return merged
}

export function deleteDraft(id) {
  const data = load()
  data.drafts = data.drafts.filter((d) => d.id !== id)
  save(data)
}

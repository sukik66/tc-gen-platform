/**
 * 用例库 · 后端 JSON 文件持久化存储
 *
 * 数据存储在 data/case-library.json，不依赖浏览器 IndexedDB / 端口。
 * 所有写操作原子化：先写临时文件再 rename，防止写入中断导致数据损坏。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'case-library.json')

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
    return { projects: [], modules: [], cases: [], suites: [], links: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return { projects: [], modules: [], cases: [], suites: [], links: [] }
  }
}

function save(data) {
  ensureDir()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

/* ========== Project ========== */

export function getAllProjects() {
  return load().projects
}

export function createProject(name, description = '') {
  const data = load()
  const p = { id: uid(), name, description, createdAt: iso() }
  data.projects.push(p)
  save(data)
  return p
}

export function updateProject(project) {
  const data = load()
  const idx = data.projects.findIndex(p => p.id === project.id)
  if (idx >= 0) data.projects[idx] = project
  save(data)
}

export function deleteProject(projectId) {
  const data = load()
  data.projects = data.projects.filter(p => p.id !== projectId)
  data.modules = data.modules.filter(m => m.projectId !== projectId)
  const caseIds = new Set(data.cases.filter(c => c.projectId === projectId).map(c => c.id))
  data.cases = data.cases.filter(c => c.projectId !== projectId)
  data.links = data.links.filter(l => !caseIds.has(l.caseId))
  data.suites = data.suites.filter(s => s.projectId !== projectId)
  save(data)
}

/* ========== Module ========== */

export function getProjectModules(projectId) {
  return load().modules.filter(m => m.projectId === projectId)
}

export function createModule(projectId, name, parentId = null) {
  const data = load()
  const siblings = data.modules.filter(m => m.projectId === projectId && m.parentId === parentId)
  const m = { id: uid(), projectId, parentId, name, order: siblings.length }
  data.modules.push(m)
  save(data)
  return m
}

export function updateModule(mod) {
  const data = load()
  const idx = data.modules.findIndex(m => m.id === mod.id)
  if (idx >= 0) data.modules[idx] = mod
  save(data)
}

export function deleteModule(moduleId) {
  const data = load()
  const collectIds = (mid) => {
    const children = data.modules.filter(m => m.parentId === mid)
    for (const ch of children) collectIds(ch.id)
    data.modules = data.modules.filter(m => m.id !== mid)
    const casesToDel = data.cases.filter(c => c.moduleId === mid)
    for (const c of casesToDel) {
      data.links = data.links.filter(l => l.caseId !== c.id)
    }
    data.cases = data.cases.filter(c => c.moduleId !== mid)
  }
  collectIds(moduleId)
  save(data)
}

export function renameModule(moduleId, name) {
  const data = load()
  const m = data.modules.find(m => m.id === moduleId)
  if (m) m.name = name
  save(data)
}

/* ========== Case ========== */

export function getCasesByModule(moduleId) {
  return load().cases.filter(c => c.moduleId === moduleId)
}

export function getCasesByProject(projectId) {
  return load().cases.filter(c => c.projectId === projectId)
}

export function importFromGeneration(cases, projectId, moduleId) {
  const data = load()
  const base = Date.now()
  const items = cases.map((tc, i) => {
    const ts = new Date(base + i).toISOString()
    return {
      ...tc,
      id: tc.id || uid(),
      projectId,
      moduleId,
      addedAt: ts,
      updatedAt: ts,
      source: 'generation',
      tags: tc.tags || [],
    }
  })
  data.cases.push(...items)
  save(data)
  return items.length
}

export function updateCase(c) {
  const data = load()
  c.updatedAt = iso()
  const idx = data.cases.findIndex(x => x.id === c.id)
  if (idx >= 0) data.cases[idx] = c
  save(data)
}

export function deleteCase(id) {
  const data = load()
  data.cases = data.cases.filter(c => c.id !== id)
  data.links = data.links.filter(l => l.caseId !== id)
  save(data)
}

export function deleteCases(ids) {
  const idSet = new Set(ids)
  const data = load()
  data.cases = data.cases.filter(c => !idSet.has(c.id))
  data.links = data.links.filter(l => !idSet.has(l.caseId))
  save(data)
}

export function searchCasesInProject(projectId, query) {
  const all = getCasesByProject(projectId)
  if (!query?.trim()) return all
  const q = query.toLowerCase()
  return all.filter(c =>
    c.summary?.toLowerCase().includes(q) ||
    c.module?.toLowerCase().includes(q) ||
    c.subModule?.toLowerCase().includes(q) ||
    c.description?.toLowerCase().includes(q) ||
    c.caseType?.toLowerCase().includes(q) ||
    (c.tags || []).some(t => t.toLowerCase().includes(q))
  )
}

export function countCasesByProject(projectId) {
  return getCasesByProject(projectId).length
}

/** 项目下各模块「直接归属」的用例数（moduleId 精确匹配） */
export function getModuleCaseCountsByProject(projectId) {
  const data = load()
  const counts = {}
  for (const m of data.modules) {
    if (m.projectId === projectId) counts[m.id] = 0
  }
  for (const c of data.cases) {
    if (c.projectId !== projectId) continue
    if (Object.prototype.hasOwnProperty.call(counts, c.moduleId)) counts[c.moduleId]++
  }
  return counts
}

/* ========== Suite ========== */

export function createSuite(projectId, name, description = '') {
  const data = load()
  const s = { id: uid(), projectId, name, description, createdAt: iso() }
  data.suites.push(s)
  save(data)
  return s
}

export function getProjectSuites(projectId) {
  return load().suites.filter(s => s.projectId === projectId)
}

export function deleteSuite(suiteId) {
  const data = load()
  data.suites = data.suites.filter(s => s.id !== suiteId)
  data.links = data.links.filter(l => l.suiteId !== suiteId)
  save(data)
}

/* ========== Suite ⇔ Case Link ========== */

export function linkCaseToSuite(suiteId, caseId) {
  const data = load()
  if (data.links.some(l => l.suiteId === suiteId && l.caseId === caseId)) return
  data.links.push({ id: uid(), suiteId, caseId })
  save(data)
}

export function unlinkCaseFromSuite(suiteId, caseId) {
  const data = load()
  data.links = data.links.filter(l => !(l.suiteId === suiteId && l.caseId === caseId))
  save(data)
}

export function getSuiteCases(suiteId) {
  const data = load()
  const caseIds = data.links.filter(l => l.suiteId === suiteId).map(l => l.caseId)
  const idSet = new Set(caseIds)
  return data.cases.filter(c => idSet.has(c.id))
}

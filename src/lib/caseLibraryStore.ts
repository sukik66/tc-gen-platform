/**
 * 用例库 · 通过后端 API 持久化（不再依赖浏览器 IndexedDB）
 *
 * 数据存储在后端 data/case-library.json，与浏览器端口无关。
 */

import type { TestCase } from '../types'

/* ---------- 数据类型 ---------- */

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface Module {
  id: string
  projectId: string
  parentId: string | null
  name: string
  order: number
}

export interface LibraryCase extends TestCase {
  projectId: string
  moduleId: string
  addedAt: string
  updatedAt: string
  source: 'generation' | 'manual'
  tags: string[]
}

export interface Suite {
  id: string
  projectId: string
  name: string
  description: string
  createdAt: string
}

export interface SuiteCaseLink {
  id: string
  suiteId: string
  caseId: string
}

/* ---------- HTTP 封装 ---------- */

const BASE = '/api/case-library'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
  return r.json()
}

async function put(path: string, body: unknown): Promise<void> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
}

async function del(path: string): Promise<void> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
}

/* ========== Project CRUD ========== */

export async function getAllProjects(): Promise<Project[]> {
  return get<Project[]>('/projects')
}

export async function createProject(name: string, description = ''): Promise<Project> {
  return post<Project>('/projects', { name, description })
}

export async function updateProject(p: Project): Promise<void> {
  await put(`/projects/${p.id}`, p)
}

export async function deleteProject(projectId: string): Promise<void> {
  await del(`/projects/${projectId}`)
}

/* ========== Module CRUD ========== */

export async function getProjectModules(projectId: string): Promise<Module[]> {
  return get<Module[]>(`/projects/${projectId}/modules`)
}

export async function createModule(
  projectId: string,
  name: string,
  parentId: string | null = null,
): Promise<Module> {
  return post<Module>('/modules', { projectId, name, parentId })
}

export async function getChildModules(
  projectId: string,
  parentId: string | null,
): Promise<Module[]> {
  const all = await getProjectModules(projectId)
  return all
    .filter((m) => m.parentId === parentId)
    .sort((a, b) => a.order - b.order)
}

export async function updateModule(m: Module): Promise<void> {
  await put(`/modules/${m.id}`, m)
}

export async function deleteModule(moduleId: string): Promise<void> {
  await del(`/modules/${moduleId}`)
}

export async function renameModule(moduleId: string, name: string): Promise<void> {
  await post(`/modules/${moduleId}/rename`, { name })
}

/* ========== Case CRUD ========== */

export async function putCase(c: LibraryCase): Promise<void> {
  await put(`/cases/${c.id}`, c)
}

export async function putCases(cases: LibraryCase[]): Promise<number> {
  if (cases.length === 0) return 0
  const first = cases[0]
  const { imported } = await post<{ imported: number }>('/import', {
    cases,
    projectId: first.projectId,
    moduleId: first.moduleId,
  })
  return imported
}

export async function importFromGeneration(
  cases: TestCase[],
  projectId: string,
  moduleId: string,
): Promise<number> {
  const { imported } = await post<{ imported: number }>('/import', {
    cases,
    projectId,
    moduleId,
  })
  return imported
}

export async function getCasesByModule(moduleId: string): Promise<LibraryCase[]> {
  return get<LibraryCase[]>(`/modules/${moduleId}/cases`)
}

export async function getCasesByProject(projectId: string): Promise<LibraryCase[]> {
  return get<LibraryCase[]>(`/projects/${projectId}/cases`)
}

export async function getCaseById(id: string): Promise<LibraryCase | undefined> {
  const all = await get<LibraryCase[]>(`/projects/_/cases`)
  return all.find(c => c.id === id)
}

export async function updateCase(c: LibraryCase): Promise<void> {
  await put(`/cases/${c.id}`, c)
}

export async function deleteCase(id: string): Promise<void> {
  await del(`/cases/${id}`)
}

export async function deleteCases(ids: string[]): Promise<void> {
  await post('/cases/batch-delete', { ids })
}

export async function searchCasesInProject(
  projectId: string,
  query: string,
): Promise<LibraryCase[]> {
  return get<LibraryCase[]>(`/projects/${projectId}/cases?q=${encodeURIComponent(query)}`)
}

export async function countCasesByProject(projectId: string): Promise<number> {
  const { count } = await get<{ count: number }>(`/projects/${projectId}/case-count`)
  return count
}

/** 各模块直接挂载的用例数（用于侧栏展示；含子树汇总由前端计算） */
export async function getModuleCaseCountsByProject(
  projectId: string,
): Promise<Record<string, number>> {
  const { counts } = await get<{ counts: Record<string, number> }>(
    `/projects/${projectId}/module-case-counts`,
  )
  return counts ?? {}
}

/* ========== Suite CRUD (保留接口，暂未使用) ========== */

export async function createSuite(
  projectId: string,
  name: string,
  description = '',
): Promise<Suite> {
  return post<Suite>('/suites', { projectId, name, description })
}

export async function getProjectSuites(projectId: string): Promise<Suite[]> {
  return get<Suite[]>(`/projects/${projectId}/suites`)
}

export async function updateSuite(_s: Suite): Promise<void> {
  // TODO: 后端接口待补充
}

export async function deleteSuite(suiteId: string): Promise<void> {
  await del(`/suites/${suiteId}`)
}

export async function linkCaseToSuite(suiteId: string, caseId: string): Promise<void> {
  await post(`/suites/${suiteId}/link`, { caseId })
}

export async function unlinkCaseFromSuite(suiteId: string, caseId: string): Promise<void> {
  await post(`/suites/${suiteId}/unlink`, { caseId })
}

export async function getSuiteLinks(_suiteId: string): Promise<SuiteCaseLink[]> {
  return []
}

export async function getSuiteCases(suiteId: string): Promise<LibraryCase[]> {
  return get<LibraryCase[]>(`/suites/${suiteId}/cases`)
}

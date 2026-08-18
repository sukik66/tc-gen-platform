/**
 * 一次性自动迁移：读取本 origin 的 IndexedDB 用例库数据 → 发送到后端 API
 * 迁移成功后在 localStorage 标记，不会重复执行。
 */

const MIGRATE_KEY = 'case-library-migrated-to-backend'
const API = '/api/case-library'

interface IdbProject { id: string; name: string; description: string; createdAt: string }
interface IdbModule { id: string; projectId: string; parentId: string | null; name: string; order: number }
interface IdbCase { id: string; projectId: string; moduleId: string; summary: string; module: string; subModule: string; priority: string; caseType: string; description: string; preconditions: string[]; steps: string[]; expected: string; remarks: string; [k: string]: unknown }

function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export async function migrateIdbToBackend(): Promise<void> {
  if (localStorage.getItem(MIGRATE_KEY) === 'done') return

  let db: IDBDatabase
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ai-test-platform', 2)
      req.onupgradeneeded = () => { req.transaction!.abort(); reject(new Error('NO_IDB')) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    localStorage.setItem(MIGRATE_KEY, 'no-idb')
    return
  }

  const projects = await readAll<IdbProject>(db, 'projects')
  const modules = await readAll<IdbModule>(db, 'modules')
  const cases = await readAll<IdbCase>(db, 'cases')
  db.close()

  if (projects.length === 0 && cases.length === 0) {
    localStorage.setItem(MIGRATE_KEY, 'empty')
    return
  }

  console.log(`[migrate] 发现 IDB 数据: ${projects.length} 项目, ${modules.length} 模块, ${cases.length} 用例`)

  const existingProjects: IdbProject[] = await fetch(`${API}/projects`).then(r => r.json())
  const existingNames = new Set(existingProjects.map(p => p.name))
  const projectIdMap: Record<string, string> = {}

  for (const p of projects) {
    if (existingNames.has(p.name)) {
      projectIdMap[p.id] = existingProjects.find(ep => ep.name === p.name)!.id
      continue
    }
    const created = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, description: p.description || '' }),
    }).then(r => r.json())
    projectIdMap[p.id] = created.id
  }

  const moduleIdMap: Record<string, string> = {}
  for (const m of modules) {
    const targetPid = projectIdMap[m.projectId]
    if (!targetPid) continue
    const existing: IdbModule[] = await fetch(`${API}/projects/${targetPid}/modules`).then(r => r.json())
    const match = existing.find(em => em.name === m.name)
    if (match) {
      moduleIdMap[m.id] = match.id
      continue
    }
    const created = await fetch(`${API}/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: targetPid, name: m.name, parentId: null }),
    }).then(r => r.json())
    moduleIdMap[m.id] = created.id
  }

  const byModule: Record<string, IdbCase[]> = {}
  for (const c of cases) {
    const key = c.moduleId
    if (!byModule[key]) byModule[key] = []
    byModule[key].push(c)
  }

  let total = 0
  for (const [oldMid, mCases] of Object.entries(byModule)) {
    const targetMid = moduleIdMap[oldMid]
    const targetPid = projectIdMap[mCases[0]?.projectId]
    if (!targetMid || !targetPid) continue

    const existingCases: { summary: string }[] = await fetch(`${API}/modules/${targetMid}/cases`).then(r => r.json())
    const existingSummaries = new Set(existingCases.map(c => c.summary))
    const newCases = mCases.filter(c => !existingSummaries.has(c.summary))

    if (newCases.length === 0) {
      console.log(`[migrate] 模块 ${mCases[0]?.module || oldMid}: ${mCases.length} 条全部已存在，跳过`)
      continue
    }

    const payload = newCases.map(c => ({
      summary: c.summary || '', module: c.module || '', subModule: c.subModule || '',
      priority: c.priority || 'P1', caseType: c.caseType || '功能测试',
      description: c.description || '', preconditions: c.preconditions || [],
      steps: c.steps || [], expected: c.expected || '', remarks: c.remarks || '',
    }))

    const res = await fetch(`${API}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cases: payload, projectId: targetPid, moduleId: targetMid }),
    }).then(r => r.json())
    total += res.imported || 0
  }

  console.log(`[migrate] 迁移完成: ${total} 条用例已导入后端`)
  localStorage.setItem(MIGRATE_KEY, 'done')
}

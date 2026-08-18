/**
 * 将旧版浏览器 IndexedDB（ai-test-contract-drafts）中的契约迁入服务端。
 * 成功后写 localStorage 标记，避免重复。
 */

import { saveContractDraft, type QualityContractDraft } from './contractDraftStore'
import { createModule, createProject, getAllProjects, getProjectModules } from './caseLibraryStore'

const DONE_KEY = 'quality-contracts-idb-migrated-v1'
const DB_NAME = 'ai-test-contract-drafts'
const STORE = 'drafts'
const DB_VERSION = 1

type LegacyRow = Omit<QualityContractDraft, 'projectId' | 'moduleId' | 'status'> & {
  projectId?: string
  moduleId?: string
  status?: string
}

async function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => resolve(null)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      req.transaction?.abort()
      resolve(null)
    }
  })
}

async function readAllDrafts(db: IDBDatabase): Promise<LegacyRow[]> {
  if (!db.objectStoreNames.contains(STORE)) return []
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).getAll()
    r.onsuccess = () => resolve((r.result as LegacyRow[]) || [])
    r.onerror = () => reject(r.error)
  })
}

/** 确保至少有一个项目 + 一个模块，供无主键旧数据挂靠 */
async function ensureDefaultPlacement(): Promise<{ projectId: string; moduleId: string }> {
  let projects = await getAllProjects()
  if (projects.length === 0) {
    const p = await createProject('默认项目', 'IndexedDB 迁移自动创建')
    projects = [p]
  }
  const projectId = projects[0].id
  let modules = await getProjectModules(projectId)
  if (modules.length === 0) {
    const m = await createModule(projectId, '未分类', null)
    modules = [m]
  }
  return { projectId, moduleId: modules[0].id }
}

export async function migrateContractsFromIdb(): Promise<void> {
  if (localStorage.getItem(DONE_KEY) === 'done' || localStorage.getItem(DONE_KEY) === 'empty') {
    return
  }

  const db = await openLegacyDb()
  if (!db) {
    localStorage.setItem(DONE_KEY, 'no-idb')
    return
  }

  let rows: LegacyRow[]
  try {
    rows = await readAllDrafts(db)
  } catch {
    db.close()
    localStorage.setItem(DONE_KEY, 'read-fail')
    return
  }
  db.close()

  if (rows.length === 0) {
    localStorage.setItem(DONE_KEY, 'empty')
    return
  }

  const fallback = await ensureDefaultPlacement()
  let migrated = 0
  for (const row of rows) {
    const projectId = row.projectId?.trim() || fallback.projectId
    const moduleId = row.moduleId?.trim() || fallback.moduleId
    const status = row.status === 'active' ? 'active' : 'draft'
    try {
      await saveContractDraft({
        projectId,
        moduleId,
        status,
        moduleLabel: row.moduleLabel || '（迁移）',
        rule: row.rule || '',
        boundaryHint: row.boundaryHint || '',
        priority: row.priority || 'P2',
        verifyMethods: Array.isArray(row.verifyMethods) && row.verifyMethods.length ? row.verifyMethods : ['code_review'],
        verifyRationale: row.verifyRationale || '自 IndexedDB 迁移',
        codeContext: row.codeContext ?? null,
      })
      migrated += 1
    } catch (e) {
      console.error('[migrate-contracts]', e)
    }
  }

  console.log(`[migrate-contracts] 已从 IndexedDB 迁入 ${migrated}/${rows.length} 条契约`)
  if (migrated === rows.length && migrated > 0) {
    try {
      indexedDB.deleteDatabase(DB_NAME)
    } catch {
      /* ignore */
    }
  }
  localStorage.setItem(DONE_KEY, migrated === rows.length ? 'done' : `partial-${migrated}`)
}

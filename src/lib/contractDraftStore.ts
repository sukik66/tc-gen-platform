/**
 * 质量契约 · 后端 `data/quality-contracts.json`（与用例库同策略）
 * 每条契约须带 projectId + moduleId（与用例库对齐）
 */

import type { CodeContextPayload } from '../api/vcs'
import type { Priority } from '../types'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export type ContractVerifyMethod = 'code_review' | 'api_test' | 'ui_test'
export type ContractStatus = 'draft' | 'active'

export interface QualityContractDraft {
  id: string
  /** 归属用例库项目 */
  projectId: string
  /** 归属用例库模块 */
  moduleId: string
  /** 草稿 / 已启用 */
  status: ContractStatus
  moduleLabel: string
  rule: string
  boundaryHint: string
  priority: Priority
  verifyMethods: ContractVerifyMethod[]
  verifyRationale?: string
  codeContext: CodeContextPayload | null
  createdAt: string
  updatedAt: string
}

export interface ListContractDraftsFilters {
  projectId?: string
  moduleId?: string
}

async function parseJson<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 ${r.status}`)
  }
  return data as T
}

function buildListQuery(f?: ListContractDraftsFilters): string {
  if (!f?.projectId && !f?.moduleId) return ''
  const q = new URLSearchParams()
  if (f.projectId) q.set('projectId', f.projectId)
  if (f.moduleId) q.set('moduleId', f.moduleId)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function listContractDrafts(
  filters?: ListContractDraftsFilters,
): Promise<QualityContractDraft[]> {
  const r = await fetch(`${apiBase}/api/quality-contracts/drafts${buildListQuery(filters)}`)
  return parseJson<QualityContractDraft[]>(r)
}

export async function saveContractDraft(
  input: Omit<QualityContractDraft, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<QualityContractDraft> {
  const r = await fetch(`${apiBase}/api/quality-contracts/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseJson<QualityContractDraft>(r)
}

export async function updateContractDraft(
  id: string,
  patch: Partial<Omit<QualityContractDraft, 'id' | 'createdAt'>>,
): Promise<QualityContractDraft> {
  const r = await fetch(`${apiBase}/api/quality-contracts/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJson<QualityContractDraft>(r)
}

export async function deleteContractDraft(id: string): Promise<void> {
  const r = await fetch(`${apiBase}/api/quality-contracts/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  await parseJson<{ ok: boolean }>(r)
}

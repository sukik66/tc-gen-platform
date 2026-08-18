/**
 * QC-13b（ST-004）· AI 自写规则提案审批前端 API
 *
 * 后端三端点（由 ST-003 已建）：
 *   - GET  /api/rule-proposals?status=pending|approved|rejected   → RuleProposal[]
 *   - POST /api/rule-proposals/:id/approve                        → { ok: true }
 *   - POST /api/rule-proposals/:id/reject                         → { ok: true }
 *
 * 错误处理：response.ok=false 或网络异常时抛出 Error，message 优先取后端 error 字段，
 * 否则回退为 `${status}` 或网络错误描述。与 codeReview.ts 风格一致。
 */
import type { RuleProposalDraft } from './codeReview'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export type RuleProposalStatus = 'pending' | 'approved' | 'rejected'

/** 与 server/vcs/rule-proposal-generator.js 输出 schema 对齐（含 ST-003 acceptance #5 的所有字段） */
export interface RuleProposal {
  id: string
  status: RuleProposalStatus
  /** 关键词正则字符串（运行时 new RegExp(keywords, 'i') 还原） */
  keywords: string
  /** 候选目录 hints（inferCandidateDirs 风格） */
  hints: string[]
  /** 文件名命中关键词 */
  fileKeywords: string[]
  /** 走查时实际读过的目录与命中文件 */
  evidence: { readDirs: string[]; hitFiles: string[] }
  /** 影响模块（可选；模型不一定输出） */
  affectsModules?: string[]
  /** Pass 2 LLM 自评分（可选） */
  qualityScore?: number
  /** 来源契约/任务上下文 */
  sourceContext?: {
    contractId?: string
    moduleLabel?: string
    ruleSummary?: string
    taskId?: string
  }
  createdAt: string
  updatedAt: string
}

/** 友好封装 fetch 错误 */
async function parseErrorOrFallback(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string }
    return data?.error || data?.message || fallback
  } catch {
    return fallback
  }
}

/** 列出规则提案（可按状态过滤） */
export async function listRuleProposals(status?: RuleProposalStatus): Promise<RuleProposal[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/rule-proposals${qs}`)
  } catch (e) {
    throw new Error(`获取规则提案列表失败：网络异常（${e instanceof Error ? e.message : '未知错误'}）`)
  }
  if (!res.ok) {
    const msg = await parseErrorOrFallback(res, `获取规则提案列表失败 (${res.status})`)
    throw new Error(msg)
  }
  const data = (await res.json().catch(() => ({}))) as { items?: RuleProposal[] } | RuleProposal[]
  if (Array.isArray(data)) return data
  if (Array.isArray((data as { items?: RuleProposal[] }).items)) {
    return (data as { items: RuleProposal[] }).items
  }
  return []
}

/** 批准提案 → 后端会 append 到 unity-domain-rules.json 并热加载 */
export async function approveRuleProposal(id: string): Promise<{ ok: true }> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/rule-proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    throw new Error(`批准提案失败：网络异常（${e instanceof Error ? e.message : '未知错误'}）`)
  }
  if (!res.ok) {
    const msg = await parseErrorOrFallback(res, `批准提案失败 (${res.status})`)
    throw new Error(msg)
  }
  return { ok: true }
}

/** 驳回提案 → 后端将状态改 rejected，保留 evidence */
export async function rejectRuleProposal(id: string): Promise<{ ok: true }> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/rule-proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    throw new Error(`驳回提案失败：网络异常（${e instanceof Error ? e.message : '未知错误'}）`)
  }
  if (!res.ok) {
    const msg = await parseErrorOrFallback(res, `驳回提案失败 (${res.status})`)
    throw new Error(msg)
  }
  return { ok: true }
}

/** Re-export 以便组件层一处导入即可拿到草稿与 API 类型 */
export type { RuleProposalDraft }

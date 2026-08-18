import type { CodeContextPayload } from './vcs'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export type CodeReviewVerdict = 'pass' | 'fail' | 'uncertain'

/** 代码证据条目（QC-15 后输出 schema 与文章原文 IO 对齐） */
export interface CodeReviewEvidence {
  file: string
  method: string
  lineHint: string
  description: string
}

/* ─── ST-003 AI 提案：内联 ruleProposalDraft（供 ST-004 消费） ─── */

export interface RuleProposalDraft {
  keywords: string
  hints: string[]
  fileKeywords: string[]
  evidence: { readDirs: string[]; hitFiles: string[] }
  affectsModules?: string[]
}

/* ─── codeContextStats 强类型导出 ─── */

export interface CodeContextStats {
  filesMatchedTotal: number
  filesWithBodyTotal: number
  omittedFromBodyTotal: number
  omittedFromBody: string[]
}

/* ─── 主结果类型（QC-15 单层 schema） ─── */

export interface ContractCodeReviewResult {
  /** 主字段：与文章原文 IO 对齐 */
  conclusion: CodeReviewVerdict
  /** 兼容字段：与 conclusion 同值，给前端旧渲染代码（verdict 徽章）继续工作 */
  verdict: CodeReviewVerdict
  confidence: number
  reasoning: string
  evidence: CodeReviewEvidence[]
  gaps: string

  /** agent 实际读取过正文的文件路径 */
  filesRead?: string[]
  /** agent 本次消耗的工具调用次数 */
  toolCallsUsed?: number

  /* ST-003 AI 提案内联（供 ST-004 渲染草稿卡片） */
  ruleProposalId?: string
  ruleProposalDraft?: RuleProposalDraft

  meta?: {
    dirHints?: string[]
    fileKeywords?: string[]
    fallback?: boolean
    toolCallsUsed?: number
    codeContextChars?: number
    codeContextStats?: CodeContextStats
  }
}

/** 将走查结果格式化为 Markdown，便于粘贴到工单或文档。 */
export function formatCodeReviewMarkdown(
  r: ContractCodeReviewResult,
  opts?: { title?: string; ruleSummary?: string },
): string {
  const title = opts?.title?.trim() || '代码走查报告'
  const verdictZh =
    r.conclusion === 'pass' ? '通过倾向' : r.conclusion === 'fail' ? '未通过倾向' : '不确定'
  const lines: string[] = [
    `# ${title}`,
    '',
    `- **结论**：${verdictZh}（\`${r.conclusion}\`）`,
    `- **置信度**：${r.confidence}%`,
  ]
  if (opts?.ruleSummary?.trim()) {
    lines.push('', '## 对照规则摘要', '', opts.ruleSummary.trim())
  }
  const tc = r.toolCallsUsed ?? r.meta?.toolCallsUsed
  if (tc != null) lines.push(`- **工具调用次数**：${tc}`)
  if (r.filesRead && r.filesRead.length > 0) {
    lines.push('', '## 实际读取文件', '', ...r.filesRead.map((f) => `- \`${f}\``))
  }
  lines.push('', '## 推理', '', r.reasoning.trim() || '（无）')
  if (r.evidence && r.evidence.length > 0) {
    lines.push('', '## 证据列表')
    for (const e of r.evidence) {
      const loc = [e.file, e.method, e.lineHint].filter(Boolean).join(' · ')
      lines.push('', `### ${loc || '（位置未标明）'}`, '', e.description)
    }
  }
  if (r.gaps?.trim()) {
    lines.push('', '## 证据缺口 / 待补材料', '', r.gaps.trim())
  }
  return lines.join('\n')
}

export async function runContractCodeReview(body: {
  rule: string
  boundaryHint?: string
  moduleLabel?: string
  /** 仍可传入，仅用于提取用户手动配置的 extraDirHints（步骤④可选） */
  codeChanges?: CodeContextPayload | null
  llmProvider?: string | null
  /** 可选：契约 id（写入 rule-proposals.json 的 sourceContext） */
  contractId?: string | null
}): Promise<ContractCodeReviewResult> {
  const res = await fetch(`${apiBase}/api/contract-code-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rule: body.rule,
      boundaryHint: body.boundaryHint || '',
      moduleLabel: body.moduleLabel || '',
      ...(body.codeChanges ? { codeChanges: body.codeChanges } : {}),
      ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
      ...(body.contractId ? { contractId: body.contractId } : {}),
    }),
  })
  const data = (await res.json().catch(() => ({}))) as ContractCodeReviewResult & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `代码走查失败 (${res.status})`)
  }
  return data as ContractCodeReviewResult
}

/* ─── TKT-20260429-014 · 单契约走查（按 id） + 历史查询 ─── */

/**
 * 走查结果落盘后追加的元字段。
 *  - savedAt：与 runAt 同值（语义双名兼容）
 *  - contractId：服务端回写
 */
export interface PersistedContractCodeReviewResult extends ContractCodeReviewResult {
  contractId?: string
  runAt?: string
  savedAt?: string
  /** 仅历史接口返回 */
  llmProvider?: string
  /** 仅历史接口返回 */
  id?: string
}

/**
 * 触发某条已入库契约的代码走查。
 * 后端会从 listDrafts 中按 id 找到契约、自动取 rule/boundaryHint/moduleLabel；
 * codeChanges 优先用 body.codeChanges，否则降级为契约自身 codeContext。
 */
export async function runContractCodeReviewById(
  contractId: string,
  body: {
    codeChanges?: CodeContextPayload | null
    llmProvider?: string | null
    llmModel?: string | null
    /** 可选透传，超时控制由调用方决定 */
    signal?: AbortSignal
  } = {},
): Promise<PersistedContractCodeReviewResult> {
  const id = encodeURIComponent(contractId)
  const res = await fetch(`${apiBase}/api/quality-contracts/drafts/${id}/code-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(body.codeChanges ? { codeChanges: body.codeChanges } : {}),
      ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
      ...(body.llmModel ? { llmModel: body.llmModel } : {}),
    }),
    signal: body.signal,
  })
  const data = (await res.json().catch(() => ({}))) as PersistedContractCodeReviewResult & {
    error?: string
  }
  if (!res.ok) {
    throw new Error(data.error || `代码走查失败 (${res.status})`)
  }
  return data
}

/**
 * 列出某条契约最近 N 条走查历史（默认 3，最大 3 由后端约束）。
 * 用于 ContractLibraryPage 进入页时拉取最新一次走查结论展示。
 */
export async function listContractReviewResults(
  contractId: string,
  limit = 3,
): Promise<PersistedContractCodeReviewResult[]> {
  const id = encodeURIComponent(contractId)
  const url = `${apiBase}/api/quality-contracts/drafts/${id}/code-review-results?limit=${encodeURIComponent(
    String(limit),
  )}`
  const res = await fetch(url)
  const data = (await res.json().catch(() => [])) as
    | PersistedContractCodeReviewResult[]
    | { error?: string }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(err || `读取走查历史失败 (${res.status})`)
  }
  return Array.isArray(data) ? data : []
}

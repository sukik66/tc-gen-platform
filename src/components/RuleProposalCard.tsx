/**
 * QC-13b（ST-004）· AI 自写规则提案审批卡片
 *
 * 设计要点（来自 dispatcher.md §scope.in_scope 13b.3）：
 * - violet 风格（与 Step 5 走查结果区一致）
 * - 内容区：标题「AI 草拟规则建议」+ keywords / hints / fileKeywords / evidence(默认折叠) / affectsModules?
 * - 三按钮：「批准入库」（violet 主色）/「驳回」（灰）/「稍后再说」（透明）
 * - 状态机：idle | submitting | done | error（done/error 仅瞬态显示，成功后页面层移除卡片）
 * - 提交中：所有按钮 disable + spinner
 * - 提交失败：显示错误文案 + 重置 idle，可重试
 *
 * 状态机隔离铁律（来自 analyst §三 13b.5）：
 * - 卡片"提交中"状态在卡片内部；卡片"已稍后/已处理"状态在页面层；
 * - 不与 reviewResult 共用 state；不污染走查状态。
 */
import { useState } from 'react'
import type { RuleProposalDraft } from '../api/ruleProposals'

type ActionState = 'idle' | 'submitting' | 'done' | 'error'

export interface RuleProposalCardProps {
  proposal: RuleProposalDraft
  proposalId: string
  onApprove: () => Promise<void>
  onReject: () => Promise<void>
  onDefer: () => void
}

export function RuleProposalCard(props: RuleProposalCardProps) {
  const { proposal, proposalId, onApprove, onReject, onDefer } = props

  const [state, setState] = useState<ActionState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const disabled = state === 'submitting' || state === 'done'

  const handle = async (kind: 'approve' | 'reject') => {
    setState('submitting')
    setErrorMsg(null)
    try {
      if (kind === 'approve') await onApprove()
      else await onReject()
      setState('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '提交失败，请重试')
      setState('error')
    }
  }

  const handleDefer = () => {
    if (disabled) return
    onDefer()
  }

  const readDirs = proposal.evidence?.readDirs ?? []
  const hitFiles = proposal.evidence?.hitFiles ?? []
  const evidenceCount = readDirs.length + hitFiles.length

  return (
    <div
      className="mt-4 rounded-lg border border-violet-500/40 bg-violet-950/25 p-3 text-xs"
      data-rule-proposal-card
      data-proposal-id={proposalId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-violet-500/25 px-2 py-0.5 text-[11px] font-semibold text-violet-100">
          AI 草拟规则建议
        </span>
        <span className="text-[10px] text-zinc-500">基于本次走查命中代码反推</span>
      </div>

      {/* keywords 正则原文 */}
      <div className="mt-2">
        <div className="text-[10px] text-zinc-400">关键词正则</div>
        <code className="mt-0.5 block break-all rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-violet-100">
          {proposal.keywords || '（空）'}
        </code>
      </div>

      {/* 候选目录 hints */}
      {proposal.hints && proposal.hints.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-zinc-400">候选目录 hints</div>
          <ul className="mt-0.5 space-y-0.5">
            {proposal.hints.map((h, i) => (
              <li key={i} className="font-mono text-[11px] text-zinc-300">
                · {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 文件关键词标签云 */}
      {proposal.fileKeywords && proposal.fileKeywords.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-zinc-400">文件关键词</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {proposal.fileKeywords.map((k, i) => (
              <span
                key={i}
                className="inline-block rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-200"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 影响模块（可选） */}
      {proposal.affectsModules && proposal.affectsModules.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-zinc-400">影响模块</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {proposal.affectsModules.map((m, i) => (
              <span
                key={i}
                className="inline-block rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-200"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* evidence 默认折叠 */}
      {evidenceCount > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setEvidenceOpen((v) => !v)}
            className="text-[11px] text-violet-300 hover:text-violet-200"
            data-rule-proposal-evidence-toggle
          >
            {evidenceOpen ? '收起证据' : `展开证据（共 ${evidenceCount} 条）`}
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-1.5">
              {readDirs.length > 0 && (
                <div>
                  <div className="text-[10px] text-zinc-500">已读目录</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {readDirs.map((d, i) => (
                      <li key={`d-${i}`} className="font-mono text-[10px] text-zinc-400">
                        · {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hitFiles.length > 0 && (
                <div>
                  <div className="text-[10px] text-zinc-500">命中文件</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {hitFiles.map((f, i) => (
                      <li key={`f-${i}`} className="font-mono text-[10px] text-zinc-400">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {state === 'error' && errorMsg && (
        <p className="mt-2 rounded border border-red-500/30 bg-red-950/30 px-2 py-1 text-[11px] text-red-200">
          ⚠ {errorMsg}
        </p>
      )}

      {/* 三按钮 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
        <button
          type="button"
          onClick={() => void handle('approve')}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          data-rule-proposal-approve
        >
          {state === 'submitting' && <Spinner />}
          批准入库
        </button>
        <button
          type="button"
          onClick={() => void handle('reject')}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-white/25 hover:bg-white/10 disabled:opacity-50"
          data-rule-proposal-reject
        >
          {state === 'submitting' && <Spinner />}
          驳回
        </button>
        <button
          type="button"
          onClick={handleDefer}
          disabled={disabled}
          className="rounded-lg border border-transparent px-3 py-1.5 text-xs text-zinc-400 hover:border-white/15 hover:text-zinc-300 disabled:opacity-50"
          data-rule-proposal-defer
        >
          稍后再说
        </button>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  )
}

export default RuleProposalCard

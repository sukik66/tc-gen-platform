import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CodeChangePanel from '../components/CodeChangePanel'
import type { CodeContextPayload } from '../api/vcs'
import type { Priority, TestDepth } from '../types'
import {
  APP_TIMEZONE,
  CONTRACT_METHOD_OPTIONS,
  contractMethodLabel,
} from '../constants'
import { priorityClass } from '../lib/ui-utils'
import {
  type ContractVerifyMethod,
  type QualityContractDraft,
  deleteContractDraft,
  listContractDrafts,
  saveContractDraft,
} from '../lib/contractDraftStore'
import {
  streamGenerateContracts,
  type ContractAiItem,
} from '../api/generateContracts'
import {
  runContractCodeReview,
  runContractCodeReviewById,
  type ContractCodeReviewResult,
  type PersistedContractCodeReviewResult,
} from '../api/codeReview'
import { approveRuleProposal, rejectRuleProposal } from '../api/ruleProposals'
import { useLlmProvider } from '../hooks/useLlmProvider'
import { LlmProviderSelect } from '../components/LlmProviderSelect'
import { ContractCard } from '../components/ContractCard'
import { RuleProposalCard } from '../components/RuleProposalCard'
import { PageShell } from '../components/PageShell'
import { AppHeader } from '../components/AppHeader'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useDocumentUpload, defaultRoleFirstPrimary } from '../hooks/useDocumentUpload'
import { DocumentUploadPanel } from '../components/DocumentUploadPanel'
import {
  saveContractInputSnapshot,
  loadContractInputSnapshot,
  getContractInputSnapshotTime,
} from '../lib/contractInputSnapshotStore'


function StepShell(props: {
  id: string
  step: number
  title: string
  subtitle?: string
  variant: 'teal' | 'violet' | 'neutral'
  children: React.ReactNode
}) {
  const { id, step, title, subtitle, variant, children } = props
  const shell =
    variant === 'teal'
      ? 'border-teal-500/30 bg-teal-950/15'
      : variant === 'violet'
        ? 'border-violet-500/30 bg-violet-950/12'
        : 'border-white/10 bg-white/[0.02]'
  const badge =
    variant === 'teal'
      ? 'bg-teal-600 text-white ring-2 ring-teal-500/25'
      : variant === 'violet'
        ? 'bg-violet-600 text-white ring-2 ring-violet-500/25'
        : 'bg-zinc-600 text-white ring-2 ring-white/10'
  return (
    <section id={id} className={`scroll-mt-24 rounded-2xl border p-5 ${shell}`}>
      <div className="flex gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${badge}`}
          aria-hidden
        >
          {step}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs leading-relaxed text-zinc-500">{subtitle}</p> : null}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  )
}


export function QualityContractsPage() {
  const [moduleLabel, setModuleLabel] = useState('')
  const [rule, setRule] = useState('')
  const [boundaryHint, setBoundaryHint] = useState('')
  const [priority, setPriority] = useState<Priority>('P1')
  const [methods, setMethods] = useState<Set<ContractVerifyMethod>>(
    () => new Set(['code_review', 'api_test']),
  )
  const [codeContext, setCodeContext] = useState<CodeContextPayload | null>(null)
  const [rows, setRows] = useState<QualityContractDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  /** 文档上传 Hook：默认策略与 TCG 对齐（第 1 个主需求，其余附件）；知识库暂闭期间不传 onParsed */
  const docs = useDocumentUpload({ defaultRole: defaultRoleFirstPrimary })
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const genDocs = docs.files
  const genDepth: TestDepth = 'qa'
  const [genFocus, setGenFocus] = useState('')
  const [aiPreview, setAiPreview] = useState<ContractAiItem[] | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractElapsedSec, setExtractElapsedSec] = useState(0)
  const contractStreamBufRef = useRef('')
  const extractAbortRef = useRef<AbortController | null>(null)
  const [savingAiBatch, setSavingAiBatch] = useState(false)
  const llm = useLlmProvider()

  const [reviewResult, setReviewResult] = useState<ContractCodeReviewResult | null>(null)
  const [reviewRunning, setReviewRunning] = useState(false)

  /* ─── TKT-20260429-014 · 批量走查 state ───
   * batchRunning：批量任务运行中（与 reviewRunning 互斥按钮）
   * batchProgress：进度元信息 { current, total, currentLabel }
   * batchSummary：完成后的汇总 { pass, fail, uncertain, errors, elapsedMs }
   * batchResults：每条契约最新一次走查结果（id 索引），刷新前生效
   * batchErrors：错误明细（contractId → error message）便于排查
   * batchAbortRef：AbortController 实例，支持中途取消
   */
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<
    | {
        current: number
        total: number
        currentLabel: string
      }
    | null
  >(null)
  const [batchSummary, setBatchSummary] = useState<
    | {
        pass: number
        fail: number
        uncertain: number
        errors: number
        elapsedMs: number
      }
    | null
  >(null)
  const [batchResults, setBatchResults] = useState<Record<string, PersistedContractCodeReviewResult>>({})
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const batchAbortRef = useRef<AbortController | null>(null)

  /* ─── ST-004（QC-13b）· 规则提案审批状态机（与 reviewResult 隔离） ───
   * proposalDismissed: 「稍后再说」隐藏的提案 id 集合（map 形态支持多次走查命中不同 id）
   * 「提交中」状态由 RuleProposalCard 内部 useState 维护；批准/驳回成功后页面层从 reviewResult 移除 ruleProposalId 字段（二次点击防御铁律）。 */
  const [proposalDismissed, setProposalDismissed] = useState<Record<string, boolean>>({})

  /** ST-1（QC-15）·契约页输入快照时间戳（保存/应用按钮显示用，独立于 TCG 快照不互相覆盖） */
  const [contractSnapshotTime, setContractSnapshotTime] = useState<string | null>(
    () => getContractInputSnapshotTime(),
  )

  // extracting 变为 true 时启动秒级计时器，每秒 +1 更新界面经过时间
  useEffect(() => {
    if (!extracting) { setExtractElapsedSec(0); return }
    setExtractElapsedSec(0)
    const id = window.setInterval(() => setExtractElapsedSec((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [extracting])

  const documentText = useMemo(() => {
    const fromGen = genDocs
      .filter((d) => d.status === 'parsed' && (d.extractedText ?? '').trim())
      .map((d) => d.extractedText ?? '')
      .join('\n\n')
    const manual = [rule.trim(), boundaryHint.trim()].filter(Boolean).join('\n\n')
    const parts = [fromGen, manual].filter(Boolean)
    return parts.join('\n\n---\n\n')
  }, [genDocs, rule, boundaryHint])

  const panelDocName = useMemo(() => {
    const first = genDocs.find((d) => d.status === 'parsed')
    if (first) return first.name
    return moduleLabel.trim() || '需求文档-用于代码关联'
  }, [genDocs, moduleLabel])

  /** 代码走查优先用手动填写的规则；若规则为空，则降级使用已解析文档文本（超限时截断） */
  const effectiveRuleForReview = useMemo(() => {
    const r = rule.trim()
    if (r) return r
    const d = documentText.trim()
    if (!d) return ''
    return d.length > 16000 ? `${d.slice(0, 16000)}\n\n（文档过长已截断至 16000 字符）` : d
  }, [rule, documentText])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listContractDrafts())
    } catch (e) {
      console.error(e)
      setMsg('读取契约草稿失败，请确认本机已启动 API（npm run dev）可访问 /api/quality-contracts/drafts，本地存储采用 IndexedDB')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleMethod = (id: ContractVerifyMethod) => {
    setMethods((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setMsg(null)
    const r = rule.trim()
    if (!r) {
      setMsg('请填写业务规则（至少一条），这是契约的核心内容')
      return
    }
    setSaving(true)
    try {
      await saveContractDraft({
        // ST-003：补齐 contractDraftStore.ts 强类型必需字段（修 ST-001 留下的 11 个预存 lint 之一）
        // 本期质量契约页尚未引入项目/模块选择器，先用 'default' 占位与 case-library 已有的 'default' 项目对齐
        status: 'draft',
        projectId: 'default',
        moduleId: 'default',
        moduleLabel: moduleLabel.trim() || '未分类模块',
        rule: r,
        boundaryHint: boundaryHint.trim(),
        priority,
        verifyMethods: Array.from(methods),
        codeContext,
      })
      setMsg('契约已保存到本地库')
      await reload()
    } catch (e) {
      console.error(e)
      setMsg('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '删除这条契约草稿？',
      description: '草稿删除后不可恢复，请确认。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    await deleteContractDraft(id)
    await reload()
  }

  const handleAiExtract = () => {
    setMsg(null)
    setExtractError(null)
    setAiPreview(null)
    contractStreamBufRef.current = ''
    const documents = docs.buildParsedDocumentsPayload()
    if (documents.length === 0) {
      const e = '请先上传并解析至少一份需求文档'
      setMsg(e)
      setExtractError(e)
      return
    }
    extractAbortRef.current?.abort()
    extractAbortRef.current = null
    setExtracting(true)
    const ac = streamGenerateContracts(
      {
        documents,
        focusText: genFocus,
        depth: genDepth,
        timezone: APP_TIMEZONE,
        llmProvider: llm.selectedProvider || null,
      },
      {
        onStreamOpen: () => {},
        onHeartbeat: (sec) => { setExtractElapsedSec(sec) },
        onDelta: (chunk) => {
          contractStreamBufRef.current += chunk
        },
        onPreview: (contracts) => {
          if (contracts.length > 0) setAiPreview(contracts)
        },
        onDone: (contracts) => {
          setAiPreview(contracts.length > 0 ? contracts : null)
          setMsg(`已生成 ${contracts.length} 条契约预览，请确认后入库`)
          setExtracting(false)
          setExtractError(null)
          contractStreamBufRef.current = ''
          extractAbortRef.current = null
        },
        onError: (err) => {
          console.error(err)
          setMsg(err || '提取失败')
          setExtractError(err || '提取失败')
          setExtracting(false)
          contractStreamBufRef.current = ''
          extractAbortRef.current = null
        },
      },
    )
    extractAbortRef.current = ac
  }

  const handleRunCodeReview = async () => {
    if (!codeContext) {
      setMsg('请先在下方步骤 ④「代码仓库」中完成关联（与用例生成相同）')
      return
    }
    if (!effectiveRuleForReview) {
      setMsg('请填写业务规则，或上传/解析需求文档以提供走查依据')
      return
    }
    setReviewRunning(true)
    setReviewResult(null)
    setMsg(null)
    try {
      const r = await runContractCodeReview({
        rule: effectiveRuleForReview,
        boundaryHint: boundaryHint.trim(),
        codeChanges: codeContext,
        llmProvider: llm.selectedProvider || null,
      })
      setReviewResult(r)
      setMsg('代码走查已完成（模型举证，非形式化证明）')
    } catch (e) {
      console.error(e)
      setMsg(e instanceof Error ? e.message : '走查失败')
    } finally {
      setReviewRunning(false)
    }
  }

  /* ─── TKT-20260430-001 · 一键走查：从快照恢复 codeContext 后直接启动批量走查 ─── */
  const handleQuickBatchReview = async () => {
    if (rows.length === 0) {
      setMsg('当前页面没有已入库契约。请先用 AI 提取 + 入库，或在步骤 ⑥ 手写并保存。')
      return
    }
    let ctx = codeContext
    if (!ctx) {
      const snap = loadContractInputSnapshot()
      if (!snap?.codeChanges) {
        setMsg('未找到已保存的代码上下文快照，请先在步骤 ④ 完成代码仓库关联并保存一次快照')
        return
      }
      ctx = snap.codeChanges
      setCodeContext(ctx)
      if (snap.files?.length) docs.replaceAll(snap.files)
      if (snap.focusText) setGenFocus(snap.focusText)
    }
    await handleBatchReview(ctx)
  }

  /* ─── TKT-20260429-014 · 批量走查处理函数 ─── */
  const handleBatchReview = async (overrideCodeContext?: CodeContextPayload | null) => {
    const effectiveCtx = overrideCodeContext ?? codeContext
    if (rows.length === 0) {
      setMsg('当前页面没有已入库契约。请先用 AI 提取 + 入库，或在步骤 ⑥ 手写并保存。')
      return
    }
    if (!effectiveCtx) {
      setMsg('请先在步骤 ④「代码仓库」中完成关联，再点批量走查')
      return
    }

    const ac = new AbortController()
    batchAbortRef.current = ac
    setBatchRunning(true)
    setBatchProgress({ current: 0, total: rows.length, currentLabel: rows[0].moduleLabel })
    setBatchSummary(null)
    setBatchResults({})
    setBatchErrors({})
    setMsg(null)

    const start = Date.now()
    let pass = 0
    let fail = 0
    let uncertain = 0
    let errors = 0
    /** 边走边累加，最后一次性 set 减少 React 抖动；每条结束都增量 set 以驱动 UI */
    const accResults: Record<string, PersistedContractCodeReviewResult> = {}
    const accErrors: Record<string, string> = {}

    for (let i = 0; i < rows.length; i++) {
      if (ac.signal.aborted) break
      const c = rows[i]
      const ruleHead = (c.rule || '').slice(0, 30)
      setBatchProgress({
        current: i,
        total: rows.length,
        currentLabel: `${c.moduleLabel} - ${ruleHead}${(c.rule || '').length > 30 ? '...' : ''}`,
      })
      try {
        const r = await runContractCodeReviewById(c.id, {
          codeChanges: effectiveCtx,
          llmProvider: llm.selectedProvider || null,
          signal: ac.signal,
        })
        accResults[c.id] = r
        setBatchResults({ ...accResults })
        if (r.conclusion === 'pass') pass++
        else if (r.conclusion === 'fail') fail++
        else uncertain++
      } catch (e) {
        if (ac.signal.aborted) break
        const msg = e instanceof Error ? e.message : String(e)
        accErrors[c.id] = msg
        setBatchErrors({ ...accErrors })
        errors++
      }
    }

    setBatchProgress({
      current: rows.length,
      total: rows.length,
      currentLabel: ac.signal.aborted ? '已取消' : '全部完成',
    })
    setBatchSummary({
      pass,
      fail,
      uncertain,
      errors,
      elapsedMs: Date.now() - start,
    })
    setBatchRunning(false)
    batchAbortRef.current = null

    if (!ac.signal.aborted && effectiveCtx) {
      saveContractInputSnapshot({ files: genDocs, focusText: genFocus, codeChanges: effectiveCtx })
      setContractSnapshotTime(getContractInputSnapshotTime())
    }

    setMsg(
      ac.signal.aborted
        ? `批量走查已取消，已完成 ${pass + fail + uncertain + errors}/${rows.length}`
        : `批量走查完成：${pass} 通过 · ${fail} 违规 · ${uncertain} 存疑 · ${errors} 错误（快照已自动保存）`,
    )
  }

  const handleAbortBatch = () => {
    batchAbortRef.current?.abort()
  }

  const handleSaveAiBatch = async () => {
    if (!aiPreview?.length) return
    const batch = aiPreview
    setSavingAiBatch(true)
    setMsg(null)
    try {
      for (const c of batch) {
        await saveContractDraft({
          // ST-003：批量入库同样补齐强类型字段（修预存 lint）
          status: 'draft',
          projectId: 'default',
          moduleId: 'default',
          moduleLabel: c.moduleLabel,
          rule: c.rule,
          boundaryHint: c.boundaryHint,
          priority: c.priority,
          verifyMethods: c.verifyMethods,
          codeContext,
        })
      }
      setAiPreview(null)
      setMsg(`已将 ${batch.length} 条契约入库，可在下方「契约库」中查看和编辑`)
      await reload()
    } catch (e) {
      console.error(e)
      setMsg('批量保存失败')
    } finally {
      setSavingAiBatch(false)
    }
  }

  /* ─── ST-004（QC-13b）· 规则提案审批三动作 ─── */

  /** 二次点击防御：从 reviewResult 移除 ruleProposalId/ruleProposalDraft，避免重渲染或刷新再次出现卡片 */
  const clearProposalFromReview = useCallback(() => {
    setReviewResult((prev) =>
      prev ? { ...prev, ruleProposalId: undefined, ruleProposalDraft: undefined } : prev,
    )
  }, [])

  const handleProposalApprove = useCallback(
    async (id: string) => {
      await approveRuleProposal(id)
      clearProposalFromReview()
      setMsg('规则已入库，下次相关走查将直接命中')
    },
    [clearProposalFromReview],
  )

  const handleProposalReject = useCallback(
    async (id: string) => {
      await rejectRuleProposal(id)
      clearProposalFromReview()
      setMsg('提案已驳回')
    },
    [clearProposalFromReview],
  )

  const handleProposalDefer = useCallback((id: string) => {
    setProposalDismissed((prev) => ({ ...prev, [id]: true }))
  }, [])

  return (
    <PageShell>
      <AppHeader
        theme="teal"
        eyebrow="实验台 · 与用例生成独立存储"
        title="质量契约"
        subtitle={
          <>
            沉淀<strong className="text-zinc-300">可验证的业务规则</strong>，与用例生成共享项目 / 模块、聚焦与应用范围描述：① 上传需求 → ② AI 提取 → ③ 关联代码仓库 → ④ 代码走查（自动） → ⑤ 手动补充规则，最终形成可执行的质量基线。
          </>
        }
        actions={
          <Link
            to="/generation"
            className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-500/25"
          >
            测试用例生成
          </Link>
        }
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-20">
        {msg && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
            {msg}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <StepShell
            id="qc-1"
            step={1}
            title="需求文件"
            subtitle="PDF/Word/Excel 均可上传解析"
            variant="teal"
          >
            <DocumentUploadPanel
              state={docs}
              variant="full"
              theme="teal"
              accept=".pdf,.docx,.xls,.xlsx,.xlsm,.txt,.md,.csv,.json,image/*"
              disabled={extracting}
            />
          </StepShell>

          <StepShell
            id="qc-2"
            step={2}
            title="提取配置"
            variant="teal"
          >
            <label className="block text-xs text-zinc-400">
              关注重点（可选）
              <textarea
                value={genFocus}
                onChange={(e) => setGenFocus(e.target.value)}
                rows={3}
                placeholder="例如：优惠券叠加、金额精度、强退逻辑、战斗计算等…"
                className="mt-1 w-full resize-y rounded-lg border border-white/15 bg-[#14151f] px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-teal-500/50"
              />
            </label>
            <div className="mt-3">
              <LlmProviderSelect state={llm} variant="teal" disabled={extracting} />
            </div>
          </StepShell>
        </div>

        <StepShell
          id="qc-3"
          step={3}
          title="生成契约预览"
          subtitle="流式请求模型，卡片随 JSON 闭合逐步出现；可随时点「取消提取」中断。"
          variant="teal"
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleAiExtract()}
              disabled={extracting}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {extracting ? `提取中… ${extractElapsedSec}s` : 'AI 提取'}
            </button>
            {extracting && (
              <button
                type="button"
                onClick={() => { extractAbortRef.current?.abort(); extractAbortRef.current = null; setExtracting(false) }}
                className="rounded-lg border border-red-500/40 bg-red-600/20 px-3 py-2 text-sm text-red-300 hover:bg-red-600/30"
              >
                取消提取
              </button>
            )}
            {/* ST-1（QC-15）·调试快照：与「测试用例生成」共用同一份输入语义但 KEY 隔离 */}
            <button
              type="button"
              disabled={extracting || !genDocs.some((f) => f.status === 'parsed')}
              onClick={() => {
                saveContractInputSnapshot({
                  files: genDocs,
                  focusText: genFocus,
                  codeChanges: codeContext,
                })
                setContractSnapshotTime(getContractInputSnapshotTime())
                setMsg('输入快照已保存（仅本机本浏览器）')
              }}
              title="把当前文档列表、聚焦文本、代码变更存到本地，下次「应用快照」一键复现同一组输入"
              className="rounded-lg border border-violet-500/40 bg-violet-500/[0.08] px-3 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40"
            >
              💾 保存输入快照
            </button>
            <button
              type="button"
              disabled={extracting || !contractSnapshotTime}
              onClick={() => {
                const snap = loadContractInputSnapshot()
                if (!snap) { setMsg('无已保存的快照'); return }
                docs.replaceAll(snap.files)
                setGenFocus(snap.focusText)
                setCodeContext(snap.codeChanges)
                setMsg('已应用输入快照')
              }}
              title="从最近一次保存的输入快照恢复文档列表、聚焦文本与代码变更"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-40"
            >
              📂 应用快照{contractSnapshotTime ? ` (${contractSnapshotTime})` : ''}
            </button>
            {aiPreview && aiPreview.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSaveAiBatch()}
                  disabled={savingAiBatch}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
                >
                  {savingAiBatch ? '保存中…' : `入库 ${aiPreview.length} 条契约草稿`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiPreview(null)
                    setMsg(null)
                  }}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-400 hover:border-white/25"
                >
                  清空预览
                </button>
              </>
            )}
          </div>
          {extracting && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-950/20 px-3 py-2 text-xs text-teal-200">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
              等待模型响应… 已等待 {extractElapsedSec} 秒
              {extractElapsedSec >= 30 && <span className="text-zinc-500">（大文档首次响应可能较慢）</span>}
            </div>
          )}
          {!extracting && extractError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
              ⚠ {extractError}
            </div>
          )}
          {aiPreview && aiPreview.length > 0 && (
            <ul className="mt-4 max-h-80 space-y-2 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3">
              {aiPreview.map((c, i) => (
                <li key={`${c.moduleLabel}-${i}`} className="border-b border-white/5 pb-2 text-xs last:border-0">
                  <span className={`mr-2 inline-block rounded border px-1.5 py-0.5 text-[10px] ${priorityClass(c.priority)}`}>
                    {c.priority}
                  </span>
                  <span className="font-medium text-zinc-200">{c.moduleLabel}</span>
                  <p className="mt-1 text-zinc-400">{c.rule}</p>
                  {c.verifyRationale && (
                    <p className="mt-0.5 text-[10px] text-teal-500/85">推荐理由：{c.verifyRationale}</p>
                  )}
                  {c.boundaryHint && <p className="mt-0.5 text-[10px] text-zinc-600">边界：{c.boundaryHint}</p>}
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    验证：{c.verifyMethods.map(contractMethodLabel).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </StepShell>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <StepShell
            id="qc-4"
            step={4}
            title="代码仓库关联（可选）"
            subtitle="入库与用例共用同一「项目 / 模块」"
            variant="violet"
          >
            <div className="[&_*]:!text-xs [&_button]:!text-xs [&_select]:!text-xs [&_input]:!text-xs [&_.border]:!border-white/15 [&_.bg-white]:!bg-[#1a1b2e] [&_.bg-blue-50\\/30]:!bg-violet-500/10 [&_.border-blue-300]:!border-violet-500/40 [&_.text-slate-700]:!text-zinc-200 [&_.text-slate-500]:!text-zinc-400 [&_.text-slate-400]:!text-zinc-500 [&_.border-slate-200]:!border-white/15 [&_.border-slate-300]:!border-white/20 [&_.bg-slate-100]:!bg-white/5 [&_.text-slate-600]:!text-zinc-400 [&_.bg-blue-600]:!bg-violet-600 [&_.text-blue-700]:!text-violet-200 [&_.bg-blue-100]:!bg-violet-500/20 [&_.text-green-700]:!text-emerald-200 [&_.bg-green-100]:!bg-emerald-500/20 [&_.bg-slate-50]:!bg-white/[0.02] [&_.bg-purple-50]:!bg-purple-500/10 [&_.text-purple-700]:!text-purple-200 [&_.bg-orange-50]:!bg-orange-500/10 [&_.text-orange-700]:!text-orange-200 [&_.hover\\:bg-slate-200]:!hover:bg-white/10">
              <CodeChangePanel
                value={codeContext}
                onChange={setCodeContext}
                documentText={documentText}
                documentFileName={panelDocName}
              />
            </div>
          </StepShell>

          <StepShell
            id="qc-5"
            step={5}
            title="AI 代码走查"
            subtitle="按代码结构定位相关文件，自动比对契约规则"
            variant="violet"
          >
          {/* TKT-20260429-014 · 批量走查（默认动作） + TKT-20260430-001 · 一键走查 */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleQuickBatchReview()}
              disabled={batchRunning || reviewRunning || rows.length === 0}
              className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                rows.length === 0
                  ? '当前没有已入库契约'
                  : !codeContext && !contractSnapshotTime
                    ? '无代码上下文且无快照，请先在步骤 ④ 关联'
                    : '自动恢复上次代码上下文快照 + 立即开始批量走查'
              }
            >
              {batchRunning
                ? `走查中… ${batchProgress?.current ?? 0}/${batchProgress?.total ?? rows.length}`
                : `一键走查 ${rows.length} 条`}
            </button>
            <button
              type="button"
              onClick={() => void handleBatchReview()}
              disabled={batchRunning || reviewRunning || rows.length === 0 || !codeContext}
              className="rounded-lg border border-violet-500/40 bg-violet-600/80 px-3 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                rows.length === 0
                  ? '当前没有已入库契约，请先用 AI 提取并入库'
                  : !codeContext
                    ? '请先在步骤 ④ 完成代码仓库关联'
                    : '逐条走查全部已入库契约（前端 for 循环串行调用）'
              }
            >
              {batchRunning
                ? `走查中…`
                : `批量走查 ${rows.length} 条`}
            </button>
            {batchRunning && (
              <button
                type="button"
                onClick={handleAbortBatch}
                className="rounded-lg border border-red-500/40 bg-red-600/20 px-3 py-2.5 text-sm text-red-300 hover:bg-red-600/30"
              >
                取消批量
              </button>
            )}
          </div>

          {/* 进度条 + 当前条目预览 */}
          {batchProgress && (batchRunning || batchSummary) && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/15 px-3 py-2 text-xs text-violet-200">
              <div className="flex items-center justify-between gap-2">
                <span>
                  已走查 {batchProgress.current}/{batchProgress.total}
                  {batchProgress.currentLabel && batchRunning && (
                    <>
                      <span className="ml-2 text-zinc-500">· 当前：</span>
                      <span className="text-zinc-300">{batchProgress.currentLabel}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-violet-950/40">
                <div
                  className="h-full bg-violet-500/70 transition-all"
                  style={{
                    width: `${batchProgress.total === 0 ? 0 : Math.round((batchProgress.current / batchProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* 总览三色徽章 */}
          {batchSummary && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-200">
                ✓ 通过 {batchSummary.pass}
              </span>
              <span className="rounded bg-red-500/20 px-2 py-0.5 font-semibold text-red-200">
                ✗ 违规 {batchSummary.fail}
              </span>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-100">
                ? 存疑 {batchSummary.uncertain}
              </span>
              {batchSummary.errors > 0 && (
                <span className="rounded bg-zinc-500/20 px-2 py-0.5 text-zinc-300">
                  ⚠ 错误 {batchSummary.errors}
                </span>
              )}
              <span className="ml-auto text-zinc-500">
                耗时 {(batchSummary.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {/* 错误明细折叠区（用于排查） */}
          {Object.keys(batchErrors).length > 0 && (
            <details className="mt-2 rounded border border-red-500/30 bg-red-950/15 px-3 py-1.5 text-[11px] text-red-200">
              <summary className="cursor-pointer">查看 {Object.keys(batchErrors).length} 条错误详情</summary>
              <ul className="mt-2 space-y-1">
                {Object.entries(batchErrors).map(([cid, msg]) => {
                  const c = rows.find((x) => x.id === cid)
                  return (
                    <li key={cid} className="border-t border-red-500/15 pt-1 first:border-0">
                      <span className="text-red-300">{c?.moduleLabel || cid}</span>
                      <span className="ml-2 text-zinc-400">{msg}</span>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}

          {/* 既有：单条走查（主编辑区规则）按钮——保留向后兼容 */}
          <button
            type="button"
            onClick={() => void handleRunCodeReview()}
            disabled={reviewRunning || batchRunning}
            className="mt-3 w-full rounded-lg border border-violet-500/40 bg-violet-600/15 py-2 text-xs font-medium text-violet-200 hover:bg-violet-600/25 disabled:opacity-50"
          >
            {reviewRunning ? '走查中…' : '运行单条走查（主编辑区规则）'}
          </button>
          {reviewResult && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded px-2 py-0.5 font-semibold',
                    reviewResult.verdict === 'pass'
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : reviewResult.verdict === 'fail'
                        ? 'bg-red-500/20 text-red-200'
                        : 'bg-amber-500/20 text-amber-100',
                  ].join(' ')}
                >
                  {reviewResult.verdict === 'pass'
                    ? '✓ 符合契约'
                    : reviewResult.verdict === 'fail'
                      ? '✗ 存在违规'
                      : '? 存疑'}
                </span>
                <span className="text-zinc-500">置信度 {reviewResult.confidence}%</span>
                {reviewResult.meta?.codeContextChars != null && (
                  <span className="text-zinc-600">材料字符串约 {reviewResult.meta.codeContextChars} 字</span>
                )}
              </div>
              {reviewResult.meta?.codeContextStats && (
                <p className="mt-2 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-500">
                  命中清单 {reviewResult.meta.codeContextStats.filesMatchedTotal} 个路径 · 实际附带正文{' '}
                  {reviewResult.meta.codeContextStats.filesWithBodyTotal} 个 ·
                  {reviewResult.meta.codeContextStats.omittedFromBodyTotal > 0 ? (
                    <>
                      {' '}
                      <span className="text-amber-200/90">
                        未附正文 {reviewResult.meta.codeContextStats.omittedFromBodyTotal} 个（因单次总字数上限）
                      </span>
                      {reviewResult.meta.codeContextStats.omittedFromBody.length > 0 && (
                        <span className="block truncate text-zinc-600" title={reviewResult.meta.codeContextStats.omittedFromBody.join('\n')}>
                          略去：{reviewResult.meta.codeContextStats.omittedFromBody.slice(0, 5).join('、')}
                          {reviewResult.meta.codeContextStats.omittedFromBody.length > 5 ? '…' : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    ' 所有命中文件均已附上正文，无截断。'
                  )}
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-zinc-300">{reviewResult.reasoning}</p>

              {reviewResult.gaps && (
                <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
                  盲区：{reviewResult.gaps}
                </p>
              )}

              {/* ST-004 占位：reviewResult.ruleProposalId / ruleProposalDraft 由 ST-004 渲染 RuleProposalCard */}
              {reviewResult.ruleProposalId &&
                reviewResult.ruleProposalDraft &&
                !proposalDismissed[reviewResult.ruleProposalId] && (
                  <RuleProposalCard
                    key={reviewResult.ruleProposalId}
                    proposalId={reviewResult.ruleProposalId}
                    proposal={reviewResult.ruleProposalDraft}
                    onApprove={() => handleProposalApprove(reviewResult.ruleProposalId as string)}
                    onReject={() => handleProposalReject(reviewResult.ruleProposalId as string)}
                    onDefer={() => handleProposalDefer(reviewResult.ruleProposalId as string)}
                  />
                )}
            </div>
          )}
        </StepShell>
        </div>

        <StepShell
          id="qc-6"
          step={6}
          title="手动补充契约（可选）"
          subtitle="AI 提取后确认每条规则、边界，也可直接在此手写。填写后点「保存契约草稿」按优先级和验证方式存入本地库，可多次保存。"
          variant="neutral"
        >
          <label className="block text-xs text-zinc-400">
            模块 / 功能名称
            <input
              value={moduleLabel}
              onChange={(e) => setModuleLabel(e.target.value)}
              placeholder="例：大厅弹框 · 弹框展示限制"
              className="mt-1 w-full rounded-lg border border-white/15 bg-[#14151f] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-500/50"
            />
          </label>
          <label className="mt-3 block text-xs text-zinc-400">
            业务规则 <span className="text-red-400/90">*</span>
            <textarea
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              rows={5}
              placeholder="例：满减优惠先于折扣优惠叠加，金额中间结果每步四舍五入到分（2位小数），最终不得为负。"
              className="mt-1 w-full resize-y rounded-lg border border-white/15 bg-[#14151f] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none focus:border-teal-500/50"
            />
          </label>
          <label className="mt-3 block text-xs text-zinc-400">
            边界 / 补充说明（可选）
            <textarea
              value={boundaryHint}
              onChange={(e) => setBoundaryHint(e.target.value)}
              rows={3}
              placeholder="例：折扣最小 0 折，步长 0.5 折；无上限"
              className="mt-1 w-full resize-y rounded-lg border border-white/15 bg-[#14151f] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none focus:border-teal-500/50"
            />
          </label>
          <div className="mt-3">
            <span className="text-xs text-zinc-400">优先级</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {(['P0', 'P1', 'P2'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={[
                    'rounded-lg border px-3 py-1 text-xs font-medium transition',
                    priority === p ? priorityClass(p) : 'border-white/10 text-zinc-500 hover:border-white/20',
                  ].join(' ')}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <span className="text-xs text-zinc-400">验证方式（多选）</span>
            <div className="mt-2 flex flex-col gap-2">
              {CONTRACT_METHOD_OPTIONS.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-[#14151f]/80 px-3 py-2 hover:border-teal-500/30"
                >
                  <input
                    type="checkbox"
                    checked={methods.has(m.id)}
                    onChange={() => toggleMethod(m.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm text-zinc-200">{m.label}</span>
                    <span className="ml-2 text-xs text-zinc-500">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="mt-5 w-full rounded-lg bg-teal-600 py-2.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存契约草稿'}
          </button>
        </StepShell>

        <StepShell id="qc-7" step={7} title="契约草稿库" variant="neutral">
          {loading && <p className="text-xs text-zinc-500">加载中…</p>}
          {!loading && rows.length === 0 && (
            <p className="mt-3 text-sm text-zinc-500">暂无契约草稿。使用上方 AI 提取或手动补充后点「保存」即可入库。</p>
          )}
          <ul className="mt-4 space-y-3">
            {rows.map((row) => (
              <ContractCard
                key={row.id}
                contract={row}
                reviewResult={batchResults[row.id] ?? null}
                actions={
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    className="shrink-0 rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    删除契约
                  </button>
                }
                footer={new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              />
            ))}
          </ul>
        </StepShell>

        <p className="text-center text-[11px] text-zinc-600">
          灵感来源：{' '}
          <a
            href="https://testerhome.com/topics/43886"
            target="_blank"
            rel="noreferrer"
            className="text-teal-500/90 underline hover:text-teal-400"
          >
            TesterHome · AI 赋能测试工程师的可能性
          </a>
        </p>
      </main>
      {confirmDialog}
    </PageShell>
  )
}

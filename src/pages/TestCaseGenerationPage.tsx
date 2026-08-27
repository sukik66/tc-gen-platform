import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TestCase, TestDepth, TestPlanLedger } from '../types'
import {
  APP_TIMEZONE,
  CASE_TYPE_OPTIONS,
  DEPTH_OPTIONS,
} from '../constants'
import { getTextOffsetAtPoint } from '../lib/textCaret'
import { priorityClass } from '../lib/ui-utils'
import { CaseDraftForm, type DraftFocusField } from '../components/CaseDraftForm'
import { CaseTypeTag } from '../components/CaseTypeTag'
import { TestCaseMindmapView } from '../components/TestCaseMindmapView'
import { RuntimeConfigModal } from '../components/RuntimeConfigModal'
import { LlmProviderSelect } from '../components/LlmProviderSelect'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''
/** 末次用例变更后空闲多久再自动 POST 修订摘要（毫秒）。断续编辑可拉大；点「API 生成」前会强制 flush 一轮。 */
const REVISION_LOG_IDLE_MS = (() => {
  const n = Number(import.meta.env.VITE_REVISION_LOG_IDLE_MS)
  return Number.isFinite(n) && n >= 5000 ? n : 120_000
})()
/**
 * 自动覆盖的安全阈值，不是正常覆盖上限。
 * 正常轮数会按覆盖计划中的非信息不足测试点数量动态计算；100 轮约等于
 * 1200 个测试点（默认每批 12 个），用于防止异常计划/模型导致无限请求。
 */
const MIN_AUTO_COVERAGE_BATCH_SIZE = 4
const MAX_AUTO_COVERAGE_ROUNDS = 100
import { streamEnhancedGenerate, fetchRagHealth } from '../api/vcs'
import CodeChangePanel from '../components/CodeChangePanel'
import type { CodeContextPayload } from '../api/vcs'
import { useLlmProvider } from '../hooks/useLlmProvider'
import { testCustomProvider } from '../api/llmProviders'
import { useDocumentUpload, defaultRoleFirstPrimary } from '../hooks/useDocumentUpload'
import { DocumentUploadPanel } from '../components/DocumentUploadPanel'
import { exportExcelFull, exportChecklist, exportXMind } from '../lib/exportCases'
import { ImportToLibraryModal } from '../components/ImportToLibraryModal'
import { loadGenerationSessionRecords } from '../lib/generationSessionCache'
import { humanizeLlmModalText } from '../lib/humanizeLlmModalText'
import { loadCodeChangesFromSession, saveCodeChangesToSession } from '../lib/codeChangesSession'
import {
  createEnhancedOnDone,
  createEnhancedOnError,
  type StreamGenerationDeps,
} from '../lib/generationStreamCallbacks'
import {
  buildPromptContextHint,
  ENHANCED_PROMPT_OVERHEAD_CHARS_GUESS,
  estimateSimplePromptChars,
} from '../lib/promptContextHint'

/** 网关中继常在 interruptReason 里塞整段说明，弹窗只展示前缀避免占满屏幕 */
function truncateInterruptReason(reason: string | undefined, max = 360): string {
  const t = String(reason ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return '未知原因'
  if (t.length <= max) return t
  return `${t.slice(0, max)}…（已截断）`
}

function tableCellIndexToField(cellIndex: number): DraftFocusField {
  const m: Record<number, DraftFocusField> = {
    1: 'module',
    2: 'summary',
    3: 'priority',
    4: 'caseType',
    5: 'preconditions',
    6: 'steps',
    7: 'expected',
    8: 'remarks',
  }
  return m[cellIndex] ?? null
}

function newCaseId(): string {
  const n = Math.floor(Math.random() * 900000) + 100000
  return `TC-${n}`
}

const MOCK_CASES: TestCase[] = []

const GENERATION_STEPS = [
  { key: 'preparing', label: '解析材料' },
  { key: 'context', label: '检索上下文' },
  { key: 'requirements', label: '分析需求' },
  { key: 'planning', label: '规划覆盖' },
  { key: 'generating', label: '生成用例' },
  { key: 'audit', label: '覆盖检查' },
] as const

function generationStepIndex(step: string): number {
  if (step === 'done') return GENERATION_STEPS.length
  const index = GENERATION_STEPS.findIndex((item) => item.key === step)
  return Math.max(0, index)
}

function buildExistingCaseBriefs(cases: TestCase[], max = 160) {
  return cases.slice(-max).map((tc) => ({
    id: tc.id,
    module: tc.module,
    subModule: tc.subModule,
    summary: tc.summary,
    expected: tc.expected,
    priority: tc.priority,
    caseType: tc.caseType,
    sourceReqIds: tc.sourceReqIds,
    testPointIds: tc.testPointIds,
    designMethod: tc.designMethod,
  }))
}

function emptyCase(): TestCase {
  return {
    id: newCaseId(),
    priority: 'P2',
    caseType: '功能测试',
    module: '',
    subModule: '',
    summary: '',
    description: '',
    preconditions: [],
    steps: [],
    expected: '',
    remarks: '',
  }
}

export function TestCaseGenerationPage() {
  /** 文档上传 Hook：不传 onParsed → 不再触发知识库 smartImportFile 副作用（知识库暂闭期间策略） */
  const docs = useDocumentUpload({ defaultRole: defaultRoleFirstPrimary })
  const files = docs.files
  const [focusText, setFocusText] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    '功能测试',
    '弱网测试',
  ])
  const [depth, setDepth] = useState<TestDepth>('qa')
  const [view, setView] = useState<'xmind' | 'card' | 'table'>('xmind')
  const [cases, setCases] = useState<TestCase[]>(MOCK_CASES)
  /** 本次标签页会话内，每次 API 生成成功后的全量用例快照（sessionStorage，关标签清空） */
  const [, setSessionSnapshots] = useState(() => loadGenerationSessionRecords())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<TestCase | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)
  const [draftAutoField, setDraftAutoField] = useState<DraftFocusField>(null)
  const [draftAutoCaret, setDraftAutoCaret] = useState<number | null>(null)
  const [draftFocusKey, setDraftFocusKey] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [preflightTesting, setPreflightTesting] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [genWaitSec, setGenWaitSec] = useState(0)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [streamText, setStreamText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  /** 最近一次 AI 合并完成后的用例快照，供 debounce 与服务器做 diff 并自动落库 */
  const revisionBaselineRef = useRef<TestCase[] | null>(null)
  const revisionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const casesRef = useRef<TestCase[]>(cases)
  const [apiHint, setApiHint] = useState<string>('')
  const llm = useLlmProvider()
  const llmProviders = llm.providers
  const llmSelected = llm.selectedProvider
  const llmModelSelected = llm.selectedModel
  const apiServerUp = llm.apiServerUp
  const [exportOpen, setExportOpen] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [codeChanges, setCodeChanges] = useState<CodeContextPayload | null>(() => loadCodeChangesFromSession())
  const [configOpen, setConfigOpen] = useState(false)
  const [repoConfigVersion, setRepoConfigVersion] = useState(0)
  const [ragOk, setRagOk] = useState<boolean | null>(null)
  const [metaInfo, setMetaInfo] = useState<{ codeLen?: number; ragLen?: number }>({})
  const [progressInfo, setProgressInfo] = useState<{ chars: number; estimatedCases: number; elapsedSec: number } | null>(null)
  const [interruptMsg, setInterruptMsg] = useState<string | null>(null)
  const [generationNotice, setGenerationNotice] = useState<string | null>(null)
  const [pipelineStatus, setPipelineStatus] = useState<string>('')
  const [pipelineStep, setPipelineStep] = useState<string>('idle')
  const [runDetailsOpen, setRunDetailsOpen] = useState(false)
  const [resultActionsOpen, setResultActionsOpen] = useState(false)
  /** Kimi 等总上下文型通道：生成前体量预警（成功收尾后清空） */
  const [promptContextHint, setPromptContextHint] = useState<string | null>(null)
  const [testPlan, setTestPlan] = useState<TestPlanLedger | null>(null)
  const [testPlanCollapsed, setTestPlanCollapsed] = useState(false)
  const cardClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (cardClickTimerRef.current) clearTimeout(cardClickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    casesRef.current = cases
  }, [cases])

  useEffect(() => {
    saveCodeChangesToSession(codeChanges)
  }, [codeChanges])

  /** 生成过程中每秒刷新等待秒数 */
  useEffect(() => {
    if (!generating) {
      setGenWaitSec(0)
      return
    }
    setGenWaitSec(0)
    const id = setInterval(() => setGenWaitSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [generating])

  /** 相对 baseline 有差异则 POST；成功且非 skipped 时推进 baseline */
  const submitRevisionIfDirty = useCallback(async () => {
    const base = revisionBaselineRef.current
    if (!base) return
    const cur = casesRef.current
    try {
      const res = await fetch(`${apiBase}/api/case-revision-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: base, after: cur }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; skipped?: boolean }
      if (res.ok && j.ok && !j.skipped) {
        revisionBaselineRef.current = structuredClone(cur)
      }
    } catch {
      /* 网络失败不推进 baseline，下次空闲或生成前会重试 */
    }
  }, [])

  /** 取消待调度并立即尝试上报（用于生成前落盘） */
  const flushRevisionLogNow = useCallback(async () => {
    if (revisionDebounceRef.current) {
      clearTimeout(revisionDebounceRef.current)
      revisionDebounceRef.current = null
    }
    await submitRevisionIfDirty()
  }, [submitRevisionIfDirty])

  /** 非生成态：末次编辑空闲 REVISION_LOG_IDLE_MS 后自动上报（避免改标题→改描述→再改标题 的中途被截断） */
  useEffect(() => {
    if (generating) return
    const base = revisionBaselineRef.current
    if (!base) return

    revisionDebounceRef.current = setTimeout(() => {
      revisionDebounceRef.current = null
      void submitRevisionIfDirty()
    }, REVISION_LOG_IDLE_MS)

    return () => {
      if (revisionDebounceRef.current) {
        clearTimeout(revisionDebounceRef.current)
        revisionDebounceRef.current = null
      }
    }
  }, [cases, generating, submitRevisionIfDirty])

  useEffect(() => {
    fetchRagHealth().then(h => setRagOk(h.ok)).catch(() => setRagOk(false))
  }, [])

  /** 文案派生：随 useLlmProvider 状态变化，更新顶部状态条。 */
  useEffect(() => {
    if (llm.apiServerUp === false) {
      setApiHint(
        '未连接本地模型 API，请打开「运行配置」检查模型参数，或启动 npm run dev（或 npm run dev:api）',
      )
      return
    }
    if (llm.apiServerUp === null) return
    const p = llm.current
    const ready = Boolean(p?.ready)
    if (!p) return
    const m = llm.selectedModel || p.model || ''
    setApiHint(
      ready
        ? `本地 API 已连接 · 当前通道：${p.label ?? p.id}（${p.id}${m ? ` / ${m}` : ''}）`
        : `已选「${p.label ?? p.id}」但未就绪：${p.hint ?? '缺少模型配置'}。请打开「运行配置」处理。`,
    )
  }, [llm.apiServerUp, llm.current, llm.selectedModel])

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  /** Hook 暴露的便捷派发函数与派生量，沿用原有同名变量以最小化下游改动 */
  const buildParsedDocumentsPayload = docs.buildParsedDocumentsPayload
  const parsingCount = docs.parsingCount
  const hasParsedOk = files.some((f) => f.status === 'parsed')
  const parseIdle = parsingCount === 0
  /** 列表已返回且 API 在线时，才按「当前通道是否就绪」禁用。 */
  const selectedLlmReady = Boolean(llmProviders.find((x) => x.id === llmSelected)?.ready)
  /** API 已确认在线时：列表为空或当前通道未就绪则不允许点（避免误点只弹窗） */
  const providerListBlocksApi =
    apiServerUp === true && (llmProviders.length === 0 || !selectedLlmReady)
  const canRunApiGenerate =
    parseIdle && hasParsedOk && !preflightTesting && apiServerUp !== false && !providerListBlocksApi && apiServerUp != null

  const cancelGenerate = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGenerating(false)
    setStreamConnected(false)
    setPromptContextHint(null)
    setPipelineStep('idle')
  }, [])

  const runGenerate = async () => {
    if (preflightTesting || generating) return
    setGenerateError(null)
    setGenerationNotice(null)
    if (apiServerUp === false) {
      window.alert(
        '未连接本地 API。请启动 npm run dev（或 npm run dev:api），并在「运行配置」中检查模型参数。',
      )
      return
    }
    if (!llmProviders.find((x) => x.id === llmSelected)?.ready) {
      window.alert(
        '当前模型通道尚未就绪。请打开「运行配置」补充 API 密钥、地址和模型。',
      )
      return
    }
    if (!files.length) {
      window.alert('请先上传至少一份文档。')
      return
    }
    if (!parseIdle) {
      window.alert('请等待当前文档解析完成后再生成。')
      return
    }
    if (!hasParsedOk) {
      window.alert('没有成功解析的文档（可能均为不支持格式或解析失败）。请检查文件列表中的错误提示。')
      return
    }
    const selectedProvider = llmProviders.find((provider) => provider.id === llmSelected)
    if (selectedProvider?.custom) {
      setPreflightTesting(true)
      setPipelineStatus('正在验证模型连接')
      try {
        await testCustomProvider(selectedProvider.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知连接错误'
        setGenerateError(`模型连接预检失败：${message}`)
        setPipelineStatus('')
        return
      } finally {
        setPreflightTesting(false)
      }
    }
    /** 生成前先 flush 修订记录，避免长时间断续编辑从未触发「空闲窗口」导致丢失 */
    if (apiServerUp !== true) {
      window.alert('正在连接本地 API 或通道列表尚未就绪，请稍后重试或刷新页面。')
      return
    }
    await flushRevisionLogNow()
    const documents = buildParsedDocumentsPayload()
    const curProv = llmProviders.find((x) => x.id === llmSelected)
    /** 不在此处 await 预览接口，避免 /api/preview-enhanced-prompt 卡住时按钮「点了没反应」 */
    const totalCharsGuess = estimateSimplePromptChars(documents, ENHANCED_PROMPT_OVERHEAD_CHARS_GUESS)
    setPromptContextHint(buildPromptContextHint(curProv, totalCharsGuess))

    const streamDeps: StreamGenerationDeps = {
      casesRef,
      revisionBaselineRef,
      setCases,
      setSessionSnapshots,
      setGenerating,
      setStreamConnected,
      setStreamText,
      setProgressInfo,
      abortRef,
      setInterruptMsg,
      setGenerationNotice,
      setGenerateError,
      truncateInterruptReason,
      onGenerationFinishSuccess: () => {
        setPromptContextHint(null)
        setPipelineStep('done')
      },
    }
    const onEnhancedDone = createEnhancedOnDone(streamDeps)
    const handleEnhancedError = createEnhancedOnError(streamDeps)
    const baseCases = [...casesRef.current]
    const allGenerated: TestCase[] = []
    const reusablePlan = baseCases.length > 0
      && testPlan
      && (testPlan.coverage.uncoveredTestPointIds?.length ?? 0) > 0
      ? testPlan
      : null
    let latestPlan: TestPlanLedger | null = reusablePlan
    let plannedMaxAutoRounds = MAX_AUTO_COVERAGE_ROUNDS

    const getPlannedMaxAutoRounds = (plan: TestPlanLedger | null) => {
      const eligibleCount = Math.max(
        0,
        (plan?.coverage.testPointTotal ?? 0)
          - (plan?.coverage.informationGapTestPointIds?.length ?? 0),
      )
      if (eligibleCount <= 0) return 1
      return Math.min(
        MAX_AUTO_COVERAGE_ROUNDS,
        // 后端批大小可通过 AUTO_COVERAGE_TP_BATCH_SIZE 调到 4；按最小值估算，
        // 避免环境配置变小时前端提前停止。默认批大小仍为 12。
        Math.max(6, Math.ceil(eligibleCount / MIN_AUTO_COVERAGE_BATCH_SIZE) + 1),
      )
    }

    if (reusablePlan) {
      plannedMaxAutoRounds = getPlannedMaxAutoRounds(reusablePlan)
    }

    setGenerating(true)
    setStreamConnected(false)
    setStreamText('')
    setMetaInfo({})
    setProgressInfo(null)
    setInterruptMsg(null)
    setGenerationNotice(null)
    setPipelineStatus('')
    setPipelineStep('preparing')
    setTestPlan(null)
    setTestPlanCollapsed(false)

    const startRound = (
      round: number,
      reusePlan: TestPlanLedger | null,
      targetTestPointIds?: string[],
    ) => {
      const combinedCases = [...baseCases, ...allGenerated]
      const existingCaseBriefs = buildExistingCaseBriefs(combinedCases)
      setStreamConnected(false)
      setStreamText('')
      setProgressInfo(null)
      if (round > 1) {
        setPipelineStep('generating')
        setPipelineStatus(`正在启动自动覆盖第 ${round} 轮`)
      }

      const ac = streamEnhancedGenerate({
        documents,
        focusText,
        selectedTypes,
        depth,
        timezone: APP_TIMEZONE,
        llmProvider: llmSelected,
        llmModel: llmModelSelected || undefined,
        codeChanges: codeChanges ?? undefined,
        usePipeline: true,
        autoCoverage: true,
        autoRound: round,
        generationMode: existingCaseBriefs.length > 0 ? 'append' : 'fresh',
        existingCases: existingCaseBriefs.length > 0 ? existingCaseBriefs : undefined,
        reuseTestPlan: reusePlan || undefined,
        targetTestPointIds,
        batchTarget: targetTestPointIds?.length
          ? { min: targetTestPointIds.length, max: Math.min(24, targetTestPointIds.length * 2) }
          : undefined,
      },
      {
        onStreamOpen: () => setStreamConnected(true),
        onThinking: ({ totalChars }) => {
          setPipelineStatus(`🤔 模型思考中... 已生成 ${totalChars} 字推理内容`)
        },
        onMeta: (meta) => {
          if (meta.type === 'stream_discard') {
            setStreamText('')
            return
          }
          if (meta.type === 'code_changes') setMetaInfo(prev => ({ ...prev, codeLen: meta.length }))
          if (meta.type === 'rag_context') setMetaInfo(prev => ({ ...prev, ragLen: meta.length }))
          if (meta.type === 'pipeline') {
            if (meta.status === 'start') setPipelineStatus('正在分析输入材料')
            else if (meta.status === 'done') setPipelineStatus('覆盖计划已就绪，准备生成用例')
            else if (meta.status === 'reused') setPipelineStatus(`沿用已锁定的覆盖计划，准备第 ${round} 轮生成`)
            else if (meta.status === 'fallback') setPipelineStatus('部分分析不可用，已降级继续生成')
          }
        },
        onCoveragePlan: (plan) => {
          setTestPlan(plan)
          setTestPlanCollapsed(false)
        },
        onPipelineProgress: (info) => {
          if (info.step === 'coverage_batch') {
            setPipelineStep('generating')
            setPipelineStatus(
              `自动覆盖第 ${info.round || round} 轮：本批处理 ${info.targetTestPointIds?.length ?? 0} 个测试点，剩余 ${info.remainingTestPointCount ?? 0} 个`,
            )
          } else if (info.step === 'code_analysis') {
            setPipelineStep('context')
            if (info.status === 'start') {
              const msg = (info as unknown as Record<string, unknown>).skippedFiles
                ? `正在分析 ${info.totalFiles} 个最相关代码文件`
                : `正在分析 ${info.totalFiles} 个代码文件`
              setPipelineStatus(msg)
            } else if (info.status === 'analyzing') {
              setPipelineStatus(`代码分析 ${info.progress || ''}：${info.file || ''}`)
            } else if (info.status === 'file_done') {
              setPipelineStatus(`代码分析 ${info.progress || ''}`)
            } else if (info.status === 'timeout') {
              setPipelineStatus('代码分析超时，使用已完成的结果')
            } else if (info.status === 'done') {
              setPipelineStatus(`代码分析完成（${info.successCount}/${info.totalFiles}）`)
            }
          } else if (info.step === 'requirement_analysis') {
            setPipelineStep('requirements')
            if (info.status === 'start') setPipelineStatus('正在拆解需求与业务规则')
            else if (info.status === 'done') setPipelineStatus('需求分析完成')
            else if (info.status === 'skipped') setPipelineStatus('需求分析已跳过')
          } else if (info.step === 'coverage_planning') {
            setPipelineStep('planning')
            if (info.status === 'start') setPipelineStatus('正在规划测试覆盖')
            else if (info.status === 'done') setPipelineStatus(`覆盖计划完成：${info.reqTotal || 0} 个需求，${info.testPointTotal || 0} 个测试点`)
            else if (info.status === 'error') setPipelineStatus('覆盖规划不可用，继续按需求分析生成')
          } else if (info.step === 'final_generation') {
            setPipelineStep('generating')
            setPipelineStatus(
              (info.round || round) > 1
                ? `自动覆盖第 ${info.round || round} 轮：正在生成可执行测试用例`
                : '正在生成可执行测试用例',
            )
          } else if (info.step === 'coverage_audit') {
            setPipelineStep('audit')
            if (info.status === 'start') setPipelineStatus('正在检查测试点覆盖与缺口')
            else if (info.status === 'done') setPipelineStatus(`覆盖检查完成：覆盖率 ${info.coverageRate || 0}%`)
          }
        },
        onProgress: (info) => setProgressInfo(info),
        onDelta: (text) => setStreamText((prev) => prev + text),
        onDone: (newCases, extra) => {
          const batch = newCases as TestCase[]
          allGenerated.push(...batch)
          const auditedPlan = extra?.testPlan ?? reusePlan ?? latestPlan
          latestPlan = auditedPlan
          plannedMaxAutoRounds = getPlannedMaxAutoRounds(auditedPlan)
          if (auditedPlan) {
            setTestPlan(auditedPlan)
            setTestPlanCollapsed(false)
          }

          const uncoveredIds = auditedPlan?.coverage.uncoveredTestPointIds ?? []
          const previousUncoveredCount = reusePlan
            ? (reusePlan.coverage.uncoveredTestPointIds?.length ?? 0)
            : Math.max(
                0,
                (auditedPlan?.coverage.testPointTotal ?? 0)
                  - (auditedPlan?.coverage.informationGapTestPointIds?.length ?? 0),
              )
          const progressed = Boolean(auditedPlan)
            && uncoveredIds.length < previousUncoveredCount
          const shouldContinue = !extra?.interrupted
            && uncoveredIds.length > 0
            && batch.length > 0
            && progressed
            && round < plannedMaxAutoRounds

          if (shouldContinue) {
            startRound(round + 1, auditedPlan, uncoveredIds.slice(0, 12))
            return
          }

          let completionNotice = ''
          if (!extra?.interrupted && uncoveredIds.length > 0) {
            if (batch.length === 0) {
              completionNotice = `本轮没有生成可用用例，自动补充已暂停。仍有 ${uncoveredIds.length} 个测试点未覆盖，可检查需求信息或人工继续补充。`
            } else if (!progressed) {
              completionNotice = `自动补充未能减少未覆盖测试点，已暂停继续生成。仍有 ${uncoveredIds.length} 个测试点未覆盖，请检查覆盖计划、需求信息不足项或模型输出中的 testPointIds。`
            } else if (round >= plannedMaxAutoRounds) {
              const safetyLimitReached = plannedMaxAutoRounds >= MAX_AUTO_COVERAGE_ROUNDS
              completionNotice = safetyLimitReached
                ? `自动补充已达到安全上限 ${MAX_AUTO_COVERAGE_ROUNDS} 轮，仍有 ${uncoveredIds.length} 个测试点未覆盖。为避免持续消耗模型额度，已暂停；可人工继续补充。`
                : `自动补充已完成预计 ${plannedMaxAutoRounds} 轮，仍有 ${uncoveredIds.length} 个测试点未覆盖。已暂停；可人工继续补充。`
            }
          }

          onEnhancedDone(allGenerated, {
            ...extra,
            testPlan: auditedPlan,
            completionNotice,
          })
        },
        onError: (message, raw) => {
          if (allGenerated.length > 0) {
            onEnhancedDone(allGenerated, { testPlan: latestPlan })
          }
          setPipelineStep('idle')
          handleEnhancedError(message, raw)
        },
      },
      )
      abortRef.current = ac
    }

    startRound(
      1,
      reusablePlan,
      reusablePlan?.coverage.uncoveredTestPointIds?.slice(0, 12),
    )
  }

  const clearDraftUi = useCallback(() => {
    setEditing(null)
    setInsertIndex(null)
    setInlineEditingId(null)
    setDraftAutoField(null)
    setDraftAutoCaret(null)
  }, [])

  /** 清空右侧用例后按当前配置重新生成。 */
  const runRegenerateFresh = async () => {
    if (generating) return
    if (
      !window.confirm(
        '将清空右侧当前全部用例，并按当前材料与配置重新生成。此操作无法撤销。\n\n确定继续？',
      )
    ) {
      return
    }
    clearDraftUi()
    setExpanded({})
    casesRef.current = []
    setCases([])
    revisionBaselineRef.current = null
    await runGenerate()
  }

  const beginInlineEdit = useCallback(
    (tc: TestCase, field: DraftFocusField, caret: number | null) => {
      setInsertIndex(null)
      setInlineEditingId(tc.id)
      setEditing({ ...tc })
      setDraftAutoField(field)
      setDraftAutoCaret(caret)
      setDraftFocusKey((k) => k + 1)
      setExpanded((e) => ({ ...e, [tc.id]: true }))
    },
    [],
  )

  const openEditFromButton = (tc: TestCase) => {
    beginInlineEdit(tc, null, null)
  }

  const applyEdit = () => {
    if (!editing) return
    if (!editing.summary.trim()) {
      window.alert('用例描述（摘要）不能为空')
      return
    }
    setCases((prev) => {
      const idx = prev.findIndex((c) => c.id === editing.id)
      if (idx === -1) return [...prev, editing]
      const copy = [...prev]
      copy[idx] = editing
      return copy
    })
    clearDraftUi()
  }

  const deleteCase = (id: string) => {
    if (inlineEditingId === id) clearDraftUi()
    setCases((prev) => prev.filter((c) => c.id !== id))
    setExpanded((e) => {
      const n = { ...e }
      delete n[id]
      return n
    })
  }

  const copyCase = (tc: TestCase) => {
    const dup = { ...tc, id: newCaseId() }
    setCases((prev) => {
      const i = prev.findIndex((c) => c.id === tc.id)
      if (i < 0) return [...prev, dup]
      const next = [...prev]
      next.splice(i + 1, 0, dup)
      return next
    })
  }

  const startInsert = (afterIndex: number) => {
    setInlineEditingId(null)
    setDraftAutoField(null)
    setDraftAutoCaret(null)
    const fresh = emptyCase()
    setInsertIndex(afterIndex)
    setEditing(fresh)
  }

  const confirmInsert = () => {
    if (!editing || insertIndex === null) return
    if (!editing.summary.trim()) {
      window.alert('用例描述（摘要）不能为空')
      return
    }
    setCases((prev) => {
      const next = [...prev]
      next.splice(insertIndex + 1, 0, editing)
      return next
    })
    clearDraftUi()
  }

  const doExport = (kind: 'excel' | 'xmind' | 'checklist') => {
    setExportOpen(false)
    if (cases.length === 0) {
      window.alert('当前没有用例可导出。')
      return
    }
    if (kind === 'excel') {
      exportExcelFull(cases)
    } else if (kind === 'checklist') {
      exportChecklist(cases)
    } else {
      void exportXMind(cases)
    }
  }

  const resolveCardEditTarget = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const fieldWrap = t.closest('[data-edit-field]') as HTMLElement | null
    const raw = fieldWrap?.dataset.editField
    const allowed: string[] = [
      'module',
      'subModule',
      'caseType',
      'priority',
      'summary',
      'description',
      'preconditions',
      'steps',
      'expected',
      'remarks',
    ]
    const field =
      raw && allowed.includes(raw) ? (raw as DraftFocusField) : null
    let caret: number | null = null
    if (
      field &&
      fieldWrap &&
      (field === 'summary' || field === 'description' || field === 'expected')
    ) {
      caret = getTextOffsetAtPoint(fieldWrap, e.clientX, e.clientY)
    }
    return { field, caret }
  }, [])

  const handleCardClick = useCallback(
    (e: React.MouseEvent, tc: TestCase) => {
      if (inlineEditingId === tc.id) return
      const t = e.target as HTMLElement
      if (t.closest('button')) return
      if (cardClickTimerRef.current) clearTimeout(cardClickTimerRef.current)
      cardClickTimerRef.current = setTimeout(() => {
        cardClickTimerRef.current = null
        setExpanded((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))
      }, 260)
    },
    [inlineEditingId],
  )

  const handleCardDoubleClick = useCallback(
    (e: React.MouseEvent, tc: TestCase) => {
      if (cardClickTimerRef.current) {
        clearTimeout(cardClickTimerRef.current)
        cardClickTimerRef.current = null
      }
      const t = e.target as HTMLElement
      if (t.closest('button')) return
      const { field, caret } = resolveCardEditTarget(e)
      beginInlineEdit(tc, field, caret)
    },
    [beginInlineEdit, resolveCardEditTarget],
  )

  const handleTableRowDoubleClick = useCallback(
    (e: React.MouseEvent, tc: TestCase) => {
      const t = e.target as HTMLElement
      if (t.closest('button')) return
      const td = t.closest('td')
      if (!td || !(td instanceof HTMLTableCellElement)) {
        beginInlineEdit(tc, null, null)
        return
      }
      const idx = td.cellIndex
      if (idx === 9) return
      const field = tableCellIndexToField(idx)
      let caret: number | null = null
      if (field === 'summary' || field === 'expected') {
        caret = getTextOffsetAtPoint(td, e.clientX, e.clientY)
      }
      beginInlineEdit(tc, field, caret)
    },
    [beginInlineEdit],
  )

  const isModalInsert = Boolean(
    editing && insertIndex !== null && !cases.some((c) => c.id === editing.id),
  )
  const uncoveredTestPointCount = testPlan?.coverage.uncoveredTestPointIds?.length ?? 0
  const coverageGenerationComplete = cases.length > 0
    && testPlan != null
    && uncoveredTestPointCount === 0

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <RuntimeConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        llm={llm}
        onSaved={async () => {
          setRepoConfigVersion((version) => version + 1)
          const health = await fetchRagHealth()
          setRagOk(health.ok)
        }}
      />
      <header className="flex shrink-0 flex-col items-start justify-between gap-3 border-b border-white/10 bg-[#161722] px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Link
            to="/"
            className="mt-0.5 shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-violet-500/40 hover:text-violet-200"
          >
            ← 功能目录
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">测试用例生成</h1>
            <p className="mt-0.5 text-[11px] text-zinc-600">{apiHint}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="rounded-lg border border-violet-400/30 bg-violet-400/[0.07] px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:border-violet-300/50 hover:bg-violet-400/15"
            data-testid="open-runtime-config"
          >
            运行配置
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            系统运行中
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden">
        {/* 配置侧栏（完整执行流水线仅计划在「智能测试」中展示） */}
        <aside className="flex w-full shrink-0 flex-col border-b border-white/10 bg-[#1a1b2e] lg:max-w-[340px] lg:overflow-hidden lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 p-4 lg:overflow-y-auto">
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">上传需求文档</h2>
              <DocumentUploadPanel
                state={docs}
                variant="full"
                theme="violet"
                accept=".pdf,.docx,.xls,.xlsx,.xlsm,.txt,.md,.csv,.json,image/*"
              />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">生成配置</h2>
              <label className="mb-3 block text-[11px] text-zinc-500">关注重点（可选）</label>
              <textarea
                className="mb-4 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                rows={3}
                placeholder="例如：支付接口、登录注册、新手引导……"
                value={focusText}
                onChange={(e) => setFocusText(e.target.value)}
              />

              <div className="mb-2 text-[11px] text-zinc-500">需要覆盖的测试类型（多选）</div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {CASE_TYPE_OPTIONS.map((t) => {
                  const on = selectedTypes.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      className={[
                        'rounded-full border px-2.5 py-1 text-[11px] transition',
                        on
                          ? 'border-violet-500/60 bg-violet-500/20 text-violet-100'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:border-white/20',
                      ].join(' ')}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>

              <div className="mb-2 text-[11px] text-zinc-500">详细程度（单选）</div>
              <div className="space-y-2">
                {DEPTH_OPTIONS.map((d) => {
                  const on = depth === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDepth(d.id)}
                      className={[
                        'w-full rounded-xl border px-3 py-2.5 text-left transition',
                        on
                          ? 'border-violet-500/50 bg-violet-500/15'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/20',
                      ].join(' ')}
                    >
                      <div className="text-xs font-medium text-zinc-100">{d.title}</div>
                      <div className="text-[11px] text-zinc-500">{d.subtitle}</div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">代码变更（可选）</h2>
              <div className="[&_*]:!text-xs [&_button]:!text-xs [&_select]:!text-xs [&_input]:!text-xs [&_.border]:!border-white/15 [&_.bg-white]:!bg-[#1a1b2e] [&_.bg-blue-50\\/30]:!bg-violet-500/10 [&_.border-blue-300]:!border-violet-500/40 [&_.text-slate-700]:!text-zinc-200 [&_.text-slate-500]:!text-zinc-400 [&_.text-slate-400]:!text-zinc-500 [&_.border-slate-200]:!border-white/15 [&_.border-slate-300]:!border-white/20 [&_.bg-slate-100]:!bg-white/5 [&_.text-slate-600]:!text-zinc-400 [&_.bg-blue-600]:!bg-violet-600 [&_.text-blue-700]:!text-violet-200 [&_.bg-blue-100]:!bg-violet-500/20 [&_.text-green-700]:!text-emerald-200 [&_.bg-green-100]:!bg-emerald-500/20 [&_.bg-slate-50]:!bg-white/[0.02] [&_.bg-purple-50]:!bg-purple-500/10 [&_.text-purple-700]:!text-purple-200 [&_.bg-orange-50]:!bg-orange-500/10 [&_.text-orange-700]:!text-orange-200 [&_.hover\\:bg-slate-200]:!hover:bg-white/10">
                <CodeChangePanel
                  key={repoConfigVersion}
                  value={codeChanges}
                  onChange={setCodeChanges}
                  documentText={files.filter(f => f.status === 'parsed').map(f => f.extractedText || '').join('\n')}
                  documentFileName={files[0]?.name}
                />
              </div>
              {ragOk !== null && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${ragOk ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                  <span className={ragOk ? 'text-emerald-300/80' : 'text-zinc-500'}>
                    {ragOk ? 'RAG 知识库已连接' : 'RAG 知识库未连接（可选）'}
                  </span>
                </div>
              )}
            </section>

            <section className="mt-5 border-t border-white/10 pt-5" data-testid="generation-model-picker">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-200">本次生成模型</h2>
                <span className="text-[10px] text-zinc-600">自动记忆选择</span>
              </div>
              <LlmProviderSelect
                state={llm}
                variant="violet"
                disabled={generating}
                label="供应商"
              />
            </section>

          </div>
          {/* 固定底部操作区 */}
          <div className="shrink-0 border-t border-white/10 bg-[#1a1b2e] px-4 py-3">
            <div className="mb-3 grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-2.5 py-2 text-zinc-400">
                <span className={`size-1.5 rounded-full ${hasParsedOk && parseIdle ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                {parsingCount > 0 ? `${parsingCount} 份材料解析中` : hasParsedOk ? `${files.filter((file) => file.status === 'parsed').length} 份材料就绪` : '等待需求材料'}
              </div>
              <div className="flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-2.5 py-2 text-zinc-400">
                <span className={`size-1.5 rounded-full ${selectedLlmReady ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                {selectedLlmReady ? '模型已就绪' : '模型待配置'}
              </div>
            </div>
            {promptContextHint && (
              <div className="mb-3 rounded-lg border border-amber-500/45 bg-amber-950/35 px-3 py-2 text-[11px] leading-relaxed text-amber-100/95">
                {promptContextHint}
              </div>
            )}
            {generating ? (
              <button
                type="button"
                onClick={cancelGenerate}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 py-3 text-sm font-medium text-white shadow-lg shadow-red-900/40"
              >
                ■ 停止生成
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canRunApiGenerate || coverageGenerationComplete}
                  onClick={() => void runGenerate()}
                  title={
                    coverageGenerationComplete
                      ? '覆盖计划中的测试点已全部生成用例'
                      : apiServerUp === false
                      ? '未连接本地 API'
                      : apiServerUp == null
                        ? '正在连接本地 API…'
                        : providerListBlocksApi
                          ? '当前模型未就绪，请切换模型或打开运行配置'
                          : cases.length > 0
                            ? '保留当前列表，追加生成下一批；会把已有用例摘要传给模型用于避重补洞'
                            : !hasParsedOk && parseIdle
                              ? '至少需要一份文档解析成功'
                              : !parseIdle
                                ? '等待解析完成'
                                : undefined
                  }
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {parsingCount > 0
                    ? `解析中（${parsingCount}）…`
                    : preflightTesting
                      ? '正在验证模型连接…'
                    : apiServerUp === false || providerListBlocksApi
                      ? '模型未就绪'
                      : apiServerUp == null
                        ? '正在连接服务…'
                        : coverageGenerationComplete
                          ? '覆盖生成完成'
                        : cases.length > 0
                          ? `继续补充未覆盖用例${uncoveredTestPointCount ? `（${uncoveredTestPointCount}）` : ''}`
                          : '生成测试用例'}
                </button>
              </>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setRunDetailsOpen((open) => !open)}
                className="px-1 py-1.5 text-[11px] text-zinc-500 transition hover:text-zinc-300"
                aria-expanded={runDetailsOpen}
              >
                {runDetailsOpen ? '收起运行详情' : '运行详情'}
              </button>
              {cases.length > 0 && !generating && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setResultActionsOpen((open) => !open)}
                    className="size-8 rounded-md border border-white/10 text-lg leading-none text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    aria-label="更多生成操作"
                    title="更多生成操作"
                  >
                    ⋯
                  </button>
                  {resultActionsOpen && (
                    <div className="absolute bottom-10 right-0 z-30 w-48 rounded-lg border border-white/10 bg-[#20212d] p-1 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setResultActionsOpen(false)
                          void runRegenerateFresh()
                        }}
                        className="w-full rounded-md px-3 py-2 text-left text-xs text-amber-100 hover:bg-white/5"
                      >
                        清空并重新生成
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {runDetailsOpen && (
              <div className="mt-2 space-y-2 border-t border-white/8 pt-3 text-[10px] text-zinc-500" data-testid="run-details">
                <div className="flex justify-between gap-3"><span>需求材料</span><span className="text-zinc-300">{files.filter((file) => file.status === 'parsed').length} 份</span></div>
                <div className="flex justify-between gap-3"><span>代码上下文</span><span className="max-w-[180px] truncate text-zinc-300">{codeChanges?.repos?.length ? `${codeChanges.repos.length} 个仓库` : '未选择'}</span></div>
                <div className="flex justify-between gap-3"><span>知识库</span><span className="text-zinc-300">{ragOk ? '已连接' : '未连接'}</span></div>
                {(metaInfo.codeLen || metaInfo.ragLen) && <div className="flex justify-between gap-3"><span>最近命中上下文</span><span className="text-right text-zinc-300">{metaInfo.codeLen ? `代码 ${(metaInfo.codeLen / 1000).toFixed(1)}k` : ''}{metaInfo.codeLen && metaInfo.ragLen ? ' · ' : ''}{metaInfo.ragLen ? `知识 ${(metaInfo.ragLen / 1000).toFixed(1)}k` : ''}</span></div>}
                <div className="flex justify-between gap-3"><span>执行模型</span><span className="max-w-[180px] truncate text-right text-zinc-300">{llm.current?.label || llmSelected || '未选择'} / {llmModelSelected || llm.current?.model || '默认模型'}</span></div>
                <div className="flex justify-between gap-3"><span>预计输入</span><span className="text-zinc-300">约 {(estimateSimplePromptChars(buildParsedDocumentsPayload(), ENHANCED_PROMPT_OVERHEAD_CHARS_GUESS) / 1000).toFixed(1)}k 字符</span></div>
              </div>
            )}
          </div>
        </aside>

        {/* 主内容 */}
        <main className="min-w-0 flex-1 bg-[#12131c] p-4 lg:overflow-y-auto">
          {generating && (
            <div className="mb-4 border-y border-white/10 bg-[#171823] px-4 py-4 text-xs text-zinc-200" data-testid="generation-progress">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-zinc-100">{pipelineStatus || (streamConnected ? '模型已连接，正在准备生成' : '正在连接生成服务')}</div>
                  <div className="mt-1 text-[10px] text-zinc-500">已运行 {genWaitSec}s{progressInfo ? ` · 已生成约 ${progressInfo.estimatedCases} 条` : ''}</div>
                </div>
                <button type="button" onClick={cancelGenerate} className="rounded-md border border-red-400/25 px-3 py-1.5 text-[11px] text-red-200 hover:bg-red-500/10">停止</button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {GENERATION_STEPS.map((step, index) => {
                  const current = generationStepIndex(pipelineStep)
                  const done = index < current
                  const active = index === current
                  return (
                    <div key={step.key} className="min-w-0">
                      <div className={`mb-1.5 h-1 rounded-full ${done ? 'bg-emerald-400' : active ? 'bg-violet-400' : 'bg-white/10'}`} />
                      <div className={`${done ? 'text-emerald-300' : active ? 'text-violet-200' : 'text-zinc-600'}`}>{step.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {generationNotice && (
            <div
              className="mb-4 flex items-start justify-between gap-4 border-y border-amber-500/25 bg-amber-950/15 px-4 py-3 text-xs text-amber-100"
              data-testid="generation-quality-notice"
              role="status"
            >
              <div className="min-w-0">
                <div className="font-medium text-amber-200">部分结果已保留</div>
                <div className="mt-1 whitespace-pre-line leading-relaxed text-amber-100/75">{generationNotice}</div>
              </div>
              <button
                type="button"
                className="size-7 shrink-0 rounded-md text-lg leading-none text-amber-200/70 transition hover:bg-amber-500/10 hover:text-amber-100"
                onClick={() => setGenerationNotice(null)}
                aria-label="关闭部分结果提示"
                title="关闭"
              >
                ×
              </button>
            </div>
          )}
          {testPlan && (
            <div className="mb-4 border-y border-sky-500/20 bg-sky-950/10 px-4 py-3 text-xs text-sky-100" data-testid="coverage-summary">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">覆盖检查</div>
                  <div className="mt-0.5 text-[10px] text-sky-300/60">需求、测试点与生成用例的追溯结果</div>
                </div>
                <button type="button" className="text-[11px] text-sky-300 hover:text-sky-100" onClick={() => setTestPlanCollapsed((v) => !v)}>{testPlanCollapsed ? '展开' : '收起'}</button>
              </div>
              {testPlanCollapsed && (
                <div className="text-[11px] text-sky-200/75">{testPlan.coverage.reqTotal} 个需求 · {testPlan.coverage.testPointTotal} 个测试点 · 覆盖率 {testPlan.coverage.coverageRate ?? 0}%</div>
              )}
              {!testPlanCollapsed && (
                <>
                  <div className="mb-2 grid gap-2 sm:grid-cols-4">
                    <CoverageMetric label="需求条目" value={testPlan.coverage.reqTotal} />
                    <CoverageMetric label="测试点" value={testPlan.coverage.testPointTotal} />
                    <CoverageMetric label="用例覆盖率" value={`${testPlan.coverage.coverageRate ?? 0}%`} tone={(testPlan.coverage.coverageRate ?? 0) >= 90 ? 'good' : 'warn'} />
                    <CoverageMetric label="未覆盖测试点" value={testPlan.coverage.uncoveredTestPointIds?.length ?? 0} tone={(testPlan.coverage.uncoveredTestPointIds?.length ?? 0) > 0 ? 'warn' : 'good'} />
                  </div>
                  <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-1 text-[11px] text-sky-300/80">测试点明细</div>
                    <div className="space-y-1">
                      {testPlan.testPoints.slice(0, 20).map((tp) => (
                        <div key={tp.id} className="flex gap-2 text-[11px] text-zinc-300">
                          <span className="w-16 shrink-0 font-mono text-sky-300">{tp.id}</span>
                          <span className={`size-1.5 shrink-0 self-center rounded-full ${tp.isInformationGap ? 'bg-amber-400' : tp.caseIds.length > 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="shrink-0 text-zinc-500">{tp.priority} · {tp.coverageType}</span>
                          <span className="min-w-0 flex-1">{tp.title}</span>
                          <span className="shrink-0 text-zinc-600">{tp.designMethod}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="text-sm font-medium text-zinc-200">
              生成的测试用例
              <span
                className="ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-500/20 px-2 text-xs text-sky-100"
                data-testid="generated-case-count"
              >
                {cases.length}
              </span>
            </div>
            <div className="flex flex-wrap rounded-lg border border-white/10 p-0.5 text-xs">
              <button
                type="button"
                className={[
                  'rounded-md px-3 py-1',
                  view === 'xmind' ? 'bg-white/10 text-white' : 'text-zinc-500',
                ].join(' ')}
                onClick={() => setView('xmind')}
              >
                脑图（XMind）
              </button>
              <button
                type="button"
                className={[
                  'rounded-md px-3 py-1',
                  view === 'card' ? 'bg-white/10 text-white' : 'text-zinc-500',
                ].join(' ')}
                onClick={() => setView('card')}
              >
                卡片
              </button>
              <button
                type="button"
                className={[
                  'rounded-md px-3 py-1',
                  view === 'table' ? 'bg-white/10 text-white' : 'text-zinc-500',
                ].join(' ')}
                onClick={() => setView('table')}
              >
                表格
              </button>
            </div>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/5"
              onClick={() => {
                setInsertIndex(cases.length - 1)
                setEditing(emptyCase())
              }}
            >
              ＋ 新增用例
            </button>
            <div className="relative">
              <button
                type="button"
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/5"
                onClick={() => setExportOpen((v) => !v)}
              >
                导出 ▾
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-white/10 bg-[#1e1f2e] py-1 text-xs shadow-xl">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-white/5"
                    onClick={() => doExport('excel')}
                  >
                    导出 Excel（标准用例表）
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-white/5"
                    onClick={() => doExport('xmind')}
                  >
                    导出思维导图（XMind）
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-white/5"
                    onClick={() => doExport('checklist')}
                  >
                    导出 Checklist（精简 Excel）
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
              onClick={() => {
                if (cases.length === 0) {
                  window.alert('当前没有用例可入库。')
                  return
                }
                setShowImportModal(true)
              }}
            >
              加入用例库
            </button>
          </div>

          {view === 'xmind' ? (
            <div className="relative">
              {generating && !streamText && (
                <div
                  className="pointer-events-none absolute inset-0 z-10 flex min-h-[480px] items-center justify-center rounded-xl bg-[#0f1018]/75 backdrop-blur-[2px]"
                  aria-live="polite"
                >
                  <div className="rounded-lg border border-white/10 bg-black/50 px-4 py-3 text-center text-sm text-zinc-200">
                    <p className="animate-pulse text-violet-200/95">用例脑图将在首包到达后更新</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {streamConnected ? '模型正在生成…' : '正在建立连接…'} 已等待 {genWaitSec}s
                    </p>
                  </div>
                </div>
              )}
              <TestCaseMindmapView cases={cases} />
            </div>
          ) : view === 'card' ? (
            <div className="space-y-0">
              <InsertRow onInsert={() => startInsert(-1)} />
              {cases.map((tc, idx) => (
                <div key={tc.id}>
                  <article
                    className="group relative mb-2 rounded-xl border border-white/10 bg-[#1a1b2e]/80 p-4"
                    onClick={(e) => handleCardClick(e, tc)}
                    onDoubleClick={(e) => handleCardDoubleClick(e, tc)}
                  >
                    {inlineEditingId === tc.id && editing?.id === tc.id ? (
                      <CaseDraftForm
                        variant="inline"
                        draft={editing}
                        onChange={setEditing}
                        onSave={applyEdit}
                        onCancel={clearDraftUi}
                        title={`编辑用例 ${editing.id}`}
                        autoFocusField={draftAutoField}
                        autoFocusCaret={draftAutoCaret}
                        focusKey={draftFocusKey}
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start gap-2">
                          <span
                            data-edit-field="priority"
                            className={[
                              'cursor-text rounded border px-2 py-0.5 text-[11px] font-bold select-text',
                              priorityClass(tc.priority),
                            ].join(' ')}
                          >
                            {tc.priority}
                          </span>
                          <span className="text-xs font-mono text-zinc-400">{tc.id}</span>
                          <CaseTypeTag caseType={tc.caseType} size="md" dataEditField="caseType" />
                          <span
                            data-edit-field="module"
                            className="cursor-text select-text rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400"
                          >
                            {tc.module}
                          </span>
                          {tc.subModule ? (
                            <span
                              data-edit-field="subModule"
                              className="cursor-text select-text rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300/90"
                            >
                              {tc.subModule}
                            </span>
                          ) : null}
                          <div className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                              title="复制"
                              onClick={(e) => {
                                e.stopPropagation()
                                copyCase(tc)
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                              title="删除"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteCase(tc.id)
                              }}
                            >
                              🗑
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                              title={expanded[tc.id] ? '收起' : '展开'}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (cardClickTimerRef.current) {
                                  clearTimeout(cardClickTimerRef.current)
                                  cardClickTimerRef.current = null
                                }
                                setExpanded((ex) => ({ ...ex, [tc.id]: !ex[tc.id] }))
                              }}
                            >
                              {expanded[tc.id] ? '⌃' : '⌄'}
                            </button>
                          </div>
                        </div>
                        <div data-edit-field="summary" className="mt-2 cursor-text select-text">
                          <p className="text-sm text-zinc-100">{tc.summary}</p>
                        </div>
                        {expanded[tc.id] && (
                          <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 text-xs text-zinc-300 md:grid-cols-2">
                            <div>
                              <div className="mb-1 font-medium text-zinc-500">用例描述</div>
                              <div
                                data-edit-field="description"
                                className="cursor-text select-text whitespace-pre-wrap"
                              >
                                {tc.description}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 font-medium text-zinc-500">前置条件</div>
                              <ul
                                data-edit-field="preconditions"
                                className="cursor-text list-disc pl-4 select-text"
                              >
                                {tc.preconditions.map((x, i) => (
                                  <li key={i}>{x}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="mb-1 font-medium text-zinc-500">测试步骤</div>
                              <ol
                                data-edit-field="steps"
                                className="cursor-text list-decimal pl-4 select-text"
                              >
                                {tc.steps.map((x, i) => (
                                  <li key={i}>{x}</li>
                                ))}
                              </ol>
                            </div>
                            <div>
                              <div className="mb-1 font-medium text-zinc-500">预期结果</div>
                              <div
                                data-edit-field="expected"
                                className="cursor-text select-text rounded-md border border-emerald-500/35 bg-emerald-500/5 p-2 whitespace-pre-wrap text-zinc-200"
                              >
                                {tc.expected}
                              </div>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          className="mt-3 text-[11px] text-violet-400 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (cardClickTimerRef.current) {
                              clearTimeout(cardClickTimerRef.current)
                              cardClickTimerRef.current = null
                            }
                            openEditFromButton(tc)
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          ✎ 编辑此用例
                        </button>
                      </>
                    )}
                  </article>
                  <InsertRow onInsert={() => startInsert(idx)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[#1a1b2e] text-zinc-500">
                  <tr>
                    <th className="border-b border-white/10 px-2 py-2">ID</th>
                    <th className="border-b border-white/10 px-2 py-2">模块</th>
                    <th className="border-b border-white/10 px-2 py-2">用例描述</th>
                    <th className="border-b border-white/10 px-2 py-2">优先级</th>
                    <th className="border-b border-white/10 px-2 py-2">类型</th>
                    <th className="border-b border-l border-sky-500/30 px-2 py-2">前置条件</th>
                    <th className="border-b border-white/10 px-2 py-2">测试步骤</th>
                    <th className="border-b border-white/10 px-2 py-2">预期结果</th>
                    <th className="border-b border-white/10 px-2 py-2">备注</th>
                    <th className="border-b border-white/10 px-2 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((tc, idx) => (
                    <Fragment key={tc.id}>
                      <tr className="group h-2">
                        <td colSpan={10} className="relative p-0">
                          <div className="flex h-3 items-center justify-center opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              className="rounded-full border border-violet-500/50 bg-violet-500/20 px-2 text-[10px] text-violet-200"
                              onClick={() => startInsert(idx - 1)}
                            >
                              ＋ 插入
                            </button>
                          </div>
                        </td>
                      </tr>
                      <tr
                        className="border-b border-white/5 hover:bg-white/[0.02]"
                        onDoubleClick={(e) => handleTableRowDoubleClick(e, tc)}
                      >
                        <td className="px-2 py-2 font-mono text-zinc-400">{tc.id}</td>
                        <td className="px-2 py-2 text-sky-300">
                          {tc.module}
                          {tc.subModule ? ` / ${tc.subModule}` : ''}
                        </td>
                        <td className="max-w-[200px] px-2 py-2 text-zinc-200">{tc.summary}</td>
                        <td className="px-2 py-2">
                          <span
                            className={[
                              'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                              priorityClass(tc.priority),
                            ].join(' ')}
                          >
                            {tc.priority}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <CaseTypeTag caseType={tc.caseType} size="sm" />
                        </td>
                        <td className="border-l border-sky-500/20 px-2 py-2 text-zinc-400">
                          <ul className="list-disc pl-3">
                            {tc.preconditions.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </td>
                        <td className="max-w-[220px] px-2 py-2 text-zinc-400">
                          <ol className="list-decimal pl-3">
                            {tc.steps.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ol>
                        </td>
                        <td className="max-w-[220px] px-2 py-2 text-zinc-400">{tc.expected}</td>
                        <td className="px-2 py-2 text-zinc-500">{tc.remarks || '—'}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            className="mr-1 text-zinc-500 hover:text-zinc-200"
                            onClick={() => copyCase(tc)}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="mr-1 text-zinc-500 hover:text-zinc-200"
                            onClick={() => openEditFromButton(tc)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="text-zinc-500 hover:text-red-300"
                            onClick={() => deleteCase(tc.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                      {inlineEditingId === tc.id && editing?.id === tc.id ? (
                        <tr className="border-b border-white/10 bg-[#14151f]">
                          <td colSpan={10} className="p-4 align-top">
                            <CaseDraftForm
                              variant="inline"
                              draft={editing}
                              onChange={setEditing}
                              onSave={applyEdit}
                              onCancel={clearDraftUi}
                              title={`编辑用例 ${editing.id}`}
                              autoFocusField={draftAutoField}
                              autoFocusCaret={draftAutoCaret}
                              focusKey={draftFocusKey}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isModalInsert && editing && (
            <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-4 sm:items-center">
              <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#1a1b2e] p-5 shadow-2xl">
                <CaseDraftForm
                  variant="modal"
                  draft={editing}
                  onChange={setEditing}
                  onSave={confirmInsert}
                  onCancel={clearDraftUi}
                  title="新增用例"
                  autoFocusField={null}
                  autoFocusCaret={null}
                  focusKey={0}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      {showImportModal && (
        <ImportToLibraryModal
          cases={cases}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {(generateError || interruptMsg) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            setGenerateError(null)
            setInterruptMsg(null)
          }}
        >
          <div
            className={`mx-4 w-full max-w-2xl rounded-2xl border p-6 shadow-2xl ${
              generateError
                ? 'border-red-500/30 bg-[#1a1b2e]'
                : 'border-amber-500/30 bg-[#1a1b2e]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              {generateError ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20 text-lg">✕</span>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-lg">⚠</span>
              )}
              <h3 className={`text-base font-semibold ${generateError ? 'text-red-200' : 'text-amber-200'}`}>
                {generateError ? '生成出错' : '生成中断'}
              </h3>
            </div>
            <p
              className={`mb-5 max-h-[min(60vh,28rem)] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed ${generateError ? 'text-red-100/80' : 'text-amber-100/80'}`}
            >
              {humanizeLlmModalText(generateError || interruptMsg)}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setGenerateError(null)
                  setInterruptMsg(null)
                }}
                className={`min-h-[2.5rem] flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white ${
                  generateError
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                知道了
              </button>
              <button
                type="button"
                onClick={async () => {
                  const raw = generateError || interruptMsg || ''
                  try {
                    await navigator.clipboard.writeText(raw)
                  } catch {
                    window.alert('复制失败：浏览器未授权剪贴板，请手动全选正文复制。')
                  }
                }}
                className="min-h-[2.5rem] flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:bg-white/10"
              >
                复制原文
              </button>
              <a
                href={`${apiBase}/api/llm-last-meta`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[2.5rem] flex-1 items-center justify-center rounded-xl border border-violet-500/40 bg-violet-950/40 px-4 py-2.5 text-center text-sm font-medium text-violet-100 hover:bg-violet-950/60"
              >
                打开上次请求摘要
              </a>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function CoverageMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'good' | 'warn'
}) {
  const valueClass = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-200' : 'text-sky-100'
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2.5">
      <div className="text-[10px] text-sky-300/65">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${valueClass}`}>{value}</div>
    </div>
  )
}

function InsertRow({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="group relative flex h-4 items-center justify-center">
      <button
        type="button"
        className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 text-[10px] text-violet-200 opacity-0 transition hover:opacity-100 group-hover:opacity-100"
        onClick={onInsert}
      >
        ＋
      </button>
    </div>
  )
}

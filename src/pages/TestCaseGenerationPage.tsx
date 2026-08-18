import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { CursorAssistPanel } from '../components/CursorAssistPanel'
import { TestCaseMindmapView } from '../components/TestCaseMindmapView'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''
/** 末次用例变更后空闲多久再自动 POST 修订摘要（毫秒）。断续编辑可拉大；点「API 生成」前会强制 flush 一轮。 */
const REVISION_LOG_IDLE_MS = (() => {
  const n = Number(import.meta.env.VITE_REVISION_LOG_IDLE_MS)
  return Number.isFinite(n) && n >= 5000 ? n : 120_000
})()
import { streamEnhancedGenerate, streamGenerateTestPlan, fetchRagHealth, previewEnhancedPrompt } from '../api/vcs'
import CodeChangePanel from '../components/CodeChangePanel'
import type { CodeContextPayload } from '../api/vcs'
import { useLlmProvider } from '../hooks/useLlmProvider'
import { LlmProviderSelect } from '../components/LlmProviderSelect'
import { useDocumentUpload, defaultRoleFirstPrimary } from '../hooks/useDocumentUpload'
import { DocumentUploadPanel } from '../components/DocumentUploadPanel'
import { buildCursorClipboardMarkdown } from '../lib/generationPrompt'
import { exportExcelFull, exportChecklist, exportXMind } from '../lib/exportCases'
import { ImportToLibraryModal } from '../components/ImportToLibraryModal'
import { clearGenerationSessionSnapshots, loadGenerationSessionRecords } from '../lib/generationSessionCache'
import { humanizeLlmModalText } from '../lib/humanizeLlmModalText'
import {
  saveInputSnapshot,
  loadInputSnapshot,
  getInputSnapshotTime,
} from '../lib/inputSnapshotStore'
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

function buildExistingCaseBriefs(cases: TestCase[], max = 160) {
  return cases.slice(-max).map((tc) => ({
    module: tc.module,
    subModule: tc.subModule,
    summary: tc.summary,
    expected: tc.expected,
    priority: tc.priority,
    caseType: tc.caseType,
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

function StreamPanel({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])
  return (
    <div className="mb-3 rounded-lg border border-violet-500/30 bg-violet-950/30 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-violet-300">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
        大模型流式输出中…
      </div>
      <pre
        ref={ref}
        className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-300"
      >
        {text}
      </pre>
    </div>
  )
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
  const [sessionSnapshots, setSessionSnapshots] = useState(() => loadGenerationSessionRecords())
  const [snapshotSelectKey, setSnapshotSelectKey] = useState(0)
  /** 通过侧栏「Cursor 辅助 → 解析 JSON」追加的用例 id，用于一键撤销 */
  const [cursorAssistCaseIds, setCursorAssistCaseIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<TestCase | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)
  const [draftAutoField, setDraftAutoField] = useState<DraftFocusField>(null)
  const [draftAutoCaret, setDraftAutoCaret] = useState<number | null>(null)
  const [draftFocusKey, setDraftFocusKey] = useState(0)
  const [generating, setGenerating] = useState(false)
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
  /** null = 尚未探测；true = 当前所选通道已配置；false = 未就绪或未连接 */
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null)
  const llm = useLlmProvider()
  const llmProviders = llm.providers
  const llmSelected = llm.selectedProvider
  const llmModelSelected = llm.selectedModel
  const apiServerUp = llm.apiServerUp
  const [exportOpen, setExportOpen] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [codeChanges, setCodeChanges] = useState<CodeContextPayload | null>(() => loadCodeChangesFromSession())
  const [ragOk, setRagOk] = useState<boolean | null>(null)
  const [metaInfo, setMetaInfo] = useState<{ codeLen?: number; ragLen?: number }>({})
  const [progressInfo, setProgressInfo] = useState<{ chars: number; estimatedCases: number; elapsedSec: number } | null>(null)
  const [interruptMsg, setInterruptMsg] = useState<string | null>(null)
  const [pipelineStatus, setPipelineStatus] = useState<string>('')
  const [usePipeline, setUsePipeline] = useState(true)
  /** Kimi 等总上下文型通道：生成前体量预警（成功收尾后清空） */
  const [promptContextHint, setPromptContextHint] = useState<string | null>(null)
  const [promptPreview, setPromptPreview] = useState<{ system: string; user: string; meta: Record<string, number> } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [testPlan, setTestPlan] = useState<TestPlanLedger | null>(null)
  const [testPlanLoading, setTestPlanLoading] = useState(false)
  const [testPlanWaitSec, setTestPlanWaitSec] = useState(0)
  const [testPlanError, setTestPlanError] = useState<string | null>(null)
  const [testPlanCollapsed, setTestPlanCollapsed] = useState(false)
  const [testPlanStreamText, setTestPlanStreamText] = useState('')
  const [testPlanStatus, setTestPlanStatus] = useState('')
  const [testPlanProgress, setTestPlanProgress] = useState<{ chars: number; elapsedSec: number } | null>(null)
  const testPlanAbortRef = useRef<AbortController | null>(null)
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

  /** 测试计划接口是非流式请求，单独展示等待秒数与超时提示 */
  useEffect(() => {
    if (!testPlanLoading) {
      setTestPlanWaitSec(0)
      return
    }
    const timer = window.setInterval(() => {
      setTestPlanWaitSec((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [testPlanLoading])

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
    setCursorAssistCaseIds((ids) => {
      const next = ids.filter((id) => cases.some((c) => c.id === id))
      return next.length === ids.length ? ids : next
    })
  }, [cases])

  const cursorAssistOnPageCount = useMemo(
    () => cursorAssistCaseIds.filter((id) => cases.some((c) => c.id === id)).length,
    [cases, cursorAssistCaseIds],
  )

  const clearCursorAppendedCases = useCallback(() => {
    setCursorAssistCaseIds((ids) => {
      if (ids.length === 0) return ids
      const idSet = new Set(ids)
      setCases((c) => c.filter((tc) => !idSet.has(tc.id)))
      return []
    })
  }, [])

  useEffect(() => {
    fetchRagHealth().then(h => setRagOk(h.ok)).catch(() => setRagOk(false))
  }, [])

  /** 文案派生：随 useLlmProvider 状态变化，更新顶部状态条 apiHint 与 apiHealthy 标志 */
  useEffect(() => {
    if (llm.apiServerUp === false) {
      setApiHealthy(false)
      setApiHint(
        '未连接本地模型 API：可使用侧栏「Cursor 辅助」；或配置 .env 后 npm run dev（或 npm run dev:api）',
      )
      return
    }
    if (llm.apiServerUp === null) return
    const p = llm.current
    const ready = Boolean(p?.ready)
    setApiHealthy(ready)
    if (!p) return
    const m = llm.selectedModel || p.model || ''
    setApiHint(
      ready
        ? `本地 API 已连接 · 当前通道：${p.label ?? p.id}（${p.id}${m ? ` / ${m}` : ''}）`
        : `已选「${p.label ?? p.id}」但未就绪：${p.hint ?? '请配置 .env'}。可换其它通道或使用 Cursor 辅助。`,
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
  /** 列表已返回且 API 在线时，才按「当前通道是否就绪」禁用；避免 apiHealthy 初值 null 误伤 */
  const selectedLlmReady = Boolean(llmProviders.find((x) => x.id === llmSelected)?.ready)
  /** API 已确认在线时：列表为空或当前通道未就绪则不允许点（避免误点只弹窗） */
  const providerListBlocksApi =
    apiServerUp === true && (llmProviders.length === 0 || !selectedLlmReady)
  const canRunApiGenerate =
    parseIdle && hasParsedOk && apiServerUp !== false && !providerListBlocksApi && apiServerUp != null

  const buildCursorFullPrompt = useCallback((): string => {
    if (!parseIdle || !hasParsedOk) return ''
    const documents = buildParsedDocumentsPayload()
    return buildCursorClipboardMarkdown({
      documents,
      focusText,
      selectedTypes,
      depth,
      timezone: APP_TIMEZONE,
    })
  }, [buildParsedDocumentsPayload, focusText, selectedTypes, depth, parseIdle, hasParsedOk])

  const handlePreviewPrompt = async () => {
    if (!hasParsedOk) {
      window.alert('请先上传并解析至少一份文档。')
      return
    }
    setPreviewLoading(true)
    try {
      const documents = buildParsedDocumentsPayload()
      const result = await previewEnhancedPrompt({
        documents,
        focusText,
        selectedTypes,
        depth,
        timezone: APP_TIMEZONE,
        codeChanges: codeChanges ?? undefined,
      })
      setPromptPreview({
        system: result.systemPrompt,
        user: result.userPrompt,
        meta: result.meta as unknown as Record<string, number>,
      })
    } catch (e) {
      window.alert(`预览失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
    setPreviewLoading(false)
  }

  const handleGenerateTestPlan = () => {
    if (!hasParsedOk) {
      window.alert('请先上传并解析至少一份文档。')
      return
    }
    if (apiServerUp === false || providerListBlocksApi || apiServerUp == null) {
      window.alert('本地 API 或当前模型通道尚未就绪。')
      return
    }
    setTestPlanLoading(true)
    setTestPlanError(null)
    setTestPlanCollapsed(false)
    setTestPlanStreamText('')
    setTestPlanStatus('正在连接测试点流式通道…')
    setTestPlanProgress(null)
    const documents = buildParsedDocumentsPayload()
    const ac = streamGenerateTestPlan(
      {
        documents,
        focusText,
        selectedTypes,
        depth,
        timezone: APP_TIMEZONE,
        llmProvider: llmSelected,
        llmModel: llmModelSelected || undefined,
      },
      {
        onStreamOpen: () => setTestPlanStatus('已连接模型，正在等待首段输出…'),
        onMeta: (meta) => {
          if (meta.type === 'test_plan_stream') setTestPlanStatus('测试点流式生成已启动…')
        },
        onThinking: ({ totalChars }) => {
          setTestPlanStatus(`模型思考中… 已生成 ${totalChars} 字推理内容`)
        },
        onProgress: (info) => setTestPlanProgress(info),
        onDelta: (text) => setTestPlanStreamText((prev) => prev + text),
        onDone: (plan) => {
          setTestPlan(plan)
          setTestPlanCollapsed(false)
          setTestPlanStatus('测试点账本已生成')
          setTestPlanLoading(false)
          testPlanAbortRef.current = null
        },
        onError: (msg, raw) => {
          setTestPlanError(raw ? `${msg}；原始输出前 200 字：${raw.slice(0, 200)}` : msg)
          setTestPlanLoading(false)
          testPlanAbortRef.current = null
        },
      },
    )
    testPlanAbortRef.current = ac
  }

  const cancelTestPlanGeneration = useCallback(() => {
    testPlanAbortRef.current?.abort()
    testPlanAbortRef.current = null
    setTestPlanLoading(false)
  }, [])

  const cancelGenerate = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGenerating(false)
    setStreamConnected(false)
    setPromptContextHint(null)
  }, [])

  const runGenerate = async () => {
    setGenerateError(null)
    if (apiServerUp === false) {
      window.alert(
        '未连接本地 API。请启动 npm run dev（或 npm run dev:api），或使用下方「Cursor 辅助」。',
      )
      return
    }
    if (!llmProviders.find((x) => x.id === llmSelected)?.ready) {
      window.alert(
        '当前所选模型通道未在服务器就绪（多为未配置对应 .env 密钥）。请更换下拉选项或编辑 .env 后重启 API。',
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
      setGenerateError,
      truncateInterruptReason,
      onGenerationFinishSuccess: () => setPromptContextHint(null),
    }
    const onEnhancedDone = createEnhancedOnDone(streamDeps)
    const onEnhancedError = createEnhancedOnError(streamDeps)
    const existingCaseBriefs = buildExistingCaseBriefs(casesRef.current)
    const isAppendGeneration = existingCaseBriefs.length > 0

    setGenerating(true)
    setStreamConnected(false)
    setStreamText('')
    setMetaInfo({})
    setProgressInfo(null)
    setInterruptMsg(null)
    setPipelineStatus('')

    const ac = streamEnhancedGenerate(
      {
        documents,
        focusText,
        selectedTypes,
        depth,
        timezone: APP_TIMEZONE,
        llmProvider: llmSelected,
        llmModel: llmModelSelected || undefined,
        codeChanges: codeChanges ?? undefined,
        usePipeline,
        generationMode: isAppendGeneration ? 'append' : 'fresh',
        existingCases: isAppendGeneration ? existingCaseBriefs : undefined,
        batchTarget: isAppendGeneration ? { min: 30, max: 60 } : undefined,
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
            if (meta.status === 'start') setPipelineStatus('🔬 多步分析启动...')
            else if (meta.status === 'done') setPipelineStatus('✅ 预分析完成，正在生成用例...')
            else if (meta.status === 'fallback') setPipelineStatus('⚠️ 预分析跳过，使用基础模式生成')
          }
        },
        onPipelineProgress: (info) => {
          if (info.step === 'code_analysis') {
            if (info.status === 'start') {
              const msg = (info as unknown as Record<string, unknown>).skippedFiles
                ? `🔬 代码预分析（精选 ${info.totalFiles} 个最相关文件）`
                : `🔬 代码预分析（${info.totalFiles} 个文件）`
              setPipelineStatus(msg)
            } else if (info.status === 'analyzing') {
              setPipelineStatus(`🔬 代码预分析 ${info.progress || ''}：${info.file || ''}`)
            } else if (info.status === 'file_done') {
              setPipelineStatus(`🔬 代码预分析 ${info.progress || ''}`)
            } else if (info.status === 'timeout') {
              setPipelineStatus('⏱ 代码预分析超时，使用已完成的结果')
            } else if (info.status === 'done') {
              setPipelineStatus(`🔬 代码预分析完成（${info.successCount}/${info.totalFiles}）`)
            }
          } else if (info.step === 'requirement_analysis') {
            if (info.status === 'start') setPipelineStatus('📋 需求深度分析中...')
            else if (info.status === 'done') setPipelineStatus('📋 需求分析完成')
            else if (info.status === 'skipped') setPipelineStatus('📋 需求分析已跳过')
          } else if (info.step === 'final_generation') {
            setPipelineStatus('🚀 预分析完成，开始生成用例，请耐心等待（首 token 最多等 3 分钟，整体可能 5-10 分钟）…')
          }
        },
        onProgress: (info) => setProgressInfo(info),
        onDelta: (text) => setStreamText((prev) => prev + text),
        onDone: onEnhancedDone,
        onError: onEnhancedError,
      },
    )
    abortRef.current = ac
  }

  const clearDraftUi = useCallback(() => {
    setEditing(null)
    setInsertIndex(null)
    setInlineEditingId(null)
    setDraftAutoField(null)
    setDraftAutoCaret(null)
  }, [])

  /** 清空右侧用例后按当前配置再调模型；不删「本次会话快照」state 与 sessionStorage */
  const runRegenerateFresh = async () => {
    if (generating) return
    if (
      !window.confirm(
        '将清空右侧当前全部用例，并按侧栏已解析文档与选项重新生成。\n\n「本次会话快照」下拉中的历史记录不会被删除；仅清空当前列表。\n\n确定继续？',
      )
    ) {
      return
    }
    clearDraftUi()
    setCursorAssistCaseIds([])
    setExpanded({})
    casesRef.current = []
    setCases([])
    revisionBaselineRef.current = null
    await runGenerate()
  }

  const handleRestoreSessionSnapshot = useCallback(
    (recordId: string) => {
      const rec = sessionSnapshots.find((r) => r.id === recordId)
      if (!rec) return
      if (
        !window.confirm(
          `用快照替换当前右侧用例列表？\n${rec.label}\n（共 ${rec.cases.length} 条，未保存的编辑将丢失）`,
        )
      ) {
        setSnapshotSelectKey((k) => k + 1)
        return
      }
      clearDraftUi()
      const clone = JSON.parse(JSON.stringify(rec.cases)) as TestCase[]
      setCases(clone)
      revisionBaselineRef.current = structuredClone(clone)
      setSnapshotSelectKey((k) => k + 1)
    },
    [sessionSnapshots, clearDraftUi],
  )

  const handleClearSessionSnapshots = useCallback(() => {
    if (sessionSnapshots.length === 0) return
    if (!window.confirm('清除本次会话内全部生成快照？（不影响当前列表）')) return
    clearGenerationSessionSnapshots()
    setSessionSnapshots([])
    setSnapshotSelectKey((k) => k + 1)
  }, [sessionSnapshots.length])

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#161722] px-6 py-3">
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
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            系统运行中
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 配置侧栏（完整执行流水线仅计划在「智能测试」中展示） */}
        <aside className="flex w-full max-w-[340px] shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#1a1b2e]">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">上传需求文档</h2>
              <DocumentUploadPanel
                state={docs}
                variant="full"
                theme="violet"
                accept=".pdf,.docx,.xls,.xlsx,.xlsm,.txt,.md,.csv,.json,image/*"
              />
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-violet-500/40 bg-violet-500/[0.08] px-2.5 py-2 text-[11px] font-medium text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40"
                  disabled={!files.some((f) => f.status === 'parsed')}
                  onClick={() => {
                    saveInputSnapshot({
                      files,
                      focusText,
                      selectedTypes,
                      depth,
                      codeChanges,
                    })
                    setSnapshotSelectKey((k) => k + 1)
                    window.alert('输入快照已保存')
                  }}
                >
                  💾 保存输入快照
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.08] px-2.5 py-2 text-[11px] font-medium text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-40"
                  disabled={!getInputSnapshotTime()}
                  onClick={() => {
                    const snap = loadInputSnapshot()
                    if (!snap) { window.alert('无已保存的快照'); return }
                    docs.replaceAll(snap.files)
                    setFocusText(snap.focusText)
                    setSelectedTypes(snap.selectedTypes)
                    setDepth(snap.depth)
                    setCodeChanges(snap.codeChanges)
                    setStreamText('')
                    setGenerateError(null)
                    setInterruptMsg(null)
                    setProgressInfo(null)
                    setMetaInfo({})
                  }}
                >
                  📂 应用快照{getInputSnapshotTime() ? ` (${getInputSnapshotTime()})` : ''}
                </button>
              </div>
              {(() => {
                const noviceFiles = [
                  'Assets/Scripts/ExternalClient/Managers/EventManager/ClientEvent.cs',
                  'Assets/Scripts/ExternalClient/Managers/PlaneEditorManager/PlaneEditorManager.cs',
                  'Assets/Scripts/ExternalClient/Managers/PlaneEditorManager/PlaneEditorManager.Operate.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/CPlanePartInfo.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneEditPanel_Portrait.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlaneOperatePanel_Portrait.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/PlaneEditUI/PlanePartSelPanel_Portrait.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/TutorialUI/AssistantPanel.cs',
                  'Assets/Scripts/ExternalClient/UI/SubUIPanel/TutorialUI/PlaneUITutorialPanel.cs',
                  'Assets/Scripts/ExternalClient/UI/UIPanel/PlaneEditUI_Portrait.cs',
                  'Assets/Scripts/ExternalClient/UI/UIPanel/PlaneEditUI_Portrait.Tutorial.cs',
                  'Assets/Scripts/ExternalClient/Utils/TutorialUtil.cs',
                ]
                const isActive = codeChanges?.repos?.[0]?.files?.length === noviceFiles.length
                  && noviceFiles.every(f => codeChanges.repos[0].files!.includes(f))
                return (
                  <button
                    type="button"
                    className={`mb-3 w-full rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                      isActive
                        ? 'border-emerald-500/40 bg-emerald-500/[0.1] text-emerald-200/90 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-200/90'
                        : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200/90 hover:bg-amber-500/15'
                    }`}
                    onClick={() => {
                      if (isActive) {
                        setCodeChanges(null)
                      } else {
                        setCodeChanges({ mode: 'smart', repos: [{ repoId: 'client', files: noviceFiles }] })
                      }
                    }}
                  >
                    {isActive ? '✅ 已关联 12 个 .cs 文件（点击取消）' : '【临时】关联新手教程代码（12 个 .cs）'}
                  </button>
                )
              })()}

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

            <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-1.5 text-xs font-medium text-zinc-200">大模型通道</div>
              <LlmProviderSelect state={llm} variant="violet" disabled={generating} label="" />
            </div>
          </div>
          {/* 固定底部操作区 */}
          <div className="shrink-0 border-t border-white/10 bg-[#1a1b2e] px-4 py-3">
            <label className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400 select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-violet-500 rounded"
                checked={usePipeline}
                onChange={(e) => setUsePipeline(e.target.checked)}
                disabled={generating}
              />
              <span className={usePipeline ? 'text-violet-300' : ''}>
                启用代码预分析（多步 Agent）
              </span>
              {!usePipeline && (
                <span className="text-amber-400/70">— 关闭后直接用原始代码摘要生成</span>
              )}
            </label>
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
                  disabled={!canRunApiGenerate}
                  onClick={() => void runGenerate()}
                  title={
                    apiServerUp === false
                      ? '未连接本地 API'
                      : apiServerUp == null
                        ? '正在连接本地 API…'
                        : providerListBlocksApi
                          ? '当前通道未就绪，请换通道或配置 .env'
                          : cases.length > 0
                            ? '保留当前列表，追加生成下一批；会把已有用例摘要传给模型用于避重补洞'
                            : !hasParsedOk && parseIdle
                              ? '至少需要一份文档解析成功'
                              : !parseIdle
                                ? '等待解析完成'
                                : undefined
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-medium text-white shadow-lg shadow-violet-900/40 disabled:opacity-50"
                >
                  {parsingCount > 0
                    ? `解析中（${parsingCount}）…`
                    : apiServerUp === false || providerListBlocksApi
                      ? 'API 生成（通道未就绪）'
                      : apiServerUp == null
                        ? 'API 生成（连接中…）'
                        : cases.length > 0
                          ? '✦ 追加生成下一批'
                          : '✦ API 生成用例'}
                </button>
                <button
                  type="button"
                  disabled={!canRunApiGenerate}
                  onClick={() => void runRegenerateFresh()}
                  title="先清空右侧全部用例，再按当前已解析文档与侧栏选项重新调用模型。不删除「本次会话快照」里的历史记录。"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-950/20 py-2.5 text-xs font-medium text-amber-100 hover:bg-amber-950/35 disabled:opacity-50"
                >
                  ⟳ 重新生成（清空列表后再调模型）
                </button>
                <button
                  type="button"
                  disabled={!canRunApiGenerate || testPlanLoading}
                  onClick={handleGenerateTestPlan}
                  title="流式生成测试点账本（REQ/TP），后续用于按测试点生成测试用例。不会影响上方 API 生成用例按钮。"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-950/20 py-2.5 text-xs font-medium text-sky-100 hover:bg-sky-950/35 disabled:opacity-50"
                >
                  {testPlanLoading ? '生成测试点中…' : '生成测试点（REQ/TP）'}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={previewLoading || !hasParsedOk || apiServerUp === false}
              onClick={handlePreviewPrompt}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40"
            >
              {previewLoading ? '正在组装 Prompt...' : '预览完整 Prompt（含代码变更+知识库）'}
            </button>
            <div className="mt-4 border-t border-white/10 pt-3">
              <CursorAssistPanel
                buildClipboard={buildCursorFullPrompt}
                apiOnline={apiHealthy === true}
                cursorAppendedCount={cursorAssistOnPageCount}
                onClearCursorAppended={clearCursorAppendedCases}
                onApplyCases={(added) => {
                  setCases((c) => [...c, ...added])
                  setCursorAssistCaseIds((ids) => [...ids, ...added.map((x) => x.id)])
                }}
              />
            </div>
          </div>
        </aside>

        {/* 主内容 */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#12131c] p-4">
          {generating && !streamText && (
            <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-violet-500/35 bg-violet-950/35 px-3 py-2.5 text-xs text-violet-100">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-violet-400" aria-hidden />
                <span>
                  {pipelineStatus
                    ? pipelineStatus
                    : streamConnected
                      ? '已连接流式通道，正在等待模型输出首段内容…'
                      : '已提交生成请求，正在连接本地 API 与模型…'}
                  <span className="ml-1.5 text-zinc-400">已等待 {genWaitSec}s</span>
                </span>
              </div>
              {pipelineStatus && (
                <div className="ml-4 text-[10px] text-zinc-500">
                  多步 Agent 流水线：需求深度分析 → 用例生成；勾选代码时会先执行代码预分析
                </div>
              )}
            </div>
          )}
          {generating && streamText && (
            <>
              {(metaInfo.codeLen || metaInfo.ragLen) && (
                <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                  {metaInfo.codeLen && (
                    <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                      代码变更已注入（{(metaInfo.codeLen / 1000).toFixed(1)}k 字符）
                    </span>
                  )}
                  {metaInfo.ragLen && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                      知识库上下文已注入（{(metaInfo.ragLen / 1000).toFixed(1)}k 字符）
                    </span>
                  )}
                </div>
              )}
              {progressInfo && (
                <div className="mb-2 flex items-center gap-3 text-[11px] text-zinc-400">
                  <span>⏱ {progressInfo.elapsedSec}s</span>
                  <span>已输出 {(progressInfo.chars / 1000).toFixed(1)}k 字符</span>
                  <span>预估 ~{progressInfo.estimatedCases} 条用例</span>
                  <span className="animate-pulse text-violet-400">生成中...</span>
                </div>
              )}
              <StreamPanel text={streamText} />
            </>
          )}
          {(testPlan || testPlanError || testPlanLoading) && (
            <div className="mb-3 rounded-xl border border-sky-500/25 bg-sky-950/20 p-3 text-xs text-sky-100">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-medium">测试点账本（REQ/TP）</div>
                {testPlan && (
                  <button
                    type="button"
                    className="text-[11px] text-sky-300 hover:text-sky-100"
                    onClick={() => setTestPlanCollapsed((v) => !v)}
                  >
                    {testPlanCollapsed ? '展开' : '收起'}
                  </button>
                )}
              </div>
              {testPlanLoading && (
                <div className="space-y-2 text-sky-200/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{testPlanStatus || '正在流式生成需求账本和测试点账本…'}</span>
                    <span className="text-zinc-400">已等待 {testPlanWaitSec}s</span>
                    <button
                      type="button"
                      className="rounded-md border border-sky-400/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/10"
                      onClick={cancelTestPlanGeneration}
                    >
                      取消
                    </button>
                  </div>
                  {testPlanWaitSec >= 120 && testPlanWaitSec < 180 && (
                    <div className="text-[11px] text-amber-200">
                      模型仍在生成测试计划，可继续等待；若文档很长，建议超过 180s 后取消重试。
                    </div>
                  )}
                  {testPlanWaitSec >= 180 && (
                    <div className="text-[11px] text-amber-200">
                      已等待超过 180s，可能卡住；建议取消后缩短文档或换通道重试。
                    </div>
                  )}
                  {testPlanProgress && (
                    <div className="text-[11px] text-zinc-400">
                      已输出 {(testPlanProgress.chars / 1000).toFixed(1)}k 字符，耗时 {testPlanProgress.elapsedSec}s
                    </div>
                  )}
                  {testPlanStreamText && (
                    <div className="rounded-lg border border-sky-500/20 bg-black/20 p-2">
                      <div className="mb-1 text-[11px] text-sky-300/80">测试点流式输出</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">
                        {testPlanStreamText}
                      </pre>
                    </div>
                  )}
                </div>
              )}
              {testPlanError && <div className="text-amber-200">生成失败：{testPlanError}</div>}
              {testPlan && testPlanCollapsed && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-sky-200/80">
                  <span>
                    已收起：{testPlan.coverage.reqTotal} 个需求条目 / {testPlan.coverage.testPointTotal} 个测试点
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-sky-400/30 px-2 py-1 text-sky-100 hover:bg-sky-500/10"
                    onClick={() => setTestPlanCollapsed(false)}
                  >
                    展开测试计划账本
                  </button>
                </div>
              )}
              {testPlan && !testPlanCollapsed && (
                <>
                  <div className="mb-2 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="text-[10px] text-sky-300/70">需求条目</div>
                      <div className="text-lg font-semibold">{testPlan.coverage.reqTotal}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="text-[10px] text-sky-300/70">测试点</div>
                      <div className="text-lg font-semibold">{testPlan.coverage.testPointTotal}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="text-[10px] text-sky-300/70">未覆盖 REQ</div>
                      <div className="text-lg font-semibold">{testPlan.coverage.uncoveredReqIds.length}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="text-[10px] text-sky-300/70">信息不足 TP</div>
                      <div className="text-lg font-semibold">{testPlan.coverage.informationGapTestPointIds.length}</div>
                    </div>
                  </div>
                  <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-1 text-[11px] text-sky-300/80">前 20 个测试点</div>
                    <div className="space-y-1">
                      {testPlan.testPoints.slice(0, 20).map((tp) => (
                        <div key={tp.id} className="flex gap-2 text-[11px] text-zinc-300">
                          <span className="w-16 shrink-0 font-mono text-sky-300">{tp.id}</span>
                          <span className="shrink-0 text-zinc-500">[{tp.priority}/{tp.coverageType}]</span>
                          <span>{tp.title}</span>
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
              <span className="ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-500/20 px-2 text-xs text-sky-100">
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

          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 text-[10px] font-medium text-zinc-500">本次会话快照</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <select
                  key={snapshotSelectKey}
                  className="min-w-0 max-w-full flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/40 sm:max-w-md"
                  defaultValue=""
                  aria-label="选择会话快照恢复到右侧用例列表"
                  onChange={(e) => {
                    const id = e.target.value
                    if (id) handleRestoreSessionSnapshot(id)
                  }}
                >
                  <option value="">选择快照恢复到右侧…</option>
                  {[...sessionSnapshots].reverse().map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300 disabled:opacity-40"
                  disabled={sessionSnapshots.length === 0}
                  onClick={handleClearSessionSnapshots}
                >
                  清除快照
                </button>
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-600 sm:max-w-[220px] sm:text-right">
              存于本标签页；关闭标签后清空。每次 API 生成成功自动追加，可恢复省 token。
            </p>
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

      {promptPreview && (
        <PromptPreviewModal
          system={promptPreview.system}
          user={promptPreview.user}
          meta={promptPreview.meta}
          onClose={() => setPromptPreview(null)}
        />
      )}

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

function PromptPreviewModal({
  system, user, meta, onClose,
}: {
  system: string
  user: string
  meta: Record<string, number>
  onClose: () => void
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const [tab, setTab] = useState<'user' | 'system'>('user')
  const [copied, setCopied] = useState(false)

  const fullText = tab === 'user' ? user : system
  const copyAll = () => {
    const combined = `[System Prompt]\n${system}\n\n[User Prompt]\n${user}`
    navigator.clipboard.writeText(combined).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-[#1a1b2e] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">增强 Prompt 预览</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
              {meta.codeChangeLength > 0 && (
                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                  代码变更 {(meta.codeChangeLength / 1000).toFixed(1)}k 字符
                </span>
              )}
              {meta.ragContextLength > 0 && (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                  知识库 {(meta.ragContextLength / 1000).toFixed(1)}k 字符
                </span>
              )}
              <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-zinc-300">
                总 {(meta.totalPromptChars / 1000).toFixed(1)}k 字符
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyAll}
              className="rounded-lg border border-violet-500/40 bg-violet-500/20 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/30"
            >
              {copied ? '已复制!' : '复制完整 Prompt'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="flex border-b border-white/10 px-5">
          <button
            type="button"
            className={`px-3 py-2 text-xs ${tab === 'user' ? 'border-b-2 border-violet-500 text-violet-200' : 'text-zinc-500'}`}
            onClick={() => setTab('user')}
          >
            User Prompt（需求+变更+知识库）
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-xs ${tab === 'system' ? 'border-b-2 border-violet-500 text-violet-200' : 'text-zinc-500'}`}
            onClick={() => setTab('system')}
          >
            System Prompt
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <pre
            ref={preRef}
            className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-300"
          >
            {fullText}
          </pre>
        </div>
      </div>
    </div>
  )
}

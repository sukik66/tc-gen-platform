/**
 * 版本控制 + 仓库配置 + RAG 前端 API
 */

import type { TestPlanLedger } from '../types'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

/* ========== 仓库配置 ========== */

export interface RepoConfig {
  id: string
  name: string
  type: 'plastic' | 'git'
  path: string
  branch?: string
  createdAt?: string
  updatedAt?: string
}

export async function fetchRepos(): Promise<RepoConfig[]> {
  const res = await fetch(`${apiBase}/api/repos`)
  if (!res.ok) throw new Error('获取仓库列表失败')
  return res.json()
}

export async function saveRepo(repo: Partial<RepoConfig> & { id: string; path: string }): Promise<RepoConfig> {
  const res = await fetch(`${apiBase}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(repo),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || '保存仓库失败')
  }
  return res.json()
}

export async function deleteRepo(id: string): Promise<void> {
  await fetch(`${apiBase}/api/repos/${id}`, { method: 'DELETE' })
}

export async function initDefaultRepos(): Promise<RepoConfig[]> {
  const res = await fetch(`${apiBase}/api/repos/init-defaults`, { method: 'POST' })
  return res.json()
}

/* ========== 分支 & 变更集 ========== */

export interface BranchInfo {
  name: string
  date: string
  owner?: string
  author?: string
  comment: string
}

export interface ChangesetInfo {
  id?: number
  hash?: string
  date: string
  owner?: string
  author?: string
  comment?: string
  message?: string
  branch?: string
}

export async function fetchBranches(repoId: string): Promise<BranchInfo[]> {
  const res = await fetch(`${apiBase}/api/vcs/${repoId}/branches`)
  if (!res.ok) throw new Error('获取分支列表失败')
  return res.json()
}

export async function fetchChangesets(
  repoId: string,
  opts: { branch?: string; since?: string; until?: string; limit?: number } = {},
): Promise<ChangesetInfo[]> {
  const params = new URLSearchParams()
  if (opts.branch) params.set('branch', opts.branch)
  if (opts.since) params.set('since', opts.since)
  if (opts.until) params.set('until', opts.until)
  if (opts.limit) params.set('limit', String(opts.limit))
  const q = params.toString()
  const res = await fetch(`${apiBase}/api/vcs/${repoId}/changesets${q ? '?' + q : ''}`)
  if (!res.ok) throw new Error('获取变更集失败')
  return res.json()
}

export async function fetchDiffContent(
  repoId: string,
  opts: { from?: string; to?: string; since?: string; until?: string; branch?: string },
): Promise<string> {
  const res = await fetch(`${apiBase}/api/vcs/${repoId}/diff-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error('获取 Diff 内容失败')
  const data = await res.json()
  return data.content || ''
}

/* ========== 代码上下文 API ========== */

export type CodeContextMode = 'smart' | 'changes'

export interface CodeContextPayload {
  mode: CodeContextMode
  repos: CodeContextRepoItem[]
}

export interface CodeContextRepoItem {
  repoId: string
  keywords?: string[]
  files?: string[]
  directory?: string
  since?: string
  until?: string
  branch?: string
}

export async function extractKeywordsFromText(text: string, fileName?: string): Promise<string[]> {
  const res = await fetch(`${apiBase}/api/code-context/extract-keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, fileName }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.keywords || []
}

export async function smartSearchFiles(repoId: string, keywords: string[]): Promise<{ path: string; reason: string }[]> {
  const res = await fetch(`${apiBase}/api/code-context/smart-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, keywords }),
  })
  if (!res.ok) throw new Error('智能检索失败')
  const data = await res.json()
  return data.files || []
}

export async function listDirs(repoId: string, subDir = ''): Promise<string[]> {
  const res = await fetch(`${apiBase}/api/code-context/list-dirs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, subDir }),
  })
  if (!res.ok) throw new Error('获取目录失败')
  const data = await res.json()
  return data.dirs || []
}

/* ========== RAG ========== */

export async function fetchRagHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${apiBase}/api/rag/health`)
    return res.json()
  } catch {
    return { ok: false, error: '无法连接 RAG 服务' }
  }
}

export async function queryRag(query: string): Promise<string> {
  const res = await fetch(`${apiBase}/api/rag/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error('RAG 查询失败')
  const data = await res.json()
  return data.context || ''
}

/* ========== 预览增强 Prompt ========== */

export interface PreviewPromptResult {
  systemPrompt: string
  userPrompt: string
  meta: {
    codeChangeLength: number
    ragContextLength: number
    documentCount: number
    totalPromptChars: number
  }
}

export async function previewEnhancedPrompt(payload: {
  documents?: { name: string; text: string; role?: string }[]
  focusText?: string
  selectedTypes?: string[]
  depth?: string
  timezone?: string
  codeChanges?: CodeContextPayload
  ragQuery?: string
}): Promise<PreviewPromptResult> {
  const res = await fetch(`${apiBase}/api/preview-enhanced-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || '预览失败')
  }
  return res.json()
}

export async function generateTestPlan(payload: {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: string
  timezone: string
  llmProvider?: string
  llmModel?: string
}, options: { signal?: AbortSignal } = {}): Promise<TestPlanLedger> {
  const res = await fetch(`${apiBase}/api/generate-test-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  })
  const data = (await res.json().catch(() => null)) as { plan?: TestPlanLedger; error?: string } | null
  if (!res.ok) {
    throw new Error(data?.error || `生成测试计划失败 (${res.status})`)
  }
  if (!data?.plan) throw new Error('接口未返回测试计划')
  return data.plan
}

export interface TestPlanStreamCallbacks {
  onStreamOpen?: () => void
  onMeta?: (meta: { type: string; status?: string; provider?: string; promptChars?: number }) => void
  onProgress?: (info: { chars: number; elapsedSec: number }) => void
  onThinking?: (info: { text: string; totalChars: number }) => void
  onDelta: (text: string) => void
  onDone: (plan: TestPlanLedger, meta?: { provider?: string; promptChars?: number; outputChars?: number; streamed?: boolean }) => void
  onError: (msg: string, raw?: string) => void
}

export function streamGenerateTestPlan(payload: {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: string
  timezone: string
  llmProvider?: string
  llmModel?: string
}, callbacks: TestPlanStreamCallbacks): AbortController {
  const ac = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(`${apiBase}/api/generate-test-plan-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '网络请求失败')
      return
    }

    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      callbacks.onError(j?.error || `请求失败 (${res.status})`)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      callbacks.onError('浏览器不支持 ReadableStream')
      return
    }
    callbacks.onStreamOpen?.()
    const decoder = new TextDecoder()
    let buf = ''
    let currentEvent = ''
    let sawTerminal = false

    const consumeCompleteLines = (lines: string[]) => {
      for (const line of lines) {
        if (!line || line.startsWith(':')) continue
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
          continue
        }
        if (!line.startsWith('data: ')) continue
        let data: Record<string, unknown>
        try {
          data = JSON.parse(line.slice(6))
        } catch {
          continue
        }
        if (!currentEvent) continue
        switch (currentEvent) {
          case 'meta':
            callbacks.onMeta?.(data as { type: string; status?: string; provider?: string; promptChars?: number })
            break
          case 'progress':
            callbacks.onProgress?.(data as { chars: number; elapsedSec: number })
            break
          case 'thinking':
            callbacks.onThinking?.(data as { text: string; totalChars: number })
            break
          case 'delta':
            callbacks.onDelta(String(data.text ?? ''))
            break
          case 'done':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onDone(data.plan as TestPlanLedger, data.meta as { provider?: string; promptChars?: number; outputChars?: number; streamed?: boolean } | undefined)
            break
          case 'error':
          case 'parse_error':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onError(String(data.error || '生成测试点失败'), data.raw as string | undefined)
            break
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        buf += decoder.decode(value != null ? value : new Uint8Array(), { stream: !done })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        consumeCompleteLines(lines)
        if (done) break
      }
      buf += decoder.decode(new Uint8Array(), { stream: false })
      const tail = buf.split('\n')
      buf = tail.pop() ?? ''
      consumeCompleteLines(tail)
      if (!sawTerminal && !ac.signal.aborted) callbacks.onError('流式连接已结束但未收到完成事件。请重试。')
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '流读取异常')
    }
  })()

  return ac
}

/* ========== 增强流式生成 ========== */

export interface EnhancedGeneratePayload {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: string
  timezone: string
  llmProvider?: string
  /** 同 provider 多 model：从 ${PROVIDER}_MODELS 白名单中选；不传则用 .env 默认 model */
  llmModel?: string
  codeChanges?: CodeContextPayload
  ragQuery?: string
  usePipeline?: boolean
  generationMode?: 'fresh' | 'append'
  existingCases?: {
    module?: string
    subModule?: string
    summary?: string
    expected?: string
    priority?: string
    caseType?: string
  }[]
  batchTarget?: { min?: number; max?: number }
}

export interface PipelineProgressInfo {
  step: string
  status: string
  file?: string
  ok?: boolean
  progress?: string
  totalFiles?: number
  successCount?: number
  error?: string
}

export interface EnhancedStreamCallbacks {
  /** 已拿到响应体并开始读流 */
  onStreamOpen?: () => void
  /** meta 含 code_changes / rag_context / pipeline / stream_discard 等 */
  onMeta?: (meta: { type: string; length?: number; message?: string; status?: string; steps?: string[] }) => void
  onProgress?: (info: { chars: number; estimatedCases: number; elapsedSec: number }) => void
  /** 多步 Agent 流水线进度事件 */
  onPipelineProgress?: (info: PipelineProgressInfo) => void
  /** 推理模型（如 DeepSeek-Reasoner / V4-Pro）的思考过程进度；totalChars 为本次累计 reasoning 字符数 */
  onThinking?: (info: { text: string; totalChars: number }) => void
  onDelta: (text: string) => void
  onDone: (
    cases: unknown[],
    extra?: {
      interrupted?: boolean
      interruptReason?: string
      partial?: boolean
      qualityHints?: {
        actualCases?: number
        partialJson?: boolean
        rawChars?: number
        shortJsonRetry?: boolean
        provider?: string
      }
    },
  ) => void
  onError: (msg: string, raw?: string) => void
}

export function streamEnhancedGenerate(
  payload: EnhancedGeneratePayload,
  callbacks: EnhancedStreamCallbacks,
): AbortController {
  const ac = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(`${apiBase}/api/generate-enhanced-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '网络请求失败')
      return
    }

    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      callbacks.onError(j?.error || `请求失败 (${res.status})`)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      callbacks.onError('浏览器不支持 ReadableStream')
      return
    }
    callbacks.onStreamOpen?.()
    const decoder = new TextDecoder()
    let buf = ''
    let currentEvent = ''
    let sawTerminal = false

    const consumeCompleteLines = (lines: string[]) => {
      for (const line of lines) {
        if (!line || line.startsWith(':')) continue
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
          continue
        }
        if (!line.startsWith('data: ')) continue
        let data: Record<string, unknown>
        try {
          data = JSON.parse(line.slice(6))
        } catch {
          continue
        }
        if (!currentEvent) continue
        switch (currentEvent) {
          case 'meta':
            callbacks.onMeta?.(data as { type: string; length?: number; message?: string; status?: string; steps?: string[] })
            break
          case 'pipeline_progress':
            callbacks.onPipelineProgress?.(data as unknown as PipelineProgressInfo)
            break
          case 'progress':
            callbacks.onProgress?.(data as { chars: number; estimatedCases: number; elapsedSec: number })
            break
          case 'thinking':
            callbacks.onThinking?.(data as { text: string; totalChars: number })
            break
          case 'delta':
            callbacks.onDelta(data.text as string)
            break
          case 'done':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onDone(data.cases as unknown[], {
              interrupted: data.interrupted as boolean | undefined,
              interruptReason: data.interruptReason as string | undefined,
              partial: data.partial as boolean | undefined,
              qualityHints: data.qualityHints as
                | {
                    actualCases?: number
                    partialJson?: boolean
                    rawChars?: number
                    shortJsonRetry?: boolean
                    provider?: string
                  }
                | undefined,
            })
            break
          case 'error':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onError(data.error as string, data.raw as string | undefined)
            break
          case 'parse_error':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onError(data.error as string, data.raw as string | undefined)
            break
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        buf += decoder.decode(value != null ? value : new Uint8Array(), { stream: !done })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        consumeCompleteLines(lines)
        if (done) break
      }
      buf += decoder.decode(new Uint8Array(), { stream: false })
      const tail = buf.split('\n')
      buf = tail.pop() ?? ''
      consumeCompleteLines(tail)
      if (!sawTerminal && !ac.signal.aborted) {
        callbacks.onError('流式连接已结束但未收到完成事件。请重试。')
      }
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '流读取异常')
    }
  })()

  return ac
}

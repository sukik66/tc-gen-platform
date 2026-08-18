import type { DocumentRole } from '../types'
import type { TestDepth } from '../types'
import type { ContractVerifyMethod } from '../lib/contractDraftStore'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

/** 与后端契约 LLM 超时大致对齐（默认 16 分钟）；可用 VITE_GENERATE_CONTRACTS_TIMEOUT_MS 覆盖 */
const CONTRACT_FETCH_TIMEOUT_MS = Number(import.meta.env.VITE_GENERATE_CONTRACTS_TIMEOUT_MS) || 16 * 60 * 1000

const DEBUG_INGEST = String(import.meta.env.VITE_DEBUG_INGEST_URL || '').trim()

function looksLikeHtmlDocument(s: string): boolean {
  const head = s.trimStart().slice(0, 64).toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html')
}

function safeJsonParse(text: string): unknown | null {
  const t = text.trim()
  if (!t) return {}
  try {
    return JSON.parse(t) as unknown
  } catch {
    return null
  }
}

export interface ContractAiItem {
  moduleLabel: string
  rule: string
  boundaryHint: string
  priority: 'P0' | 'P1' | 'P2'
  verifyMethods: ContractVerifyMethod[]
  /** 为何选择上述验证方式（用户层 · 供 QA 审核），对齐 TesterHome #43886 理念 */
  verifyRationale: string
  /** 前端列表稳定 key（不入库、不传 API） */
  rowKey?: string
}

export interface GenerateContractsRequest {
  documents: { name: string; text: string; role?: DocumentRole }[]
  focusText?: string
  depth: TestDepth
  timezone?: string
  llmProvider?: string | null
}

export async function generateContractsFromDocuments(
  body: GenerateContractsRequest,
): Promise<ContractAiItem[]> {
  const fetchT0 = Date.now()
  const bodyBytes = new TextEncoder().encode(
    JSON.stringify({
      documents: body.documents,
      focusText: body.focusText || '',
      depth: body.depth,
      timezone: body.timezone || 'Asia/Shanghai',
      ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
    }),
  ).length
  // #region agent log
  if (DEBUG_INGEST) fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0083ad' },
    body: JSON.stringify({
      sessionId: '0083ad',
      hypothesisId: 'H3',
      location: 'generateContracts.ts:fetch_start',
      message: 'client_fetch_start',
      data: {
        apiBaseLen: apiBase.length,
        docCount: body.documents.length,
        approxBodyBytes: bodyBytes,
        timeoutMs: CONTRACT_FETCH_TIMEOUT_MS,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion

  const signal =
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === 'function'
      ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(CONTRACT_FETCH_TIMEOUT_MS)
      : undefined

  let res: Response
  try {
    res = await fetch(`${apiBase}/api/generate-contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        documents: body.documents,
        focusText: body.focusText || '',
        depth: body.depth,
        timezone: body.timezone || 'Asia/Shanghai',
        ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
      }),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    const msg = e instanceof Error ? e.message : String(e)
    if (name === 'TimeoutError' || /aborted|timeout/i.test(msg)) {
      throw new Error(
        `契约提取请求超时（前端等待超过 ${Math.round(CONTRACT_FETCH_TIMEOUT_MS / 60000)} 分钟）。QA 档生成条数多、耗时可较长；可改大环境变量 VITE_GENERATE_CONTRACTS_TIMEOUT_MS，或直接访问 API 端口避免代理限制。`,
      )
    }
    throw e
  }
  const rawText = await res.text()
  // #region agent log
  if (DEBUG_INGEST) fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0083ad' },
    body: JSON.stringify({
      sessionId: '0083ad',
      hypothesisId: 'H4',
      location: 'generateContracts.ts:after_response',
      message: 'client_fetch_response',
      data: {
        ms: Date.now() - fetchT0,
        httpStatus: res.status,
        bodyChars: rawText.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion

  // Cloudflare / 网关常返回整页 HTML（如 524），绝不能当 JSON 解析或塞进契约正文展示
  if (looksLikeHtmlDocument(rawText)) {
    if (res.status === 524) {
      throw new Error(
        '上游网关超时（HTTP 524）：契约生成超过 Cloudflare 等待上限，连接被断开。请稍后重试、缩短单次文档体量，或请管理员调大超时 / 改为异步生成（避免经 CDN 的长同步请求）。',
      )
    }
    if (res.status === 502 || res.status === 503) {
      throw new Error(
        `网关错误（HTTP ${res.status}）：多为反向代理/负载均衡在等待上游 API 时失败。请优先使用页面上的「流式提取」（SSE），或直连 API 端口、调大代理 read timeout；Claude 长 JSON 同步 POST 易被中间层断开。`,
      )
    }
    throw new Error(
      `服务器返回了 HTML 网页而非 JSON（HTTP ${res.status}），多为网关或反代错误页；请检查 API 地址与部署配置。`,
    )
  }

  const parsed = safeJsonParse(rawText)
  if (parsed === null) {
    throw new Error(
      res.ok
        ? '接口返回了非 JSON 内容，无法解析契约列表。'
        : `契约提取失败（HTTP ${res.status}），且响应体不是合法 JSON。`,
    )
  }

  const data = parsed as { contracts?: ContractAiItem[]; error?: string }

  if (!res.ok) {
    let apiErr =
      typeof data.error === 'string' && data.error.trim()
        ? data.error.trim().slice(0, 800)
        : `契约提取失败（HTTP ${res.status}）`
    if ((res.status === 502 || res.status === 503) && !looksLikeHtmlDocument(rawText)) {
      apiErr += ' — 建议改用流式接口 /generate-contracts-stream（页面默认已使用），或检查反代超时与 Claude 通道可用性。'
    }
    throw new Error(apiErr)
  }
  if (!Array.isArray(data.contracts) || data.contracts.length === 0) {
    throw new Error('未返回任何契约')
  }

  for (const c of data.contracts) {
    const rule = typeof c?.rule === 'string' ? c.rule : ''
    if (looksLikeHtmlDocument(rule)) {
      throw new Error(
        '返回的契约正文中疑似包含 HTML 错误页，已拒绝展示。通常为上游超时或代理把错误页写进了业务字段，请检查网关与模型响应。',
      )
    }
  }

  return data.contracts
}

export interface ContractStreamCallbacks {
  onStreamOpen?: () => void
  onDelta: (text: string) => void
  /** 服务端或本地解析到新的完整契约条数时触发 */
  onPreview?: (contracts: ContractAiItem[]) => void
  onDone: (contracts: ContractAiItem[], extra?: { interrupted?: boolean; partial?: boolean }) => void
  onError: (msg: string, raw?: string) => void
  /** 服务端心跳（每 5s），参数为已等待秒数；可用于更新前端计时 */
  onHeartbeat?: (elapsedSec: number) => void
}

/**
 * SSE 流式契约提取（推荐）。返回 AbortController，调用 .abort() 可取消。
 */
export function streamGenerateContracts(
  body: GenerateContractsRequest,
  callbacks: ContractStreamCallbacks,
): AbortController {
  const ac = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(`${apiBase}/api/generate-contracts-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: body.documents,
          focusText: body.focusText || '',
          depth: body.depth,
          timezone: body.timezone || 'Asia/Shanghai',
          ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
        }),
        signal: ac.signal,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '网络请求失败')
      return
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      if (looksLikeHtmlDocument(raw)) {
        callbacks.onError(
          res.status === 502 || res.status === 503
            ? `HTTP ${res.status}：网关返回了网页而非流式数据，多为反代超时或上游不可用。请直连 API 端口重试或调大 proxy_read_timeout。`
            : `HTTP ${res.status}：网关返回了 HTML 错误页。`,
          raw.slice(0, 500),
        )
      } else {
        const j = (() => {
          try {
            return JSON.parse(raw) as { error?: string }
          } catch {
            return null
          }
        })()
        callbacks.onError(j?.error || `契约流式请求失败（HTTP ${res.status}）`, raw.slice(0, 800))
      }
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
    /** event 与 data 可能被 TCP 分片到不同 read；必须在多次 read 之间保留 */
    let currentEvent = ''
    let sawTerminal = false

    const consumeCompleteLines = (lines: string[]) => {
      for (const line of lines) {
        if (!line) continue
        // 解析服务端心跳注释 `:heartbeat Ns`，通知外层更新等待时间
        if (line.startsWith(':heartbeat ')) {
          const sec = parseInt(line.slice(11), 10)
          if (!isNaN(sec)) callbacks.onHeartbeat?.(sec)
          continue
        }
        if (line.startsWith(':')) continue
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
          continue
        }
        if (!line.startsWith('data: ')) continue
        const rawLine = line.slice(6)
        let data: Record<string, unknown>
        try {
          data = JSON.parse(rawLine) as Record<string, unknown>
        } catch {
          continue
        }
        if (!currentEvent) continue
        switch (currentEvent) {
          case 'delta':
            callbacks.onDelta(String(data.text ?? ''))
            break
          case 'preview': {
            const arr = data.contracts
            if (Array.isArray(arr)) {
              callbacks.onPreview?.(arr as ContractAiItem[])
            }
            break
          }
          case 'done':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onDone((data.contracts as ContractAiItem[]) || [], {
              interrupted: data.interrupted as boolean | undefined,
              partial: data.partial as boolean | undefined,
            })
            break
          case 'error':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onError(String(data.error ?? '流式错误'), data.raw as string | undefined)
            break
          case 'parse_error':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onError(String(data.error ?? 'JSON 解析失败'), data.raw as string | undefined)
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
        callbacks.onError(
          '流式连接已结束但未收到完成事件（done / error）。多为网络中断或代理提前断开，请重试；若仍失败请打开开发者工具 Network 查看该请求是否被截断。',
        )
      }
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '流读取异常')
    }
  })()

  return ac
}

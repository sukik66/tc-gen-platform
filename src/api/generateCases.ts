import type { TestCase, TestDepth } from '../types'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export interface GeneratePayload {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: TestDepth
  timezone: string
  /** 覆盖服务端 LLM_PROVIDER，须已在 .env 配置该通道密钥 */
  llmProvider?: string
  /** 覆盖服务端 ${PROVIDER}_MODEL，必须在 ${PROVIDER}_MODELS 白名单内 */
  llmModel?: string
}

export async function generateTestCases(payload: GeneratePayload): Promise<TestCase[]> {
  const res = await fetch(`${apiBase}/api/generate-test-cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json()) as { cases?: TestCase[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`)
  }
  if (!data.cases?.length) {
    throw new Error('接口未返回用例数据')
  }
  return data.cases
}

/* ---------- 流式生成 ---------- */

export interface StreamDoneExtra {
  interrupted?: boolean
  interruptReason?: string
  partial?: boolean
}

export interface StreamCallbacks {
  /** 已拿到响应体并开始读流（首段 delta 可能尚未到达） */
  onStreamOpen?: () => void
  onDelta: (text: string) => void
  /** 推理模型（如 DeepSeek-Reasoner / V4-Pro）的思考过程 */
  onThinking?: (info: { text: string; totalChars: number }) => void
  onDone: (cases: TestCase[], extra?: StreamDoneExtra) => void
  /** parse_error 等会附带 raw 片段便于排查 */
  onError: (msg: string, raw?: string) => void
}

/**
 * 通过 SSE 流式获取大模型输出。
 * 返回 AbortController，外部调用 .abort() 即可取消。
 */
export function streamGenerateTestCases(
  payload: GeneratePayload,
  callbacks: StreamCallbacks,
): AbortController {
  const ac = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(`${apiBase}/api/generate-test-cases-stream`, {
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
      const j = await res.json().catch(() => null) as { error?: string } | null
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
        const raw = line.slice(6)
        let data: Record<string, unknown>
        try {
          data = JSON.parse(raw)
        } catch {
          continue
        }
        if (!currentEvent) continue
        switch (currentEvent) {
          case 'delta':
            callbacks.onDelta(data.text as string)
            break
          case 'thinking':
            callbacks.onThinking?.(data as { text: string; totalChars: number })
            break
          case 'done':
            if (sawTerminal) break
            sawTerminal = true
            callbacks.onDone(data.cases as TestCase[], {
              interrupted: data.interrupted as boolean | undefined,
              interruptReason: data.interruptReason as string | undefined,
              partial: data.partial as boolean | undefined,
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
        callbacks.onError(
          '流式连接已结束但未收到完成事件。多为网络或代理中断，请重试。',
        )
      }
    } catch (e) {
      if (ac.signal.aborted) return
      callbacks.onError(e instanceof Error ? e.message : '流读取异常')
    }
  })()

  return ac
}

export async function fetchApiHealth(providerId?: string): Promise<{
  ok: boolean
  provider?: string
  hint?: string
} | null> {
  try {
    const q = providerId?.trim() ? `?provider=${encodeURIComponent(providerId.trim())}` : ''
    const res = await fetch(`${apiBase}/api/health${q}`)
    if (!res.ok) return null
    return (await res.json()) as { ok: boolean; provider?: string; hint?: string }
  } catch {
    return null
  }
}

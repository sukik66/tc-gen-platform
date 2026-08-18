import { useState } from 'react'
import type { TestCase } from '../types'
import { normalizeCasesFromJson, repairLlmJson, stripMarkdownJsonFence } from '../lib/normalizeCasesFromJson'

interface CursorAssistPanelProps {
  /** 当前应复制到 Cursor 的完整 Markdown */
  buildClipboard: () => string
  onApplyCases: (cases: TestCase[]) => void
  /** 通过本面板「解析 JSON 追加」的用例数量（用于启用撤销按钮） */
  cursorAppendedCount: number
  /** 移除上述追加的用例，不影响示例用例与 API 生成结果 */
  onClearCursorAppended: () => void
  /** 本地 API 是否可用（仅文案提示） */
  apiOnline: boolean
}

export function CursorAssistPanel({
  buildClipboard,
  onApplyCases,
  cursorAppendedCount,
  onClearCursorAppended,
  apiOnline,
}: CursorAssistPanelProps) {
  const [pasted, setPasted] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyPrompt = async () => {
    const text = buildClipboard().trim()
    if (!text) {
      window.alert('请先上传并成功解析至少一份文档，再复制提示词。')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.alert('复制失败，请手动全选复制。')
    }
  }

  const [repaired, setRepaired] = useState(false)

  const applyPasted = () => {
    setLocalErr(null)
    setRepaired(false)
    try {
      const text = stripMarkdownJsonFence(pasted)
      let parsed: unknown
      let wasRepaired = false
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = repairLlmJson(text)
        if (parsed === null) {
          throw new Error('JSON 格式错误，自动修复也无法解析。请检查粘贴内容是否完整。')
        }
        wasRepaired = true
      }
      const cases = normalizeCasesFromJson(parsed)
      if (cases.length === 0) {
        setLocalErr('cases 数组为空')
        return
      }
      onApplyCases(cases)
      setPasted('')
      if (wasRepaired) setRepaired(true)
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
      <div className="mb-2 text-xs font-medium text-sky-200/90">Cursor 辅助（无需 API 密钥）</div>
      <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
        网页<strong>不能</strong>直接调用 Cursor 内置模型。请：① 复制下方提示词 → ② 粘贴到{' '}
        <strong>Cursor 聊天</strong> → ③ 将模型返回的纯 JSON 贴到文本框 → ④ 解析并追加。
        {apiOnline ? ' 若已配置本地 API，也可使用上方「API 生成」。' : ''}
      </p>
      <button
        type="button"
        onClick={() => void copyPrompt()}
        className="mb-2 w-full rounded-lg border border-sky-500/40 bg-sky-500/15 py-2 text-xs font-medium text-sky-100 hover:bg-sky-500/25"
      >
        {copied ? '已复制到剪贴板' : '复制完整提示词（给 Cursor）'}
      </button>
      <textarea
        className="mb-2 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2 py-2 font-mono text-[10px] text-zinc-300 outline-none focus:border-sky-500/40"
        rows={5}
        placeholder="将 Cursor 返回的 JSON 粘贴到此处（可含 ```json 围栏，会自动去掉）"
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
      />
      {localErr && (
        <p className="mb-2 text-[10px] text-red-300/90">{localErr}</p>
      )}
      {repaired && !localErr && (
        <p className="mb-2 text-[10px] text-amber-300/90">⚠ JSON 格式有误，已自动修复后解析成功。建议检查追加的用例是否完整。</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={applyPasted}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 py-2 text-xs text-zinc-200 hover:bg-white/10"
        >
          解析 JSON 并追加用例
        </button>
        <button
          type="button"
          disabled={cursorAppendedCount === 0}
          title={
            cursorAppendedCount === 0
              ? '暂无通过本面板追加的用例'
              : `移除 ${cursorAppendedCount} 条 Cursor 解析追加的用例`
          }
          onClick={() => {
            onClearCursorAppended()
            setLocalErr(null)
          }}
          className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-200/95 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          撤销 Cursor 追加
        </button>
      </div>
    </div>
  )
}

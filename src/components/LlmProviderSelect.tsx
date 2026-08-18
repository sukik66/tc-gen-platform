import type { UseLlmProviderResult } from '../hooks/useLlmProvider'

export type LlmProviderSelectVariant = 'teal' | 'violet' | 'neutral'

export interface LlmProviderSelectProps {
  /** 由 useLlmProvider() 返回的状态对象，整体透传，便于一次性传入 */
  state: UseLlmProviderResult
  /** 视觉主题，影响 focus 边框色；默认 neutral */
  variant?: LlmProviderSelectVariant
  /** 是否禁用（如生成中） */
  disabled?: boolean
  /** 显示在下拉上方的标签文本，默认「模型通道」 */
  label?: string
  /** 是否显示底部的就绪/未就绪提示文案；默认 true */
  showHints?: boolean
}

const FOCUS_BORDER: Record<LlmProviderSelectVariant, string> = {
  teal: 'focus:border-teal-500/50',
  violet: 'focus:border-violet-500/45',
  neutral: 'focus:border-zinc-400/40',
}

/**
 * LLM 通道选择 UI：provider 下拉 + 可选的 model 下拉 + 状态提示。
 *
 * 与 `useLlmProvider` 配套使用：
 *   const llm = useLlmProvider()
 *   <LlmProviderSelect state={llm} variant="teal" disabled={busy} />
 *
 * 多 model 行为：仅当当前 provider 的 availableModels.length >= 2 时显示 model 子下拉。
 */
export function LlmProviderSelect(props: LlmProviderSelectProps) {
  const {
    state,
    variant = 'neutral',
    disabled = false,
    label = '模型通道',
    showHints = true,
  } = props
  const {
    providers,
    selectedProvider,
    selectedModel,
    apiServerUp,
    current,
    setProvider,
    setModel,
  } = state

  const focus = FOCUS_BORDER[variant]
  const availableModels = current?.availableModels ?? []
  const showModelSelect = Boolean(current?.ready) && availableModels.length >= 2

  return (
    <div className="text-xs text-zinc-400">
      <label className="block">
        {label}
        <select
          value={selectedProvider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={disabled || providers.length === 0}
          className={`mt-1 block w-full rounded-lg border border-white/15 bg-[#14151f] px-2 py-1.5 text-xs text-zinc-200 outline-none ${focus}`}
        >
          {providers.length === 0 ? (
            <option value="">未连接本地 API</option>
          ) : (
            providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.ready ? '✓ ' : '✗ '}
                {p.label}（{p.id}）
                {!p.ready && p.hint ? `（${p.hint}）` : ''}
              </option>
            ))
          )}
        </select>
      </label>

      {showModelSelect && (
        <label className="mt-2 block">
          <span className="text-[10px] text-zinc-500">该通道支持多个模型</span>
          <select
            value={selectedModel || current?.model || ''}
            onChange={(e) => setModel(e.target.value)}
            disabled={disabled}
            aria-label="选择该通道下的具体模型"
            className={`mt-1 block w-full rounded-lg border border-white/15 bg-[#14151f] px-2 py-1.5 text-xs text-zinc-200 outline-none ${focus}`}
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === current?.model ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* 当前通道就绪但仅有单一 model 时，仍展示一行只读说明，保持信息一致 */}
      {showHints && current?.ready && availableModels.length < 2 && current.model && (
        <p className="mt-2 text-[10px] text-zinc-500">
          模型：<code className="text-zinc-300">{current.model}</code>
          <span className="ml-1 text-zinc-600">
            （单一 model；如需多模型可在 .env 中配 {String(current.id).toUpperCase()}_MODELS=xxx,yyy）
          </span>
        </p>
      )}

      {showHints && providers.length === 0 && apiServerUp === false && (
        <p className="mt-2 text-[10px] text-amber-200/85">
          未连接本地 API：可在工程根目录运行 npm run dev / dev:api 后再切换。
        </p>
      )}

      {showHints && current && !current.ready && (
        <p className="mt-2 text-[10px] text-amber-200/90">
          {current.hint ?? '通道未就绪，请配置对应密钥后重启 API'}
        </p>
      )}
    </div>
  )
}

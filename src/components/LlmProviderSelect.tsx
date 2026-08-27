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
 * Provider 就绪且存在模型时始终显示模型下拉；单模型通道显示唯一选项。
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
  const modelOptions = availableModels.length > 0
    ? availableModels
    : current?.model ? [current.model] : []
  const showModelSelect = Boolean(current?.ready) && modelOptions.length > 0

  return (
    <div className="text-xs text-zinc-400">
      <label className="block">
        {label}
        <select
          value={selectedProvider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={disabled || providers.length === 0}
          aria-label={label}
          data-testid="llm-provider-select"
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
          <span>模型</span>
          <select
            value={selectedModel || current?.model || ''}
            onChange={(e) => setModel(e.target.value)}
            disabled={disabled}
            aria-label="选择该通道下的具体模型"
            data-testid="llm-model-select"
            className={`mt-1 block w-full rounded-lg border border-white/15 bg-[#14151f] px-2 py-1.5 text-xs text-zinc-200 outline-none ${focus}`}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === current?.model ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </label>
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

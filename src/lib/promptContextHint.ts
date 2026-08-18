import type { LlmProviderOption } from '../api/llmProviders'

/** 与服务端 throwIfPromptExceedsSharedContext 一致的偏保守估算：字符 → 输入 token 上界 */
export function roughInputTokensHigh(totalPromptChars: number): number {
  return Math.ceil(Math.max(0, totalPromptChars) / 1.8)
}

/**
 * 生成前黄条：仅对「总上下文 = 输入 + 输出」类通道（如 Kimi）提示体量风险。
 */
export function buildPromptContextHint(
  provider: LlmProviderOption | undefined,
  totalPromptChars: number,
): string | null {
  if (!provider?.ready || provider.tokenBudget !== 'shared_context_window') return null
  const ctx = provider.sharedContextTokens
  if (!ctx) return null
  const rough = roughInputTokensHigh(totalPromptChars)
  const reserve = 256
  const model = provider.model ?? '当前模型'
  if (rough + reserve > ctx) {
    return `估算输入约 ${rough} tokens（提示总字符约 ${totalPromptChars.toLocaleString()}），已超过「${model}」总上下文约 ${ctx.toLocaleString()} tokens。请改用 kimi-k2.6 等大上下文模型、moonshot-v1-128k，或减少文档/关闭「代码变更」后再试。`
  }
  if (rough > ctx * 0.72) {
    return `提示体量较大：估算输入约 ${rough}/${ctx.toLocaleString()} tokens（${model}）。若生成失败请换更大上下文模型（如 kimi-k2.6）或缩短上下文。`
  }
  return null
}

/** 增强路径（代码/RAG）在未跑服务端预览时的保守附加开销上界（字符），用于 Kimi 体量黄条粗估 */
export const ENHANCED_PROMPT_OVERHEAD_CHARS_GUESS = 120_000

/** 无增强预览时：用文档字符 + 固定开销粗估总提示字符（普通流式 + Kimi） */
export function estimateSimplePromptChars(documents: { text: string }[], overheadChars = 22_000): number {
  const doc = documents.reduce((n, d) => n + (d.text?.length ?? 0), 0)
  return doc + overheadChars
}

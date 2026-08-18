const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export const LLM_PROVIDER_STORAGE_KEY = 'ai-test-platform.llmProvider'
/** 同 provider 多 model 时记录用户选择；key 形如 ai-test-platform.llmModel.deepseek */
export const LLM_MODEL_STORAGE_KEY_PREFIX = 'ai-test-platform.llmModel.'

export interface LlmProviderOption {
  id: string
  label: string
  ready: boolean
  hint?: string
  /** OpenAI 兼容通道：当前 .env 解析到的默认模型 id（无密钥时可能无） */
  model?: string
  /** 同 provider 多 model：在 .env 配置 ${PROVIDER}_MODELS=a,b,c 后此字段返回；首项为默认 model */
  availableModels?: string[]
  /** 与 server/llm/providers.js 中 tokenBudget 一致 */
  tokenBudget?: 'completion_independent' | 'shared_context_window'
  /** tokenBudget 为 shared 时：按模型名推断的总上下文 token 上限 */
  sharedContextTokens?: number
}

export interface LlmProviderListResponse {
  serverDefaultProvider: string
  providers: LlmProviderOption[]
}

export async function fetchLlmProviderList(
  timeoutMs = 12_000,
): Promise<LlmProviderListResponse | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBase}/api/llm-providers`, { signal: ctl.signal })
    if (!res.ok) return null
    return (await res.json()) as LlmProviderListResponse
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function readStoredLlmProvider(): string | null {
  try {
    return localStorage.getItem(LLM_PROVIDER_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeStoredLlmProvider(id: string) {
  try {
    localStorage.setItem(LLM_PROVIDER_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

export function readStoredLlmModel(providerId: string): string | null {
  try {
    return localStorage.getItem(LLM_MODEL_STORAGE_KEY_PREFIX + providerId)
  } catch {
    return null
  }
}

export function writeStoredLlmModel(providerId: string, model: string) {
  try {
    localStorage.setItem(LLM_MODEL_STORAGE_KEY_PREFIX + providerId, model)
  } catch {
    /* ignore */
  }
}

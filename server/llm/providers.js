/**
 * LLM_PROVIDER 与各厂商环境变量映射（OpenAI 兼容通道统一走 openai SDK）
 * 官方 Base URL / 模型名以各云文档为准，此处为常用默认值，可通过环境变量覆盖。
 */

export const GEMINI_PROVIDER = 'gemini'

/**
 * max_tokens 与 prompt 的关系说明见同目录 `TOKEN_BUDGETS.md`。
 * 新增通道：在 OPENAI_COMPATIBLE 写 `tokenBudget`，并在该文档登记官方依据链接。
 *
 * 多模型支持：每个 provider 可在 `${MODELS_ENV}` 配置 CSV 列表（如 DEEPSEEK_MODELS=deepseek-v4-pro,deepseek-v4-flash），
 * 前端将以下拉框形式展示。前端选定后通过 `llmModel` 字段回传，后端按白名单校验后覆盖默认 model。
 * 未配置 `${MODELS_ENV}` 时退化为单 model 模式（现有行为）。
 *
 * @typedef {{ keyEnv: string; baseEnv: string; baseDefault: string; modelEnv: string; modelsEnv?: string; modelDefault: string; label: string; maxTokens?: number; requiresModel?: boolean; tokenBudget?: 'completion_independent' | 'shared_context_window'; tokenBudgetNote?: string }} OpenAiCompatProviderConfig
 */

/** @type {Record<string, OpenAiCompatProviderConfig>} */
export const OPENAI_COMPATIBLE = {
  openai: {
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    baseEnv: 'OPENAI_BASE_URL',
    baseDefault: 'https://api.openai.com/v1',
    modelEnv: 'OPENAI_MODEL',
    modelsEnv: 'OPENAI_MODELS',
    modelDefault: 'gpt-5.4',
    maxTokens: 16384,
    tokenBudget: 'completion_independent',
  },
  /** 官方 Claude OpenAI SDK 兼容层：https://platform.claude.com/docs/en/api/openai-sdk */
  anthropic: {
    label: 'Anthropic Claude（OpenAI 兼容）',
    keyEnv: 'ANTHROPIC_API_KEY',
    baseEnv: 'ANTHROPIC_BASE_URL',
    baseDefault: 'https://api.anthropic.com/v1',
    modelEnv: 'ANTHROPIC_MODEL',
    modelsEnv: 'ANTHROPIC_MODELS',
    modelDefault: 'claude-sonnet-4-6',
    /** 与 openai 默认对齐：增强用例 JSON 较长，8192 易 finish_reason=length 截断 */
    maxTokens: 16384,
    tokenBudget: 'completion_independent',
  },
  qwen: {
    label: '阿里通义 Qwen（DashScope 兼容模式）',
    keyEnv: 'QWEN_API_KEY',
    baseEnv: 'QWEN_BASE_URL',
    baseDefault: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelEnv: 'QWEN_MODEL',
    modelsEnv: 'QWEN_MODELS',
    modelDefault: 'qwen-turbo',
    maxTokens: 8192,
    tokenBudget: 'completion_independent',
  },
  ernie: {
    label: '百度文心 ERNIE（千帆 OpenAI 兼容）',
    keyEnv: 'ERNIE_API_KEY',
    baseEnv: 'ERNIE_BASE_URL',
    baseDefault: 'https://qianfan.baidubce.com/v2',
    modelEnv: 'ERNIE_MODEL',
    modelsEnv: 'ERNIE_MODELS',
    modelDefault: 'ernie-4.0-8k',
    maxTokens: 8192,
    tokenBudget: 'completion_independent',
    tokenBudgetNote: '若遇「总 token 超限」类 400，再在 TOKEN_BUDGETS.md 核对后改为 shared_context_window',
  },
  doubao: {
    label: '字节豆包（火山方舟 Ark）',
    keyEnv: 'DOUBAO_API_KEY',
    baseEnv: 'DOUBAO_BASE_URL',
    baseDefault: 'https://ark.cn-beijing.volces.com/api/v3',
    modelEnv: 'DOUBAO_MODEL',
    modelsEnv: 'DOUBAO_MODELS',
    modelDefault: '',
    maxTokens: 4096,
    requiresModel: true,
    tokenBudget: 'completion_independent',
  },
  glm: {
    label: '智谱 GLM',
    keyEnv: 'GLM_API_KEY',
    baseEnv: 'GLM_BASE_URL',
    baseDefault: 'https://open.bigmodel.cn/api/paas/v4',
    modelEnv: 'GLM_MODEL',
    modelsEnv: 'GLM_MODELS',
    modelDefault: 'glm-4-flash',
    maxTokens: 4096,
    tokenBudget: 'completion_independent',
  },
  minimax: {
    label: 'MiniMax',
    keyEnv: 'MINIMAX_API_KEY',
    baseEnv: 'MINIMAX_BASE_URL',
    baseDefault: 'https://api.minimax.chat/v1',
    modelEnv: 'MINIMAX_MODEL',
    modelsEnv: 'MINIMAX_MODELS',
    modelDefault: 'abab6.5s-chat',
    maxTokens: 8192,
    tokenBudget: 'completion_independent',
  },
  kimi: {
    label: '月之暗面 Kimi（Moonshot）',
    keyEnv: 'KIMI_API_KEY',
    baseEnv: 'KIMI_BASE_URL',
    baseDefault: 'https://api.moonshot.cn/v1',
    modelEnv: 'KIMI_MODEL',
    modelsEnv: 'KIMI_MODELS',
    /** 默认 kimi-k2.6：Moonshot OpenAPI 列出的模型 id，约 256k 总上下文（见 TOKEN_BUDGETS.md 链接） */
    modelDefault: 'kimi-k2.6',
    maxTokens: 8192,
    tokenBudget: 'shared_context_window',
    tokenBudgetNote: 'Moonshot Chat API：输入+max_tokens 不得超过模型上下文',
  },
  deepseek: {
    label: 'DeepSeek',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseEnv: 'DEEPSEEK_BASE_URL',
    baseDefault: 'https://api.deepseek.com/v1',
    modelEnv: 'DEEPSEEK_MODEL',
    modelsEnv: 'DEEPSEEK_MODELS',
    modelDefault: 'deepseek-reasoner',
    /** V4/V4-pro 输出上限约 16K；reasoner 上限更高；8192 对 V4-pro 容易截断用例 JSON */
    maxTokens: 16384,
    tokenBudget: 'completion_independent',
  },
}

/**
 * 解析 `${MODELS_ENV}` 环境变量为去重后的可选 model 列表。
 * 格式支持 CSV / 多空格分隔；`default` 始终位列第一（无重复）。
 * @param {string | undefined} modelsEnv
 * @param {string} defaultModel
 * @returns {string[]}
 */
function parseAvailableModels(modelsEnv, defaultModel) {
  const raw = (modelsEnv && process.env[modelsEnv]) || ''
  const list = String(raw)
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out = []
  if (defaultModel) out.push(defaultModel)
  for (const m of list) {
    if (!out.includes(m)) out.push(m)
  }
  return out
}

export const DEFAULT_MAX_TOKENS = 8192

/**
 * 从模型 id 推断「总上下文」上限（用于 shared_context_window；命名含 8k/32k/128k 的常见于 Moonshot/部分国产模型）
 */
/**
 * OpenAI 兼容请求体中的 temperature。
 * Moonshot 对 kimi-k2.5 / kimi-k2.6 等返回「only 1 is allowed for this model」时需固定为 1。
 * @param {string} providerId
 * @param {string} model
 * @param {number} preferred 其它通道使用的温度
 */
export function openAiCompatTemperature(providerId, model, preferred) {
  const pid = String(providerId || '').trim().toLowerCase()
  const m = String(model || '')
  if (pid === 'kimi' && /\bkimi-k2\.(?:5|6)\b/i.test(m)) return 1
  return preferred
}

export function inferSharedContextWindowTokens(model) {
  const m = String(model || '')
  /** Kimi K2.5 / K2.6：官方 Chat API 模型列表为 kimi-k2.5、kimi-k2.6，文档标注约 256k 总上下文 */
  if (/\bkimi-k2\.(?:5|6)\b/i.test(m)) return 262144
  /** Kimi K2 预览/思考等：未带 8k/32k/128k 后缀时保守按 128k 档估算，避免把窗口当成 32k 误拦 */
  if (/\bkimi-k2/i.test(m)) return 131072
  if (/128k/i.test(m)) return 131072
  if (/32k/i.test(m)) return 32768
  if (/8k/i.test(m)) return 8192
  return 32768
}

/**
 * 按通道策略计算实际可用的 max_tokens。
 * @param {string} providerId openai | kimi | …
 * @param {string} model
 * @param {number} configuredMax OPENAI_COMPATIBLE[].maxTokens 等配置值
 * @param {number} approxPromptChars messages 近似总字符数
 */
export function effectiveMaxCompletionTokens(providerId, model, configuredMax, approxPromptChars) {
  const pid = String(providerId || '').trim().toLowerCase()
  const cfg = OPENAI_COMPATIBLE[pid]
  const mode = cfg?.tokenBudget || 'completion_independent'
  if (mode !== 'shared_context_window') return configuredMax

  const contextTotal = inferSharedContextWindowTokens(model)
  const roughPromptTokens = Math.ceil(Math.max(0, approxPromptChars) / 2)
  const reserved = 128
  const capByContext = contextTotal - roughPromptTokens - reserved
  return Math.max(256, Math.min(configuredMax, capByContext))
}

/**
 * shared_context_window：仅压 max_tokens **不能**解决「输入已超过总上下文」。
 * 用略偏保守的 chars→tokens 上界在发请求前拦截，避免 Moonshot 返回难读的 400。
 * @param {number} [minCompletionTokens] 至少留给输出的 token 预算
 */
export function throwIfPromptExceedsSharedContext(
  providerId,
  model,
  approxPromptChars,
  minCompletionTokens = 256,
) {
  const pid = String(providerId || '').trim().toLowerCase()
  const cfg = OPENAI_COMPATIBLE[pid]
  if (!cfg || (cfg.tokenBudget || 'completion_independent') !== 'shared_context_window') return

  const ctx = inferSharedContextWindowTokens(model)
  const roughInHigh = Math.ceil(Math.max(0, approxPromptChars) / 1.8)
  if (roughInHigh + minCompletionTokens <= ctx) return

  const m = String(model || '')
  const kimiHint = (() => {
    if (/\bkimi-k2\.(?:5|6)\b/i.test(m)) {
      return '当前已为 Kimi K2 大上下文窗口（约 256k），请减少上传文档、关闭「代码变更/关联代码」或调低详细程度以缩短输入。'
    }
    if (/128k/i.test(m) || /\bkimi-k2/i.test(m)) {
      return '当前已为较大上下文窗口，请减少上传文档、关闭「代码变更/关联代码」或调低详细程度以缩短输入。'
    }
    if (/32k/i.test(m)) {
      return '请将 .env 中 KIMI_MODEL 改为 kimi-k2.6 或 moonshot-v1-128k，或减少上传文档/关闭「代码变更」等以缩短上下文。'
    }
    return '请将 .env 中 KIMI_MODEL 改为 kimi-k2.6、moonshot-v1-32k 或 moonshot-v1-128k，或减少上传文档/关闭「代码变更」等以缩短上下文。'
  })()
  const hint = pid === 'kimi' ? kimiHint : '请换用更大上下文的模型，或缩短输入。'
  throw new Error(
    `「${cfg.label}」当前模型总上下文约 ${ctx} tokens（按模型名推断），估算输入约 ${roughInHigh}+ tokens，已超过可用空间（需保留至少 ${minCompletionTokens} tokens 用于生成）。${hint}`,
  )
}

/** @deprecated 请用 effectiveMaxCompletionTokens('kimi', …) */
export function clampKimiCompletionTokens(model, configuredMax, approxPromptChars) {
  return effectiveMaxCompletionTokens('kimi', model, configuredMax, approxPromptChars)
}

export const MOCK_PROVIDER = 'mock'

export const ALL_LLM_PROVIDERS = [
  GEMINI_PROVIDER,
  ...Object.keys(OPENAI_COMPATIBLE),
  MOCK_PROVIDER,
]

export function isKnownLlmProvider(id) {
  const p = String(id || '').trim().toLowerCase()
  return ALL_LLM_PROVIDERS.includes(p)
}

export function providerDisplayLabel(id) {
  const p = String(id || '').trim().toLowerCase()
  if (p === GEMINI_PROVIDER) return 'Google Gemini'
  if (p === MOCK_PROVIDER) return 'Mock（模拟数据）'
  return OPENAI_COMPATIBLE[p]?.label ?? p
}

/**
 * 部分中转（如 Apifox 文档说明）控制台只给「根域名」，OpenAI SDK 实际需要 …/v1。
 * 仅当 URL 路径为空或仅为「/」时自动补 `/v1`；已有路径（含 /v1、/v2 等）不改动。
 * @param {string} providerId  openai | qwen | kimi | minimax | deepseek 等走 /v1 的通道
 * @param {string} raw
 */
export function normalizeOpenAiStyleBaseURL(providerId, raw) {
  const pid = String(providerId || '').trim().toLowerCase()
  /** 默认基址以 /v1 结尾的 OpenAI 兼容通道 */
  const v1Style = new Set(['openai', 'anthropic', 'qwen', 'kimi', 'minimax', 'deepseek'])
  let u = String(raw || '').trim().replace(/\/+$/, '')
  if (!u || !v1Style.has(pid)) return u
  try {
    const parsed = new URL(u)
    const path = parsed.pathname === '' ? '/' : parsed.pathname
    if (path === '/' || path === '') return `${parsed.origin}/v1`
    return u
  } catch {
    return u
  }
}

/** 供前端展示：各通道是否已在 .env 配好密钥 */
export function listLlmProviderOptions() {
  const envDefault = (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
  const serverDefaultProvider = ALL_LLM_PROVIDERS.includes(envDefault)
    ? envDefault
    : 'openai'
  const providers = ALL_LLM_PROVIDERS.map((pid) => {
    const h = healthForProvider(pid)
    const base = {
      id: pid,
      label: providerDisplayLabel(pid),
      ready: h.ok,
      hint: h.ok ? undefined : h.hint,
    }
    if (h.ok && OPENAI_COMPATIBLE[pid]) {
      const r = resolveOpenAiCompatible(pid)
      if (r.ok) {
        base.model = r.model
        base.tokenBudget = OPENAI_COMPATIBLE[pid].tokenBudget || 'completion_independent'
        if (base.tokenBudget === 'shared_context_window') {
          base.sharedContextTokens = inferSharedContextWindowTokens(r.model)
        }
        const cfg = OPENAI_COMPATIBLE[pid]
        const list = parseAvailableModels(cfg.modelsEnv, r.model)
        /* 当列表多于 1 项才返回，避免前端给单 model provider 显示多余下拉 */
        if (list.length > 1) base.availableModels = list
      }
    }
    return base
  })
  return { serverDefaultProvider, providers }
}

/**
 * @param {string} id
 * @param {string} [modelOverride] 前端传入的 model；必须命中 `${MODELS_ENV}` 白名单或恰好等于默认 model，否则忽略
 * @returns {{ ok: true, kind: 'openai-compatible', id: string, label: string, apiKey: string, baseURL: string, model: string, maxTokens: number } | { ok: false, id: string, label: string, hint: string, keyEnv?: string }}
 */
export function resolveOpenAiCompatible(id, modelOverride) {
  const key = String(id || '').trim().toLowerCase()
  const cfg = OPENAI_COMPATIBLE[key]
  if (!cfg) {
    return {
      ok: false,
      id: key,
      label: key,
      hint: `未知的 LLM_PROVIDER「${key}」。可选：${ALL_LLM_PROVIDERS.join(', ')}`,
    }
  }
  const apiKey = process.env[cfg.keyEnv]
  if (!apiKey || !String(apiKey).trim()) {
    return {
      ok: false,
      id: key,
      label: cfg.label,
      keyEnv: cfg.keyEnv,
      hint: `未配置 ${cfg.keyEnv}`,
    }
  }
  const baseURL = normalizeOpenAiStyleBaseURL(
    key,
    (process.env[cfg.baseEnv] || cfg.baseDefault || '').replace(/\/$/, ''),
  )
  const defaultModel = (process.env[cfg.modelEnv] || cfg.modelDefault || '').trim()
  const allowList = parseAvailableModels(cfg.modelsEnv, defaultModel)
  const overrideTrim = String(modelOverride || '').trim()
  /* override 必须在白名单里才生效，防止前端注入未授权模型名（按 .env 显式声明为准） */
  const model = overrideTrim && allowList.includes(overrideTrim)
    ? overrideTrim
    : defaultModel
  if (cfg.requiresModel && !model) {
    return {
      ok: false,
      id: key,
      label: cfg.label,
      keyEnv: cfg.modelEnv,
      hint: `未配置 ${cfg.modelEnv}（火山方舟需填写推理接入点 ID）`,
    }
  }
  if (!model) {
    return {
      ok: false,
      id: key,
      label: cfg.label,
      keyEnv: cfg.modelEnv,
      hint: `未配置 ${cfg.modelEnv}`,
    }
  }
  return {
    ok: true,
    kind: 'openai-compatible',
    id: key,
    label: cfg.label,
    apiKey,
    baseURL,
    model,
    maxTokens: cfg.maxTokens || DEFAULT_MAX_TOKENS,
  }
}

/**
 * @param {string} id
 */
export function resolveGemini(id) {
  const key = String(id || '').trim().toLowerCase()
  if (key !== GEMINI_PROVIDER) {
    return { ok: false, hint: '内部错误：非 gemini' }
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      id: 'gemini',
      label: 'Google Gemini',
      hint: '未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）',
    }
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  return { ok: true, kind: 'gemini', id: 'gemini', label: 'Google Gemini', apiKey, model }
}

/**
 * @param {string} providerId
 */
export function healthForProvider(providerId) {
  const p = String(providerId || 'openai').trim().toLowerCase()
  if (p === MOCK_PROVIDER) {
    return { ok: true, provider: 'mock', label: 'Mock（模拟数据）' }
  }
  if (p === GEMINI_PROVIDER) {
    const r = resolveGemini(p)
    if (!r.ok) {
      return { ok: false, provider: 'gemini', hint: r.hint }
    }
    return { ok: true, provider: 'gemini', label: r.label }
  }
  const r = resolveOpenAiCompatible(p)
  if (!r.ok) {
    return { ok: false, provider: p, hint: r.hint }
  }
  return { ok: true, provider: p, label: r.label }
}

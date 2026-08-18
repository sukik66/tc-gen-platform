/** OpenAI 兼容通道可选调试日志（不打印密钥） */

export function isDebugLlm() {
  const v = String(process.env.DEBUG_LLM ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 仅用于调试：origin + pathname，不含 query/hash */
export function safeBaseUrlLabel(baseURL) {
  try {
    const u = new URL(baseURL)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '') || baseURL
  } catch {
    return '(invalid-base-url)'
  }
}

export function logLlmDebug(tag, payload) {
  if (!isDebugLlm()) return
  console.info(`[DEBUG_LLM] ${tag}`, payload)
}

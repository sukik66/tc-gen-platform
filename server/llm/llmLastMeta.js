/**
 * 内存中保留最近一次 OpenAI 兼容调用的排障摘要（不含密钥、不含提示词正文）。
 * 供 GET /api/llm-last-meta 与前端「浏览器查看」链接使用。
 */

/** @type {null | Record<string, unknown>} */
let last = null

/** @param {Record<string, unknown>} payload */
export function setLastOpenAiCompatibleMeta(payload) {
  last = {
    updatedAt: new Date().toISOString(),
    ...payload,
  }
}

export function getLastOpenAiCompatibleMeta() {
  return last
}

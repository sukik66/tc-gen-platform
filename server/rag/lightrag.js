/**
 * LightRAG HTTP 客户端
 * 调用 LightRAG 服务的 REST API 获取检索上下文
 */

const BASE_URL = process.env.LIGHTRAG_URL || 'http://127.0.0.1:6002'
const TIMEOUT = 60_000

/**
 * 查询知识库，返回检索到的上下文（不让 RAG 生成回答）
 * @param {string} query 查询文本
 * @param {object} opts
 * @param {string} opts.mode 查询模式 local|global|hybrid|naive|mix
 * @param {number} opts.topK 最大检索数量
 * @param {string[]} opts.hlKeywords 高级关键词
 * @param {string[]} opts.llKeywords 低级关键词
 * @returns {Promise<string>} 检索到的上下文文本
 */
export async function queryContext(query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    only_need_context: true,
    top_k: opts.topK || 60,
  }
  if (opts.hlKeywords?.length) body.hl_keywords = opts.hlKeywords
  if (opts.llKeywords?.length) body.ll_keywords = opts.llKeywords

  const resp = await fetch(`${BASE_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LightRAG query failed (${resp.status}): ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  return typeof data.response === 'string' ? data.response : JSON.stringify(data)
}

/**
 * 向知识库插入文档
 * @param {string} text 文档文本
 * @param {string} description 文档描述/标题
 * @returns {Promise<object>}
 */
export async function insertDocument(text, description) {
  const resp = await fetch(`${BASE_URL}/documents/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, description }),
    signal: AbortSignal.timeout(TIMEOUT * 3),
  })

  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`LightRAG insert failed (${resp.status}): ${t.slice(0, 200)}`)
  }
  return resp.json()
}

/**
 * 检查 LightRAG 服务健康状态
 */
export async function checkHealth() {
  try {
    const resp = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
    const data = await resp.json()
    return { ok: data.status === 'healthy', data }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

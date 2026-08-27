/**
 * LightRAG HTTP 客户端
 * 调用 LightRAG 服务的 REST API 获取检索上下文
 */

const TIMEOUT = 60_000

function safePath(value, fallback) {
  const text = String(value || fallback).trim()
  return text.startsWith('/') ? text : `/${text}`
}

function connector(overrides = {}) {
  const provider = overrides.provider === 'llm-wiki' || overrides.provider === 'lightrag'
    ? overrides.provider
    : process.env.KNOWLEDGE_PROVIDER === 'llm-wiki' ? 'llm-wiki' : 'lightrag'
  const configuredUrl = provider === 'llm-wiki'
    ? process.env.LLM_WIKI_URL || 'http://127.0.0.1:3000'
    : process.env.LIGHTRAG_URL || 'http://127.0.0.1:6002'
  const parsed = new URL(String(overrides.url || configuredUrl))
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('知识库地址仅支持 HTTP 或 HTTPS')
  return {
    provider,
    baseUrl: parsed.toString().replace(/\/$/, ''),
    queryPath: safePath(overrides.queryPath || process.env.LLM_WIKI_QUERY_PATH, provider === 'llm-wiki' ? '/api/search' : '/query'),
    healthPath: safePath(overrides.healthPath || process.env.LLM_WIKI_HEALTH_PATH, provider === 'llm-wiki' ? '/api/health' : '/health'),
    apiKey: String(overrides.apiKey || process.env.LLM_WIKI_API_KEY || '').trim(),
  }
}

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
  const target = connector(opts)
  const body = {
    query,
    mode: opts.mode || 'mix',
    only_need_context: true,
    top_k: opts.topK || 60,
  }
  if (opts.hlKeywords?.length) body.hl_keywords = opts.hlKeywords
  if (opts.llKeywords?.length) body.ll_keywords = opts.llKeywords

  const resp = await fetch(`${target.baseUrl}${target.queryPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${target.provider} query failed (${resp.status}): ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  const candidate = data.context ?? data.response ?? data.answer ?? data.data?.context ?? data.data?.answer ?? data.data
  return typeof candidate === 'string' ? candidate : JSON.stringify(candidate ?? data)
}

/**
 * 向知识库插入文档
 * @param {string} text 文档文本
 * @param {string} description 文档描述/标题
 * @returns {Promise<object>}
 */
export async function insertDocument(text, description) {
  const target = connector()
  if (target.provider !== 'lightrag') throw new Error('llm-wiki 连接器当前仅用于检索，不支持从本平台写入')
  const resp = await fetch(`${target.baseUrl}/documents/text`, {
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
export async function checkHealth(overrides = {}) {
  try {
    const target = connector(typeof overrides === 'string' ? { url: overrides } : overrides)
    const resp = await fetch(`${target.baseUrl}${target.healthPath}`, {
      headers: target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
    const data = await resp.json().catch(() => ({}))
    const explicitlyUnhealthy = data.status && !['healthy', 'ok', 'ready'].includes(String(data.status).toLowerCase())
    return { ok: !explicitlyUnhealthy, provider: target.provider, data }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

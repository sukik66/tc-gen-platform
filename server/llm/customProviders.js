import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_FILE = path.join(__dirname, '..', 'data', 'custom-providers.json')

function safeString(value, max = 4096) {
  return String(value ?? '').replace(/[\r\n]/g, '').trim().slice(0, max)
}

function readStore() {
  if (!fs.existsSync(STORE_FILE)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStore(items) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
  fs.writeFileSync(STORE_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
}

function secretStatus(value) {
  const text = safeString(value)
  if (!text) return { configured: false, preview: '' }
  if (text.length <= 8) return { configured: true, preview: '••••••••' }
  return { configured: true, preview: `${text.slice(0, 3)}••••${text.slice(-3)}` }
}

function parseHeaders(value) {
  const headers = {}
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const name = line.slice(0, index).trim()
    const headerValue = line.slice(index + 1).trim()
    if (name && headerValue) headers[name] = headerValue
  }
  return headers
}

function normalizeModels(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,，;；\n]+/)
  const models = []
  for (const item of values) {
    const model = safeString(typeof item === 'string' ? item : item?.id, 200)
    if (model && !models.includes(model)) models.push(model)
    if (models.length >= 200) break
  }
  return models
}

function normalize(input, previous = null) {
  const id = safeString(input.id || previous?.id, 80).toLowerCase()
  if (!/^custom-[a-z0-9_-]+$/.test(id)) throw new Error('自定义 Provider 标识必须以 custom- 开头，且仅包含字母、数字、短横线或下划线')
  const name = safeString(input.name, 120)
  if (!name) throw new Error('供应商名称不能为空')
  const endpoint = safeString(input.endpoint, 2048).replace(/\/$/, '')
  if (!endpoint) throw new Error('供应商 URL 不能为空')
  const parsed = new URL(endpoint)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('供应商 URL 仅支持 HTTP 或 HTTPS')

  const apiKeyInput = safeString(input.apiKey)
  const apiKey = apiKeyInput || previous?.apiKey || ''
  if (!apiKey) throw new Error('API Key 不能为空')
  const hasModelsInput = Object.prototype.hasOwnProperty.call(input, 'models')
  const requestedModel = safeString(input.model, 200)
  const models = hasModelsInput
    ? normalizeModels(input.models)
    : normalizeModels(requestedModel || previous?.models || previous?.model)
  if (requestedModel && !models.includes(requestedModel)) models.unshift(requestedModel)
  const model = requestedModel || models[0] || ''
  return {
    id,
    name,
    enabled: input.enabled !== false,
    apiMode: input.apiMode === 'anthropic' ? 'anthropic' : 'openai',
    endpoint,
    apiKey,
    model,
    models,
    contextWindow: Math.min(1_048_576, Math.max(4096, Number(input.contextWindow) || 131072)),
    streaming: input.streaming !== false,
    customHeaders: String(input.customHeaders ?? '').slice(0, 8192),
    timeoutMinutes: Math.min(120, Math.max(1, Number(input.timeoutMinutes) || 30)),
    reasoning: ['auto', 'on', 'off'].includes(input.reasoning) ? input.reasoning : 'auto',
    updatedAt: new Date().toISOString(),
    createdAt: previous?.createdAt || new Date().toISOString(),
  }
}

export function listCustomProviders({ includeSecrets = false } = {}) {
  return readStore().map((item) => includeSecrets
    ? { ...item }
    : { ...item, apiKey: secretStatus(item.apiKey) })
}

export function getCustomProvider(id, { includeSecrets = true } = {}) {
  const item = readStore().find((provider) => provider.id === String(id || '').trim().toLowerCase())
  if (!item) return null
  return includeSecrets ? { ...item } : { ...item, apiKey: secretStatus(item.apiKey) }
}

export function saveCustomProvider(input) {
  const items = readStore()
  const index = items.findIndex((provider) => provider.id === String(input.id || '').trim().toLowerCase())
  const next = normalize(input, index >= 0 ? items[index] : null)
  if (index >= 0) items[index] = next
  else items.push(next)
  writeStore(items)
  return { ...next, apiKey: secretStatus(next.apiKey) }
}

export function removeCustomProvider(id) {
  const key = String(id || '').trim().toLowerCase()
  const items = readStore()
  const next = items.filter((provider) => provider.id !== key)
  if (next.length === items.length) return false
  writeStore(next)
  return true
}

export function resolveCustomProvider(id, modelOverride) {
  const provider = getCustomProvider(id)
  if (!provider) return null
  if (!provider.enabled) return { ok: false, id: provider.id, label: provider.name, hint: 'Provider 已停用' }
  if (!provider.model) return { ok: false, id: provider.id, label: provider.name, hint: '未配置模型 ID' }
  const availableModels = normalizeModels(provider.models?.length ? provider.models : provider.model)
  const requestedModel = safeString(modelOverride, 200)
  const model = requestedModel && availableModels.includes(requestedModel)
    ? requestedModel
    : provider.model
  return {
    ok: true,
    kind: 'openai-compatible',
    id: provider.id,
    label: provider.name,
    apiKey: provider.apiKey || 'local-no-key',
    baseURL: provider.endpoint,
    model,
    maxTokens: Math.max(1024, Math.min(16384, Math.floor(provider.contextWindow / 8))),
    defaultHeaders: parseHeaders(provider.customHeaders),
    timeoutMs: provider.timeoutMinutes * 60_000,
    streaming: provider.streaming,
    reasoning: provider.reasoning,
    contextWindow: provider.contextWindow,
  }
}

function modelsUrl(endpoint) {
  const parsed = new URL(safeString(endpoint, 2048))
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('供应商 URL 仅支持 HTTP 或 HTTPS')
  const path = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = path.endsWith('/models') ? path : `${path}/models`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function readRemoteModels(body) {
  const source = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
        : []
  return normalizeModels(source.map((item) => {
    if (typeof item === 'string') return item
    return item?.id || item?.name || item?.model || ''
  }))
}

function modelDiscoveryNetworkError(error, endpoint) {
  let host = '供应商服务'
  try {
    const parsed = new URL(endpoint)
    host = `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`
  } catch {
    /* endpoint validation reports the malformed URL separately */
  }
  let cause = error
  while (cause?.cause && cause.cause !== cause) cause = cause.cause
  const code = String(cause?.code || '')
  if (code === 'EACCES' || code === 'EPERM') {
    return `无法连接 ${host}：本机拒绝 Node 进程建立出站连接（${code}）。请在防火墙/终端安全软件中允许 node.exe 出站访问；如果该地址属于公司内网，还需确认已连接公司内网/VPN`
  }
  if (code === 'ECONNREFUSED') return `无法连接 ${host}：目标端口拒绝连接，请确认供应商服务已启动`
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `无法解析 ${host}：请检查域名、DNS 或网络连接`
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return `连接 ${host} 超时，请确认已连接公司内网/VPN`
  if (/CERT|TLS|SSL/i.test(code) || /certificate|TLS|SSL/i.test(String(cause?.message || ''))) return `连接 ${host} 的 TLS 证书校验失败，请检查证书或网关配置`
  return String(cause?.message || error?.message || '无法连接供应商')
}

export function describeCustomProviderConnectionError(error, endpoint) {
  const status = Number(error?.status || error?.response?.status || 0)
  const message = String(error?.error?.message || error?.message || '').trim()
  if (status >= 400) {
    return `模型服务返回 HTTP ${status}${message ? `：${message}` : ''}`
  }
  return `无法连接模型服务：${modelDiscoveryNetworkError(error, endpoint)}`
}

export async function discoverCustomProviderModels(input = {}, fetchImpl = globalThis.fetch) {
  const endpoint = safeString(input.endpoint, 2048)
  if (!endpoint) throw new Error('请先填写供应商 URL')
  const apiKey = safeString(input.apiKey)
  if (!apiKey) throw new Error('请先填写 API Key')

  const headers = new Headers(parseHeaders(input.customHeaders))
  headers.set('Accept', 'application/json')
  if (input.apiMode === 'anthropic') {
    headers.set('x-api-key', apiKey)
    headers.set('anthropic-version', '2023-06-01')
  } else {
    headers.set('Authorization', `Bearer ${apiKey}`)
  }

  let response
  try {
    response = await fetchImpl(modelsUrl(endpoint), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`获取模型失败：${modelDiscoveryNetworkError(error, endpoint)}`)
  }

  const text = await response.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {}
  }
  if (!response.ok) {
    const detail = body?.error?.message || body?.error || body?.message || text || `HTTP ${response.status}`
    throw new Error(`获取模型失败：${String(detail).slice(0, 500)}`)
  }
  return readRemoteModels(body)
}

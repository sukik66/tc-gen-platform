import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.join(__dirname, '..')
export const ENV_FILE = path.join(PROJECT_ROOT, '.env')
export const ENV_EXAMPLE_FILE = path.join(PROJECT_ROOT, '.env.example')

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI / 兼容网关', keyEnv: 'OPENAI_API_KEY', baseEnv: 'OPENAI_BASE_URL', modelEnv: 'OPENAI_MODEL', modelsEnv: 'OPENAI_MODELS', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic Claude', keyEnv: 'ANTHROPIC_API_KEY', baseEnv: 'ANTHROPIC_BASE_URL', modelEnv: 'ANTHROPIC_MODEL', modelsEnv: 'ANTHROPIC_MODELS', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', label: 'Google Gemini', keyEnv: 'GEMINI_API_KEY', baseEnv: '', modelEnv: 'GEMINI_MODEL', modelsEnv: '', defaultBaseUrl: '' },
  { id: 'qwen', label: '阿里通义 Qwen', keyEnv: 'QWEN_API_KEY', baseEnv: 'QWEN_BASE_URL', modelEnv: 'QWEN_MODEL', modelsEnv: 'QWEN_MODELS', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'ernie', label: '百度文心 ERNIE', keyEnv: 'ERNIE_API_KEY', baseEnv: 'ERNIE_BASE_URL', modelEnv: 'ERNIE_MODEL', modelsEnv: 'ERNIE_MODELS', defaultBaseUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'doubao', label: '字节豆包 Ark', keyEnv: 'DOUBAO_API_KEY', baseEnv: 'DOUBAO_BASE_URL', modelEnv: 'DOUBAO_MODEL', modelsEnv: 'DOUBAO_MODELS', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'glm', label: '智谱 GLM', keyEnv: 'GLM_API_KEY', baseEnv: 'GLM_BASE_URL', modelEnv: 'GLM_MODEL', modelsEnv: 'GLM_MODELS', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'minimax', label: 'MiniMax', keyEnv: 'MINIMAX_API_KEY', baseEnv: 'MINIMAX_BASE_URL', modelEnv: 'MINIMAX_MODEL', modelsEnv: 'MINIMAX_MODELS', defaultBaseUrl: 'https://api.minimax.chat/v1' },
  { id: 'kimi', label: '月之暗面 Kimi', keyEnv: 'KIMI_API_KEY', baseEnv: 'KIMI_BASE_URL', modelEnv: 'KIMI_MODEL', modelsEnv: 'KIMI_MODELS', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'deepseek', label: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', baseEnv: 'DEEPSEEK_BASE_URL', modelEnv: 'DEEPSEEK_MODEL', modelsEnv: 'DEEPSEEK_MODELS', defaultBaseUrl: 'https://api.deepseek.com/v1' },
]

const EDITABLE_ENV_KEYS = new Set([
  'LLM_PROVIDER',
  'LIGHTRAG_URL',
  'PLASTIC_CM_PATH',
  'METHODOLOGY_FILE',
  'DEBUG_INGEST_URL',
  'API_PORT',
  ...PROVIDERS.flatMap((p) => [p.keyEnv, p.baseEnv, p.modelEnv, p.modelsEnv]).filter(Boolean),
])

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return { raw: '', values: {} }
  const raw = fs.readFileSync(ENV_FILE, 'utf8')
  return { raw, values: dotenv.parse(raw) }
}

function safeValue(value) {
  return String(value ?? '').replace(/[\r\n]/g, '').trim()
}

export function normalizeWindowsPath(value) {
  let output = ''
  let previousSlash = false
  for (const char of safeValue(value)) {
    if (char === '\\') {
      if (previousSlash) continue
      previousSlash = true
    } else {
      previousSlash = false
    }
    output += char
  }
  return output
}

function redactSecret(value) {
  const v = safeValue(value)
  if (!v) return { configured: false, preview: '' }
  if (v.length <= 8) return { configured: true, preview: '••••••••' }
  return { configured: true, preview: `${v.slice(0, 3)}••••${v.slice(-3)}` }
}

function formatEnvValue(value) {
  const v = safeValue(value)
  return /[#"']/.test(v) ? JSON.stringify(v) : v
  // dotenv 不会可靠地还原 Windows 路径中的反斜杠；路径即使含空格也可不加引号。
  return /[#"']/.test(v) ? JSON.stringify(v) : v
}

function updateEnvFile(updates) {
  const existing = readEnvFile().raw
  const lines = existing ? existing.split(/\r?\n/) : []
  const seen = new Set()
  const next = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) return line
    const key = match[1]
    seen.add(key)
    return `${key}=${formatEnvValue(updates[key])}`
  })

  const missing = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
  if (missing.length) {
    while (next.length && next[next.length - 1] === '') next.pop()
    next.push('', '# Managed from the Settings page', ...missing)
  }

  fs.writeFileSync(ENV_FILE, `${next.join('\n').replace(/\n*$/, '')}\n`, 'utf8')
}

export function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return false
  const template = fs.existsSync(ENV_EXAMPLE_FILE) ? fs.readFileSync(ENV_EXAMPLE_FILE, 'utf8') : '# Local configuration\n'
  fs.writeFileSync(ENV_FILE, template, 'utf8')
  return true
}

export function getLocalConfig() {
  const { values } = readEnvFile()
  const methodologyPath = safeValue(values.METHODOLOGY_FILE) || path.join(PROJECT_ROOT, 'knowledge', '参考', '测试用例设计方法论.md')
  const providers = PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    apiKey: redactSecret(values[p.keyEnv]),
    baseUrl: p.baseEnv ? (safeValue(values[p.baseEnv]) || p.defaultBaseUrl) : '',
    model: p.modelEnv ? safeValue(values[p.modelEnv]) : '',
    models: p.modelsEnv ? safeValue(values[p.modelsEnv]) : '',
  }))
  return {
    exists: fs.existsSync(ENV_FILE),
    path: ENV_FILE,
    llmProvider: safeValue(values.LLM_PROVIDER) || 'openai',
    providers,
    lightRagUrl: safeValue(values.LIGHTRAG_URL) || 'http://127.0.0.1:6002',
    plasticCmPath: normalizeWindowsPath(values.PLASTIC_CM_PATH) || 'C:\\Program Files\\PlasticSCM5\\client\\cm.exe',
    methodologyPath,
    methodologyExists: fs.existsSync(methodologyPath),
    debugIngestEnabled: Boolean(safeValue(values.DEBUG_INGEST_URL)),
    apiPort: safeValue(values.API_PORT) || '8787',
  }
}

export function saveLocalConfig(input = {}) {
  const updates = {}
  const add = (key, value, { preserveEmpty = false } = {}) => {
    if (!EDITABLE_ENV_KEYS.has(key) || value === undefined || value === null) return
    const safe = safeValue(value)
    if (safe || preserveEmpty) updates[key] = safe
  }

  add('LLM_PROVIDER', input.llmProvider)
  add('LIGHTRAG_URL', input.lightRagUrl, { preserveEmpty: true })
  add('PLASTIC_CM_PATH', input.plasticCmPath, { preserveEmpty: true })
  add('METHODOLOGY_FILE', input.methodologyPath, { preserveEmpty: true })
  add('DEBUG_INGEST_URL', input.debugIngestUrl, { preserveEmpty: true })
  add('API_PORT', input.apiPort)

  for (const provider of Array.isArray(input.providers) ? input.providers : []) {
    const cfg = PROVIDERS.find((p) => p.id === provider?.id)
    if (!cfg || !provider || typeof provider !== 'object') continue
    // 空 API Key 表示“不修改已有密钥”，避免页面回填脱敏值覆盖真实密钥。
    add(cfg.keyEnv, provider.apiKey)
    add(cfg.baseEnv, provider.baseUrl, { preserveEmpty: true })
    add(cfg.modelEnv, provider.model, { preserveEmpty: true })
    add(cfg.modelsEnv, provider.models, { preserveEmpty: true })
  }

  ensureEnvFile()
  if (Object.keys(updates).length) updateEnvFile(updates)
  return getLocalConfig()
}

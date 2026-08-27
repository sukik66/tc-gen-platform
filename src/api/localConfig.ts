const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export interface SecretStatus {
  configured: boolean
  preview: string
}

export interface LocalProviderConfig {
  id: string
  label: string
  apiKey: SecretStatus
  baseUrl: string
  model: string
  models: string
}

export interface LocalConfig {
  exists: boolean
  path: string
  llmProvider: string
  providers: LocalProviderConfig[]
  knowledgeProvider: 'lightrag' | 'llm-wiki'
  lightRagUrl: string
  llmWikiUrl: string
  llmWikiQueryPath: string
  llmWikiHealthPath: string
  llmWikiApiKey: SecretStatus
  plasticCmPath: string
  methodologyPath: string
  methodologyExists: boolean
  debugIngestEnabled: boolean
  apiPort: string
  restartRequired?: boolean
  created?: boolean
}

export interface LocalConfigPayload {
  llmProvider: string
  apiPort: string
  lightRagUrl: string
  knowledgeProvider?: 'lightrag' | 'llm-wiki'
  llmWikiUrl?: string
  llmWikiQueryPath?: string
  llmWikiHealthPath?: string
  llmWikiApiKey?: string
  plasticCmPath: string
  methodologyPath: string
  providers: Array<{
    id: string
    apiKey: string
    baseUrl: string
    model: string
    models: string
  }>
}

async function readResponse(response: Response): Promise<LocalConfig> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = String(body.error || '')
    if (response.status === 404) {
      throw new Error(
        '配置请求失败（404）：当前 API 端口可能被其它服务占用。请停止占用 8787 的服务后重启 npm run dev，或修改 .env 的 API_PORT。',
      )
    }
    throw new Error(detail || `配置请求失败（${response.status}）`)
  }
  return body as LocalConfig
}

export async function fetchLocalConfig(): Promise<LocalConfig> {
  return readResponse(await fetch(`${apiBase}/api/config`))
}

export async function createLocalConfig(): Promise<LocalConfig> {
  return readResponse(await fetch(`${apiBase}/api/config`, { method: 'POST' }))
}

export async function saveLocalConfig(payload: LocalConfigPayload): Promise<LocalConfig> {
  return readResponse(await fetch(`${apiBase}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

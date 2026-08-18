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
  lightRagUrl: string
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
  if (!response.ok) throw new Error(String(body.error || `配置请求失败（${response.status}）`))
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

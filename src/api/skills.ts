const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export interface SkillSummary {
  id: string
  name: string
  fileCount: number
  totalBytes: number
  hasSkillMd: boolean
  updatedAt: string
  currentVersion: number
}

export interface SkillFileSummary {
  path: string
  bytes: number
}

export interface SkillDetail extends SkillSummary {
  files: SkillFileSummary[]
}

export interface SkillVersionSummary {
  version: number
  createdAt: string
  files: SkillFileSummary[]
  totalBytes: number
  current: boolean
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string; skills?: SkillSummary[]; skill?: SkillSummary; existing?: SkillSummary }
  if (!response.ok) {
    const error = new Error(body.error || `请求失败 (${response.status})`) as Error & { code?: string; existing?: SkillSummary }
    error.code = response.status === 409 ? 'SKILL_EXISTS' : undefined
    error.existing = body.existing
    throw error
  }
  return body
}

export async function listSkills(): Promise<SkillSummary[]> {
  const body = await readJson(await fetch(`${apiBase}/api/skills`))
  return body.skills || []
}

export async function fetchSkillDetail(id: string): Promise<SkillDetail> {
  return await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}`)) as unknown as SkillDetail
}

export async function fetchSkillFile(id: string, filePath: string): Promise<{ skill: SkillSummary; path: string; content: string }> {
  const query = new URLSearchParams({ path: filePath })
  return await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}/file?${query}`)) as unknown as { skill: SkillSummary; path: string; content: string }
}

export async function fetchSkillVersions(id: string): Promise<SkillVersionSummary[]> {
  const body = await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}/versions`)) as { versions?: SkillVersionSummary[] }
  return body.versions || []
}

export async function fetchSkillVersionFile(id: string, version: number, filePath: string): Promise<{ skill: SkillSummary; version: number; path: string; content: string }> {
  const query = new URLSearchParams({ path: filePath })
  return await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}/versions/${version}/file?${query}`)) as unknown as { skill: SkillSummary; version: number; path: string; content: string }
}

export async function restoreSkillVersion(id: string, version: number): Promise<SkillSummary> {
  const body = await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}/versions/${version}/restore`, { method: 'POST' })) as { skill?: SkillSummary }
  return body.skill as SkillSummary
}

export async function uploadSkill(payload: { name: string; files: Array<{ path: string; content: string }>; replace?: boolean; id?: string }): Promise<SkillSummary> {
  const body = await readJson(await fetch(`${apiBase}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  return body.skill as SkillSummary
}

export async function deleteSkill(id: string): Promise<void> {
  await readJson(await fetch(`${apiBase}/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

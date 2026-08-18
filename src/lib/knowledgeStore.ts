/**
 * 知识库 · 后端 `data/knowledge.json` 持久化（与用例库 / 契约草稿同策略）
 *
 * 列表接口不返回文件二进制；下载或需 Blob 时调用 `ensureKbFileBlob`。
 */

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

function apiUrl(path: string) {
  return `${apiBase}${path}`
}

async function parseJson<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 ${r.status}`)
  }
  return data as T
}

/* ---------- 数据类型 ---------- */

export interface KBArticle {
  id: string
  title: string
  category: string
  subCategory: string
  tags: string[]
  content: string
  source: 'manual' | 'mistake_book' | 'import'
  sourceRef?: string
  createdAt: string
  updatedAt: string
}

export interface KBFile {
  id: string
  displayName: string
  originalName: string
  mimeType: string
  size: number
  blob: Blob
  extractedText: string
  contentHash: string
  category: string
  tags: string[]
  source: 'generation' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KBFileVersion {
  id: string
  fileId: string
  oldHash: string
  newHash: string
  oldSize: number
  newSize: number
  changeNote: string
  createdAt: string
}

export const KB_CATEGORIES = [
  { id: 'requirement', label: '需求文档', children: ['产品需求', '技术方案', '协议文档'] },
  { id: 'defect', label: '缺陷模式', children: ['功能缺陷', '性能缺陷', '兼容性缺陷', '安全漏洞'] },
  { id: 'experience', label: '测试经验', children: ['踩坑记录', '复盘总结', '最佳实践'] },
  { id: 'standard', label: '规范策略', children: ['测试规范', '回归策略', '冒烟清单', 'Checklist'] },
  { id: 'case_ref', label: '历史用例', children: ['经典用例', '回归用例'] },
  { id: 'tool', label: '工具脚本', children: ['自动化脚本', '环境配置', '工具指南'] },
  { id: 'report', label: '测试报告', children: ['测试报告', '质量趋势'] },
  { id: 'other', label: '其他', children: ['未分类'] },
] as const

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime || 'application/octet-stream' })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 列表元数据 → 带占位 Blob（size 为 0，真实大小见字段 size） */
function fileMetaToKBFile(meta: Omit<KBFile, 'blob'>): KBFile {
  return {
    ...meta,
    blob: new Blob([], { type: meta.mimeType || 'application/octet-stream' }),
  }
}

/** 若列表项尚未拉取二进制（占位 blob 与元数据 size 不一致），从服务端补全 */
export async function ensureKbFileBlob(f: KBFile): Promise<KBFile> {
  if (f.size > 0 && f.blob.size === 0) {
    const r = await fetch(apiUrl(`/api/knowledge/files/${encodeURIComponent(f.id)}`))
    const raw = (await parseJson(r)) as unknown as KBFile & { dataBase64: string }
    const { dataBase64, ...rest } = raw
    return { ...(rest as KBFile), blob: b64ToBlob(String(dataBase64), String(rest.mimeType || '')) }
  }
  return f
}

/** 计算文件内容的 SHA-256 哈希 */
export async function computeFileHash(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/* ========== 文章 CRUD ========== */

export async function getAllArticles(): Promise<KBArticle[]> {
  const r = await fetch(apiUrl('/api/knowledge/articles'))
  return parseJson<KBArticle[]>(r)
}

export async function getArticle(id: string): Promise<KBArticle | undefined> {
  const all = await getAllArticles()
  return all.find((a) => a.id === id)
}

export async function createArticle(data: Omit<KBArticle, 'id' | 'createdAt' | 'updatedAt'>): Promise<KBArticle> {
  const r = await fetch(apiUrl('/api/knowledge/articles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return parseJson<KBArticle>(r)
}

export async function updateArticle(id: string, patch: Partial<Omit<KBArticle, 'id' | 'createdAt'>>): Promise<void> {
  const r = await fetch(apiUrl(`/api/knowledge/articles/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  await parseJson<{ ok: boolean }>(r)
}

export async function deleteArticle(id: string): Promise<void> {
  const r = await fetch(apiUrl(`/api/knowledge/articles/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  await parseJson<{ ok: boolean }>(r)
}

export async function searchArticles(keyword: string): Promise<KBArticle[]> {
  const all = await getAllArticles()
  if (!keyword.trim()) return all
  const kw = keyword.toLowerCase()
  return all.filter(
    (a) =>
      a.title.toLowerCase().includes(kw) ||
      a.content.toLowerCase().includes(kw) ||
      a.category.toLowerCase().includes(kw) ||
      a.subCategory.toLowerCase().includes(kw) ||
      a.tags.some((t) => t.toLowerCase().includes(kw)),
  )
}

/* ========== 文件 CRUD ========== */

export async function getAllFiles(): Promise<KBFile[]> {
  const r = await fetch(apiUrl('/api/knowledge/files'))
  const metas = await parseJson<Omit<KBFile, 'blob'>[]>(r)
  return metas.map(fileMetaToKBFile)
}

export async function getFile(id: string): Promise<KBFile | undefined> {
  try {
    const r = await fetch(apiUrl(`/api/knowledge/files/${encodeURIComponent(id)}`))
    const raw = (await parseJson(r)) as unknown as KBFile & { dataBase64: string }
    const { dataBase64, ...rest } = raw
    return { ...(rest as KBFile), blob: b64ToBlob(String(dataBase64), String(rest.mimeType || '')) }
  } catch {
    return undefined
  }
}

export async function deleteFile(id: string): Promise<void> {
  const r = await fetch(apiUrl(`/api/knowledge/files/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  await parseJson<{ ok: boolean }>(r)
}

export async function searchFiles(keyword: string): Promise<KBFile[]> {
  const all = await getAllFiles()
  if (!keyword.trim()) return all
  const kw = keyword.toLowerCase()
  return all.filter(
    (f) =>
      f.displayName.toLowerCase().includes(kw) ||
      f.originalName.toLowerCase().includes(kw) ||
      f.extractedText.toLowerCase().includes(kw) ||
      f.category.toLowerCase().includes(kw) ||
      f.tags.some((t) => t.toLowerCase().includes(kw)),
  )
}

export async function getFileVersions(fileId: string): Promise<KBFileVersion[]> {
  const r = await fetch(apiUrl(`/api/knowledge/files/${encodeURIComponent(fileId)}/versions`))
  return parseJson<KBFileVersion[]>(r)
}

export type FileImportResult =
  | { action: 'skipped'; reason: string; fileId: string }
  | { action: 'updated'; fileId: string; versionId: string }
  | { action: 'created'; fileId: string }

export async function smartImportFile(
  file: File,
  extractedText: string,
  category: string = '需求文档',
  tags: string[] = [],
  source: 'generation' | 'manual' = 'generation',
): Promise<FileImportResult> {
  const blob = new Blob([await file.arrayBuffer()], { type: file.type })
  const hash = await computeFileHash(blob)
  const dataBase64 = await blobToBase64(blob)
  const r = await fetch(apiUrl('/api/knowledge/files/smart-import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || '',
      size: file.size,
      contentHash: hash,
      extractedText,
      category,
      tags,
      source,
      dataBase64,
    }),
  })
  return parseJson<FileImportResult>(r)
}

export async function manualImportFile(
  file: File,
  extractedText: string,
  category: string,
  tags: string[] = [],
): Promise<FileImportResult> {
  return smartImportFile(file, extractedText, category, tags, 'manual')
}

export async function getKBStats(): Promise<{
  articleCount: number
  fileCount: number
  totalFileSize: number
}> {
  const r = await fetch(apiUrl('/api/knowledge/stats'))
  return parseJson(r)
}

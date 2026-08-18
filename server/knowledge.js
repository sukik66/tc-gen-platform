/**
 * 知识库 · 后端 JSON 文件持久化（与用例库 / 契约草稿策略一致）
 * 数据：data/knowledge.json
 * 文件二进制以 Base64 存入 JSON（适合中小体积；大体量可再拆分为分文件存储）
 */
import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'knowledge.json')

function uid() {
  return randomUUID()
}

function iso() {
  return new Date().toISOString()
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) {
    return { articles: [], files: [], versions: [] }
  }
  try {
    const o = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return {
      articles: Array.isArray(o.articles) ? o.articles : [],
      files: Array.isArray(o.files) ? o.files : [],
      versions: Array.isArray(o.versions) ? o.versions : [],
    }
  } catch {
    return { articles: [], files: [], versions: [] }
  }
}

function save(data) {
  ensureDir()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

/* ---------- 文章 ---------- */

export function getAllArticles() {
  return load().articles
}

export function createArticle(data) {
  const d = load()
  const now = iso()
  const item = {
    title: String(data.title || ''),
    category: String(data.category || ''),
    subCategory: String(data.subCategory || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    content: String(data.content || ''),
    source: ['manual', 'mistake_book', 'import'].includes(data.source) ? data.source : 'manual',
    sourceRef: data.sourceRef ? String(data.sourceRef) : undefined,
    id: uid(),
    createdAt: now,
    updatedAt: now,
  }
  d.articles.push(item)
  save(d)
  return item
}

export function updateArticle(id, patch) {
  const d = load()
  const idx = d.articles.findIndex((a) => a.id === id)
  if (idx < 0) throw new Error('文章不存在')
  const existing = d.articles[idx]
  const updated = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: iso(),
  }
  d.articles[idx] = updated
  save(d)
}

export function deleteArticle(id) {
  const d = load()
  d.articles = d.articles.filter((a) => a.id !== id)
  save(d)
}

/* ---------- 文件（含 dataBase64） ---------- */

function stripBinary(f) {
  if (!f || typeof f !== 'object') return f
  const { dataBase64, ...rest } = f
  return rest
}

export function getAllFilesMeta() {
  return load().files.map(stripBinary)
}

export function getFileById(id) {
  const f = load().files.find((x) => x.id === id)
  return f || null
}

export function deleteFile(id) {
  const d = load()
  d.files = d.files.filter((f) => f.id !== id)
  d.versions = d.versions.filter((v) => v.fileId !== id)
  save(d)
}

export function getFileVersions(fileId) {
  return load().versions.filter((v) => v.fileId === fileId)
}

function textSimilarity(a, b) {
  if (a === b) return 1
  if (!a || !b) return 0
  const bigramsA = new Set()
  const bigramsB = new Set()
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2))
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2))
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0
  let intersection = 0
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++
  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

function findMostSimilar(files, text) {
  let best = null
  for (const f of files) {
    const sim = textSimilarity(f.extractedText || '', text)
    if (!best || sim > best.similarity) best = { file: f, similarity: sim }
  }
  return best
}

function generateUniqueDisplayName(originalName, existing) {
  const dotIdx = originalName.lastIndexOf('.')
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : ''
  const existingNames = new Set(existing.map((f) => f.displayName))
  let counter = 2
  let candidate = `${base}_${counter}${ext}`
  while (existingNames.has(candidate)) {
    counter++
    candidate = `${base}_${counter}${ext}`
  }
  return candidate
}

function hashFromBase64(dataBase64) {
  return createHash('sha256').update(Buffer.from(dataBase64, 'base64')).digest('hex')
}

/**
 * 与前端 smartImportFile 一致的三级去重（入参为已抽取文本 + Base64）
 * @returns {{ action: string, reason?: string, fileId: string, versionId?: string }}
 */
export function smartImportFile(payload) {
  const {
    fileName,
    mimeType = '',
    size = 0,
    contentHash: clientHash,
    extractedText = '',
    category = '需求文档',
    tags = [],
    source = 'generation',
    dataBase64,
  } = payload || {}

  if (!fileName || typeof dataBase64 !== 'string' || !dataBase64.length) {
    throw new Error('缺少 fileName 或 dataBase64')
  }
  const hash = clientHash && String(clientHash).length === 64 ? String(clientHash) : hashFromBase64(dataBase64)

  const d = load()
  const sameNameFiles = d.files.filter((f) => f.originalName === fileName)

  const exactMatch = sameNameFiles.find((f) => f.contentHash === hash)
  if (exactMatch) {
    return { action: 'skipped', reason: '文件内容完全相同，已跳过', fileId: exactMatch.id }
  }

  if (sameNameFiles.length > 0) {
    const best = findMostSimilar(sameNameFiles, extractedText)
    if (best && best.similarity >= 0.3) {
      const now = iso()
      const version = {
        id: uid(),
        fileId: best.file.id,
        oldHash: best.file.contentHash,
        newHash: hash,
        oldSize: best.file.size,
        newSize: size,
        changeNote: `文件内容更新（相似度 ${(best.similarity * 100).toFixed(0)}%）`,
        createdAt: now,
      }
      const updated = {
        ...best.file,
        mimeType: mimeType || best.file.mimeType,
        size,
        extractedText,
        contentHash: hash,
        dataBase64,
        updatedAt: now,
      }
      const idx = d.files.findIndex((f) => f.id === best.file.id)
      if (idx >= 0) d.files[idx] = updated
      d.versions.push(version)
      save(d)
      return { action: 'updated', fileId: best.file.id, versionId: version.id }
    }
    const displayName = generateUniqueDisplayName(fileName, sameNameFiles)
    const now = iso()
    const newFile = {
      id: uid(),
      displayName,
      originalName: fileName,
      mimeType: mimeType || '',
      size,
      extractedText,
      contentHash: hash,
      dataBase64,
      category,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      source: source === 'manual' ? 'manual' : 'generation',
      createdAt: now,
      updatedAt: now,
    }
    d.files.push(newFile)
    save(d)
    return { action: 'created', fileId: newFile.id }
  }

  const now = iso()
  const newFile = {
    id: uid(),
    displayName: fileName,
    originalName: fileName,
    mimeType: mimeType || '',
    size,
    extractedText,
    contentHash: hash,
    dataBase64,
    category,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    source: source === 'manual' ? 'manual' : 'generation',
    createdAt: now,
    updatedAt: now,
  }
  d.files.push(newFile)
  save(d)
  return { action: 'created', fileId: newFile.id }
}

export function getKBStats() {
  const { articles, files } = load()
  const totalFileSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
  return {
    articleCount: articles.length,
    fileCount: files.length,
    totalFileSize,
  }
}

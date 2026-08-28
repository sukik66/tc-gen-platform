import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = path.join(PROJECT_ROOT, 'server', 'data', 'skills')
const VERSIONS_ROOT = path.join(DATA_ROOT, '.versions')
const INDEX_FILE = path.join(DATA_ROOT, 'index.json')
const MAX_FILES = 500
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

function ensureStore() {
  fs.mkdirSync(DATA_ROOT, { recursive: true })
  if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, '[]\n', 'utf8')
}

function readIndex() {
  ensureStore()
  try {
    const value = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeIndex(items) {
  ensureStore()
  const temp = `${INDEX_FILE}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, INDEX_FILE)
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[\\/]+/g, '-').replace(/[^\u4e00-\u9fffA-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return name.slice(0, 80)
}

function skillIdentityName(value) {
  return safeName(value).replace(/[-_ ]v\d+(?:\.\d+)*$/i, '').toLowerCase()
}

function safeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) throw new Error('Skill 文件路径不能为空')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Skill 文件路径不合法')
  return parts.join('/')
}

function publicSkill(item) {
  return {
    id: item.id,
    name: item.name,
    fileCount: item.fileCount,
    totalBytes: item.totalBytes,
    hasSkillMd: item.hasSkillMd,
    updatedAt: item.updatedAt,
    currentVersion: Number(item.currentVersion) || 1,
  }
}

function versionRoot(skillId, version) {
  return path.join(VERSIONS_ROOT, String(skillId), `v${version}`)
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
}

function copySnapshot(source, target) {
  const temp = path.join(DATA_ROOT, `.tmp-snapshot-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  fs.rmSync(temp, { recursive: true, force: true })
  fs.cpSync(source, temp, {
    recursive: true,
  })
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(temp, target)
}

function ensureVersionSnapshot(item) {
  const currentVersion = Number(item.currentVersion) || 1
  const snapshot = versionRoot(item.id, currentVersion)
  if (fs.existsSync(snapshot)) return currentVersion
  const currentRoot = path.join(DATA_ROOT, item.id)
  if (!fs.existsSync(currentRoot)) return currentVersion
  copySnapshot(currentRoot, snapshot)
  return currentVersion
}

function migrateLegacyVersion(item, items) {
  const currentVersion = Number(item.currentVersion) || 1
  const changed = !Number.isInteger(Number(item.currentVersion)) || !item.versionCreatedAt?.['1']
  ensureVersionSnapshot(item)
  if (!changed) return false
  item.currentVersion = currentVersion
  item.versionCreatedAt = {
    ...(item.versionCreatedAt || {}),
    '1': item.versionCreatedAt?.['1'] || item.updatedAt,
  }
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index >= 0) items[index] = item
  return true
}

function readVersionFiles(item, version) {
  const currentVersion = Number(item.currentVersion) || 1
  const requested = Number(version)
  if (!Number.isInteger(requested) || requested < 1 || requested > currentVersion) return null
  ensureVersionSnapshot(item)
  const root = versionRoot(item.id, requested)
  if (!fs.existsSync(root)) return null
  const files = []
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute, relative)
      else if (entry.isFile()) files.push({ path: relative, bytes: fs.statSync(absolute).size })
    }
  }
  walk(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { version: requested, createdAt: item.versionCreatedAt?.[String(requested)] || item.updatedAt, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) }
}

export function listSkills() {
  const items = readIndex()
  let changed = false
  for (const item of items) changed = migrateLegacyVersion(item, items) || changed
  if (changed) writeIndex(items)
  return items.map(publicSkill).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export function getSkill(id) {
  const item = readIndex().find((entry) => entry.id === String(id))
  return item ? publicSkill(item) : null
}

export function getSkillDetail(id) {
  const item = readIndex().find((entry) => entry.id === String(id))
  if (!item) return null
  return {
    ...publicSkill(item),
    files: (item.files || []).map((file) => ({ path: file.path, bytes: file.bytes })),
  }
}

export function listSkillVersions(id) {
  const items = readIndex()
  const item = items.find((entry) => entry.id === String(id))
  if (!item) return null
  const changed = migrateLegacyVersion(item, items)
  if (changed) writeIndex(items)
  ensureVersionSnapshot(item)
  const currentVersion = Number(item.currentVersion) || 1
  return Array.from({ length: currentVersion }, (_, index) => currentVersion - index)
    .map((version) => readVersionFiles(item, version))
    .filter(Boolean)
    .map((version) => ({ ...version, current: version.version === currentVersion }))
}

export function getSkillVersion(id, version) {
  const item = readIndex().find((entry) => entry.id === String(id))
  if (!item) return null
  const summary = readVersionFiles(item, version)
  if (!summary) return null
  return { skill: publicSkill(item), ...summary }
}

export function readSkillFile(id, relativePath) {
  const item = readIndex().find((entry) => entry.id === String(id))
  if (!item) return null
  const normalized = safeRelativePath(relativePath)
  const file = (item.files || []).find((entry) => entry.path === normalized)
  if (!file) return null
  const root = path.resolve(DATA_ROOT, item.id)
  const absolute = path.resolve(root, ...normalized.split('/'))
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error('Skill 文件路径不合法')
  return {
    skill: publicSkill(item),
    path: normalized,
    content: fs.readFileSync(absolute, 'utf8'),
  }
}

export function readSkillVersionFile(id, version, relativePath) {
  const item = readIndex().find((entry) => entry.id === String(id))
  if (!item) return null
  const summary = readVersionFiles(item, version)
  if (!summary) return null
  const normalized = safeRelativePath(relativePath)
  if (!summary.files.some((file) => file.path === normalized)) return null
  const root = path.resolve(versionRoot(item.id, summary.version))
  const absolute = path.resolve(root, ...normalized.split('/'))
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error('Skill 文件路径不合法')
  return { skill: publicSkill(item), version: summary.version, path: normalized, content: fs.readFileSync(absolute, 'utf8') }
}

export function deleteSkill(id) {
  const items = readIndex()
  const index = items.findIndex((entry) => entry.id === String(id))
  if (index < 0) return false
  const [removed] = items.splice(index, 1)
  const dir = path.join(DATA_ROOT, removed.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(path.join(VERSIONS_ROOT, removed.id), { recursive: true, force: true })
  writeIndex(items)
  return true
}

export function saveSkill({ id, name, files, replace = false } = {}) {
  const cleanName = safeName(name)
  if (!cleanName) throw new Error('Skill 名称不能为空')
  if (!Array.isArray(files) || files.length === 0) throw new Error('至少上传一个 Skill 文件')
  if (files.length > MAX_FILES) throw new Error(`Skill 文件数量不能超过 ${MAX_FILES}`)

  const normalizedFiles = files.map((file) => {
    const relativePath = safeRelativePath(file?.path)
    const content = String(file?.content ?? '')
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_FILE_BYTES) throw new Error(`文件过大：${relativePath}`)
    return { path: relativePath, content, bytes }
  })
  const duplicatePath = new Set(normalizedFiles.map((file) => file.path)).size !== normalizedFiles.length
  if (duplicatePath) throw new Error('Skill 中存在重复文件路径')
  const totalBytes = normalizedFiles.reduce((sum, file) => sum + file.bytes, 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Skill 总大小不能超过 20MB')

  const items = readIndex()
  const cleanIdentity = skillIdentityName(cleanName)
  const existingIndex = items.findIndex((entry) => entry.id === String(id) || entry.name.toLowerCase() === cleanName.toLowerCase() || skillIdentityName(entry.name) === cleanIdentity)
  if (existingIndex >= 0 && !replace) {
    const error = new Error('Skill 名称已存在')
    error.code = 'SKILL_EXISTS'
    error.existing = publicSkill(items[existingIndex])
    throw error
  }

  const existing = existingIndex >= 0 ? items[existingIndex] : null
  const skillId = existing?.id || `skill-${crypto.randomUUID().slice(0, 8)}`
  const targetDir = path.join(DATA_ROOT, skillId)
  const tempDir = path.join(DATA_ROOT, `.tmp-${skillId}-${process.pid}`)
  if (existing) {
    // The old layout predates versions; preserve it as v1 before replacing the live files.
    ensureVersionSnapshot({ ...existing, id: skillId })
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })
  for (const file of normalizedFiles) {
    const target = path.join(tempDir, ...file.path.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, file.content, 'utf8')
  }
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.renameSync(tempDir, targetDir)

  const nextVersion = existing ? (Number(existing.currentVersion) || 1) + 1 : 1
  copySnapshot(targetDir, versionRoot(skillId, nextVersion))

  const metadata = {
    id: skillId,
    name: cleanName,
    fileCount: normalizedFiles.length,
    totalBytes,
    hasSkillMd: normalizedFiles.some((file) => path.basename(file.path).toLowerCase() === 'skill.md'),
    updatedAt: new Date().toISOString(),
    currentVersion: nextVersion,
    versionCreatedAt: {
      ...(existing?.versionCreatedAt || {}),
      [String(nextVersion)]: new Date().toISOString(),
    },
    files: normalizedFiles.map(({ path: filePath, bytes }) => ({ path: filePath, bytes })),
  }
  if (existingIndex >= 0) items[existingIndex] = metadata
  else items.push(metadata)
  writeIndex(items)
  return publicSkill(metadata)
}

export function restoreSkillVersion(id, version) {
  const items = readIndex()
  const index = items.findIndex((entry) => entry.id === String(id))
  if (index < 0) return null
  const item = items[index]
  const sourceSummary = readVersionFiles(item, version)
  if (!sourceSummary) return null
  const sourceRoot = versionRoot(item.id, sourceSummary.version)
  const currentRoot = path.join(DATA_ROOT, item.id)
  const tempDir = path.join(DATA_ROOT, `.tmp-restore-${item.id}-${process.pid}`)
  copyDirectory(sourceRoot, tempDir)
  const nextVersion = (Number(item.currentVersion) || 1) + 1
  fs.rmSync(currentRoot, { recursive: true, force: true })
  fs.renameSync(tempDir, currentRoot)
  copySnapshot(currentRoot, versionRoot(item.id, nextVersion))
  const metadata = {
    ...item,
    fileCount: sourceSummary.files.length,
    totalBytes: sourceSummary.totalBytes,
    hasSkillMd: sourceSummary.files.some((file) => path.basename(file.path).toLowerCase() === 'skill.md'),
    updatedAt: new Date().toISOString(),
    currentVersion: nextVersion,
    versionCreatedAt: {
      ...(item.versionCreatedAt || {}),
      [String(nextVersion)]: new Date().toISOString(),
    },
    files: sourceSummary.files,
  }
  items[index] = metadata
  writeIndex(items)
  return publicSkill(metadata)
}

export function readSkillContext(ids, maxChars = 60_000) {
  const wanted = Array.isArray(ids) ? [...new Set(ids.map(String))] : []
  const items = readIndex().filter((entry) => wanted.includes(entry.id))
  const sections = []
  let used = 0
  for (const item of items) {
    const root = path.join(DATA_ROOT, item.id)
    const files = [...(item.files || [])].sort((a, b) => (a.path.toLowerCase() === 'skill.md' ? -1 : b.path.toLowerCase() === 'skill.md' ? 1 : a.path.localeCompare(b.path)))
    for (const file of files) {
      if (used >= maxChars) break
      const absolute = path.join(root, ...file.path.split('/'))
      let content = ''
      try { content = fs.readFileSync(absolute, 'utf8') } catch { continue }
      const room = Math.max(0, maxChars - used)
      const excerpt = content.slice(0, room)
      sections.push(`## Skill: ${item.name}\n### File: ${file.path}\n${excerpt}`)
      used += excerpt.length
    }
  }
  return sections.join('\n\n')
}

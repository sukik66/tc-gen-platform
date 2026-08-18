/**
 * 代码上下文收集 —— 三种策略统一入口
 *
 * 策略 A: 智能检索 — 从需求关键词搜索项目代码，读取匹配文件
 * 策略 B: 指定目录 — 直接扫描用户指定的目录
 * 策略 C: 变更聚合 — 时间范围内改动文件去重，读最终版
 */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as plastic from './plastic.js'
import * as git from './git.js'
import { getRepo } from './repos.js'
import { normalizeWindowsPath } from '../localConfig.js'

const execP = promisify(execFile)
const CM = normalizeWindowsPath(process.env.PLASTIC_CM_PATH) || 'C:\\Program Files\\PlasticSCM5\\client\\cm.exe'

const CODE_EXTS = new Set([
  '.cs', '.lua', '.py', '.js', '.ts', '.java', '.go', '.cpp', '.c', '.h',
  '.hpp', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.proto', '.sql', '.vue', '.jsx', '.tsx', '.kt', '.swift', '.rs',
  '.prefab',
])

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.plastic', 'bin', 'obj', 'Library', 'Temp',
  'Logs', 'Build', 'Builds', '.vs', '.idea', '__pycache__', 'dist',
  'Packages', 'ProjectSettings', 'UserSettings',
])

const MAX_FILE_SIZE = 80_000
const MAX_TOTAL_CHARS = 120_000

/**
 * 智能检索单仓命中文件上限（传给 smartSearch 的 slice）。
 * - 未设置：默认 80（避免用例 JSON 等误提关键词时全仓 grep 并集爆炸）
 * - SMART_SEARCH_MAX_FILES=0：显式不限制（旧行为）
 * - 其他正整数：按值截断
 */
function smartSearchMaxFilesCap() {
  const v = process.env.SMART_SEARCH_MAX_FILES
  if (v === undefined || v === '') return 80
  const n = parseInt(String(v).trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 80
  if (n === 0) return Infinity
  return n
}

/** 与前端 docKeywordNormalize 一致，减少无意义空白扰动关键词 */
function normalizeKeywordSourceText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u00a0\u200b-\u200d\ufeff\u2028\u2029]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isCodeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return CODE_EXTS.has(ext)
}

function shouldSkipDir(dirName) {
  return IGNORE_DIRS.has(dirName) || dirName.startsWith('.')
}

/* ================================================================
 * 策略 A: 智能检索 — 关键词 → 文件名/内容搜索 → 读取匹配文件
 * ================================================================ */

/**
 * @param {string} repoPath  项目根路径
 * @param {string[]} keywords  搜索关键词
 * @param {object} [opts]
 * @param {number} [opts.maxFiles]  可选硬上限；与 SMART_SEARCH_MAX_FILES 取较小值（默认单仓约 80，见 smartSearchMaxFilesCap）
 * @param {string} [opts.repoType='plastic'|'git']
 * @returns {Promise<{ files: { path: string, reason: string }[], contents: { path: string, content: string }[] }>}
 */
export async function smartSearch(repoPath, keywords, { maxFiles, repoType = 'plastic' } = {}) {
  const matchedFiles = new Map()

  for (const kw of keywords) {
    if (!kw.trim()) continue

    const nameHits = await searchFileNames(repoPath, kw)
    for (const f of nameHits) {
      if (!matchedFiles.has(f)) matchedFiles.set(f, `文件名匹配「${kw}」`)
    }

    if (repoType === 'git') {
      const grepHits = await git.grepCode(repoPath, kw, { filePattern: '*.cs' })
        .catch(() => [])
      for (const line of grepHits) {
        const filePath = line.split(':')[0]
        if (filePath && isCodeFile(filePath) && !matchedFiles.has(filePath)) {
          matchedFiles.set(filePath, `内容包含「${kw}」`)
        }
      }
    } else {
      const contentHits = await grepInDirectory(repoPath, kw)
      for (const f of contentHits) {
        if (!matchedFiles.has(f)) matchedFiles.set(f, `内容包含「${kw}」`)
      }
    }
  }

  const cap = Math.min(
    maxFiles ?? Infinity,
    smartSearchMaxFilesCap(),
  )

  const files = [...matchedFiles.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .slice(0, Number.isFinite(cap) ? cap : undefined)
    .map(([p, reason]) => ({ path: p, reason }))

  const contents = await readFilesWithBudget(repoPath, files.map(f => f.path))
  return { files, contents }
}

/** 稳定排序目录项，避免 readdir 顺序随 OS/文件系统变化导致智能检索命中数波动 */
function sortedDirEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

async function searchFileNames(rootPath, keyword) {
  const results = []
  const kw = keyword.toLowerCase()

  function walk(dir, depth = 0) {
    if (depth > 8) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of sortedDirEntries(entries)) {
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) walk(path.join(dir, e.name), depth + 1)
      } else if (isCodeFile(e.name) && e.name.toLowerCase().includes(kw)) {
        results.push(path.relative(rootPath, path.join(dir, e.name)).replace(/\\/g, '/'))
      }
    }
  }
  walk(rootPath)
  return [...new Set(results)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** 内容全文检索（Plastic 目录）：遍历全仓，慢但结果全集；单文件仍受 MAX_FILE_SIZE 跳过 */
async function grepInDirectory(rootPath, keyword) {
  const found = new Set()
  const kw = keyword.toLowerCase()

  function walk(dir, depth = 0) {
    if (depth > 8) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of sortedDirEntries(entries)) {
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) walk(path.join(dir, e.name), depth + 1)
      } else if (isCodeFile(e.name)) {
        const fullPath = path.join(dir, e.name)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.size > MAX_FILE_SIZE) continue
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (content.toLowerCase().includes(kw)) {
            found.add(path.relative(rootPath, fullPath).replace(/\\/g, '/'))
          }
        } catch { /* skip */ }
      }
    }
  }
  walk(rootPath)
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/* ================================================================
 * 策略 B: 指定目录 — 扫描目录下全部代码文件
 * ================================================================ */

/**
 * @param {string} repoPath  项目根路径
 * @param {string} subDir  相对子目录，如 "Assets/Scripts/Tutorial"
 * @param {object} [opts]
 * @param {number} [opts.maxFiles=50]
 * @returns {Promise<{ files: string[], contents: { path: string, content: string }[] }>}
 */
export async function scanDirectory(repoPath, subDir, { maxFiles = 50 } = {}) {
  const targetDir = path.resolve(repoPath, subDir)
  if (!fs.existsSync(targetDir)) {
    throw new Error(`目录不存在: ${subDir}`)
  }

  const files = []
  function walk(dir, depth = 0) {
    if (depth > 10 || files.length >= maxFiles) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of sortedDirEntries(entries)) {
      if (files.length >= maxFiles) break
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) walk(path.join(dir, e.name), depth + 1)
      } else if (isCodeFile(e.name)) {
        files.push(path.relative(repoPath, path.join(dir, e.name)).replace(/\\/g, '/'))
      }
    }
  }
  walk(targetDir)

  const contents = await readFilesWithBudget(repoPath, files)
  return { files, contents }
}

/**
 * 列出某目录下的子目录结构（供前端浏览选择）
 */
export function listSubDirs(repoPath, subDir = '') {
  const targetDir = subDir ? path.resolve(repoPath, subDir) : repoPath
  if (!fs.existsSync(targetDir)) return []
  try {
    return fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !shouldSkipDir(e.name))
      .map(e => e.name)
      .sort()
  } catch { return [] }
}

/* ================================================================
 * 策略 C: 变更聚合 — 时间范围改动文件去重 → 读最终版
 * ================================================================ */

/**
 * @param {string} repoPath
 * @param {string} repoType 'plastic' | 'git'
 * @param {object} opts
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @param {string} [opts.branch]
 * @param {number} [opts.maxFiles=40]
 * @returns {Promise<{ changedFiles: { path: string, status: string }[], contents: { path: string, content: string }[] }>}
 */
export async function aggregateChanges(repoPath, repoType, { since, until, branch, maxFiles = 40 } = {}) {
  let fileMap = new Map()

  if (repoType === 'plastic') {
    const cs = await plastic.listChangesets(repoPath, { since, until, branch, limit: 200 })
    if (cs.length === 0) return { changedFiles: [], contents: [] }

    const oldest = cs[cs.length - 1]
    const newest = cs[0]

    try {
      const files = await plastic.diffChangesets(repoPath, oldest.id, newest.id)
      for (const f of files) {
        if (!fileMap.has(f.path)) fileMap.set(f.path, f.status)
      }
    } catch {
      for (const c of cs.slice(0, 30)) {
        try {
          const detail = await plastic.getChangesetDetail(repoPath, c.id)
          if (detail?.files) {
            for (const f of detail.files) {
              if (!fileMap.has(f.path)) fileMap.set(f.path, f.status)
            }
          }
        } catch { /* skip */ }
      }
    }
  } else {
    if (since) {
      const logArgs = ['log', `--since=${since}`, '--name-status', '--format=']
      if (until) logArgs.push(`--until=${until}`)
      try {
        const raw = await execP('git', logArgs, { cwd: repoPath, timeout: 30000, maxBuffer: 10 * 1024 * 1024 }).then(r => r.stdout)
        for (const line of raw.split('\n').filter(Boolean)) {
          const [status, ...pathParts] = line.split('\t')
          const p = pathParts.join('\t')
          if (p && !fileMap.has(p)) fileMap.set(p, status)
        }
      } catch { /* */ }
    } else if (branch) {
      try {
        const files = await git.branchDiff(repoPath, branch)
        for (const f of files) {
          if (!fileMap.has(f.path)) fileMap.set(f.path, f.status)
        }
      } catch { /* */ }
    }
  }

  const codeFiles = [...fileMap.entries()]
    .filter(([p]) => isCodeFile(p))
    .slice(0, maxFiles)

  const changedFiles = codeFiles.map(([p, s]) => ({ path: p, status: s }))
  const contents = await readFilesWithBudget(repoPath, codeFiles.map(([p]) => p))
  return { changedFiles, contents }
}

/* ================================================================
 * 统一入口：根据策略收集代码上下文，输出 LLM 可用的文本
 * ================================================================ */

/**
 * 列出「应读」路径与已附加正文的 contents，将未出现正文块的路径显式写入 prompt，避免模型误以为文件不存在。
 * @param {string[]} parts
 * @param {string[]} listedPaths
 * @param {{ path: string, content: string }[]} contents
 * @param {Record<string, string>} [pathNotes] path -> 附注（如命中原因、变更状态）
 * @returns {string[]}
 */
function appendOmittedFromBudgetBlock(parts, listedPaths, contents, pathNotes = {}) {
  const loaded = new Set(contents.map((c) => c.path))
  const omitted = listedPaths.filter((p) => !loaded.has(p))
  if (omitted.length === 0) return []
  parts.push('\n### 未纳入本次上下文的文件（单次代码材料总字数上限内未能附加正文）\n')
  parts.push(
    '说明：下列路径出现在上文清单或扫描范围内，但在本次材料中没有对应的 `--- 路径 ---` 代码块；不代表仓库中不存在该文件。\n',
  )
  for (const p of omitted) {
    const note = pathNotes[p]
    parts.push(`- ${p}${note ? ` · ${note}` : ''}\n`)
  }
  return omitted
}

/**
 * @param {{ mode: 'smart'|'directory'|'changes', repos: object[] }} params
 * @returns {Promise<{ text: string, stats: {
 *   textChars: number,
 *   filesMatchedTotal: number,
 *   filesWithBodyTotal: number,
 *   omittedFromBodyTotal: number,
 *   omittedFromBody: string[],
 *   repos: { repoId: string, repoName: string, mode: string, filesMatched: number, filesWithBody: number, omittedFromBody: string[] }[]
 * } }>}
 */
export async function gatherCodeContext(params) {
  const { mode, repos } = params
  const emptyStats = () => ({
    textChars: 0,
    filesMatchedTotal: 0,
    filesWithBodyTotal: 0,
    omittedFromBodyTotal: 0,
    omittedFromBody: [],
    repos: [],
  })
  if (!Array.isArray(repos) || repos.length === 0) {
    return { text: '', stats: emptyStats() }
  }

  const parts = []
  const stats = emptyStats()
  const allOmitted = []
  const allRawFiles = []

  for (const r of repos) {
    const repo = getRepo(r.repoId)
    if (!repo) continue

    try {
      if (r.files?.length) {
        const filePaths = r.files.filter(p => isCodeFile(p))
        const contents = await readFilesWithBudget(repo.path, filePaths)
        if (contents.length === 0) {
          parts.push(`### 仓库 ${repo.name}: 指定文件均无法读取`)
          stats.repos.push({ repoId: r.repoId, repoName: repo.name, mode: 'files', filesMatched: filePaths.length, filesWithBody: 0, omittedFromBody: [] })
          continue
        }
        parts.push(`### 仓库 ${repo.name} — 指定文件 (${filePaths.length} 个)\n`)
        parts.push(formatContents(contents))
        const omitted = appendOmittedFromBudgetBlock(parts, filePaths, contents)
        stats.filesMatchedTotal += filePaths.length
        stats.filesWithBodyTotal += contents.length
        stats.repos.push({ repoId: r.repoId, repoName: repo.name, mode: 'files', filesMatched: filePaths.length, filesWithBody: contents.length, omittedFromBody: omitted })
        allOmitted.push(...omitted)
        allRawFiles.push(...contents.filter(c => !c.content.startsWith('[')))

      } else if (mode === 'smart' && r.keywords?.length) {
        const result = await smartSearch(repo.path, r.keywords, { repoType: repo.type })
        if (result.contents.length === 0) {
          parts.push(`### 仓库 ${repo.name}: 未找到与关键词匹配的代码文件`)
          stats.repos.push({
            repoId: r.repoId,
            repoName: repo.name,
            mode: 'smart',
            filesMatched: result.files.length,
            filesWithBody: 0,
            omittedFromBody: [],
          })
          continue
        }
        parts.push(`### 仓库 ${repo.name} — 智能检索 (匹配 ${result.files.length} 个文件)\n`)
        parts.push(formatFileList(result.files))
        parts.push('')
        parts.push(formatContents(result.contents))
        const listed = result.files.map((f) => f.path)
        const pathNotes = Object.fromEntries(result.files.map((f) => [f.path, f.reason]))
        const omitted = appendOmittedFromBudgetBlock(parts, listed, result.contents, pathNotes)
        stats.filesMatchedTotal += listed.length
        stats.filesWithBodyTotal += result.contents.length
        stats.repos.push({
          repoId: r.repoId,
          repoName: repo.name,
          mode: 'smart',
          filesMatched: listed.length,
          filesWithBody: result.contents.length,
          omittedFromBody: omitted,
        })
        allOmitted.push(...omitted)
        allRawFiles.push(...result.contents.filter(c => !c.content.startsWith('[')))

      } else if (mode === 'directory' && r.directory) {
        const result = await scanDirectory(repo.path, r.directory)
        if (result.contents.length === 0) {
          parts.push(`### 仓库 ${repo.name}: 目录 ${r.directory} 下无代码文件`)
          stats.repos.push({
            repoId: r.repoId,
            repoName: repo.name,
            mode: 'directory',
            filesMatched: result.files.length,
            filesWithBody: 0,
            omittedFromBody: [],
          })
          continue
        }
        parts.push(`### 仓库 ${repo.name} — 目录 ${r.directory} (${result.files.length} 个文件)\n`)
        parts.push(formatContents(result.contents))
        const omitted = appendOmittedFromBudgetBlock(parts, result.files, result.contents)
        stats.filesMatchedTotal += result.files.length
        stats.filesWithBodyTotal += result.contents.length
        stats.repos.push({
          repoId: r.repoId,
          repoName: repo.name,
          mode: 'directory',
          filesMatched: result.files.length,
          filesWithBody: result.contents.length,
          omittedFromBody: omitted,
        })
        allOmitted.push(...omitted)
        allRawFiles.push(...result.contents.filter(c => !c.content.startsWith('[')))

      } else if (mode === 'changes') {
        const result = await aggregateChanges(repo.path, repo.type, {
          since: r.since, until: r.until, branch: r.branch,
        })
        if (result.changedFiles.length === 0) {
          parts.push(`### 仓库 ${repo.name}: 该范围内无代码文件变更`)
          stats.repos.push({
            repoId: r.repoId,
            repoName: repo.name,
            mode: 'changes',
            filesMatched: 0,
            filesWithBody: 0,
            omittedFromBody: [],
          })
          continue
        }
        parts.push(`### 仓库 ${repo.name} — 变更文件聚合 (${result.changedFiles.length} 个代码文件)\n`)
        parts.push('变更文件清单:')
        for (const f of result.changedFiles) {
          parts.push(`  ${f.status}\t${f.path}`)
        }
        parts.push('')
        parts.push(formatContents(result.contents))
        const listed = result.changedFiles.map((f) => f.path)
        const pathNotes = Object.fromEntries(
          result.changedFiles.map((f) => [f.path, `变更状态 ${f.status}`]),
        )
        const omitted = appendOmittedFromBudgetBlock(parts, listed, result.contents, pathNotes)
        stats.filesMatchedTotal += listed.length
        stats.filesWithBodyTotal += result.contents.length
        stats.repos.push({
          repoId: r.repoId,
          repoName: repo.name,
          mode: 'changes',
          filesMatched: listed.length,
          filesWithBody: result.contents.length,
          omittedFromBody: omitted,
        })
        allOmitted.push(...omitted)
        allRawFiles.push(...result.contents.filter(c => !c.content.startsWith('[')))

      } else {
        parts.push(`### 仓库 ${repo.name}: 未配置有效的检索参数`)
      }
    } catch (e) {
      parts.push(`### 仓库 ${repo.name}: 获取代码上下文失败 — ${e.message}`)
    }
  }

  const text = parts.join('\n')
  stats.textChars = text.length
  stats.omittedFromBody = [...new Set(allOmitted)]
  stats.omittedFromBodyTotal = stats.omittedFromBody.length
  return { text, stats, rawFiles: allRawFiles }
}

/* ================================================================
 * 通用工具
 * ================================================================ */

async function readFilesWithBudget(rootPath, relPaths) {
  const result = []
  let totalChars = 0

  for (const relPath of relPaths) {
    if (totalChars >= MAX_TOTAL_CHARS) break
    const fullPath = path.resolve(rootPath, relPath)
    try {
      const stat = fs.statSync(fullPath)
      if (stat.size > MAX_FILE_SIZE) {
        result.push({ path: relPath, content: `[文件过大: ${(stat.size / 1024).toFixed(0)}KB, 已跳过]` })
        continue
      }
      const content = fs.readFileSync(fullPath, 'utf-8')
      const budget = MAX_TOTAL_CHARS - totalChars
      const trimmed = content.length > budget ? content.slice(0, budget) + '\n... (截断)' : content
      result.push({ path: relPath, content: trimmed })
      totalChars += trimmed.length
    } catch {
      result.push({ path: relPath, content: '[无法读取]' })
    }
  }

  return result
}

function formatFileList(files) {
  return files.map(f => `  ${f.reason} → ${f.path}`).join('\n')
}

function formatContents(contents) {
  return contents.map(c =>
    `\n--- ${c.path} ---\n${c.content}`
  ).join('\n')
}

/* ================================================================
 * 关键词自动提取 — 从需求文本中提取可能的模块名/类名/功能词
 * ================================================================ */

/**
 * 用例 JSON / 通用导出里的字段名、过短英文，作关键词会在 C# 工程里大面积误命中（caseType/description 等）
 */
/** 与侧栏「测试类型」选项重合的文案，在参考用例 JSON 里大量出现，勿当代码检索词 */
const KEYWORD_CASE_TYPE_LABEL_NOISE = new Set(
  [
    '功能测试', '弱网测试', '异常操作', '协议安全', '客户端性能', '服务端性能',
    '兼容适配', '容灾容错', 'ui/ux体验', 'checklist',
  ].map((s) => s.toLowerCase()),
)

const KEYWORD_GENERIC_LABEL_NOISE = new Set(['参考用例', '测试用例', '用例库', '需求文档'])

/** 本页「参考用例 JSON」等结构里的字段名，勿当代码检索词（易全仓误命中） */
const KEYWORD_JSON_FIELD_NOISE = new Set([
  'casetype', 'submodule', 'description', 'preconditions', 'steps', 'expected', 'remarks',
  'summary', 'priority', 'module', 'cases', 'tags', 'source', 'addedat', 'updatedat',
  'projectid', 'moduleid', 'documentrole', 'extractedtext', 'mimetype',
  'boolean', 'number', 'string', 'array', 'object', 'null', 'undefined',
])

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '它', '后', '所以', '什么', '因为', '如果', '可以', '这个',
  '但是', '而且', '或者', '以及', '等等', '其中', '通过', '进行', '进入', '需要',
  '功能', '系统', '模块', '测试', '用例', '文档', '需求', '设计', '实现', '支持',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'and', 'or', 'but', 'not', 'no', 'if', 'then', 'else', 'when', 'this',
  'that', 'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her',
])

/**
 * 从需求文本中提取搜索关键词
 * 优先提取：英文标识符（PascalCase/camelCase/UPPER_CASE）、中文功能名词
 * @param {string} text 需求文本（可以是多个文档拼接）
 * @param {string} [fileName] 文件名（从文件名也提取线索）
 * @returns {string[]} 去重排序后的关键词列表
 */
export function extractKeywords(text, fileName) {
  const keywords = new Map()
  text = normalizeKeywordSourceText(text)

  const addKw = (word, weight = 1) => {
    const w = word.trim()
    if (!w || w.length < 2) return
    const lower = w.toLowerCase()
    if (STOP_WORDS.has(lower) || STOP_WORDS.has(w)) return
    if (KEYWORD_JSON_FIELD_NOISE.has(lower)) return
    if (KEYWORD_CASE_TYPE_LABEL_NOISE.has(lower)) return
    if (KEYWORD_GENERIC_LABEL_NOISE.has(lower)) return
    /** 用例 JSON 碎片 / 优先级字面量，勿进检索 */
    if (/^p[0-2]$/i.test(w)) return
    if (/[{}\[\]:"',]{2}/.test(w)) return
    if (/^[，,。.；;'"'"'\s:：]+/.test(w)) return
    if (!/[\u4e00-\u9fa5]/.test(w) && !/[a-zA-Z]{3,}/.test(w)) return
    keywords.set(w, (keywords.get(w) || 0) + weight)
  }

  if (fileName) {
    const base = fileName.replace(/\.[^.]+$/, '')
    const nameWords = base.split(/[-_\s,，、]+/).filter(Boolean)
    for (const w of nameWords) addKw(w, 5)
  }

  const englishIds = text.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)+/g) || []
  for (const id of englishIds) addKw(id, 3)

  const upperIds = text.match(/[A-Z][A-Z_]{2,}/g) || []
  for (const id of upperIds) addKw(id, 2)

  const camelIds = text.match(/[a-z]+(?:[A-Z][a-z]+)+/g) || []
  for (const id of camelIds) addKw(id, 2)

  const quoted = text.match(/[「」""《》]([^「」""《》]{2,20})[「」""《》]/g) || []
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim()
    addKw(inner, 4)
  }

  const cnPatterns = [
    /[\u4e00-\u9fa5]{2,8}(?:系统|模块|功能|管理|界面|面板|窗口|弹窗|按钮|流程|逻辑|机制|引导|教程)/g,
    /(?:新手|引导|教程|商城|背包|任务|技能|战斗|登录|注册|设置|充值|签到|成就|排行|好友|聊天|邮件|公告|活动|抽奖|掉落|装备|养成|升级|匹配|结算)[\u4e00-\u9fa5]{0,4}/g,
  ]
  for (const pat of cnPatterns) {
    const matches = text.match(pat) || []
    for (const m of matches) addKw(m, 3)
  }

  const singleEnglish = text.match(/\b[A-Z][a-z]{3,15}\b/g) || []
  for (const w of singleEnglish) {
    if (!/^(This|That|These|Those|When|Then|What|Where|Which|There|Here|From|With|About|After|Before|Under|Over|Into|Upon)$/.test(w)) {
      addKw(w, 1)
    }
  }

  const sorted = [...keywords.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([w]) => w)

  // 去除被更长关键词包含的子串
  const deduped = sorted.filter((w, i) =>
    !sorted.some((other, j) => j !== i && other.length > w.length && other.toLowerCase().includes(w.toLowerCase()))
  )

  return deduped.slice(0, 12)
}

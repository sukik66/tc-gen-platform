/**
 * Plastic SCM CLI 封装
 * 通过 cm 命令行获取变更集、diff、文件列表等
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { normalizeWindowsPath } from '../localConfig.js'

const exec = promisify(execFile)
const CM = normalizeWindowsPath(process.env.PLASTIC_CM_PATH) || 'C:\\Program Files\\PlasticSCM5\\client\\cm.exe'
const TIMEOUT = 30_000

async function cm(args, cwd) {
  const { stdout } = await exec(CM, args, {
    cwd,
    timeout: TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

/**
 * 列出变更集（按时间范围或分支）
 * @returns {{ id: number, date: string, owner: string, comment: string, branch: string, guid: string }[]}
 */
export async function listChangesets(repoPath, { branch, since, until, limit = 50 } = {}) {
  const fmt = '{changesetid}|{date}|{owner}|{comment}|{branch}|{guid}'

  if (branch) {
    const args = ['find', 'changesets', `where branch='${branch}'`, `--format=${fmt}`, `--nototal`]
    const raw = await cm(args, repoPath)
    return parseChangesets(raw).slice(0, limit)
  }

  if (since) {
    const sinceStr = since instanceof Date ? formatPlasticDate(since) : since
    let where = `date > '${sinceStr}'`
    if (until) {
      const untilStr = until instanceof Date ? formatPlasticDate(until) : until
      where += ` and date < '${untilStr}'`
    }
    const args = ['find', 'changesets', `where ${where}`, `--format=${fmt}`, '--nototal']
    const raw = await cm(args, repoPath)
    return parseChangesets(raw).slice(0, limit)
  }

  const args = ['log', '--csformat=' + fmt, `--itemformat=`]
  const raw = await cm(args, repoPath)
  return parseChangesets(raw).slice(0, limit)
}

/**
 * 获取单个变更集详情（含变更文件列表）
 * 使用 cm find 获取元信息 + cm diff 获取文件列表（cm log --itemformat 不可靠）
 */
export async function getChangesetDetail(repoPath, csId) {
  const fmt = '{changesetid}|{date}|{owner}|{comment}|{branch}|{parent}'
  const args = ['find', 'changesets', `where changesetid=${csId}`, `--format=${fmt}`, '--nototal']
  const raw = await cm(args, repoPath)
  const line = raw.trim().split('\n').filter(Boolean)[0]
  if (!line) return null

  const parts = line.split('|')
  const cs = {
    id: parseInt(parts[0], 10),
    date: parts[1] || '',
    owner: parts[2] || '',
    comment: parts[3] || '',
    branch: parts[4] || '',
    parentId: parts[5]?.trim() || null,
  }

  let files = []
  if (cs.parentId && /^\d+$/.test(cs.parentId)) {
    try {
      const diffArgs = ['diff', `cs:${cs.parentId}`, `cs:${csId}`, '--format={status} {path}']
      const diffRaw = await cm(diffArgs, repoPath)
      files = diffRaw.trim().split('\n').filter(Boolean).map(l => {
        const status = l.charAt(0)
        const p = l.slice(2).trim().replace(/^"|"$/g, '')
        return { status: statusLabel(status), path: p }
      })
    } catch { /* diff 失败时返回空文件列表 */ }
  }

  return { ...cs, files }
}

/**
 * 获取两个变更集之间的 diff（文件级变更列表）
 */
export async function diffChangesets(repoPath, fromCs, toCs) {
  const args = ['diff', `cs:${fromCs}`, `cs:${toCs}`, '--format={status} {path}']
  const raw = await cm(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const status = line.charAt(0)
    const path = line.slice(2).trim().replace(/^"|"$/g, '')
    return { status: statusLabel(status), path }
  })
}

/**
 * 列出分支
 */
export async function listBranches(repoPath, { limit = 50 } = {}) {
  const fmt = '{name}|{date}|{owner}|{comment}'
  const args = ['find', 'branches', `--format=${fmt}`, '--nototal']
  const raw = await cm(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const [name, date, owner, comment] = line.split('|')
    return { name, date, owner, comment: comment || '' }
  }).slice(-limit)
}

/**
 * 获取分支上所有变更集的合并 diff
 */
export async function branchDiff(repoPath, branchName) {
  const args = ['diff', `br:${branchName}`, '--format={status} {path}']
  const raw = await cm(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const status = line.charAt(0)
    const path = line.slice(2).trim().replace(/^"|"$/g, '')
    return { status: statusLabel(status), path }
  })
}

/**
 * 获取文件内容（指定变更集版本）
 */
export async function showFile(repoPath, filePath, csId) {
  const spec = `${filePath}#cs:${csId}`
  const args = ['cat', spec]
  try {
    return await cm(args, repoPath)
  } catch {
    return null
  }
}

const TEXT_EXTS = new Set([
  '.cs', '.lua', '.py', '.js', '.ts', '.java', '.go', '.cpp', '.c', '.h',
  '.hpp', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.txt', '.md', '.csv', '.sql', '.sh', '.bat', '.ps1', '.proto', '.html',
  '.css', '.scss', '.less', '.vue', '.jsx', '.tsx', '.rb', '.rs', '.swift',
  '.kt', '.gradle', '.cmake', '.makefile', '.dockerfile',
])

function isTextFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return TEXT_EXTS.has(ext)
}

/**
 * 获取变更集的代码级 diff 内容
 * 使用 cm diff 获取文件列表 + cm cat 获取新旧版本并计算差异
 * @returns {string} 格式化的 diff 摘要
 */
export async function changesetDiffContent(repoPath, csId, { maxFiles = 15, maxFileChars = 8000 } = {}) {
  const detail = await getChangesetDetail(repoPath, csId)
  if (!detail) return `变更集 cs:${csId} 不存在`
  if (!detail.files?.length) return `变更集 cs:${csId} [${detail.date}] ${detail.comment} — 无文件变更（可能是合并提交）`

  const parentCsId = detail.parentId
  const textFiles = detail.files.filter(f => isTextFile(f.path))
  const binaryFiles = detail.files.filter(f => !isTextFile(f.path))

  const parts = [
    `#### 变更集 ${csId} [${detail.date}] ${detail.comment}`,
    `  文件: ${detail.files.length} (代码文件 ${textFiles.length}, 二进制 ${binaryFiles.length})`,
  ]

  if (binaryFiles.length > 0 && binaryFiles.length <= 5) {
    parts.push(`  二进制/资源: ${binaryFiles.map(f => f.path.split(/[\\/]/).pop()).join(', ')}`)
  }

  let processed = 0
  for (const f of textFiles) {
    if (processed >= maxFiles) {
      parts.push(`\n... 还有 ${textFiles.length - processed} 个代码文件未展示`)
      break
    }

    if (f.status === 'deleted') {
      parts.push(`\n  [已删除] ${f.path}`)
      processed++
      continue
    }

    const newContent = await showFile(repoPath, f.path, csId)
    if (!newContent) {
      parts.push(`  [无法读取] ${f.path}`)
      processed++
      continue
    }

    if (f.status === 'added') {
      parts.push(`\n--- 新增: ${f.path} ---`)
      parts.push(newContent.slice(0, maxFileChars))
      if (newContent.length > maxFileChars) parts.push('... (截断)')
    } else if (parentCsId) {
      const oldContent = await showFile(repoPath, f.path, parentCsId)
      if (oldContent && oldContent !== newContent) {
        const diff = simpleDiff(oldContent, newContent, f.path)
        parts.push(diff.slice(0, maxFileChars))
        if (diff.length > maxFileChars) parts.push('... (截断)')
      } else if (!oldContent) {
        parts.push(`\n--- 新增: ${f.path} ---`)
        parts.push(newContent.slice(0, maxFileChars))
        if (newContent.length > maxFileChars) parts.push('... (截断)')
      }
    } else {
      parts.push(`\n--- ${f.path} (完整内容) ---`)
      parts.push(newContent.slice(0, maxFileChars))
      if (newContent.length > maxFileChars) parts.push('... (截断)')
    }
    processed++
  }

  return parts.join('\n')
}

/**
 * 获取两个变更集之间的代码级 diff（合并多文件差异）
 */
export async function diffChangesetsContent(repoPath, fromCs, toCs, { maxFiles = 20, maxFileChars = 6000 } = {}) {
  const files = await diffChangesets(repoPath, fromCs, toCs)
  if (!files.length) return '无文件差异'

  const textFiles = files.filter(f => isTextFile(f.path))
  const binaryFiles = files.filter(f => !isTextFile(f.path))
  const parts = [`### Diff: cs:${fromCs} → cs:${toCs}`, `涉及 ${files.length} 个文件 (代码 ${textFiles.length}, 二进制 ${binaryFiles.length})\n`]

  let processed = 0
  for (const f of textFiles) {
    if (processed >= maxFiles) {
      parts.push(`\n... 还有 ${textFiles.length - processed} 个代码文件未展示`)
      break
    }

    if (f.status === 'deleted') {
      parts.push(`  [已删除] ${f.path}`)
      processed++
      continue
    }

    const newContent = await showFile(repoPath, f.path, toCs)
    if (f.status === 'added' && newContent) {
      parts.push(`\n--- 新增: ${f.path} ---`)
      parts.push(newContent.slice(0, maxFileChars))
      if (newContent.length > maxFileChars) parts.push('... (截断)')
    } else if (newContent) {
      const oldContent = await showFile(repoPath, f.path, fromCs)
      if (oldContent && oldContent !== newContent) {
        const diff = simpleDiff(oldContent, newContent, f.path)
        parts.push(diff.slice(0, maxFileChars))
        if (diff.length > maxFileChars) parts.push('... (截断)')
      } else if (!oldContent) {
        parts.push(`\n--- 新增: ${f.path} ---`)
        parts.push(newContent.slice(0, maxFileChars))
        if (newContent.length > maxFileChars) parts.push('... (截断)')
      }
    }
    processed++
  }

  return parts.join('\n')
}

/**
 * 获取分支的代码级 diff
 */
export async function branchDiffContent(repoPath, branchName, { maxFiles = 20, maxFileChars = 6000 } = {}) {
  const files = await branchDiff(repoPath, branchName)
  if (!files.length) return `分支 ${branchName} 无差异`

  const parts = [`### 分支差异: ${branchName}`, `涉及 ${files.length} 个文件\n`]

  let processed = 0
  for (const f of files) {
    if (processed >= maxFiles) {
      parts.push(`\n... 还有 ${files.length - processed} 个文件未展示`)
      break
    }

    parts.push(`  ${f.status}\t${f.path}`)
    processed++
  }

  return parts.join('\n')
}

/**
 * 简单行级 diff（无需外部库）
 * 输出类 unified diff 格式，标记新增/删除行
 */
function simpleDiff(oldText, newText, filePath) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const parts = [`\n--- ${filePath} (变更前)`, `+++ ${filePath} (变更后)`]

  const contextSize = 2
  const changes = []
  const maxLines = Math.max(oldLines.length, newLines.length)

  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  const removedLines = oldLines.filter((l, i) => !newSet.has(l)).slice(0, 50)
  const addedLines = newLines.filter((l, i) => !oldSet.has(l)).slice(0, 50)

  if (removedLines.length === 0 && addedLines.length === 0) {
    return `\n${filePath}: 内容相同（可能仅空格/换行差异）`
  }

  if (removedLines.length > 0) {
    parts.push(`  删除 ${removedLines.length} 行:`)
    for (const l of removedLines.slice(0, 20)) {
      parts.push(`- ${l}`)
    }
    if (removedLines.length > 20) parts.push(`  ... 还有 ${removedLines.length - 20} 行删除`)
  }

  if (addedLines.length > 0) {
    parts.push(`  新增 ${addedLines.length} 行:`)
    for (const l of addedLines.slice(0, 30)) {
      parts.push(`+ ${l}`)
    }
    if (addedLines.length > 30) parts.push(`  ... 还有 ${addedLines.length - 30} 行新增`)
  }

  return parts.join('\n')
}

/* ---------- 内部工具 ---------- */

function parseChangesets(raw) {
  return raw.trim().split('\n').filter(Boolean).map(parseChangesetLine).filter(Boolean)
}

function parseChangesetLine(line) {
  const parts = line.split('|')
  if (parts.length < 5) return null
  return {
    id: parseInt(parts[0], 10),
    date: parts[1],
    owner: parts[2],
    comment: parts[3] || '',
    branch: parts[4],
    guid: parts[5] || '',
  }
}

function statusLabel(s) {
  const map = { A: 'added', C: 'changed', D: 'deleted', M: 'moved' }
  return map[s] || s
}

function formatPlasticDate(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

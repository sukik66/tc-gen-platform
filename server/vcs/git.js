/**
 * Git CLI 封装
 * 通过 git 命令行获取 commit、diff、文件内容等
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)
const TIMEOUT = 30_000

async function git(args, cwd) {
  const { stdout } = await exec('git', args, {
    cwd,
    timeout: TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

/**
 * 列出 commits（按分支/时间范围/数量）
 * @returns {{ hash: string, date: string, author: string, message: string }[]}
 */
export async function listCommits(repoPath, { branch, since, until, limit = 50 } = {}) {
  const fmt = '%H|%aI|%an|%s'
  const args = ['log', `--format=${fmt}`, `-n`, String(limit)]
  if (branch) args.push(branch)
  if (since) args.push(`--since=${since}`)
  if (until) args.push(`--until=${until}`)
  const raw = await git(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const [hash, date, author, ...msgParts] = line.split('|')
    return { hash, date, author, message: msgParts.join('|') }
  })
}

/**
 * 获取两个 commit 之间的 diff（文件级变更列表）
 */
export async function diffCommits(repoPath, fromHash, toHash) {
  const args = ['diff', '--name-status', fromHash, toHash]
  const raw = await git(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const [status, ...pathParts] = line.split('\t')
    return { status: gitStatusLabel(status), path: pathParts.join('\t') }
  })
}

/**
 * 获取单个 commit 的 diff（含具体代码变更）
 */
export async function commitDiff(repoPath, hash, { contextLines = 3 } = {}) {
  const args = ['show', hash, `--format=`, `-U${contextLines}`, '--stat']
  return git(args, repoPath)
}

/**
 * 获取分支相对于 main 的合并 diff
 */
export async function branchDiff(repoPath, branchName, baseBranch = 'main') {
  const mergeBase = (await git(['merge-base', baseBranch, branchName], repoPath)).trim()
  const args = ['diff', '--name-status', mergeBase, branchName]
  const raw = await git(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const [status, ...pathParts] = line.split('\t')
    return { status: gitStatusLabel(status), path: pathParts.join('\t') }
  })
}

/**
 * 获取分支相对于 main 的详细 diff 内容
 */
export async function branchDiffContent(repoPath, branchName, baseBranch = 'main', { contextLines = 3 } = {}) {
  const mergeBase = (await git(['merge-base', baseBranch, branchName], repoPath)).trim()
  return git(['diff', `-U${contextLines}`, mergeBase, branchName], repoPath)
}

/**
 * 获取时间范围内的详细 diff 内容
 */
export async function timeDiffContent(repoPath, since, until, { contextLines = 3 } = {}) {
  const logArgs = ['log', `--since=${since}`, '--format=%H', '-1']
  if (until) logArgs.push(`--until=${until}`)
  const firstHash = (await git(logArgs, repoPath)).trim()
  if (!firstHash) return ''

  const logArgs2 = ['log', `--since=${since}`, '--format=%H']
  if (until) logArgs2.push(`--until=${until}`)
  const hashes = (await git(logArgs2, repoPath)).trim().split('\n').filter(Boolean)
  if (hashes.length < 2) {
    return git(['show', firstHash, '--format=', `-U${contextLines}`], repoPath)
  }
  const oldest = hashes[hashes.length - 1]
  const newest = hashes[0]
  return git(['diff', `-U${contextLines}`, `${oldest}~1`, newest], repoPath).catch(() =>
    git(['diff', `-U${contextLines}`, oldest, newest], repoPath)
  )
}

/**
 * 列出分支
 */
export async function listBranches(repoPath, { limit = 50 } = {}) {
  const args = ['branch', '-a', '--sort=-committerdate', `--format=%(refname:short)|%(committerdate:iso)|%(authorname)|%(subject)`]
  const raw = await git(args, repoPath)
  return raw.trim().split('\n').filter(Boolean).slice(0, limit).map(line => {
    const [name, date, author, subject] = line.split('|')
    return { name, date, author, comment: subject || '' }
  })
}

/**
 * 获取文件内容（指定 commit）
 */
export async function showFile(repoPath, filePath, hash = 'HEAD') {
  try {
    return await git(['show', `${hash}:${filePath}`], repoPath)
  } catch {
    return null
  }
}

/**
 * grep 搜索（找函数调用）
 */
export async function grepCode(repoPath, pattern, { filePattern } = {}) {
  const args = ['grep', '-n', '-I', pattern]
  if (filePattern) args.push('--', filePattern)
  try {
    const raw = await git(args, repoPath)
    /* 不截断行数：智能检索侧按路径去重；超大仓库若 OOM 可调低 GIT_GREP_MAX_LINES */
    const maxLines = Math.min(
      parseInt(process.env.GIT_GREP_MAX_LINES || '200000', 10) || 200000,
      500000,
    )
    return raw.trim().split('\n').filter(Boolean).sort().slice(0, maxLines)
  } catch {
    return []
  }
}

/* ---------- 内部工具 ---------- */

function gitStatusLabel(s) {
  const map = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' }
  return map[s] || s
}

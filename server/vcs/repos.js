/**
 * 仓库配置管理
 * 存储在 server/data/repos.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const REPOS_FILE = path.join(DATA_DIR, 'repos.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadRepos() {
  ensureDir()
  if (!existsSync(REPOS_FILE)) return []
  try {
    return JSON.parse(readFileSync(REPOS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveRepos(repos) {
  ensureDir()
  writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2), 'utf-8')
}

/**
 * 获取所有仓库配置
 * @returns {{ id: string, name: string, type: 'plastic'|'git', path: string, branch?: string }[]}
 */
export function getAllRepos() {
  return loadRepos()
}

/**
 * 获取单个仓库配置
 */
export function getRepo(id) {
  return loadRepos().find(r => r.id === id) || null
}

/**
 * 添加/更新仓库配置
 */
export function upsertRepo(repo) {
  const repos = loadRepos()
  const idx = repos.findIndex(r => r.id === repo.id)
  const entry = {
    id: repo.id,
    name: repo.name || repo.id,
    type: repo.type || 'git',
    path: repo.path,
    branch: repo.branch || '',
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) {
    repos[idx] = { ...repos[idx], ...entry }
  } else {
    entry.createdAt = new Date().toISOString()
    repos.push(entry)
  }
  saveRepos(repos)
  return entry
}

/**
 * 删除仓库配置
 */
export function deleteRepo(id) {
  const repos = loadRepos().filter(r => r.id !== id)
  saveRepos(repos)
}

/**
 * 初始化默认仓库（用于 C:\Demo 下四个项目）
 */
export function initDefaultRepos() {
  const repos = loadRepos()
  if (repos.length > 0) return repos

  const defaults = [
    { id: 'client', name: 'Client', type: 'plastic', path: 'C:\\Demo\\client' },
    { id: 'ds', name: 'DS (战斗服)', type: 'plastic', path: 'C:\\Demo\\ds' },
    { id: 'config', name: 'Config', type: 'plastic', path: 'C:\\Demo\\config' },
    { id: 'gameplay', name: 'Gameplay (局外服务端)', type: 'git', path: 'C:\\Demo\\gameplay' },
  ]

  for (const d of defaults) {
    upsertRepo(d)
  }
  return loadRepos()
}

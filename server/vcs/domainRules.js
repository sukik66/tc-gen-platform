/**
 * 域规则双层加载（ST-003 · DATA.1）
 *
 * 双层来源：
 *   1. 内置 UNITY_DOMAIN_MAP（来自 code-review-agent.js BUILTIN_UNITY_DOMAIN_MAP）
 *   2. data/unity-domain-rules.json（用户已批准的 AI 提案规则，启动时合并）
 *
 * 序列化：
 *   - 内存中 keywords 是正则；落盘为字符串 → loadDomainRulesFromFile 时转回 RegExp
 *   - 落盘 schema：{ keywords: string, hints: string[], fileKeywords: string[],
 *                   approvedAt?: string, sourceProposalId?: string }
 *
 * 热加载：approve 端点写完文件后调 reloadDomainRules() 即可生效，无需重启服务
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const UNITY_RULES_FILE = path.join(DATA_DIR, 'unity-domain-rules.json')

/** @type {{ keywords: RegExp, hints: string[], fileKeywords: string[] }[]} */
let mergedDomainMap = []

/** @type {{ keywords: RegExp, hints: string[], fileKeywords: string[] }[]} */
let builtinSnapshot = []

/**
 * 初始化：注入内置 BUILTIN_UNITY_DOMAIN_MAP 并合并文件层
 * 由 code-review-agent.js 在启动时调用一次
 */
export function initDomainRules(builtin) {
  builtinSnapshot = Array.isArray(builtin) ? builtin.slice() : []
  reloadDomainRules()
}

/** 重新加载 data/unity-domain-rules.json 与内置层合并（热加载入口） */
export function reloadDomainRules() {
  const fileLayer = loadDomainRulesFromFile()
  mergedDomainMap = [...builtinSnapshot, ...fileLayer]
  return mergedDomainMap.length
}

/** 当前合并后的域规则只读视图 */
export function getDomainRules() {
  return mergedDomainMap
}

/**
 * 把用户批准的提案追加到 data/unity-domain-rules.json
 * @param {{ keywords: string, hints: string[], fileKeywords: string[],
 *           sourceProposalId?: string }} entry
 */
export function appendApprovedRule(entry) {
  ensureDataDir()
  /** @type {any[]} */
  let arr = []
  if (fs.existsSync(UNITY_RULES_FILE)) {
    try {
      const raw = fs.readFileSync(UNITY_RULES_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) arr = parsed
    } catch {
      arr = []
    }
  }
  arr.push({
    keywords: String(entry.keywords || '').trim(),
    hints: Array.isArray(entry.hints) ? entry.hints.map(String) : [],
    fileKeywords: Array.isArray(entry.fileKeywords) ? entry.fileKeywords.map(String) : [],
    approvedAt: new Date().toISOString(),
    sourceProposalId: entry.sourceProposalId || undefined,
  })
  fs.writeFileSync(UNITY_RULES_FILE, JSON.stringify(arr, null, 2), 'utf-8')
  reloadDomainRules()
  return arr.length
}

/**
 * 读取 data/unity-domain-rules.json 并把 keywords 字符串转回 RegExp
 * @returns {{ keywords: RegExp, hints: string[], fileKeywords: string[] }[]}
 */
function loadDomainRulesFromFile() {
  if (!fs.existsSync(UNITY_RULES_FILE)) return []
  try {
    const raw = fs.readFileSync(UNITY_RULES_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /** @type {{ keywords: RegExp, hints: string[], fileKeywords: string[] }[]} */
    const result = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const kwStr = String(item.keywords || '').trim()
      if (!kwStr) continue
      let re
      try {
        re = new RegExp(kwStr, 'i')
      } catch {
        // 非法正则 → 自动转义为字面量
        re = new RegExp(kwStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      }
      result.push({
        keywords: re,
        hints: Array.isArray(item.hints) ? item.hints.map(String) : [],
        fileKeywords: Array.isArray(item.fileKeywords) ? item.fileKeywords.map(String) : [],
      })
    }
    return result
  } catch {
    return []
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

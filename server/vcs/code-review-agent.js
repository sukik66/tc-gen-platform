/**
 * CodeReviewSkill — Agent 循环实现
 *
 * 四阶段：
 *   Phase 1  路径侦察 — 模块名 → Unity 目录约定推断候选目录
 *   Phase 2  定向阅读 — LLM 通过 tool calling 自主迭代读文件
 *   Phase 3  逻辑判断 — 规则 × 代码举证（在 Phase 2 循环末尾触发）
 *   Phase 4  结构化输出 — 返回 { conclusion, evidence, confidence, ... } 单层结果（QC-15 与文章原文 IO 对齐）
 *
 * ST-003 / QC-15 能力清单：
 *   - 四工具：listDir / readFile / searchInFile / grepRepo（dirHint 必填、3s 超时、20 命中上限）
 *   - MAX_TOOL_CALLS = 16
 *   - UNITY_DOMAIN_MAP 双层合并加载（内置 + data/unity-domain-rules.json）
 *   - Token 双档闸门：60K chars 软警告 / 70K chars 硬上限（marker 通过 dispatchToolCall 副作用暴露）
 *   - shouldTriggerRuleProposal helper：fallback=true && conclusion=fail（QC-15 后触发条件迁移自 v2 判定矩阵）
 */

import fs from 'fs'
import path from 'path'
import { getRepo } from './repos.js'
import {
  initDomainRules,
  getDomainRules,
  reloadDomainRules,
  appendApprovedRule,
} from './domainRules.js'

/* ================================================================
 * 常量
 * ================================================================ */

const CODE_EXTS = new Set([
  '.cs', '.lua', '.js', '.ts', '.java', '.go', '.cpp', '.c', '.h',
  '.hpp', '.json', '.xml', '.yaml', '.yml', '.proto', '.py',
])

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.plastic', 'bin', 'obj', 'Library', 'Temp',
  'Logs', 'Build', 'Builds', '.vs', '.idea', '__pycache__', 'dist',
  'Packages', 'ProjectSettings', 'UserSettings',
])

/** 单文件读取行数上限 */
const MAX_FILE_LINES = 300

/**
 * agent 工具调用轮次上限（超出强制收尾）
 * ST-003: 12→16（D 改造新增 grepRepo + 反例优先策略后原值不够）
 */
const MAX_TOOL_CALLS = 16

/** 累计读取字符上限（硬上限，超过强制 finalize） */
const MAX_TOTAL_CHARS = 80_000

/** ST-003 Token 双档闸门：软警告（注入 system 提示让模型主动收尾） */
const TOKEN_SOFT_WARN_THRESHOLD = 60_000

/** ST-003 Token 双档闸门：硬上限（强制 finalize 跳出循环 + 禁用 tools） */
const TOKEN_HARD_CAP_THRESHOLD = 70_000

/** grepRepo 工具：单次遍历超时（ms） */
const GREP_REPO_TIMEOUT_MS = 3000

/** grepRepo 工具：单次最大命中数 */
const GREP_REPO_MAX_HITS = 20

/** grepRepo 工具：单文件最大字节数（超过跳过） */
const GREP_REPO_MAX_FILE_BYTES = 500_000

/* ================================================================
 * Phase 1 — 模块名 → 候选目录推断（内置层）
 * ================================================================ */

/**
 * Unity 项目目录约定关键词映射表（内置层）
 * key: 功能域关键词（支持正则）
 * value: 对应的候选目录片段（相对仓库根，支持 glob-like 描述）
 *
 * ST-003: 双层合并加载——本数组为内置层，data/unity-domain-rules.json 为用户批准层
 *         启动时合并到 domainRules.js 的 mergedDomainMap，inferCandidateDirs 消费 getDomainRules()
 */
const BUILTIN_UNITY_DOMAIN_MAP = [
  {
    keywords: /新手引导|tutorial|guide|novice|beginner|引导/i,
    hints: [
      'Assets/Scripts/Client/Managers',
      'Assets/Scripts/Client/UI',
      'Assets/Scripts/ExternalClient/UI',
    ],
    fileKeywords: ['Tutorial', 'Guide', 'Novice', 'Beginner', 'Cutout'],
  },
  {
    keywords: /战斗|battle|combat|skill|技能/i,
    hints: [
      'Assets/Scripts/Client/Systems',
      'Assets/Scripts/Client/Managers',
      'ds/Assets/Scripts',
    ],
    fileKeywords: ['Battle', 'Combat', 'Weapon', 'Skill', 'Fight'],
  },
  {
    keywords: /移动|move|rvo|flowfield|导航/i,
    hints: [
      'Assets/Scripts/Client/Managers/FlowFieldAndRVOManager',
      'Assets/Scripts/Client/Systems',
    ],
    fileKeywords: ['Move', 'RVO', 'FlowField', 'Navigation'],
  },
  {
    keywords: /小地图|minimap|mini.?map/i,
    hints: [
      'Assets/Scripts/Client/BattleUI',
      'Assets/Scripts/Client/Managers',
    ],
    fileKeywords: ['MiniMap', 'Minimap'],
  },
  {
    keywords: /登录|login|账号|account|access/i,
    hints: [
      'Assets/Scripts/ExternalClient/UI/UIPanel',
      'Assets/Scripts/ExternalClient/Managers/AccessManager',
    ],
    fileKeywords: ['Login', 'Account', 'Access'],
  },
  {
    keywords: /匹配|match|房间|room|lobby/i,
    hints: [
      'Assets/Scripts/Client/ClientBootstrap',
    ],
    fileKeywords: ['Match', 'Room', 'Lobby', 'Bootstrap'],
  },
  {
    keywords: /ui|界面|面板|panel|view/i,
    hints: [
      'Assets/Scripts/Client/BattleUI',
      'Assets/Scripts/ExternalClient/UI',
    ],
    fileKeywords: ['Panel', 'View', 'UI', 'Window'],
  },
  {
    keywords: /网络|network|协议|protocol|同步|sync/i,
    hints: [
      'Assets/Scripts/ExternalClient/Managers/AccessManager',
      'Assets/Scripts/Client/ClientBootstrap',
    ],
    fileKeywords: ['Network', 'Protocol', 'Sync', 'Net'],
  },
  {
    keywords: /资源|asset|bundle|ab包|热更/i,
    hints: [
      'Assets/Scripts/ExternalClient/AssetsLoader',
      'Assets/Scripts/ExternalClient/AssetsBundle',
    ],
    fileKeywords: ['Asset', 'Bundle', 'Loader', 'HotFix'],
  },
  {
    keywords: /配置|config|数值|excel|xls/i,
    hints: ['config/', 'ds/Assets/StreamingAssets/ConfigAsset'],
    fileKeywords: ['Config', 'Table', 'Data'],
  },
]

// 模块加载时初始化 domainRules：内置 + 文件层（用户批准的 AI 提案）
initDomainRules(BUILTIN_UNITY_DOMAIN_MAP)

/**
 * Phase 1：从模块名和规则文本推断候选目录与文件关键词
 *
 * 与 `gatherCodeContext`（server/vcs/code-context.js）的关系（PR-0 接通后澄清）：
 * - gatherCodeContext 一次性预收集启动材料（codeContextText），用于兼容 v1 旧契约展示口径
 * - inferCandidateDirs 为 agent 循环（Phase 2）提供 dirHints/fileKeywords/fallback 导航信号
 * - 二者互补不重叠：前者一次性预热文本，后者驱动按需 listDir/readFile/searchInFile/grepRepo 工具调用
 *   （agent 工具循环已受 MAX_TOOL_CALLS=16 / MAX_TOTAL_CHARS=80K + 软硬双档 60K/70K 闸门保护）
 *
 * ST-003: domain map 改为双层合并（内置 + data/unity-domain-rules.json）；
 *         批准的提案规则 reloadDomainRules() 后立即生效
 *
 * @param {string} moduleLabel
 * @param {string} ruleText
 * @returns {{ dirHints: string[], fileKeywords: string[], fallback: boolean }}
 */
export function inferCandidateDirs(moduleLabel, ruleText) {
  const combined = `${moduleLabel} ${ruleText}`.toLowerCase()
  const domainMap = getDomainRules()
  const matched = domainMap.filter((m) => m.keywords.test(combined))

  if (matched.length === 0) {
    return {
      dirHints: ['Assets/Scripts/Client', 'Assets/Scripts/ExternalClient', 'ds/Assets/Scripts'],
      fileKeywords: extractRawKeywords(moduleLabel),
      fallback: true,
    }
  }

  const dirHints = [...new Set(matched.flatMap((m) => m.hints))]
  const fileKeywords = [...new Set(matched.flatMap((m) => m.fileKeywords))]
  return { dirHints, fileKeywords, fallback: false }
}

function extractRawKeywords(text) {
  return text
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 10)
}

/* ================================================================
 * 文件系统工具（供 agent 调用）
 * ================================================================ */

/**
 * 列出目录下一级代码文件与子目录
 * @param {string} repoPath
 * @param {string} relDir
 * @returns {{ files: string[], dirs: string[], error?: string }}
 */
export function listDirForAgent(repoPath, relDir) {
  const abs = path.resolve(repoPath, relDir.replace(/\//g, path.sep))
  try {
    if (!fs.existsSync(abs)) return { files: [], dirs: [], error: `目录不存在: ${relDir}` }
    const entries = fs.readdirSync(abs, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && CODE_EXTS.has(path.extname(e.name).toLowerCase()))
      .map((e) => `${relDir}/${e.name}`.replace(/\\/g, '/'))
    const dirs = entries
      .filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map((e) => `${relDir}/${e.name}`.replace(/\\/g, '/'))
    return { files, dirs }
  } catch (e) {
    return { files: [], dirs: [], error: String(e.message) }
  }
}

/**
 * 读取文件指定行范围
 * @param {string} repoPath
 * @param {string} relFile
 * @param {{ startLine?: number, maxLines?: number }} opts
 * @returns {{ content: string, totalLines: number, truncated: boolean, error?: string }}
 */
export function readFileForAgent(repoPath, relFile, opts = {}) {
  const abs = path.resolve(repoPath, relFile.replace(/\//g, path.sep))
  const startLine = Math.max(0, (opts.startLine ?? 1) - 1) // 转 0-indexed
  const maxLines = opts.maxLines ?? MAX_FILE_LINES
  try {
    if (!fs.existsSync(abs)) return { content: '', totalLines: 0, truncated: false, error: `文件不存在: ${relFile}` }
    const stat = fs.statSync(abs)
    if (stat.size > 500_000) return { content: '', totalLines: 0, truncated: false, error: `文件过大 (${Math.round(stat.size / 1024)}KB)，跳过` }
    const raw = fs.readFileSync(abs, 'utf-8')
    const lines = raw.split('\n')
    const slice = lines.slice(startLine, startLine + maxLines)
    const truncated = startLine + maxLines < lines.length
    return {
      content: slice.join('\n'),
      totalLines: lines.length,
      truncated,
      startLine: startLine + 1,
      endLine: startLine + slice.length,
    }
  } catch (e) {
    return { content: '', totalLines: 0, truncated: false, error: String(e.message) }
  }
}

/**
 * 在单文件内 grep，返回命中行 ± 5 行上下文
 */
export function searchInFileForAgent(repoPath, relFile, pattern) {
  const abs = path.resolve(repoPath, relFile.replace(/\//g, path.sep))
  try {
    if (!fs.existsSync(abs)) return { hits: [], error: `文件不存在: ${relFile}` }
    const lines = fs.readFileSync(abs, 'utf-8').split('\n')
    let re
    try { re = new RegExp(pattern, 'i') } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    const hits = []
    lines.forEach((line, i) => {
      if (re.test(line)) {
        const start = Math.max(0, i - 5)
        const end = Math.min(lines.length - 1, i + 5)
        hits.push({
          lineNumber: i + 1,
          context: lines.slice(start, end + 1).join('\n'),
        })
      }
    })
    return { hits: hits.slice(0, 10) }
  } catch (e) {
    return { hits: [], error: String(e.message) }
  }
}

/**
 * ST-003 D 改造：grepRepo 工具实现（反例优先策略底座）
 *
 * 在 dirHint 子树内深度优先遍历，找文件名命中 + 文件内容命中 pattern 的位置（每文件 ±5 行上下文）
 *
 * 严约束：
 *   - dirHint 必填且非空（在 dispatchToolCall 入口校验，本函数仅信任入参）
 *   - 必须是 dirHints 数组中的元素或其子目录（在 dispatchToolCall 校验）
 *   - 3s 超时返回 partial（避免 IO 风暴）
 *   - 尊重 IGNORE_DIRS / CODE_EXTS / 500KB 上限
 *   - 总命中数 maxHits（默认 20）
 *
 * @param {string} repoPath
 * @param {string} pattern
 * @param {string} dirHint  必须是相对仓库根的目录路径（已校验）
 * @param {{ fileExt?: string, maxHits?: number }} opts
 * @returns {{ hits: Array<{file:string,lineNumber:number,context:string}>,
 *             searchedFiles: number, partial: boolean, error?: string,
 *             searchedPaths: string[] }}
 */
export function grepRepoForAgent(repoPath, pattern, dirHint, opts = {}) {
  const startTs = Date.now()
  const maxHits = Number.isFinite(opts.maxHits) && opts.maxHits > 0
    ? Math.min(GREP_REPO_MAX_HITS, opts.maxHits)
    : GREP_REPO_MAX_HITS
  const fileExt = opts.fileExt
    ? String(opts.fileExt).toLowerCase().replace(/^\./, '')
    : null

  const absRoot = path.resolve(repoPath, String(dirHint).replace(/\//g, path.sep))
  if (!fs.existsSync(absRoot)) {
    return { hits: [], searchedFiles: 0, partial: false, searchedPaths: [dirHint], error: `dirHint 目录不存在: ${dirHint}` }
  }

  let re
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }

  /** @type {Array<{file:string,lineNumber:number,context:string}>} */
  const hits = []
  const searchedPaths = [dirHint]
  let searchedFiles = 0
  let partial = false
  /** @type {string[]} */
  const stack = [absRoot]

  while (stack.length > 0) {
    if (Date.now() - startTs > GREP_REPO_TIMEOUT_MS) {
      partial = true
      break
    }
    if (hits.length >= maxHits) {
      partial = true
      break
    }
    const cur = stack.pop()
    /** @type {fs.Dirent[]} */
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (Date.now() - startTs > GREP_REPO_TIMEOUT_MS) { partial = true; break }
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      const ext = path.extname(e.name).toLowerCase()
      if (!CODE_EXTS.has(ext)) continue
      if (fileExt && ext !== `.${fileExt}`) continue
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.size > GREP_REPO_MAX_FILE_BYTES) continue

      searchedFiles++
      const rel = path.relative(repoPath, full).replace(/\\/g, '/')
      // 文件名命中
      if (re.test(e.name)) {
        hits.push({ file: rel, lineNumber: 0, context: `[文件名命中] ${rel}` })
        if (hits.length >= maxHits) { partial = true; break }
      }
      // 文件内容命中（按行扫描）
      let content
      try { content = fs.readFileSync(full, 'utf-8') } catch { continue }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (Date.now() - startTs > GREP_REPO_TIMEOUT_MS) { partial = true; break }
        if (re.test(lines[i])) {
          const start = Math.max(0, i - 5)
          const end = Math.min(lines.length - 1, i + 5)
          hits.push({
            file: rel,
            lineNumber: i + 1,
            context: lines.slice(start, end + 1).join('\n'),
          })
          if (hits.length >= maxHits) { partial = true; break }
        }
      }
      if (partial) break
    }
    if (partial) break
  }

  return { hits, searchedFiles, partial, searchedPaths }
}

/* ================================================================
 * Phase 2 工具调度（供 agent 循环调用）
 * ================================================================ */

/**
 * Token 双档闸门：dispatchToolCall 调用次数累加 totalChars 计数
 * 通过 sessionMeta 在单次走查内累加；agent 循环识别 marker 处理
 */

/**
 * 创建一个 agent 会话上下文（在 openai-code-review 一次走查开始时调用）
 * 在 sessionMeta 内累加 totalChars，超过阈值时给后续 dispatchToolCall 返回值附加 marker
 *
 * @returns {{ totalChars: number, softWarnFired: boolean, hardCapFired: boolean }}
 */
export function createAgentSessionMeta() {
  return { totalChars: 0, softWarnFired: false, hardCapFired: false }
}

/**
 * 根据 tool_call 名称与参数，路由到对应工具并执行
 *
 * @param {string} toolName
 * @param {object} args
 * @param {{ repos: object[], dirHints?: string[], fileKeywords?: string[], fallback?: boolean }} context
 * @param {{ totalChars: number, softWarnFired: boolean, hardCapFired: boolean }} [sessionMeta]
 *   ST-003: 可选会话级累计上下文；不传则降级为旧行为（无 token 闸门）
 * @returns {string}  JSON 字符串，交回给 LLM
 */
export function dispatchToolCall(toolName, args, context, sessionMeta) {
  const { repos } = context || {}
  if (!Array.isArray(repos) || repos.length === 0) {
    return JSON.stringify({ error: '无仓库上下文' })
  }
  const repoId = args.repoId || (repos[0]?.repoId)
  const repo = getRepo(repoId)
  if (!repo) {
    return JSON.stringify({ error: `仓库 ${repoId} 未配置，可用仓库: ${repos.map((r) => r.repoId).join(', ')}` })
  }
  const repoPath = repo.path

  /** @type {any} */
  let result
  if (toolName === 'listDir') {
    result = listDirForAgent(repoPath, String(args.dirPath || ''))
  } else if (toolName === 'readFile') {
    result = readFileForAgent(repoPath, String(args.filePath || ''), {
      startLine: args.startLine,
      maxLines: args.maxLines ?? MAX_FILE_LINES,
    })
  } else if (toolName === 'searchInFile') {
    result = searchInFileForAgent(repoPath, String(args.filePath || ''), String(args.pattern || ''))
  } else if (toolName === 'grepRepo') {
    // ST-003 D 改造：dirHint 必填硬约束
    const dirHint = String(args.dirHint || '').trim()
    if (!dirHint) {
      result = {
        error: 'grepRepo: dirHint 必填且非空（防止仓库根全 grep 触发 IO 风暴）',
        hits: [],
        searchedFiles: 0,
        partial: false,
        searchedPaths: [],
      }
    } else if (
      Array.isArray(context.dirHints) && context.dirHints.length > 0 &&
      !isWithinAnyDirHint(dirHint, context.dirHints)
    ) {
      result = {
        error: `grepRepo: dirHint「${dirHint}」必须是 dirHints 数组中的元素或其子目录。可用 dirHints：${context.dirHints.join(' / ')}`,
        hits: [],
        searchedFiles: 0,
        partial: false,
        searchedPaths: [dirHint],
      }
    } else {
      result = grepRepoForAgent(repoPath, String(args.pattern || ''), dirHint, {
        fileExt: args.fileExt,
        maxHits: args.maxHits,
      })
    }
  } else {
    result = { error: `未知工具: ${toolName}` }
  }

  const json = JSON.stringify(result)

  // ST-003 Token 双档闸门
  if (sessionMeta && typeof sessionMeta === 'object') {
    sessionMeta.totalChars = (sessionMeta.totalChars || 0) + json.length
    if (!sessionMeta.hardCapFired && sessionMeta.totalChars >= TOKEN_HARD_CAP_THRESHOLD) {
      sessionMeta.hardCapFired = true
      return JSON.stringify({ ...result, __hardCap: true, __totalChars: sessionMeta.totalChars })
    }
    if (!sessionMeta.softWarnFired && sessionMeta.totalChars >= TOKEN_SOFT_WARN_THRESHOLD) {
      sessionMeta.softWarnFired = true
      return JSON.stringify({ ...result, __softWarn: true, __totalChars: sessionMeta.totalChars })
    }
  }
  return json
}

/** dirHint 是否落在 allowedHints 任一元素之内（前缀匹配） */
function isWithinAnyDirHint(dirHint, allowedHints) {
  const norm = String(dirHint).replace(/\\/g, '/').replace(/\/+$/, '')
  return allowedHints.some((h) => {
    const hh = String(h).replace(/\\/g, '/').replace(/\/+$/, '')
    return norm === hh || norm.startsWith(hh + '/')
  })
}

/* ================================================================
 * Tool schemas（传给 LLM 的工具定义）
 * ================================================================ */

export const CODE_REVIEW_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'listDir',
      description: '列出指定目录下一级的代码文件（仅代码类扩展名）与子目录。用于探索项目结构、确认候选目录是否存在。',
      parameters: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: '仓库 ID（如 client / ds / config）' },
          dirPath: { type: 'string', description: '相对仓库根的目录路径，如 Assets/Scripts/Client/Managers' },
        },
        required: ['repoId', 'dirPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: '读取指定代码文件的内容（默认最多 300 行）。若文件较长，可用 startLine 分段续读。',
      parameters: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: '仓库 ID' },
          filePath: { type: 'string', description: '相对仓库根的文件路径' },
          startLine: { type: 'number', description: '起始行号（1-indexed，默认 1）' },
          maxLines: { type: 'number', description: '最多读取行数（默认 300，最大 300）' },
        },
        required: ['repoId', 'filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchInFile',
      description: '在单个文件内搜索关键词或正则，返回命中行及上下文（每处 ±5 行，最多 10 处）。用于快速定位方法名或关键逻辑。',
      parameters: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: '仓库 ID' },
          filePath: { type: 'string', description: '相对仓库根的文件路径' },
          pattern: { type: 'string', description: '搜索关键词或正则表达式' },
        },
        required: ['repoId', 'filePath', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grepRepo',
      description: '用于在指定 dirHint 子树内查找代码模式（含可能的违规证据）：找文件名命中 + 文件内容命中。dirHint 必填且必须落在 Phase 1 推断的 dirHints 内（防止仓库根全 grep）。3s 超时，最多 20 命中，单文件 500KB 上限，尊重 IGNORE_DIRS。',
      parameters: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: '仓库 ID' },
          pattern: { type: 'string', description: '搜索关键词或正则表达式（i 不区分大小写）' },
          dirHint: { type: 'string', description: '搜索目录（相对仓库根）。必填且必须是 Phase 1 dirHints 中的元素或其子目录' },
          fileExt: { type: 'string', description: '可选：仅搜索该扩展名的文件（如 cs / lua）；不带点' },
          maxHits: { type: 'number', description: '可选：最大命中数，默认 20，硬上限 20' },
        },
        required: ['repoId', 'pattern', 'dirHint'],
      },
    },
  },
]

/* ================================================================
 * AI 自写规则提案触发判定（ST-003 · AI.4 触发条件）
 * ================================================================ */

/**
 * 提案 Pass 2 触发判定（QC-15 后触发条件迁移自 v2 判定矩阵）：
 *   合取条件：fallback === true && parsedResult.conclusion === 'fail' && evidence 非空
 *
 * @param {{ fallback?: boolean }} repoContext
 * @param {{ conclusion?: string, evidence?: any[] }} parsedResult
 * @returns {boolean}
 */
export function shouldTriggerRuleProposal(repoContext, parsedResult) {
  if (!repoContext || repoContext.fallback !== true) return false
  if (!parsedResult || parsedResult.conclusion !== 'fail') return false
  const evidence = Array.isArray(parsedResult.evidence) ? parsedResult.evidence : []
  return evidence.length > 0
}

/* ================================================================
 * 对外接口
 * ================================================================ */

export {
  MAX_TOOL_CALLS,
  MAX_TOTAL_CHARS,
  MAX_FILE_LINES,
  TOKEN_SOFT_WARN_THRESHOLD,
  TOKEN_HARD_CAP_THRESHOLD,
  IGNORE_DIRS,
  CODE_EXTS,
  reloadDomainRules,
  appendApprovedRule,
}

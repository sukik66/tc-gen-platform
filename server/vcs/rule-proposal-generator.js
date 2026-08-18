/**
 * AI 自写规则提案生成器（ST-003 · AI.1-AI.5）
 *
 * 触发条件（合取，QC-15 后调整为单层 conclusion 判定）：
 *   - agentCtx.repoContext.fallback === true
 *   - 走查 conclusion === 'fail' 且 evidence 非空
 *
 * 流程：
 *   1. feature-flags.json 物理开关 aiRuleProposalEnabled === true 才启用（Q4 决议默认 true，回退路径见 §7.2.d 重度档）
 *   2. 调 runRuleProposalPass2（独立 LLM）反推 ruleProposalDraft
 *   3. jaccard≥0.6 去重（与 unity-domain-rules.json + 历史 rule-proposals.json 比对）
 *      - 命中：仅 append evidence 到现有提案，不新建（status 不变）
 *      - 未命中：新建提案 status=pending 写入 rule-proposals.json
 *   4. stats 埋点：在 rule-proposals-stats.json 累计周指标 {week, produced, deduped, approved, rejected, deferred}
 *
 * 数据 schema（rule-proposals.json）：
 *   {
 *     id, status: 'pending'|'approved'|'rejected',
 *     keywords: string,        // 正则字符串
 *     hints: string[],
 *     fileKeywords: string[],
 *     evidence: { readDirs: string[], hitFiles: string[] },
 *     affectsModules?: string[],
 *     qualityScore?: number,    // 预留字段（QC-13g 后置）
 *     sourceContext: { contractId?, moduleLabel?, ruleSummary?, taskId? },
 *     createdAt, updatedAt
 *   }
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runRuleProposalPass2 } from '../llm/openai-code-review.js'
import { extractViolatedFindings } from '../normalize-code-review.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const RULE_PROPOSALS_FILE = path.join(DATA_DIR, 'rule-proposals.json')
const UNITY_DOMAIN_RULES_FILE = path.join(DATA_DIR, 'unity-domain-rules.json')
const FEATURE_FLAGS_FILE = path.join(DATA_DIR, 'feature-flags.json')
const STATS_FILE = path.join(DATA_DIR, 'rule-proposals-stats.json')

/** jaccard 去重阈值（≥0.6 视为重复，命中仅 append evidence） */
const JACCARD_THRESHOLD = 0.6

/* ================================================================
 * Feature Flag
 * ================================================================ */

export function isAiRuleProposalEnabled() {
  if (!fs.existsSync(FEATURE_FLAGS_FILE)) {
    // 文件不存在视为默认关（保守）
    return false
  }
  try {
    const raw = fs.readFileSync(FEATURE_FLAGS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed?.aiRuleProposalEnabled === true
  } catch {
    return false
  }
}

/* ================================================================
 * jaccard 相似度（基于字符 bigram 集合）
 * ================================================================ */

/**
 * 计算两个 keywords 字符串的 jaccard 相似度
 * 拆分策略：转小写 → 去除正则元字符 → 字符级 bigram 集合
 */
export function jaccardSimilarity(aRaw, bRaw) {
  const a = stringToBigrams(aRaw)
  const b = stringToBigrams(bRaw)
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function stringToBigrams(raw) {
  const s = String(raw || '')
    .toLowerCase()
    // 提取所有字母数字与中文字符（剥离正则元字符 / 分隔）
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .trim()
  const set = new Set()
  if (!s) return set
  // 按空格切词后逐词生成 bigram
  for (const word of s.split(/\s+/)) {
    if (word.length === 0) continue
    if (word.length === 1) {
      set.add(word)
      continue
    }
    for (let i = 0; i < word.length - 1; i++) {
      set.add(word.slice(i, i + 2))
    }
  }
  return set
}

/* ================================================================
 * I/O Helpers
 * ================================================================ */

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function saveJson(file, value) {
  ensureDataDir()
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
}

export function loadProposals() {
  const arr = loadJson(RULE_PROPOSALS_FILE, [])
  return Array.isArray(arr) ? arr : []
}

export function saveProposals(arr) {
  saveJson(RULE_PROPOSALS_FILE, Array.isArray(arr) ? arr : [])
}

function loadDomainRulesRaw() {
  const arr = loadJson(UNITY_DOMAIN_RULES_FILE, [])
  return Array.isArray(arr) ? arr : []
}

/* ================================================================
 * Stats 埋点
 * ================================================================ */

function getCurrentISOWeek() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * @param {'produced'|'deduped'|'approved'|'rejected'|'deferred'} kind
 */
export function bumpStats(kind) {
  const arr = loadJson(STATS_FILE, [])
  const list = Array.isArray(arr) ? arr : []
  const week = getCurrentISOWeek()
  let row = list.find((r) => r && r.week === week)
  if (!row) {
    row = { week, produced: 0, deduped: 0, approved: 0, rejected: 0, deferred: 0 }
    list.push(row)
  }
  row[kind] = (row[kind] || 0) + 1
  saveJson(STATS_FILE, list)
}

/* ================================================================
 * 主流程：依据走查结果生成（或更新）提案
 * ================================================================ */

/**
 * @param {{
 *   parsedResult: any,            // normalize-code-review 输出（含 thenMustNotResults）
 *   repoContext: { fallback?: boolean, dirHints?: string[], fileKeywords?: string[] },
 *   moduleLabel: string,
 *   rule: string,
 *   contractId?: string,
 *   taskId?: string,
 *   pass2LlmOpts: { apiKey: string, baseURL: string, model: string, maxTokens?: number, providerId?: string },
 * }} input
 * @returns {Promise<{
 *   proposalId: string|null,
 *   ruleProposalDraft: any|null,
 *   action: 'created'|'merged'|'skipped'|'disabled'|'no_violated',
 *   reason?: string,
 * }>}
 */
export async function maybeGenerateRuleProposal(input) {
  if (!isAiRuleProposalEnabled()) {
    return { proposalId: null, ruleProposalDraft: null, action: 'disabled' }
  }
  // 触发条件：fallback=true 且 conclusion=fail（evidence 非空）
  if (!input.repoContext || input.repoContext.fallback !== true) {
    return { proposalId: null, ruleProposalDraft: null, action: 'skipped', reason: 'fallback !== true' }
  }
  const violatedFindings = extractViolatedFindings(input.parsedResult)
  if (violatedFindings.length === 0) {
    return { proposalId: null, ruleProposalDraft: null, action: 'no_violated' }
  }

  // 收集 readDirs / hitFiles 作为提案的 evidence
  const filesRead = Array.isArray(input.parsedResult?.filesRead) ? input.parsedResult.filesRead : []
  const readDirs = [...new Set(
    filesRead.map((f) => String(f).split('/').slice(0, -1).join('/')).filter(Boolean)
  )]
  const hitFiles = [...new Set(
    violatedFindings.flatMap((f) => (f.evidence || []).map((e) => String(e.file || '')).filter(Boolean))
  )]

  // Pass 2 LLM 调用
  let pass2Raw
  try {
    pass2Raw = await runRuleProposalPass2(input.pass2LlmOpts, {
      moduleLabel: input.moduleLabel || '',
      rule: input.rule || '',
      violatedFindings,
      readDirs,
      hitFiles,
    })
  } catch (e) {
    return { proposalId: null, ruleProposalDraft: null, action: 'skipped', reason: `Pass 2 LLM 调用失败：${e instanceof Error ? e.message : String(e)}` }
  }

  let draft
  try {
    draft = JSON.parse(stripJsonFences(pass2Raw))
  } catch (e) {
    return { proposalId: null, ruleProposalDraft: null, action: 'skipped', reason: `Pass 2 输出 JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }

  if (!draft || typeof draft !== 'object' || !draft.keywords) {
    return { proposalId: null, ruleProposalDraft: null, action: 'skipped', reason: 'Pass 2 输出无 keywords 字段' }
  }

  // jaccard 去重
  const proposals = loadProposals()
  const domainRules = loadDomainRulesRaw()

  const dupHit = findDuplicate(draft.keywords, proposals, domainRules)
  if (dupHit.matched) {
    // 命中：仅 append evidence 到现有提案，不新建
    if (dupHit.kind === 'proposal') {
      const idx = proposals.findIndex((p) => p && p.id === dupHit.id)
      if (idx >= 0) {
        const existing = proposals[idx]
        const mergedReadDirs = [...new Set([...(existing.evidence?.readDirs || []), ...readDirs])]
        const mergedHitFiles = [...new Set([...(existing.evidence?.hitFiles || []), ...hitFiles])]
        proposals[idx] = {
          ...existing,
          evidence: { readDirs: mergedReadDirs, hitFiles: mergedHitFiles },
          updatedAt: new Date().toISOString(),
        }
        saveProposals(proposals)
      }
    }
    bumpStats('deduped')
    return {
      proposalId: dupHit.id || null,
      ruleProposalDraft: null,
      action: 'merged',
      reason: `jaccard ${dupHit.score.toFixed(3)} ≥ ${JACCARD_THRESHOLD}（${dupHit.kind}：${dupHit.id}）`,
    }
  }

  // 新建提案
  const id = `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const fullDraft = {
    id,
    status: 'pending',
    keywords: String(draft.keywords),
    hints: Array.isArray(draft.hints) ? draft.hints.map(String) : [],
    fileKeywords: Array.isArray(draft.fileKeywords) ? draft.fileKeywords.map(String) : [],
    evidence: {
      readDirs: Array.isArray(draft.evidence?.readDirs) ? draft.evidence.readDirs.map(String) : readDirs,
      hitFiles: Array.isArray(draft.evidence?.hitFiles) ? draft.evidence.hitFiles.map(String) : hitFiles,
    },
    affectsModules: Array.isArray(draft.affectsModules) ? draft.affectsModules.map(String) : undefined,
    sourceContext: {
      contractId: input.contractId,
      moduleLabel: input.moduleLabel,
      ruleSummary: input.rule,
      taskId: input.taskId,
    },
    createdAt: now,
    updatedAt: now,
  }
  proposals.push(fullDraft)
  saveProposals(proposals)
  bumpStats('produced')

  return {
    proposalId: id,
    // 同步内联给前端：reviewResult.ruleProposalDraft 直接展示
    ruleProposalDraft: {
      keywords: fullDraft.keywords,
      hints: fullDraft.hints,
      fileKeywords: fullDraft.fileKeywords,
      evidence: fullDraft.evidence,
      affectsModules: fullDraft.affectsModules,
    },
    action: 'created',
  }
}

function stripJsonFences(text) {
  let s = String(text || '').trim()
  s = s.replace(/^\uFEFF/, '')
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return s
}

/**
 * 在已有 proposals + domainRules 中查找是否已存在 jaccard≥0.6 的相似项
 */
function findDuplicate(keywords, proposals, domainRulesRaw) {
  let best = { matched: false, score: 0, kind: null, id: null }
  for (const p of proposals) {
    if (!p || !p.keywords) continue
    const s = jaccardSimilarity(keywords, p.keywords)
    if (s > best.score) best = { matched: s >= JACCARD_THRESHOLD, score: s, kind: 'proposal', id: p.id }
  }
  for (const r of domainRulesRaw) {
    if (!r || !r.keywords) continue
    const s = jaccardSimilarity(keywords, r.keywords)
    if (s > best.score) best = { matched: s >= JACCARD_THRESHOLD, score: s, kind: 'domainRule', id: r.sourceProposalId || r.keywords }
  }
  return best
}

/* ================================================================
 * 对外
 * ================================================================ */

export { JACCARD_THRESHOLD, RULE_PROPOSALS_FILE, UNITY_DOMAIN_RULES_FILE }

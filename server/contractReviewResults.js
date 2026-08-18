/**
 * 契约代码走查结果 · 后端 JSON 文件持久化
 *
 * 数据存储在 data/contract-review-results.json
 * 与 contractLibrary.js / qualityContracts.js 同策略：
 *   - 原子写入（先写临时文件再 rename），防止中断导致数据损坏
 *   - 加载失败兜底为空集合，不抛错
 *
 * 数据结构：
 *   {
 *     results: [
 *       {
 *         id: string,                // 本条记录唯一 id
 *         contractId: string,        // 契约 id（关联 quality-contracts.json）
 *         runAt: string,             // ISO 时间戳
 *         conclusion: 'pass'|'fail'|'uncertain',
 *         verdict: 'pass'|'fail'|'uncertain',  // 与 conclusion 同值（QC-15 alias）
 *         confidence: number,
 *         reasoning: string,
 *         evidence: Array<{file, method, lineHint, description}>,
 *         gaps: string,
 *         filesRead: string[],
 *         toolCallsUsed: number,
 *         llmProvider: string,
 *       },
 *       ...
 *     ]
 *   }
 *
 * 每个 contractId 仅保留最近 3 条（按 runAt 倒序，FIFO 截断）。
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'contract-review-results.json')

const HISTORY_LIMIT = 3

function uid() {
  return `crr-${randomUUID()}`
}

function iso() {
  return new Date().toISOString()
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) return { results: [] }
  try {
    const o = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    if (!o || !Array.isArray(o.results)) return { results: [] }
    return o
  } catch {
    return { results: [] }
  }
}

function save(data) {
  ensureDir()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

/**
 * 追加一条走查结果到指定契约下，并执行 FIFO 截断（保留最近 3 条）。
 * @param {string} contractId
 * @param {Record<string, unknown>} result 走查 normalize 结果（来自 tryParseCodeReviewResponse.result）
 * @param {{ llmProvider?: string }} [extra] 额外元信息
 * @returns {{ id: string, contractId: string, runAt: string } & Record<string, unknown>}
 */
export function appendResult(contractId, result, extra = {}) {
  const cid = String(contractId || '').trim()
  if (!cid) throw new Error('appendResult: contractId 必填')
  if (!result || typeof result !== 'object') throw new Error('appendResult: result 必须为对象')

  const data = load()
  const row = {
    id: uid(),
    contractId: cid,
    runAt: iso(),
    conclusion: result.conclusion,
    verdict: result.verdict ?? result.conclusion,
    confidence: result.confidence,
    reasoning: result.reasoning,
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    gaps: result.gaps || '',
    filesRead: Array.isArray(result.filesRead) ? result.filesRead : [],
    toolCallsUsed: Number(result.toolCallsUsed) || 0,
    llmProvider: String(extra.llmProvider || '').trim(),
  }
  data.results.push(row)

  // FIFO 截断：仅截断当前 contractId 下的历史，其它契约不动
  const sameContract = data.results
    .filter((r) => r && r.contractId === cid)
    .sort((a, b) => (a.runAt < b.runAt ? 1 : -1))
  const keep = new Set(sameContract.slice(0, HISTORY_LIMIT).map((r) => r.id))
  data.results = data.results.filter((r) => r.contractId !== cid || keep.has(r.id))

  save(data)
  return row
}

/**
 * 列出指定契约的最近 N 条走查结果（按 runAt 倒序）。
 * @param {string} contractId
 * @param {number} [limit] 默认 3
 * @returns {Array<Record<string, unknown>>}
 */
export function listResultsForContract(contractId, limit = HISTORY_LIMIT) {
  const cid = String(contractId || '').trim()
  if (!cid) return []
  const max = Math.max(1, Math.min(HISTORY_LIMIT, Number(limit) || HISTORY_LIMIT))
  const { results } = load()
  return results
    .filter((r) => r && r.contractId === cid)
    .sort((a, b) => (a.runAt < b.runAt ? 1 : -1))
    .slice(0, max)
}

/**
 * 取指定契约最新的一条走查结果（无则返回 null）。
 * @param {string} contractId
 * @returns {Record<string, unknown>|null}
 */
export function getLatestResult(contractId) {
  const list = listResultsForContract(contractId, 1)
  return list[0] || null
}

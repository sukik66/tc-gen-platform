/**
 * 契约规整（normalize）— 与 prompt-contract.js 配套。
 *
 * QC-15（2026-04-29 · 两层架构回归）说明：
 *   - 新生成的契约因 prompt 不再产出 layer/given/when/then_must/then_must_not/measurable 等
 *     执行层骨架字段（layer 仍由 prompt 要求输出，但 given/when/then_must 等已不再要求），
 *     looksLikeV2() 在新数据上自然返回 false → 走 v1 分支输出 version=1。
 *   - 但库内仍保留 16 条 QC-12/QC-13 期间生成的历史 v2 契约 JSON——这些数据在前端
 *     不再渲染骨架字段（前端组件已删除），但本文件**保留 v2 透传逻辑**（looksLikeV2 +
 *     normalizeOneContract 的 v2 分支 + LAYER / MEASURABLE_KIND 常量），让历史数据
 *     可继续读出而不抛错。layer 字段对所有数据保持透传（QC-15 后作为元数据保留）。
 *   - 因此本文件 QC-15 后逻辑层面**不变**，仅作此说明。
 */
const PRI = new Set(['P0', 'P1', 'P2'])
const METHOD = new Set(['code_review', 'api_test', 'ui_test'])
const LAYER = new Set(['data', 'business', 'ux'])
const MEASURABLE_KIND = new Set(['value', 'enum', 'state', 'count', 'none'])

/** 从 start 起找第一个 { 并按括号深度提取完整对象（字符串内括号忽略） */
function extractBalancedJsonObject(s, startSearch = 0) {
  const start = s.indexOf('{', startSearch)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 把任意值规整成非空字符串数组，过滤空白项
 * @param {unknown} v
 * @returns {string[]}
 */
function toStringArray(v) {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 规整 measurable 对象（v2 字段），不合法时返回 null
 * 合法形态：{ kind: value|enum|state|count|none, expression: 非空字符串 }
 * @param {unknown} m
 * @returns {{ kind: string, expression: string } | null}
 */
function normalizeMeasurable(m) {
  if (!m || typeof m !== 'object') return null
  const obj = /** @type {Record<string, unknown>} */ (m)
  const kindRaw = typeof obj.kind === 'string' ? obj.kind.trim().toLowerCase() : ''
  const kind = MEASURABLE_KIND.has(kindRaw) ? kindRaw : ''
  const expression = String(obj.expression ?? '').trim()
  if (!kind || !expression) return null
  return { kind, expression }
}

/**
 * 检测 raw 契约对象是否含 v2 必填字段（用于 version 判定）
 * v2 必填：layer / given / when / then_must(数组≥1) / measurable(合法对象)
 * 注意：then_must_not 单独处理（缺失 → 填 null，不影响 version 判定，让 v2 在
 * 反例字段未填的情况下仍可降级渲染但保留 v2 标记——这里的判定较严格，避免误判 v1）
 * @param {Record<string, unknown>} raw
 */
function looksLikeV2(raw) {
  const layer = typeof raw.layer === 'string' ? raw.layer.trim().toLowerCase() : ''
  const given = typeof raw.given === 'string' ? raw.given.trim() : ''
  const when = typeof raw.when === 'string' ? raw.when.trim() : ''
  const thenMust = toStringArray(raw.then_must)
  const measurable = normalizeMeasurable(raw.measurable)
  return Boolean(LAYER.has(layer) && given && when && thenMust.length >= 1 && measurable)
}

/**
 * @typedef {Object} NormalizedContractBase
 * @property {string} moduleLabel
 * @property {string} rule
 * @property {string} boundaryHint
 * @property {string} priority
 * @property {string[]} verifyMethods
 * @property {string} verifyRationale
 * @property {1|2} version
 *
 * @typedef {NormalizedContractBase & {
 *   layer?: 'data'|'business'|'ux',
 *   given?: string,
 *   when?: string,
 *   then_must?: string[],
 *   then_must_not?: string[]|null,
 *   measurable?: { kind: string, expression: string }|null,
 * }} NormalizedContract
 */

/**
 * 把单个原始契约对象规整为带 version 字段的标准对象
 * - 基础字段（v1）始终输出
 * - 若 v2 必填齐全 → version=2，写入 v2 字段；then_must_not 缺失填 null（区分「未知」与「已检查无反例 []」）
 * - 否则 → version=1，仅输出基础字段（不写 v2 字段，避免前端误读）
 *
 * @param {Record<string, unknown>} item
 * @param {number} i
 * @returns {NormalizedContract}
 */
function normalizeOneContract(item, i) {
  const p = item.priority
  const priority = PRI.has(p) ? /** @type {string} */ (p) : 'P2'
  const vm = Array.isArray(item.verifyMethods)
    ? item.verifyMethods.map(String).filter((x) => METHOD.has(x))
    : []
  const verifyMethods = vm.length > 0 ? vm : ['code_review']
  let verifyRationale = String(item.verifyRationale ?? '').trim()
  if (!verifyRationale) {
    verifyRationale =
      verifyMethods.length > 1
        ? `已选 ${verifyMethods.join('、')} 组合验证；模型未返回推荐理由，请 QA 审核时补充。`
        : '模型未返回推荐理由；请 QA 结合规则与实现审核验证方式是否充分。'
  }

  const base = {
    moduleLabel: String(item.moduleLabel || '').trim() || `未命名模块 ${i + 1}`,
    rule: String(item.rule || '').trim() || `（规则未填写 ${i + 1}）`,
    boundaryHint: String(item.boundaryHint || '').trim(),
    priority,
    verifyMethods,
    verifyRationale,
  }

  if (looksLikeV2(item)) {
    const layer = /** @type {'data'|'business'|'ux'} */ (
      String(item.layer).trim().toLowerCase()
    )
    const given = String(item.given).trim()
    const when = String(item.when).trim()
    const thenMust = toStringArray(item.then_must)
    // then_must_not 缺失填 null；存在但是空数组 → 保留 []（语义为「已检查无反例」）
    let thenMustNot = null
    if (Array.isArray(item.then_must_not)) {
      thenMustNot = toStringArray(item.then_must_not)
    } else if (item.then_must_not == null) {
      thenMustNot = null
    } else {
      // 单字符串等非法形态 → 视为缺失
      thenMustNot = null
    }
    const measurable = normalizeMeasurable(item.measurable)
    return {
      ...base,
      version: /** @type {2} */ (2),
      layer,
      given,
      when,
      then_must: thenMust,
      then_must_not: thenMustNot,
      measurable,
    }
  }

  return {
    ...base,
    version: /** @type {1} */ (1),
  }
}

/**
 * @param {unknown} parsed
 * @returns {NormalizedContract[]}
 */
export function normalizeContracts(parsed) {
  let obj = parsed
  if (typeof parsed === 'string') {
    try {
      obj = JSON.parse(parsed)
    } catch {
      throw new Error('模型返回不是合法 JSON')
    }
  }
  if (!obj || typeof obj !== 'object') throw new Error('JSON 格式错误：应为对象')
  const raw = /** @type {Record<string, unknown>} */ (obj).contracts
  if (!Array.isArray(raw)) throw new Error('JSON 必须包含 contracts 数组')

  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`contracts[${i}] 不是对象`)
    }
    return normalizeOneContract(/** @type {Record<string, unknown>} */ (item), i)
  })
}

/**
 * 流式场景：逐条 normalize，避免第 N+1 条字段不合法时整批抛错导致返回 []、把已解析的卡片清空。
 * @param {unknown[]} rawItems
 */
function normalizeContractObjectsPrefixSafe(rawItems) {
  const out = []
  for (let idx = 0; idx < rawItems.length; idx++) {
    try {
      const one = normalizeContracts({ contracts: [rawItems[idx]] })
      if (one[0]) out.push(one[0])
    } catch {
      break
    }
  }
  return out
}

/**
 * 流式缓冲：从尚未闭合的 JSON 中解析 contracts 数组里**已完整**的对象，用于渐进展示。
 * extractBalancedJsonObject 已基于括号深度匹配，对 v2 嵌套 measurable 对象天然支持，
 * 无需额外改造（QC-12 · 12.6 仅做端到端验证，不改本函数）。
 * @param {string} text
 * @returns {NormalizedContract[]}
 */
export function parseCompleteContractObjectsFromPartialStream(text) {
  let s0 = String(text ?? '').trim()
  s0 = s0.replace(/^\uFEFF/, '')
  s0 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const m = s0.match(/"contracts"\s*:\s*\[/i)
  if (!m || m.index === undefined) return []
  let i = m.index + m[0].length
  const rawItems = []
  while (i < s0.length) {
    while (i < s0.length && /[\s,]/.test(s0[i])) i++
    if (i >= s0.length || s0[i] === ']') break
    if (s0[i] !== '{') break
    const objStr = extractBalancedJsonObject(s0, i)
    if (!objStr) break
    try {
      rawItems.push(JSON.parse(objStr))
    } catch {
      break
    }
    i += objStr.length
  }
  if (rawItems.length === 0) return []
  return normalizeContractObjectsPrefixSafe(rawItems)
}

/**
 * 从模型原文解析 contracts（去围栏、容错）
 * @param {string} text
 * @returns {{ contracts: NormalizedContract[], parseError?: string }}
 */
export function tryParseContractsResponse(text) {
  let s0 = String(text ?? '').trim()
  s0 = s0.replace(/^\uFEFF/, '')
  s0 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(s0)
    const contracts = normalizeContracts(parsed)
    if (contracts.length === 0) {
      return { contracts: [], parseError: 'contracts 数组为空' }
    }
    return { contracts }
  } catch (e) {
    return {
      contracts: [],
      parseError: e instanceof Error ? e.message : 'JSON 解析失败',
    }
  }
}

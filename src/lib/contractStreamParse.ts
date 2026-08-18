/**
 * 与 server/normalize-contracts.js 中 parseCompleteContractObjectsFromPartialStream
 * 逻辑对齐：在浏览器侧对累积文本做渐进解析（SSE 未下发 preview 时的兜底）。
 */
import type { ContractAiItem } from '../api/generateContracts'

function extractBalancedJsonObject(s: string, startSearch = 0): string | null {
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

const PRI = new Set(['P0', 'P1', 'P2'])
const METHOD = new Set(['code_review', 'api_test', 'ui_test'])

function normalizeOne(item: unknown, i: number): ContractAiItem {
  if (!item || typeof item !== 'object') {
    return {
      moduleLabel: `未命名 ${i + 1}`,
      rule: '',
      boundaryHint: '',
      priority: 'P2',
      verifyMethods: ['code_review'],
      verifyRationale: '',
    }
  }
  const o = item as Record<string, unknown>
  const p = o.priority
  const priority = PRI.has(p as string) ? (p as ContractAiItem['priority']) : 'P2'
  const vm = Array.isArray(o.verifyMethods)
    ? (o.verifyMethods as unknown[]).map(String).filter((x) => METHOD.has(x))
    : []
  const verifyMethods = (vm.length > 0 ? vm : ['code_review']) as ContractAiItem['verifyMethods']
  let verifyRationale = String(o.verifyRationale ?? '').trim()
  if (!verifyRationale) {
    verifyRationale =
      verifyMethods.length > 1
        ? `已选 ${verifyMethods.join('、')} 组合验证；请 QA 审核时补充理由。`
        : '请 QA 结合规则与实现审核验证方式是否充分。'
  }
  return {
    moduleLabel: String(o.moduleLabel || '').trim() || `未命名模块 ${i + 1}`,
    rule: String(o.rule || '').trim() || `（规则未填写 ${i + 1}）`,
    boundaryHint: String(o.boundaryHint || '').trim(),
    priority,
    verifyMethods,
    verifyRationale,
  }
}

export function parseCompleteContractObjectsFromPartialStream(text: string): ContractAiItem[] {
  let s0 = String(text ?? '').trim()
  s0 = s0.replace(/^\uFEFF/, '')
  s0 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const m = s0.match(/"contracts"\s*:\s*\[/i)
  if (!m || m.index === undefined) return []
  let i = m.index + m[0].length
  const rawItems: unknown[] = []
  while (i < s0.length) {
    while (i < s0.length && /[\s,]/.test(s0[i])) i++
    if (i >= s0.length || s0[i] === ']') break
    if (s0[i] !== '{') break
    const objStr = extractBalancedJsonObject(s0, i)
    if (!objStr) break
    try {
      rawItems.push(JSON.parse(objStr) as unknown)
    } catch {
      break
    }
    i += objStr.length
  }
  return rawItems.map((it, idx) => normalizeOne(it, idx))
}

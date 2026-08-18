/**
 * 按单条契约重建「代码关联」payload：智能模式下用该条正文重抽关键词，其它模式原样复用。
 */
import type { CodeContextPayload } from '../api/vcs'
import { extractKeywordsFromText } from '../api/vcs'
import { DOCUMENT_KEYWORD_TEXT_MAX_CHARS } from './docKeywordNormalize'

export type ContractKeywordSource = {
  moduleLabel: string
  rule: string
  boundaryHint: string
}

export function contractKeywordSourceText(c: ContractKeywordSource): string {
  return [c.moduleLabel, c.rule, c.boundaryHint].map((s) => String(s).trim()).filter(Boolean).join('\n\n')
}

/** 与预览走查一致的规则拼装（模块 + 规则；边界单独字段传给 API） */
export function buildContractReviewRuleText(c: ContractKeywordSource): string {
  const mod = c.moduleLabel.trim() || '（未命名模块）'
  const r = c.rule.trim()
  if (!r) return ''
  return `【模块/场景】${mod}\n\n【业务规则】\n${r}`
}

function fallbackKeywordsFromRule(rule: string): string[] {
  const r = rule.trim()
  if (!r) return ['code']
  const parts = r
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of parts) {
    const low = w.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    out.push(w)
    if (out.length >= 24) break
  }
  return out.length > 0 ? out : [r.slice(0, 48).trim() || 'code']
}

export async function buildCodeContextPayloadForContract(
  base: CodeContextPayload,
  contract: ContractKeywordSource,
): Promise<CodeContextPayload> {
  if (base.mode !== 'smart') {
    return JSON.parse(JSON.stringify(base)) as CodeContextPayload
  }
  const text = contractKeywordSourceText(contract)
  const slice = text.slice(0, DOCUMENT_KEYWORD_TEXT_MAX_CHARS)
  let kws = slice ? await extractKeywordsFromText(slice, 'quality-contract.txt') : []
  if (kws.length === 0) kws = fallbackKeywordsFromRule(contract.rule)
  const repos = base.repos.map((r) => ({
    ...r,
    keywords: kws,
  }))
  return { mode: 'smart', repos }
}

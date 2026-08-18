/**
 * CodeReviewSkill — 输出标准化
 *
 * QC-15 单层输出（与文章原文 IO 对齐）：
 *   {
 *     conclusion: 'pass' | 'fail' | 'uncertain',
 *     verdict: 'pass' | 'fail' | 'uncertain',   // 与 conclusion 同值，给前端旧渲染兼容
 *     confidence: 0-100,
 *     reasoning: string,
 *     evidence: CodeReviewEvidence[],
 *     gaps: string,
 *     filesRead: string[],
 *     toolCallsUsed: number,
 *   }
 *
 * 不再支持过去的判定矩阵 schema（QC-15 已下架）。
 * extractViolatedFindings 仍然导出，用于 ST-004 提案 Pass 2 触发——基于 conclusion=fail + evidence。
 */

const VERDICT_OVERALL = new Set(['pass', 'fail', 'uncertain'])

/**
 * 主入口：标准化为单层 conclusion + evidence schema
 */
export function normalizeCodeReviewResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('根对象无效')
  }

  // 主字段：conclusion 三选一；优先 parsed.conclusion，回退 verdict / overallVerdict
  let conclusion = 'uncertain'
  if (VERDICT_OVERALL.has(parsed.conclusion)) {
    conclusion = parsed.conclusion
  } else if (VERDICT_OVERALL.has(parsed.verdict)) {
    conclusion = parsed.verdict
  } else if (VERDICT_OVERALL.has(parsed.overallVerdict)) {
    conclusion = parsed.overallVerdict
  }

  let confidence = Number(parsed.confidence ?? parsed.overallConfidence)
  if (!Number.isFinite(confidence)) confidence = 0
  confidence = Math.max(0, Math.min(100, Math.round(confidence)))

  const reasoning = String(parsed.reasoning || '').trim() || '（无说明）'
  const gaps = String(parsed.gaps || '').trim()
  const filesRead = Array.isArray(parsed.filesRead) ? parsed.filesRead.map(String) : []
  const toolCallsUsed = Number(parsed.toolCallsUsed) || 0
  const evidence = normalizeEvidenceArray(parsed.evidence)

  return {
    conclusion,
    // 与 conclusion 同值，保留 verdict 字段给前端旧渲染代码（reviewResult.verdict 徽章）兼容
    verdict: conclusion,
    confidence,
    reasoning,
    evidence,
    gaps,
    filesRead,
    toolCallsUsed,
  }
}

function normalizeEvidenceArray(rawEvidence) {
  return (Array.isArray(rawEvidence) ? rawEvidence : []).map((item, i) => {
    if (!item || typeof item !== 'object') {
      return { file: '', method: '', lineHint: '', description: `evidence[${i}] 无效` }
    }
    return {
      file: String(item.file || ''),
      method: String(item.method || ''),
      lineHint: String(item.lineHint || ''),
      description: String(item.description || '').trim() || `evidence ${i + 1}`,
    }
  })
}

export function tryParseCodeReviewResponse(text) {
  let s0 = String(text ?? '').trim()
  s0 = s0.replace(/^\uFEFF/, '')
  // DeepSeek DSML / <think> 残余清理
  s0 = s0.replace(/<[｜\|]+DSML[｜\|]+[^>]*>/g, '')
  s0 = s0.replace(/<think>[\s\S]*?<\/think>/gi, '')
  s0 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  // 第一次尝试：直接解析
  try {
    const parsed = JSON.parse(s0)
    return { ok: true, result: normalizeCodeReviewResult(parsed) }
  } catch { /* fall through */ }

  // 第二次尝试：提取第一个 JSON 对象（处理前后有非 JSON 文本的情况）
  const firstBrace = s0.indexOf('{')
  const lastBrace = s0.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(s0.slice(firstBrace, lastBrace + 1))
      return { ok: true, result: normalizeCodeReviewResult(parsed) }
    } catch { /* fall through */ }
  }

  return {
    ok: false,
    error: `JSON 解析失败，rawText 前100字: ${s0.slice(0, 100)}`,
  }
}

/**
 * 提取走查结果中的违规证据（用于 ST-004 Pass 2 提案触发判定 + reasoning 输入）
 *
 * QC-15 后触发条件：parsedResult.conclusion === 'fail' && evidence.length > 0
 */
export function extractViolatedFindings(parsedResult) {
  if (!parsedResult || parsedResult.conclusion !== 'fail') return []
  const evidence = Array.isArray(parsedResult.evidence) ? parsedResult.evidence : []
  if (evidence.length === 0) return []
  return [{
    claim: String(parsedResult.reasoning || '').slice(0, 200) || '走查发现违规',
    evidence,
  }]
}

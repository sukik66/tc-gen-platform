function newCaseId() {
  const n = Math.floor(Math.random() * 900000) + 100000
  return `TC-${n}`
}

const PRI = new Set(['P0', 'P1', 'P2'])

/** @param {unknown} parsed */
export function normalizeCases(parsed) {
  let obj = parsed
  if (typeof parsed === 'string') {
    try {
      obj = JSON.parse(parsed)
    } catch {
      throw new Error('模型返回不是合法 JSON')
    }
  }
  if (!obj || typeof obj !== 'object') throw new Error('JSON 格式错误：应为对象')
  const rawCases = obj.cases
  if (!Array.isArray(rawCases)) throw new Error('JSON 必须包含 cases 数组')

  return rawCases.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`cases[${i}] 不是对象`)
    }
    const p = item.priority
    const priority = PRI.has(p) ? p : 'P2'
    const preconditions = Array.isArray(item.preconditions)
      ? item.preconditions.map(String).filter(Boolean)
      : []
    const steps = Array.isArray(item.steps)
      ? item.steps.map(String).filter(Boolean)
      : []
    return {
      id: newCaseId(),
      priority,
      caseType: String(item.caseType || '功能测试'),
      module: String(item.module || ''),
      subModule: String(item.subModule || ''),
      summary: String(item.summary || '').trim() || `未命名用例 ${i + 1}`,
      description: String(item.description || ''),
      preconditions,
      steps,
      expected: String(item.expected || ''),
      remarks: String(item.remarks || ''),
      sourceReqIds: Array.isArray(item.sourceReqIds) ? item.sourceReqIds.map(String).filter(Boolean) : [],
      testPointIds: Array.isArray(item.testPointIds) ? item.testPointIds.map(String).filter(Boolean) : [],
      designMethod: String(item.designMethod || ''),
    }
  })
}

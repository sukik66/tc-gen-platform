function normalizeStringArray(value, max = Infinity) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max) : []
}

export function normalizeTestPlan(parsed) {
  const obj = parsed && typeof parsed === 'object' ? parsed : {}
  const rawReqItems = Array.isArray(obj.reqItems) ? obj.reqItems : []
  const rawTestPoints = Array.isArray(obj.testPoints) ? obj.testPoints : []
  const reqIdSet = new Set()

  const reqItems = rawReqItems.map((item, idx) => {
    const id = /^REQ-\d{3,}$/i.test(String(item?.id || ''))
      ? String(item.id).toUpperCase()
      : `REQ-${String(idx + 1).padStart(3, '0')}`
    reqIdSet.add(id)
    const type = ['module', 'feature', 'branch', 'gap'].includes(item?.type) ? item.type : 'feature'
    const source = item?.source && typeof item.source === 'object' ? item.source : {}
    return {
      id,
      type,
      title: String(item?.title || `需求条目 ${idx + 1}`).trim(),
      module: String(item?.module || item?.title || '').trim(),
      parentId: String(item?.parentId || '').trim(),
      source: {
        documentName: String(source.documentName || '').trim(),
        heading: String(source.heading || '').trim(),
        excerpt: String(source.excerpt || '').trim().slice(0, 180),
      },
      testPointIds: [],
      gaps: normalizeStringArray(item?.gaps),
      coverageStatus: type === 'gap' ? 'gap' : 'uncovered',
    }
  })

  const testPoints = rawTestPoints.map((item, idx) => {
    const id = /^TP-\d{3,}$/i.test(String(item?.id || ''))
      ? String(item.id).toUpperCase()
      : `TP-${String(idx + 1).padStart(3, '0')}`
    const sourceReqIds = normalizeStringArray(item?.sourceReqIds)
      .map((value) => value.toUpperCase())
      .filter((value) => reqIdSet.has(value))
    const priority = ['P0', 'P1', 'P2'].includes(item?.priority) ? item.priority : 'P1'
    const explicitInformationGap = Boolean(item?.isInformationGap)
    const coverageType = String(item?.coverageType || (explicitInformationGap ? '\u4fe1\u606f\u4e0d\u8db3' : '\u529f\u80fd')).trim()
    const isInformationGap = explicitInformationGap || coverageType.includes('\u4fe1\u606f\u4e0d\u8db3')
    return {
      id,
      title: String(item?.title || `测试点 ${idx + 1}`).trim(),
      sourceReqIds,
      coverageType,
      designMethod: String(item?.designMethod || '').trim(),
      designBasis: String(item?.designBasis || '').trim().slice(0, 240),
      priority,
      isInformationGap,
      agentStage: 'test_point_planning',
      sourceEvidence: normalizeStringArray(item?.sourceEvidence, 8),
      caseIds: normalizeStringArray(item?.caseIds),
      gaps: normalizeStringArray(item?.gaps),
      coverageStatus: isInformationGap ? 'gap' : 'planned',
    }
  }).filter((tp) => tp.sourceReqIds.length > 0 || reqItems.length === 0)

  const reqById = new Map(reqItems.map((req) => [req.id, req]))
  for (const tp of testPoints) {
    for (const reqId of tp.sourceReqIds) {
      const req = reqById.get(reqId)
      if (!req || req.testPointIds.includes(tp.id)) continue
      req.testPointIds.push(tp.id)
      req.coverageStatus = tp.isInformationGap ? 'gap' : 'planned'
      if (tp.isInformationGap) {
        for (const gap of tp.gaps) {
          if (gap && !req.gaps.includes(gap)) req.gaps.push(gap)
        }
      }
    }
  }

  return buildCoverage(reqItems, testPoints)
}

function buildCoverage(reqItems, testPoints) {
  const uncoveredReqIds = reqItems
    .filter((req) => req.type !== 'module' && req.testPointIds.length === 0)
    .map((req) => req.id)
  const informationGapReqIds = reqItems
    .filter((req) => req.type === 'gap' || req.coverageStatus === 'gap' || req.gaps.length > 0)
    .map((req) => req.id)
  const informationGapTestPointIds = testPoints
    .filter((tp) => tp.isInformationGap || tp.coverageType.includes('\u4fe1\u606f\u4e0d\u8db3'))
    .map((tp) => tp.id)
  const coveredTestPointIds = testPoints
    .filter((tp) => !tp.isInformationGap && tp.caseIds.length > 0)
    .map((tp) => tp.id)
  const uncoveredTestPointIds = testPoints
    .filter((tp) => !tp.isInformationGap && tp.caseIds.length === 0)
    .map((tp) => tp.id)
  const eligibleCount = Math.max(0, testPoints.length - informationGapTestPointIds.length)

  return {
    reqItems,
    testPoints,
    coverage: {
      reqTotal: reqItems.length,
      testPointTotal: testPoints.length,
      uncoveredReqIds,
      informationGapReqIds,
      informationGapTestPointIds,
      coveredTestPointIds,
      uncoveredTestPointIds,
      coverageRate: eligibleCount > 0 ? Math.round((coveredTestPointIds.length / eligibleCount) * 100) : 0,
    },
  }
}

export function applyCasesToTestPlan(plan, cases) {
  const normalized = normalizeTestPlan(plan)
  const caseList = Array.isArray(cases) ? cases : []
  const testPointById = new Map(normalized.testPoints.map((tp) => [tp.id, tp]))

  for (const testPoint of normalized.testPoints) testPoint.caseIds = []
  for (const testCase of caseList) {
    const caseId = String(testCase?.id || '').trim()
    for (const rawId of normalizeStringArray(testCase?.testPointIds)) {
      const testPoint = testPointById.get(rawId.toUpperCase())
      if (testPoint && caseId && !testPoint.caseIds.includes(caseId)) testPoint.caseIds.push(caseId)
    }
  }

  for (const testPoint of normalized.testPoints) {
    testPoint.coverageStatus = testPoint.isInformationGap
      ? 'gap'
      : testPoint.caseIds.length > 0 ? 'covered' : 'planned'
  }
  for (const req of normalized.reqItems) {
    if (req.type === 'gap' || req.gaps.length > 0) {
      req.coverageStatus = 'gap'
      continue
    }
    const linked = req.testPointIds.map((id) => testPointById.get(id)).filter(Boolean)
    req.coverageStatus = linked.length > 0 && linked.every((tp) => tp.caseIds.length > 0) ? 'covered' : linked.length > 0 ? 'planned' : 'uncovered'
  }

  return buildCoverage(normalized.reqItems, normalized.testPoints)
}

export function focusTestPlanForGeneration(plan, targetTestPointIds) {
  const normalized = normalizeTestPlan(plan)
  const requested = new Set(normalizeStringArray(targetTestPointIds).map((id) => id.toUpperCase()))
  const testPoints = normalized.testPoints.filter(
    (testPoint) => requested.has(testPoint.id) && !testPoint.isInformationGap,
  )
  const reqIds = new Set(testPoints.flatMap((testPoint) => testPoint.sourceReqIds))
  const reqById = new Map(normalized.reqItems.map((req) => [req.id, req]))

  let addedParent = true
  while (addedParent) {
    addedParent = false
    for (const reqId of [...reqIds]) {
      const parentId = reqById.get(reqId)?.parentId
      if (parentId && !reqIds.has(parentId) && reqById.has(parentId)) {
        reqIds.add(parentId)
        addedParent = true
      }
    }
  }

  const selectedTestPointIds = new Set(testPoints.map((testPoint) => testPoint.id))
  const reqItems = normalized.reqItems
    .filter((req) => reqIds.has(req.id))
    .map((req) => ({
      ...req,
      testPointIds: req.testPointIds.filter((id) => selectedTestPointIds.has(id)),
    }))

  return buildCoverage(reqItems, testPoints)
}

export function renumberTestPoints(testPoints) {
  return (Array.isArray(testPoints) ? testPoints : []).map((tp, idx) => ({
    ...tp,
    id: `TP-${String(idx + 1).padStart(3, '0')}`,
  }))
}

export function parseTestPlanJson(text) {
  if (!String(text || '').trim()) return null
  const cleaned = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<[｜|]+\s*DSML[\s\S]*?>/g, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  return parseJsonLenient(cleaned) || parseJsonLenient(extractBalancedJsonObject(cleaned) || '')
}

function parseJsonLenient(value) {
  if (!value) return null
  try { return JSON.parse(value) } catch {
    try { return JSON.parse(value.replace(/,\s*([}\]])/g, '$1')) } catch { return null }
  }
}

function extractBalancedJsonObject(value) {
  const start = value.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < value.length; i++) {
    const char = value[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return value.slice(start, i + 1)
    }
  }
  return null
}

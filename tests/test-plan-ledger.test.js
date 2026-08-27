import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEnhancedUserContent } from '../server/prompt-enhanced.js'
import { getEffectiveGenerationSpec } from '../server/prompt.js'
import { applyCasesToTestPlan, focusTestPlanForGeneration, normalizeTestPlan, parseTestPlanJson } from '../server/test-plan-ledger.js'

function ledgerFixture() {
  return {
    reqItems: [
      { id: 'REQ-001', type: 'feature', title: '金额输入', source: { excerpt: '输入金额后提交' } },
      { id: 'REQ-002', type: 'branch', title: '会员折扣', source: { excerpt: '会员且活动开启时享受折扣' } },
      { id: 'REQ-003', type: 'gap', title: '上限未说明', gaps: ['金额上限'] },
    ],
    testPoints: [
      {
        id: 'TP-001',
        title: '有效金额与无效金额输入',
        sourceReqIds: ['REQ-001'],
        coverageType: '功能',
        designMethod: '等价类',
        designBasis: '有效正数、空值、非数字',
      },
      {
        id: 'TP-002',
        title: '金额最小值及邻域',
        sourceReqIds: ['REQ-001'],
        coverageType: '边界',
        designMethod: '边界值',
        designBasis: '0、1 及最小有效金额',
      },
      {
        id: 'TP-003',
        title: '会员与活动条件组合',
        sourceReqIds: ['REQ-002'],
        coverageType: '状态',
        designMethod: '判定表',
        designBasis: '会员/非会员 × 活动开启/关闭',
      },
      {
        id: 'TP-004',
        title: '确认金额上限',
        sourceReqIds: ['REQ-003'],
        coverageType: '信息不足',
        isInformationGap: true,
        gaps: ['金额上限'],
      },
    ],
  }
}

test('normalization keeps valid references and rejects invalid reference equivalence classes', () => {
  const raw = ledgerFixture()
  raw.testPoints.push({ id: 'invalid', title: '不存在的引用', sourceReqIds: ['REQ-999'] })
  const plan = normalizeTestPlan(raw)

  assert.equal(plan.reqItems.length, 3)
  assert.equal(plan.testPoints.length, 4)
  assert.deepEqual(plan.reqItems[0].testPointIds, ['TP-001', 'TP-002'])
  assert.equal(plan.testPoints[0].designMethod, '等价类')
  assert.equal(plan.coverage.uncoveredReqIds.length, 0)
})

test('coverage boundary values stay within 0 to 100 and exclude information gaps', () => {
  const empty = applyCasesToTestPlan({ reqItems: [], testPoints: [] }, [])
  assert.equal(empty.coverage.coverageRate, 0)

  const onlyGap = applyCasesToTestPlan({
    reqItems: [{ id: 'REQ-001', type: 'gap', title: '缺少规则', gaps: ['规则'] }],
    testPoints: [{ id: 'TP-001', sourceReqIds: ['REQ-001'], isInformationGap: true, gaps: ['规则'] }],
  }, [{ id: 'TC-001', testPointIds: ['TP-001'] }])
  assert.equal(onlyGap.coverage.coverageRate, 0)
  assert.deepEqual(onlyGap.coverage.coveredTestPointIds, [])

  const complete = applyCasesToTestPlan(ledgerFixture(), [
    { id: 'TC-001', testPointIds: ['TP-001', 'TP-002'] },
    { id: 'TC-002', testPointIds: ['TP-003', 'TP-999'] },
  ])
  assert.equal(complete.coverage.coverageRate, 100)
  assert.deepEqual(complete.coverage.uncoveredTestPointIds, [])
})

test('normal test points with caveats remain eligible for coverage', () => {
  const audited = applyCasesToTestPlan({
    reqItems: [{ id: 'REQ-001', type: 'feature', title: 'Account length' }],
    testPoints: [{
      id: 'TP-001',
      sourceReqIds: ['REQ-001'],
      coverageType: 'Boundary value',
      designMethod: 'Boundary value analysis',
      gaps: ['Exact validation message is not specified'],
    }],
  }, [{ id: 'TC-001', testPointIds: ['TP-001'] }])

  assert.deepEqual(audited.coverage.informationGapTestPointIds, [])
  assert.deepEqual(audited.coverage.coveredTestPointIds, ['TP-001'])
  assert.equal(audited.coverage.coverageRate, 100)
})

test('coverage decision table maps no, partial, complete, and gap states correctly', () => {
  const cases = [
    { id: 'TC-001', testPointIds: ['TP-001'] },
    { id: 'TC-IGNORED', testPointIds: ['TP-999'] },
  ]
  const audited = applyCasesToTestPlan(ledgerFixture(), cases)

  assert.equal(audited.coverage.coverageRate, 33)
  assert.deepEqual(audited.coverage.coveredTestPointIds, ['TP-001'])
  assert.deepEqual(audited.coverage.uncoveredTestPointIds, ['TP-002', 'TP-003'])
  assert.equal(audited.reqItems.find((req) => req.id === 'REQ-001').coverageStatus, 'planned')
  assert.equal(audited.reqItems.find((req) => req.id === 'REQ-002').coverageStatus, 'planned')
  assert.equal(audited.reqItems.find((req) => req.id === 'REQ-003').coverageStatus, 'gap')
})

test('focused generation plan locks IDs and includes only requested uncovered test points', () => {
  const fullPlan = normalizeTestPlan(ledgerFixture())
  const focused = focusTestPlanForGeneration(fullPlan, ['TP-002', 'TP-004', 'TP-999'])

  assert.deepEqual(focused.testPoints.map((testPoint) => testPoint.id), ['TP-002'])
  assert.deepEqual(focused.reqItems.map((req) => req.id), ['REQ-001'])
  assert.deepEqual(focused.reqItems[0].testPointIds, ['TP-002'])
  assert.equal(focused.testPoints[0].designMethod, fullPlan.testPoints[1].designMethod)
})

test('automatic batch size boundaries clamp to one through forty-eight cases', () => {
  const minimum = getEffectiveGenerationSpec('qa', { min: 0.8, max: 1 })
  const maximum = getEffectiveGenerationSpec('qa', { min: 90, max: 120 })

  assert.equal(minimum.minCases, 1)
  assert.equal(minimum.stretchMax, 1)
  assert.equal(maximum.minCases, 48)
  assert.equal(maximum.stretchMax, 48)
})

test('focused prompt contains only the selected boundary-value test point', () => {
  const focused = focusTestPlanForGeneration(normalizeTestPlan(ledgerFixture()), ['TP-002'])
  const prompt = buildEnhancedUserContent({
    documents: [{ name: 'amount.txt', text: '输入金额后提交', role: 'primary' }],
    focusText: '',
    selectedTypes: ['功能测试'],
    depth: 'qa',
    timezone: 'Asia/Shanghai',
    maxTotalChars: 40_000,
    testPlan: focused,
    targetTestPointIds: ['TP-002'],
    caseTarget: { min: 1, max: 2 },
  })

  assert.match(prompt, /本批只允许覆盖以下测试点：TP-002/)
  assert.match(prompt, /"designMethod": "边界值"/)
  assert.doesNotMatch(prompt, /TP-001|TP-003|TP-004/)
})

test('test-plan JSON parser accepts fenced output and rejects incomplete objects', () => {
  assert.deepEqual(parseTestPlanJson('```json\n{"reqItems":[],"testPoints":[]}\n```'), {
    reqItems: [],
    testPoints: [],
  })
  assert.equal(parseTestPlanJson('{"reqItems":['), null)
})

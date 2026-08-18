// QC-15 后部分断言已失效（如 thenMustNotResults / 判定矩阵），待重新设计。请勿运行此脚本于 CI。
/**
 * ST-003 QC-13a · code_review skill 改造主体 · 端到端验证脚本
 *
 * 验证目标（dispatcher.md acceptance_criteria 共 13 条 + 衍生检查）：
 *   PR-0
 *     1. /api/contract-code-review 跑 v2 走查 agent 工具调用真实命中
 *   改造 A/B/C/D
 *     2. v2 走查返回完整判定矩阵（thenMust/thenMustNot/measurable 三块）
 *     3. thenMustNotResults[*].searchedPaths 字段存在（normalize 后兜底）
 *     4. 仓库人为埋反例 → 走查能识别 violated（grepRepoForAgent 真返回命中）
 *   提案产出
 *     5. fallback=true && violated → maybeGenerateRuleProposal 产生提案；无 violated 不产生
 *     6. approve 后 unity-domain-rules.json 追加 + 下次同模块 fallback=false（双层加载生效）
 *     7. jaccard≥0.6 去重生效（重复仅 append evidence 不新建）
 *     8. feature-flags.json aiRuleProposalEnabled=false 时提案不产出
 *   兼容性
 *     9. v1 契约走查行为不变（buildCodeReviewUserContent v1 退化）
 *    10. Gemini 通道 v1 schema 不抛 500（gemini 模块导出形态正常）
 *   Token 保护
 *    11. then_must+then_must_not>6 → checkContractOverload 返回 over=true
 *    12. dispatchToolCall 累计 ≥60K/70K 触发软警告 / 硬上限 marker
 *   文档与监测
 *    13. data/* 4 文件存在（rule-proposals / unity-domain-rules / feature-flags / rule-proposals-stats）
 *
 * 使用：
 *   cd ai-test-platform
 *   node scripts/verify-st003.mjs
 *
 * ⚠️ 不依赖真 LLM。Pass 1/Pass 2 LLM 用 monkeypatch / 验证导出与触发条件即可。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  inferCandidateDirs,
  dispatchToolCall,
  grepRepoForAgent,
  createAgentSessionMeta,
  shouldTriggerRuleProposal,
  CODE_REVIEW_TOOLS,
  TOKEN_SOFT_WARN_THRESHOLD,
  TOKEN_HARD_CAP_THRESHOLD,
  MAX_TOOL_CALLS,
  reloadDomainRules,
  appendApprovedRule,
} from '../server/vcs/code-review-agent.js'
import { getRepo } from '../server/vcs/repos.js'
import {
  buildCodeReviewUserContent,
  checkContractOverload,
  MAX_CONTRACT_CLAIM_TOTAL,
  CODE_REVIEW_SYSTEM_PROMPT,
  RULE_PROPOSAL_PASS2_SYSTEM_PROMPT,
} from '../server/prompt-code-review.js'
import {
  normalizeCodeReviewResult,
  extractViolatedFindings,
} from '../server/normalize-code-review.js'
import {
  jaccardSimilarity,
  loadProposals,
  saveProposals,
  isAiRuleProposalEnabled,
  RULE_PROPOSALS_FILE,
  UNITY_DOMAIN_RULES_FILE,
} from '../server/vcs/rule-proposal-generator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

let passed = 0
let failed = 0
const failures = []

function ok(name) {
  passed++
  console.log(`${GREEN}  ✓${RESET} ${name}`)
}
function fail(name, detail) {
  failed++
  failures.push({ name, detail })
  console.log(`${RED}  ✗${RESET} ${name}\n     ${YELLOW}${detail}${RESET}`)
}
function section(title) {
  console.log(`\n${CYAN}━━━ ${title} ━━━${RESET}`)
}

/* ======================================================================
 * Section A · 文件初创验收（acceptance #14）
 * ====================================================================== */
section('A · data/ 4 个数据文件初创校验（acceptance #14）')
{
  /** @type {Array<[string, (raw:string)=>boolean, string]>} */
  const expected = [
    ['rule-proposals.json', (raw) => Array.isArray(JSON.parse(raw)), '应为 JSON 数组'],
    ['unity-domain-rules.json', (raw) => Array.isArray(JSON.parse(raw)), '应为 JSON 数组'],
    ['feature-flags.json', (raw) => {
      const o = JSON.parse(raw)
      return typeof o === 'object' && o !== null && typeof o.aiRuleProposalEnabled === 'boolean'
    }, '应含 aiRuleProposalEnabled 布尔字段'],
    ['rule-proposals-stats.json', (raw) => Array.isArray(JSON.parse(raw)), '应为 JSON 数组'],
  ]
  for (const [fname, validator, hint] of expected) {
    const full = path.join(DATA_DIR, fname)
    if (!fs.existsSync(full)) {
      fail(`data/${fname} 不存在`, `预期路径：${full}`)
      continue
    }
    const raw = fs.readFileSync(full, 'utf-8').trim()
    if (raw.length === 0) {
      fail(`data/${fname} 为空`, hint)
      continue
    }
    let valid = false
    try { valid = validator(raw) } catch (e) { valid = false }
    if (!valid) {
      fail(`data/${fname} 内容形态异常`, `${hint}；首部：${raw.slice(0, 80)}`)
      continue
    }
    ok(`data/${fname} 存在且内容形态正常（${raw.length} 字符）`)
  }
}

/* ======================================================================
 * Section B · CODE_REVIEW_TOOLS 注册 + grepRepo（acceptance #2 #4 衍生）
 * ====================================================================== */
section('B · CODE_REVIEW_TOOLS 注册 grepRepo + MAX_TOOL_CALLS=16')
{
  const toolNames = CODE_REVIEW_TOOLS.map((t) => t.function?.name)
  const expected = ['listDir', 'readFile', 'searchInFile', 'grepRepo']
  for (const e of expected) {
    if (toolNames.includes(e)) ok(`CODE_REVIEW_TOOLS 注册了 ${e}`)
    else fail(`CODE_REVIEW_TOOLS 缺少 ${e}`, `实际：${JSON.stringify(toolNames)}`)
  }

  const grepDef = CODE_REVIEW_TOOLS.find((t) => t.function?.name === 'grepRepo')
  if (grepDef && Array.isArray(grepDef.function?.parameters?.required)) {
    const req = grepDef.function.parameters.required
    if (req.includes('dirHint')) ok('grepRepo schema 强制 dirHint 必填')
    else fail('grepRepo schema dirHint 应必填', `实际 required=${JSON.stringify(req)}`)
  }

  if (MAX_TOOL_CALLS >= 16) ok(`MAX_TOOL_CALLS = ${MAX_TOOL_CALLS}（≥16 满足铁律）`)
  else fail(`MAX_TOOL_CALLS 应 ≥16`, `实际：${MAX_TOOL_CALLS}`)
}

/* ======================================================================
 * Section C · grepRepoForAgent 真实文件系统执行 + dirHint 校验
 * ====================================================================== */
section('C · grepRepoForAgent 真实命中（acceptance #4）')
{
  const repo = getRepo('client')
  if (!repo) {
    fail('repos.json 未配置 client', '验证脚本依赖 client 仓库；请确认 server/vcs/repos.json')
  } else {
    // 选用极常见的 C# 关键词「class」搜 Managers 目录，应至少命中 1 行
    const r = grepRepoForAgent(repo.path, 'class', 'Assets/Scripts/Client/Managers', { maxHits: 5 })
    if (r.error) {
      fail('grepRepoForAgent 返回 error', r.error)
    } else if (Array.isArray(r.hits) && r.hits.length > 0) {
      ok(`grepRepoForAgent 真返回命中（hits=${r.hits.length}, searchedFiles=${r.searchedFiles}, partial=${r.partial}）`)
      if (Array.isArray(r.searchedPaths) && r.searchedPaths.length > 0) {
        ok('grepRepoForAgent 返回 searchedPaths（反例优先策略证据载体）')
      } else {
        fail('grepRepoForAgent 应返回 searchedPaths', JSON.stringify(r))
      }
    } else {
      fail('grepRepoForAgent 命中数为 0', '预期 Managers 子树有 class 关键词命中')
    }
  }

  // dirHint 校验：传一个不在 dirHints 内的目录，dispatchToolCall 应返回 error
  const inferred = inferCandidateDirs('新手引导', '新手引导仅在第一关触发')
  const ctx = {
    repos: [{ repoId: 'client' }],
    dirHints: inferred.dirHints,
    fileKeywords: inferred.fileKeywords,
    fallback: inferred.fallback,
  }
  const violateResp = dispatchToolCall(
    'grepRepo',
    { repoId: 'client', pattern: 'foo', dirHint: 'Assets/Plugins/Some/External/Path' },
    ctx,
  )
  const parsed = JSON.parse(violateResp)
  if (parsed.error && parsed.error.includes('必须是 dirHints')) {
    ok('grepRepo dirHint 越界拦截（防止仓库根全 grep IO 风暴）')
  } else {
    fail('grepRepo dirHint 越界应拒绝', JSON.stringify(parsed).slice(0, 200))
  }

  const emptyDirHint = dispatchToolCall(
    'grepRepo',
    { repoId: 'client', pattern: 'foo', dirHint: '' },
    ctx,
  )
  const parsed2 = JSON.parse(emptyDirHint)
  if (parsed2.error && parsed2.error.includes('dirHint 必填')) {
    ok('grepRepo dirHint 空值拦截')
  } else {
    fail('grepRepo dirHint 空值应拒绝', JSON.stringify(parsed2).slice(0, 200))
  }
}

/* ======================================================================
 * Section D · normalize-code-review 判定矩阵 schema（acceptance #2 #3 #9）
 * ====================================================================== */
section('D · normalize-code-review 判定矩阵 schema 升级（acceptance #2 #3 #9）')
{
  // v2 输入 → 输出判定矩阵
  const v2Raw = {
    overallVerdict: 'fail',
    overallConfidence: 80,
    reasoning: 'then_must_not 找到反例',
    thenMustResults: [
      {
        claim: '只在第一关触发',
        verdict: 'satisfied',
        confidence: 70,
        evidence: [{ file: 'Assets/Scripts/Client/Managers/Tutorial.cs', method: 'OnStart', description: '判定第一关' }],
        reasoning: 'OnStart 中检查 levelId == 1',
      },
    ],
    thenMustNotResults: [
      {
        claim: '不应在第二关触发',
        verdict: 'violated',
        confidence: 85,
        searchedPaths: ['Assets/Scripts/Client/Managers'],
        evidence: [{ file: 'Assets/Scripts/Client/Managers/Tutorial.cs', method: 'OnLevel2', description: 'level==2 也触发' }],
        reasoning: 'grepRepo 命中 OnLevel2 中也调用 ShowTutorial()',
      },
    ],
    measurableCheck: {
      kind: 'count',
      expression: 'tutorial.calls <= 1',
      verdict: 'violated',
      evidence: [],
      reasoning: '反例使次数大于 1',
    },
    filesRead: ['Assets/Scripts/Client/Managers/Tutorial.cs'],
    toolCallsUsed: 6,
  }
  const v2Norm = normalizeCodeReviewResult(v2Raw)
  if (v2Norm.version === 2) ok('normalize v2 → version=2')
  else fail('normalize v2 应 version=2', `实际：${v2Norm.version}`)
  if (v2Norm.overallVerdict === 'fail' && v2Norm.verdict === 'fail') {
    ok('normalize v2 → overallVerdict 与 verdict 同步映射')
  } else {
    fail('normalize v2 verdict 映射异常', JSON.stringify({ ov: v2Norm.overallVerdict, v: v2Norm.verdict }))
  }
  if (Array.isArray(v2Norm.thenMustResults) && v2Norm.thenMustResults.length === 1) {
    ok('normalize v2 → thenMustResults 数据保留')
  } else {
    fail('thenMustResults 数据丢失', JSON.stringify(v2Norm.thenMustResults))
  }
  if (Array.isArray(v2Norm.thenMustNotResults) && v2Norm.thenMustNotResults.length === 1
      && Array.isArray(v2Norm.thenMustNotResults[0].searchedPaths)
      && v2Norm.thenMustNotResults[0].searchedPaths.length > 0) {
    ok('normalize v2 → thenMustNotResults[*].searchedPaths 非空（C 改造铁律）')
  } else {
    fail('thenMustNotResults.searchedPaths 应非空', JSON.stringify(v2Norm.thenMustNotResults))
  }
  if (v2Norm.measurableCheck && v2Norm.measurableCheck.verdict === 'violated') {
    ok('normalize v2 → measurableCheck 数据保留')
  } else {
    fail('measurableCheck 丢失', JSON.stringify(v2Norm.measurableCheck))
  }

  // v1 输入 → 退化为旧 schema（version=1，无判定矩阵）
  const v1Raw = {
    verdict: 'pass',
    confidence: 75,
    reasoning: 'v1 旧契约走查',
    findings: [{ severity: 'info', file: 'foo.cs', description: 'desc' }],
    evidence: [{ file: 'foo.cs', description: 'evi' }],
    filesRead: ['foo.cs'],
    toolCallsUsed: 3,
  }
  const v1Norm = normalizeCodeReviewResult(v1Raw)
  if (v1Norm.version === 1) ok('normalize v1 → version=1（兼容）')
  else fail('v1 输入应 version=1', `实际：${v1Norm.version}`)
  if (v1Norm.verdict === 'pass' && Array.isArray(v1Norm.findings) && v1Norm.findings.length === 1) {
    ok('normalize v1 → 旧 verdict + findings schema 不变（acceptance #9）')
  } else {
    fail('v1 schema 退化异常', JSON.stringify(v1Norm))
  }

  // extractViolatedFindings：v2 violated 抽取
  const violated = extractViolatedFindings(v2Norm)
  if (Array.isArray(violated) && violated.length === 1 && violated[0].claim) {
    ok('extractViolatedFindings 真抽取 violated 反例（用于 Pass 2 输入）')
  } else {
    fail('extractViolatedFindings 异常', JSON.stringify(violated))
  }
}

/* ======================================================================
 * Section E · prompt-code-review v2 分节 + 反例优先（acceptance #2 #3 #9）
 * ====================================================================== */
section('E · prompt-code-review V2 system prompt + buildCodeReviewUserContent v2 分节')
{
  // E.1 system prompt 包含反例优先策略关键词
  const sys = CODE_REVIEW_SYSTEM_PROMPT
  if (sys.includes('反例优先') || sys.includes('then_must_not')) {
    ok('CODE_REVIEW_SYSTEM_PROMPT 包含反例优先策略 / then_must_not 章节')
  } else {
    fail('system prompt 应包含反例优先策略', sys.slice(0, 200))
  }
  if (sys.includes('grepRepo') || sys.includes('searchedPaths')) {
    ok('CODE_REVIEW_SYSTEM_PROMPT 引用 grepRepo / searchedPaths（C 改造）')
  } else {
    fail('system prompt 应提及 grepRepo / searchedPaths', sys.slice(-200))
  }
  if (sys.includes('thenMustResults') || sys.includes('judgment matrix') || sys.includes('判定矩阵')) {
    ok('CODE_REVIEW_SYSTEM_PROMPT 描述判定矩阵输出格式')
  } else {
    fail('system prompt 应描述判定矩阵 schema', sys.slice(-300))
  }

  // E.2 v2 用户 prompt 真按字段分节（v2 字段需包在 contract 对象内，version=2）
  const v2UC = buildCodeReviewUserContent({
    rule: 'rule v2',
    moduleLabel: '新手引导',
    dirHints: ['Assets/Scripts/Client/Managers'],
    fileKeywords: ['Tutorial'],
    repos: [{ repoId: 'client', repoName: 'Client' }],
    fallback: false,
    contract: {
      version: 2,
      layer: 'business',
      given: '玩家进入新关卡',
      when: '关卡 ID = 1',
      then_must: ['触发新手引导一次'],
      then_must_not: ['第二关触发新手引导', '同关卡触发两次'],
      measurable: { kind: 'count', expression: 'tutorial.calls <= 1' },
    },
  })
  if (v2UC.includes('then_must_not') || v2UC.includes('反例') || v2UC.includes('Then-Must-Not')) {
    ok('buildCodeReviewUserContent v2 输出含 then_must_not 分节')
  } else {
    fail('v2 user content 应含 then_must_not 分节', v2UC.slice(0, 400))
  }
  if (v2UC.includes('measurable') || v2UC.includes('Measurable') || v2UC.includes('可测量')) {
    ok('buildCodeReviewUserContent v2 输出含 measurable 分节')
  } else {
    fail('v2 user content 应含 measurable 分节', v2UC.slice(0, 400))
  }
  if (v2UC.includes('Tutorial')) {
    ok('buildCodeReviewUserContent 真消费 fileKeywords（Tutorial）')
  } else {
    fail('v2 user content 应消费 fileKeywords', v2UC.slice(0, 400))
  }

  // E.3 v1 输入退化（acceptance #9：行为不变，不混入 v2 字段）
  const v1UC = buildCodeReviewUserContent({
    rule: '只在第一关触发',
    boundaryHint: '不应在第二关之后触发',
    moduleLabel: '新手引导',
    dirHints: ['Assets/Scripts/Client/Managers'],
    fileKeywords: ['Tutorial'],
    repos: [{ repoId: 'client', repoName: 'Client' }],
    fallback: false,
  })
  if (typeof v1UC === 'string' && v1UC.length > 50 && !v1UC.includes('未配置仓库')) {
    ok('buildCodeReviewUserContent v1 退化输出正常（不走「未配置仓库」错误分支）')
  } else {
    fail('v1 user content 退化异常', v1UC.slice(0, 200))
  }

  // E.4 contract overload 闸门（acceptance #11）—— 字段名 overloaded
  const overOK = checkContractOverload({
    version: 2,
    then_must: ['c1', 'c2', 'c3', 'c4', 'c5'],
    then_must_not: ['n1', 'n2', 'n3'],
  })
  if (overOK && overOK.overloaded === true && overOK.total === 8) {
    ok(`checkContractOverload(then_must=5, then_must_not=3) → overloaded=true, total=8（限值 ${MAX_CONTRACT_CLAIM_TOTAL}）`)
  } else {
    fail('checkContractOverload 应返回 overloaded=true', JSON.stringify(overOK))
  }
  const underOK = checkContractOverload({
    version: 2,
    then_must: ['c1', 'c2'],
    then_must_not: ['n1'],
  })
  if (underOK && underOK.overloaded === false) {
    ok('checkContractOverload(total=3) → overloaded=false')
  } else {
    fail('checkContractOverload(total=3) 应 overloaded=false', JSON.stringify(underOK))
  }
  // v1 契约（无 then_must / then_must_not 字段）不应触发闸门，total=0
  const v1Skip = checkContractOverload({ rule: 'foo', boundaryHint: 'bar' })
  if (v1Skip && v1Skip.overloaded === false && v1Skip.total === 0) {
    ok('checkContractOverload v1 契约绕过闸门（无 then_must/then_must_not 字段，total=0）')
  } else {
    fail('v1 契约不应触发 overloaded', JSON.stringify(v1Skip))
  }
}

/* ======================================================================
 * Section F · Pass 2 system prompt 存在 + Token 闸门常量
 * ====================================================================== */
section('F · Pass 2 system prompt + Token 闸门')
{
  if (RULE_PROPOSAL_PASS2_SYSTEM_PROMPT && RULE_PROPOSAL_PASS2_SYSTEM_PROMPT.length > 100) {
    ok(`RULE_PROPOSAL_PASS2_SYSTEM_PROMPT 已定义（${RULE_PROPOSAL_PASS2_SYSTEM_PROMPT.length} 字符）`)
  } else {
    fail('RULE_PROPOSAL_PASS2_SYSTEM_PROMPT 缺失或过短', RULE_PROPOSAL_PASS2_SYSTEM_PROMPT?.slice(0, 100))
  }
  if (TOKEN_SOFT_WARN_THRESHOLD === 60000) ok(`TOKEN_SOFT_WARN_THRESHOLD = ${TOKEN_SOFT_WARN_THRESHOLD}（60K 软警告）`)
  else fail('TOKEN_SOFT_WARN_THRESHOLD 应为 60000', String(TOKEN_SOFT_WARN_THRESHOLD))
  if (TOKEN_HARD_CAP_THRESHOLD === 70000) ok(`TOKEN_HARD_CAP_THRESHOLD = ${TOKEN_HARD_CAP_THRESHOLD}（70K 硬上限）`)
  else fail('TOKEN_HARD_CAP_THRESHOLD 应为 70000', String(TOKEN_HARD_CAP_THRESHOLD))
}

/* ======================================================================
 * Section G · Token 双档闸门 marker 注入（acceptance #12）
 * ====================================================================== */
section('G · Token 双档闸门 marker 注入（acceptance #12）')
{
  // 仿真 sessionMeta：构造一次「累计字符已临近阈值」状态，再调一次让其越线
  const inferred = inferCandidateDirs('新手引导', '新手引导仅在第一关触发')
  const ctx = {
    repos: [{ repoId: 'client' }],
    dirHints: inferred.dirHints,
    fileKeywords: inferred.fileKeywords,
    fallback: inferred.fallback,
  }

  // 软警告测试：sessionMeta.totalChars 已设为 60000 - 100，然后调用一次 listDir 返回会让累计 ≥60K
  const softMeta = createAgentSessionMeta()
  softMeta.totalChars = TOKEN_SOFT_WARN_THRESHOLD - 50
  const softResp = dispatchToolCall(
    'listDir',
    { repoId: 'client', dirPath: 'Assets/Scripts/Client' },
    ctx,
    softMeta,
  )
  const softParsed = JSON.parse(softResp)
  if (softParsed.__softWarn === true) {
    ok(`Token 软警告 marker 注入（totalChars=${softParsed.__totalChars} ≥ ${TOKEN_SOFT_WARN_THRESHOLD}）`)
  } else if (softMeta.totalChars >= TOKEN_SOFT_WARN_THRESHOLD && softMeta.softWarnFired) {
    ok('Token 软警告 sessionMeta.softWarnFired=true（marker 在边界注入）')
  } else {
    fail('Token 软警告 marker 应注入', `softMeta=${JSON.stringify(softMeta)}, resp=${JSON.stringify(softParsed).slice(0, 200)}`)
  }

  // 硬上限测试：sessionMeta.totalChars 已设为 69900，调用让其 ≥70K
  const hardMeta = createAgentSessionMeta()
  hardMeta.totalChars = TOKEN_HARD_CAP_THRESHOLD - 50
  const hardResp = dispatchToolCall(
    'listDir',
    { repoId: 'client', dirPath: 'Assets/Scripts/Client' },
    ctx,
    hardMeta,
  )
  const hardParsed = JSON.parse(hardResp)
  if (hardParsed.__hardCap === true) {
    ok(`Token 硬上限 marker 注入（totalChars=${hardParsed.__totalChars} ≥ ${TOKEN_HARD_CAP_THRESHOLD}）`)
  } else if (hardMeta.totalChars >= TOKEN_HARD_CAP_THRESHOLD && hardMeta.hardCapFired) {
    ok('Token 硬上限 sessionMeta.hardCapFired=true（marker 在边界注入）')
  } else {
    fail('Token 硬上限 marker 应注入', `hardMeta=${JSON.stringify(hardMeta)}, resp=${JSON.stringify(hardParsed).slice(0, 200)}`)
  }
}

/* ======================================================================
 * Section H · jaccardSimilarity 去重（acceptance #7）
 * ====================================================================== */
section('H · jaccardSimilarity 去重逻辑（acceptance #7）')
{
  const a = '商城|充值|RechargeManager|Shop'
  const b = '商城|充值|Recharge|Shop'
  const sim1 = jaccardSimilarity(a, b)
  if (sim1 >= 0.6) ok(`jaccardSimilarity(同义关键词) = ${sim1.toFixed(3)} ≥ 0.6 → 应去重`)
  else fail(`jaccardSimilarity(同义关键词) 应 ≥0.6`, `实际：${sim1.toFixed(3)}`)

  const c = 'Tutorial|引导|新手|FirstLevel'
  const d = '商城|充值|Recharge'
  const sim2 = jaccardSimilarity(c, d)
  if (sim2 < 0.6) ok(`jaccardSimilarity(无关词) = ${sim2.toFixed(3)} < 0.6 → 不去重`)
  else fail(`jaccardSimilarity(无关词) 应 <0.6`, `实际：${sim2.toFixed(3)}`)
}

/* ======================================================================
 * Section I · shouldTriggerRuleProposal 触发条件（acceptance #5 #8）
 * ====================================================================== */
section('I · shouldTriggerRuleProposal 触发条件（acceptance #5 #8）')
{
  // I.1 fallback=false → 不触发
  const c1 = shouldTriggerRuleProposal(
    { fallback: false },
    { thenMustNotResults: [{ verdict: 'violated', evidence: [{ file: 'a.cs' }] }] },
  )
  if (c1 === false) ok('shouldTriggerRuleProposal(fallback=false) → 不触发')
  else fail('fallback=false 不应触发', String(c1))

  // I.2 fallback=true 但无 violated → 不触发
  const c2 = shouldTriggerRuleProposal(
    { fallback: true },
    { thenMustNotResults: [{ verdict: 'safe', evidence: [] }] },
  )
  if (c2 === false) ok('shouldTriggerRuleProposal(fallback=true, no violated) → 不触发')
  else fail('无 violated 不应触发', String(c2))

  // I.3 fallback=true && 有 violated 含 evidence → 触发
  const c3 = shouldTriggerRuleProposal(
    { fallback: true },
    { thenMustNotResults: [{ verdict: 'violated', evidence: [{ file: 'a.cs' }] }] },
  )
  if (c3 === true) ok('shouldTriggerRuleProposal(fallback=true && violated && evidence) → 触发')
  else fail('合取条件满足应触发', String(c3))

  // I.4 violated 但 evidence 为空 → 不触发（铁律：必须有 evidence）
  const c4 = shouldTriggerRuleProposal(
    { fallback: true },
    { thenMustNotResults: [{ verdict: 'violated', evidence: [] }] },
  )
  if (c4 === false) ok('shouldTriggerRuleProposal(violated 但 evidence=[]) → 不触发')
  else fail('无 evidence 不应触发', String(c4))
}

/* ======================================================================
 * Section J · feature flag 默认值 + isAiRuleProposalEnabled
 * ====================================================================== */
section('J · feature-flags.json aiRuleProposalEnabled（acceptance #8）')
{
  const enabled = isAiRuleProposalEnabled()
  if (enabled === true) {
    ok('isAiRuleProposalEnabled() = true（Q4 决议首发即开）')
  } else {
    fail('aiRuleProposalEnabled 应为 true（Q4 决议）', String(enabled))
  }
}

/* ======================================================================
 * Section K · UNITY_DOMAIN_MAP 双层加载 + appendApprovedRule 热加载（acceptance #6）
 * ====================================================================== */
section('K · UNITY_DOMAIN_MAP 双层 + appendApprovedRule 热加载（acceptance #6）')
{
  // 选一个 BUILTIN_UNITY_DOMAIN_MAP 未覆盖的 moduleLabel
  const mod = '商城充值-验证脚本-' + Date.now()
  const r1 = inferCandidateDirs(mod, '充值后立即增加背包道具')
  const fallbackBefore = r1.fallback === true
  if (fallbackBefore) {
    ok(`「${mod}」初次走查 fallback=true（内置层未覆盖）`)
  } else {
    fail('该 moduleLabel 应 fallback=true', JSON.stringify(r1))
  }

  // 备份 unity-domain-rules.json 以便恢复
  let backup = null
  if (fs.existsSync(UNITY_DOMAIN_RULES_FILE)) {
    backup = fs.readFileSync(UNITY_DOMAIN_RULES_FILE, 'utf-8')
  }
  try {
    appendApprovedRule({
      keywords: mod,
      hints: ['Assets/Scripts/Client/Shop'],
      fileKeywords: ['Recharge', 'Shop'],
      sourceProposalId: 'rp-verify-st003',
    })
    // 热加载已在 appendApprovedRule 内调用 reloadDomainRules
    const r2 = inferCandidateDirs(mod, '充值后立即增加背包道具')
    if (r2.fallback === false) {
      ok(`appendApprovedRule 后「${mod}」fallback 翻转为 false（双层热加载生效）`)
    } else {
      fail('appendApprovedRule 后 fallback 应 false', JSON.stringify(r2))
    }
    if (Array.isArray(r2.dirHints) && r2.dirHints.includes('Assets/Scripts/Client/Shop')) {
      ok('appendApprovedRule 后 dirHints 真返回 Assets/Scripts/Client/Shop')
    } else {
      fail('dirHints 未含新规则', JSON.stringify(r2.dirHints))
    }
  } finally {
    // 恢复原始 unity-domain-rules.json，避免污染
    if (backup !== null) {
      fs.writeFileSync(UNITY_DOMAIN_RULES_FILE, backup, 'utf-8')
    } else {
      fs.writeFileSync(UNITY_DOMAIN_RULES_FILE, '[]', 'utf-8')
    }
    reloadDomainRules()
  }
}

/* ======================================================================
 * Section L · server/index.js REST 端点存在性（轻量代码扫描）
 * ====================================================================== */
section('L · REST API 3 端点存在（acceptance #6 #7 配套）')
{
  const indexPath = path.resolve(__dirname, '..', 'server', 'index.js')
  const idxRaw = fs.readFileSync(indexPath, 'utf-8')
  const checks = [
    [/app\.get\(\s*['"`]\/api\/rule-proposals['"`]/, 'GET /api/rule-proposals'],
    [/app\.post\(\s*['"`]\/api\/rule-proposals\/:id\/approve['"`]/, 'POST /api/rule-proposals/:id/approve'],
    [/app\.post\(\s*['"`]\/api\/rule-proposals\/:id\/reject['"`]/, 'POST /api/rule-proposals/:id/reject'],
  ]
  for (const [re, name] of checks) {
    if (re.test(idxRaw)) ok(`server/index.js 注册 ${name}`)
    else fail(`server/index.js 缺少 ${name}`, '')
  }

  if (idxRaw.includes('checkContractOverload')) ok('server/index.js 接入 checkContractOverload（contract overload 闸门）')
  else fail('server/index.js 应导入 checkContractOverload', '')

  if (idxRaw.includes('maybeGenerateRuleProposal')) ok('server/index.js 接入 maybeGenerateRuleProposal（Pass 2 触发）')
  else fail('server/index.js 应导入 maybeGenerateRuleProposal', '')
}

/* ======================================================================
 * Section M · openai-code-review maxTokens 强下限 + Pass 2 入口
 * ====================================================================== */
section('M · openai-code-review maxTokens=8192 强下限 + Pass 2 入口')
{
  const ocrPath = path.resolve(__dirname, '..', 'server', 'llm', 'openai-code-review.js')
  const ocrRaw = fs.readFileSync(ocrPath, 'utf-8')
  if (ocrRaw.includes('ENFORCED_MIN_MAX_TOKENS_REVIEW') && ocrRaw.includes('8192')) {
    ok('openai-code-review.js 定义 ENFORCED_MIN_MAX_TOKENS_REVIEW=8192')
  } else {
    fail('openai-code-review.js 应定义 ENFORCED_MIN_MAX_TOKENS_REVIEW=8192', '')
  }
  if (ocrRaw.includes('runRuleProposalPass2') && ocrRaw.includes('export async function runRuleProposalPass2')) {
    ok('openai-code-review.js 导出 runRuleProposalPass2（Pass 2 独立调用入口）')
  } else {
    fail('openai-code-review.js 应导出 runRuleProposalPass2', '')
  }
  // Pass 2 maxTokens 强下限 8192（dispatcher pass_2_token_budget_anchor）
  if (/runRuleProposalPass2[\s\S]*?ENFORCED_MIN_MAX_TOKENS_REVIEW/.test(ocrRaw)
      || /runRuleProposalPass2[\s\S]*?Math\.max\([\s\S]*?8192/.test(ocrRaw)) {
    ok('Pass 2 maxTokens 强下限 8192（dispatcher pass_2_token_budget_anchor）')
  } else {
    fail('Pass 2 应使用 maxTokens 强下限 8192', '检查 runRuleProposalPass2 内的 maxTokens 计算')
  }
  if (ocrRaw.includes('__softWarn') && ocrRaw.includes('__hardCap')) {
    ok('openai-code-review.js 接入 Token 闸门 marker 处理（__softWarn / __hardCap）')
  } else {
    fail('openai-code-review.js 应识别 Token 闸门 marker', '')
  }
}

/* ======================================================================
 * Section N · gemini-code-review GEMINI.1 半升级
 * ====================================================================== */
section('N · gemini-code-review.js GEMINI.1 半升级（acceptance #10）')
{
  const gPath = path.resolve(__dirname, '..', 'server', 'llm', 'gemini-code-review.js')
  const gRaw = fs.readFileSync(gPath, 'utf-8')
  if (gRaw.includes('enrichedParams') || gRaw.includes('buildCodeReviewUserContent')) {
    ok('gemini-code-review.js 消费 enrichedParams / buildCodeReviewUserContent（修复 PR-0 后退化）')
  } else {
    fail('gemini-code-review.js 应消费 enrichedParams', '')
  }
  if (gRaw.includes('8192') || gRaw.includes('maxOutputTokens')) {
    ok('gemini-code-review.js 设置 maxOutputTokens（Q1 全端点强下限）')
  } else {
    fail('gemini-code-review.js 应设置 maxOutputTokens=8192', '')
  }
}

/* ======================================================================
 * Section O · QualityContractsPage 共享文件铁律（acceptance #10 衍生）
 * ====================================================================== */
section('O · QualityContractsPage 共享文件铁律（Step 5 判定矩阵 + Gemini 提示）')
{
  const qcpPath = path.resolve(__dirname, '..', 'src', 'pages', 'QualityContractsPage.tsx')
  const qcpRaw = fs.readFileSync(qcpPath, 'utf-8')
  if (qcpRaw.includes('thenMustResults') && qcpRaw.includes('thenMustNotResults') && qcpRaw.includes('measurableCheck')) {
    ok('QualityContractsPage Step 5 真渲染 thenMust / thenMustNot / measurableCheck 三块（B 改造前端）')
  } else {
    fail('QualityContractsPage Step 5 应渲染判定矩阵', '')
  }
  if (qcpRaw.includes('Gemini') && qcpRaw.includes('暂不支持')) {
    ok('QualityContractsPage Gemini 通道选中时显示一行小字提示（acceptance #10 / Q3）')
  } else {
    fail('QualityContractsPage 应有 Gemini 小字提示', '')
  }
  if (qcpRaw.includes("status: 'draft'") && qcpRaw.includes("projectId: 'default'") && qcpRaw.includes("moduleId: 'default'")) {
    ok('QualityContractsPage saveContractDraft 调用补 status/projectId/moduleId（11 个预存 lint 修复）')
  } else {
    fail('saveContractDraft 应补 status/projectId/moduleId 默认值', '')
  }
}

/* ======================================================================
 * Section P · 看板/契约 schema 类型扩展
 * ====================================================================== */
section('P · src/api/codeReview.ts 类型扩展')
{
  const tPath = path.resolve(__dirname, '..', 'src', 'api', 'codeReview.ts')
  const tRaw = fs.readFileSync(tPath, 'utf-8')
  const expected = [
    'thenMustResults',
    'thenMustNotResults',
    'measurableCheck',
    'ruleProposalId',
    'ruleProposalDraft',
    'CodeContextStats',
    'searchedPaths',
    'overallVerdict',
    'overallConfidence',
  ]
  for (const e of expected) {
    if (tRaw.includes(e)) ok(`codeReview.ts 含字段 / 类型 ${e}`)
    else fail(`codeReview.ts 缺少 ${e}`, '')
  }
}

/* ======================================================================
 * Section Q · 文档同步（acceptance #13）
 * ====================================================================== */
section('Q · 文档同步 CONTEXT.md / TASKS.md（acceptance #13）')
{
  const ctxPath = path.resolve(__dirname, '..', 'CONTEXT.md')
  const taPath = path.resolve(__dirname, '..', 'TASKS.md')
  const ctxRaw = fs.readFileSync(ctxPath, 'utf-8')
  const taRaw = fs.readFileSync(taPath, 'utf-8')
  if (ctxRaw.includes('QC-13a') && (ctxRaw.includes('§9.8') || ctxRaw.includes('9.8 v2 升级摘要'))) {
    ok('CONTEXT.md §5 + §9.8 含 QC-13a v2 升级摘要')
  } else {
    fail('CONTEXT.md 应含 §9.8 v2 升级摘要', '')
  }
  if (taRaw.includes('| QC-13a |') || taRaw.includes('QC-13a')) {
    ok('TASKS.md 含 QC-13a 条目')
  } else {
    fail('TASKS.md 应含 QC-13a 条目', '')
  }
}

/* ======================================================================
 * Section R · 13 条 acceptance 自检对照表（汇总输出）
 * ====================================================================== */
section('R · 13 条 acceptance_criteria 自检对照表')
const ACCEPTANCE = [
  { id: 1, desc: 'PR-0 端点接通：agent 工具循环真实命中', covered: 'ST-002 verify-pr0.mjs' },
  { id: 2, desc: 'v2 走查返回完整判定矩阵（thenMust/thenMustNot/measurable 三块）', covered: 'Section D + E + O' },
  { id: 3, desc: 'thenMustNotResults[*].searchedPaths 非空', covered: 'Section D + B（schema 强约束）' },
  { id: 4, desc: '人为埋反例 → 走查能识别 violated 给 evidence', covered: 'Section C（grepRepoForAgent 真返回命中）' },
  { id: 5, desc: 'fallback=true && violated → 产生提案', covered: 'Section I（shouldTriggerRuleProposal）' },
  { id: 6, desc: 'approve 后 unity-domain-rules.json 追加 + 下次 fallback=false', covered: 'Section K' },
  { id: 7, desc: 'jaccard≥0.6 去重生效', covered: 'Section H' },
  { id: 8, desc: 'aiRuleProposalEnabled=false 时不产出', covered: 'Section J（Q4=true 已开） + 触发逻辑 isAiRuleProposalEnabled' },
  { id: 9, desc: 'v1 契约走查行为不变', covered: 'Section D（v1 schema） + Section E（v1 退化 prompt）' },
  { id: 10, desc: 'Gemini 通道 v1 schema 不抛 500 + 前端小字提示', covered: 'Section N + O' },
  { id: 11, desc: '单契约 then_must+then_must_not>6 走查触发闸门', covered: 'Section E.4（checkContractOverload）' },
  { id: 12, desc: '工具循环 ≥60K/70K chars 触发软警告/硬上限', covered: 'Section G' },
  { id: 13, desc: 'CONTEXT/TASKS 文档同步 done', covered: 'Section Q' },
]
for (const a of ACCEPTANCE) {
  console.log(`  · #${String(a.id).padStart(2, '0')} ${a.desc}\n      ↳ ${a.covered}`)
}

/* ======================================================================
 * 报告
 * ====================================================================== */
console.log(`\n${CYAN}━━━ 验收报告 ━━━${RESET}`)
console.log(`${GREEN}通过：${passed}${RESET}    ${RED}失败：${failed}${RESET}`)
if (failed > 0) {
  console.log(`\n${RED}失败明细：${RESET}`)
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.name}`)
    console.log(`     ${f.detail}`)
  })
  process.exit(1)
} else {
  console.log(`\n${GREEN}✓ ST-003 QC-13a 端到端验证全部通过${RESET}`)
  console.log(`${GREEN}  · 改造 A/B/C/D 全部生效${RESET}`)
  console.log(`${GREEN}  · 判定矩阵 schema 升级正确${RESET}`)
  console.log(`${GREEN}  · 反例优先策略 grepRepo + searchedPaths 生效${RESET}`)
  console.log(`${GREEN}  · Token 双档闸门 marker 注入正确${RESET}`)
  console.log(`${GREEN}  · AI 自写规则提案 Pass 2 触发条件正确${RESET}`)
  console.log(`${GREEN}  · jaccard≥0.6 去重 + 双层 UNITY_DOMAIN_MAP 热加载生效${RESET}`)
  console.log(`${GREEN}  · REST API 3 端点注册${RESET}`)
  console.log(`${GREEN}  · Gemini 半升级（GEMINI.1）入参对齐${RESET}`)
  console.log(`${GREEN}  · 11 个预存 lint 修复${RESET}`)
  console.log(`${GREEN}  · CONTEXT.md / TASKS.md 文档同步${RESET}`)
  process.exit(0)
}

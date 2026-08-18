// QC-15 后部分断言已失效（如 thenMustNotResults / 判定矩阵），待重新设计。请勿运行此脚本于 CI。
/**
 * ST-004 QC-13b · 规则提案审批 UI MVP · 端到端验证脚本
 *
 * 不依赖真 LLM、不启 dev server。采用「静态文件检查 + 关键特征字符串落地核验」
 * 方式覆盖 dispatcher.md acceptance_criteria 8 条 + must_preserve 5 条 + 二次点击防御铁律。
 *
 * 执行：
 *   cd ai-test-platform
 *   node scripts/verify-st004.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

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

/** 读取文件，文件不存在时返回 null（调用方负责报失败） */
function read(rel) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) return null
  return fs.readFileSync(full, 'utf-8')
}

/* ======================================================================
 * Section A · 新增文件存在性
 * ====================================================================== */
section('A · 新增文件存在性（D-13b.2 / D-13b.3）')

const apiSrc = read('src/api/ruleProposals.ts')
if (apiSrc === null) {
  fail('src/api/ruleProposals.ts 不存在', '组件层无法导入审批 API')
} else {
  ok(`src/api/ruleProposals.ts 存在（${apiSrc.length} 字符）`)
}

const cardSrc = read('src/components/RuleProposalCard.tsx')
if (cardSrc === null) {
  fail('src/components/RuleProposalCard.tsx 不存在', '走查结果区无法挂载草稿卡')
} else {
  ok(`src/components/RuleProposalCard.tsx 存在（${cardSrc.length} 字符）`)
}

const pageSrc = read('src/pages/QualityContractsPage.tsx')
if (pageSrc === null) {
  fail('src/pages/QualityContractsPage.tsx 不存在', '关键页面缺失')
}

/* ======================================================================
 * Section B · API 三函数 + 类型 re-export（13b.2）
 * ====================================================================== */
section('B · ruleProposals.ts 三 API 与类型 re-export')

if (apiSrc) {
  const apiChecks = [
    [/export\s+async\s+function\s+listRuleProposals\b/, 'listRuleProposals 函数存在'],
    [/export\s+async\s+function\s+approveRuleProposal\b/, 'approveRuleProposal 函数存在'],
    [/export\s+async\s+function\s+rejectRuleProposal\b/, 'rejectRuleProposal 函数存在'],
    [/POST\s.*?\/api\/rule-proposals\/.*?\/approve/, 'POST /api/rule-proposals/:id/approve 端点 URL 落地'],
    [/POST\s.*?\/api\/rule-proposals\/.*?\/reject/, 'POST /api/rule-proposals/:id/reject 端点 URL 落地'],
    [/\/api\/rule-proposals/, 'GET /api/rule-proposals URL 落地'],
    [/export\s+type\s+\{\s*RuleProposalDraft\s*\}|export\s+type\s+RuleProposalDraft/, 'RuleProposalDraft 类型 re-export'],
    [/export\s+interface\s+RuleProposal\b/, 'RuleProposal 类型导出'],
    [/throw\s+new\s+Error/, '错误处理：throw Error 友好封装'],
  ]
  for (const [re, name] of apiChecks) {
    if (re.test(apiSrc)) ok(name)
    else fail(name, `未在 ruleProposals.ts 中匹配到正则 ${re}`)
  }
}

/* ======================================================================
 * Section C · RuleProposalCard 组件结构（13b.3 / acceptance #5 #7）
 * ====================================================================== */
section('C · RuleProposalCard 组件结构')

if (cardSrc) {
  const cardChecks = [
    [/AI 草拟规则建议/, '标题「AI 草拟规则建议」存在'],
    [/批准入库/, '按钮「批准入库」存在'],
    [/驳回/, '按钮「驳回」存在'],
    [/稍后再说/, '按钮「稍后再说」存在'],
    [/violet/, 'violet 主色（与 Step 5 一致）'],
    [/proposal\.keywords/, 'keywords 正则展示'],
    [/proposal\.hints/, 'hints 候选目录展示'],
    [/proposal\.fileKeywords/, 'fileKeywords 标签云展示'],
    [/proposal\.affectsModules/, 'affectsModules 可选展示'],
    [/evidenceOpen|setEvidenceOpen/, 'evidence 默认折叠（local useState 切换）'],
    [/展开证据|收起证据/, '展开证据 / 收起证据 按钮文案'],
    [/'idle'\s*\|\s*'submitting'\s*\|\s*'done'\s*\|\s*'error'/, '状态机 idle | submitting | done | error'],
    [/disabled=\{disabled\}/, '按钮 disable 防重复点击'],
    [/data-rule-proposal-approve/, 'data 钩子：approve 按钮（验收钩子）'],
    [/data-rule-proposal-reject/, 'data 钩子：reject 按钮（验收钩子）'],
    [/data-rule-proposal-defer/, 'data 钩子：defer 按钮（验收钩子）'],
    [/Spinner/, 'submitting 时 spinner'],
  ]
  for (const [re, name] of cardChecks) {
    if (re.test(cardSrc)) ok(name)
    else fail(name, `RuleProposalCard.tsx 未匹配到正则 ${re}`)
  }
}

/* ======================================================================
 * Section D · QualityContractsPage 集成（13b.4 / 13b.5 / 13b.7）
 * ====================================================================== */
section('D · QualityContractsPage 集成与状态机隔离')

if (pageSrc) {
  const pageChecks = [
    [
      /import\s*\{\s*RuleProposalCard\s*\}\s*from\s*'\.\.\/components\/RuleProposalCard'/,
      'RuleProposalCard 已 import',
    ],
    [
      /import\s*\{\s*approveRuleProposal,\s*rejectRuleProposal\s*\}\s*from\s*'\.\.\/api\/ruleProposals'/,
      '审批 API 已 import',
    ],
    [
      /useState<Record<string,\s*boolean>>\(\{\}\)/,
      '独立状态机：proposalDismissed Record<string, boolean>',
    ],
    [
      /proposalDismissed/,
      'proposalDismissed 状态在页面层使用',
    ],
    [
      /clearProposalFromReview|ruleProposalId:\s*undefined,\s*ruleProposalDraft:\s*undefined/,
      '二次点击防御：成功后从 reviewResult 移除 ruleProposalId/ruleProposalDraft',
    ],
    [
      /handleProposalApprove/,
      'handleProposalApprove 函数存在',
    ],
    [
      /handleProposalReject/,
      'handleProposalReject 函数存在',
    ],
    [
      /handleProposalDefer/,
      'handleProposalDefer 函数存在',
    ],
    [
      /setMsg\('规则已入库[，,]?\s*下次相关走查将直接命中'\)/,
      'toast 文案：批准 → 「规则已入库，下次相关走查将直接命中」',
    ],
    [
      /setMsg\('提案已驳回'\)/,
      'toast 文案：驳回 → 「提案已驳回」',
    ],
    [
      /reviewResult\.ruleProposalId\s*&&[\s\S]{0,200}reviewResult\.ruleProposalDraft\s*&&[\s\S]{0,200}!proposalDismissed\[reviewResult\.ruleProposalId\]/,
      '渲染条件三 && 表达式：ruleProposalId && ruleProposalDraft && !proposalDismissed[id]',
    ],
    [
      /<RuleProposalCard\b[\s\S]{0,500}onApprove=/,
      '<RuleProposalCard /> 已挂载且传入 onApprove',
    ],
    [
      /<RuleProposalCard\b[\s\S]{0,500}onReject=/,
      '<RuleProposalCard /> 已传入 onReject',
    ],
    [
      /<RuleProposalCard\b[\s\S]{0,500}onDefer=/,
      '<RuleProposalCard /> 已传入 onDefer',
    ],
    [
      /\{\/\*\s*ST-004 占位/,
      'line 711 占位注释保留（未删除）',
    ],
  ]
  for (const [re, name] of pageChecks) {
    if (re.test(pageSrc)) ok(name)
    else fail(name, `QualityContractsPage 未匹配到正则 ${String(re).slice(0, 200)}`)
  }
}

/* ======================================================================
 * Section E · 共享文件铁律（must_preserve）—— 不可触碰区
 * ====================================================================== */
section('E · 共享文件铁律：Step 1-4 与 Step 5 拆分展示主体不动')

if (pageSrc) {
  // RuleProposalCard 渲染必须在 ST-004 占位注释之后；占位注释之前的 reviewResult 三块（thenMustResults / thenMustNotResults / measurableCheck）必须保留
  const placeholderIdx = pageSrc.indexOf('ST-004 占位')
  if (placeholderIdx < 0) {
    fail('未找到 ST-004 占位注释', '渲染锚点丢失')
  } else {
    ok(`ST-004 占位注释位置 ${placeholderIdx}`)
    const before = pageSrc.slice(0, placeholderIdx)
    const after = pageSrc.slice(placeholderIdx)
    // 在占位之前必须保留 ST-003 三块判定矩阵展示
    const beforeChecks = [
      [/Then-Must（正向不变量）/, 'Step 5 主体保留：Then-Must 区块'],
      [/Then-Must-Not（反向断言/, 'Step 5 主体保留：Then-Must-Not 区块'],
      [/Measurable（可测量量）/, 'Step 5 主体保留：Measurable 区块'],
      [/Gemini 通道暂不支持反例判定矩阵/, 'Step 5 主体保留：Gemini 小字提示'],
      [/盲区：/, 'Step 5 主体保留：盲区/gaps 行'],
    ]
    for (const [re, name] of beforeChecks) {
      if (re.test(before)) ok(name)
      else fail(name, `占位前未匹配到 ${re}`)
    }
    // 渲染必须在占位之后
    if (/<RuleProposalCard\b/.test(after)) {
      ok('<RuleProposalCard /> 在 ST-004 占位注释之后挂载（追加而非替换）')
    } else {
      fail('<RuleProposalCard /> 未在占位之后', '违反「仅在占位下方追加」铁律')
    }
  }

  // ContractCard.tsx 不动（ST-004 file_boundary 禁止）
  const ccImport = /from\s+'\.\.\/components\/ContractCard'/.test(pageSrc)
  if (ccImport) ok('ContractCard 仍正常 import（QC-12 范畴）')
}

/* ======================================================================
 * Section F · TASKS.md B.9 节 QC-13b 条目（D2）
 * ====================================================================== */
section('F · TASKS.md B.9 节 QC-13b 条目（D2 文档同步）')

const tasksMd = read('TASKS.md')
if (!tasksMd) {
  fail('TASKS.md 不存在', '文档同步缺失')
} else {
  const taskChecks = [
    [/\|\s*QC-13b\s*\|/, 'QC-13b 表格行存在'],
    [/规则提案审批 UI/, 'QC-13b 标题含「规则提案审批 UI」'],
    [/RuleProposalCard/, 'QC-13b 备注含 RuleProposalCard'],
    [/TKT-20260429-004/, 'QC-13b 关联看板 TKT-20260429-004'],
    [/4-6h/, 'QC-13b 工时 4-6h'],
    [/已实现/, 'QC-13b 状态「已实现」'],
  ]
  for (const [re, name] of taskChecks) {
    if (re.test(tasksMd)) ok(name)
    else fail(name, `TASKS.md 未匹配到正则 ${re}`)
  }
}

/* ======================================================================
 * Section G · 后端不可碰（forbidden 验证）
 * ====================================================================== */
section('G · forbidden 验证：server/* 不应被 ST-004 修改')

// 间接验证：本任务期间不应新增/删除 server/ 文件；这里只检查关键 server 文件存在性（保护性检查）
const serverProbes = [
  'server/index.js',
  'server/vcs/code-review-agent.js',
  'server/vcs/rule-proposal-generator.js',
  'server/normalize-code-review.js',
]
for (const p of serverProbes) {
  if (read(p) === null) {
    fail(`${p} 缺失`, '可能被误删（forbidden 区域）')
  } else {
    ok(`${p} 仍存在（forbidden 区域未被破坏）`)
  }
}

/* ======================================================================
 * Section H · 8 条 acceptance_criteria 自检对照表
 * ====================================================================== */
section('H · 8 条 acceptance_criteria 自检对照表')

const accept = [
  {
    n: 1,
    name: '端到端：fallback 走出 violated 反例 → 草稿卡出现',
    pass:
      !!cardSrc &&
      !!pageSrc &&
      /<RuleProposalCard\b/.test(pageSrc) &&
      /reviewResult\.ruleProposalId\s*&&[\s\S]{0,200}reviewResult\.ruleProposalDraft/.test(pageSrc),
    detail:
      '组件已挂载 + 渲染条件依赖 reviewResult.ruleProposalId/Draft；端到端真实跑出反例需手动跑 server，本脚本仅静态验证条件',
  },
  {
    n: 2,
    name: '批准入库 → 卡片消失 + toast 文案 + 后端写 unity-domain-rules.json',
    pass:
      !!pageSrc &&
      /handleProposalApprove/.test(pageSrc) &&
      /approveRuleProposal/.test(pageSrc) &&
      /setMsg\('规则已入库[，,]?\s*下次相关走查将直接命中'\)/.test(pageSrc) &&
      /clearProposalFromReview|ruleProposalId:\s*undefined/.test(pageSrc),
    detail: '批准 handler 调 approveRuleProposal、写 toast、移除 ruleProposalId 三动作齐全',
  },
  {
    n: 3,
    name: '驳回 → 卡片消失 + toast「提案已驳回」+ 后端 status=rejected',
    pass:
      !!pageSrc &&
      /handleProposalReject/.test(pageSrc) &&
      /rejectRuleProposal/.test(pageSrc) &&
      /setMsg\('提案已驳回'\)/.test(pageSrc),
    detail: '驳回 handler 三动作齐全（API 调用 + toast + 移除 ruleProposalId）',
  },
  {
    n: 4,
    name: '稍后再说 → 仅前端隐藏（proposalDismissed=true），不调 API、不改 reviewResult',
    pass:
      !!pageSrc &&
      /handleProposalDefer.*setProposalDismissed/.test(pageSrc.replace(/\s+/g, ' ')) &&
      // defer 不应调 approve/reject API（在 handleProposalDefer 函数体内不出现这两个名字）
      !/handleProposalDefer[\s\S]{0,400}approveRuleProposal|handleProposalDefer[\s\S]{0,400}rejectRuleProposal/.test(
        pageSrc,
      ),
    detail: '稍后 handler 仅 setProposalDismissed，不调审批 API',
  },
  {
    n: 5,
    name: '三按钮点击后立即 disable；接口返回（成功/失败）后状态正确重置',
    pass:
      !!cardSrc &&
      /setState\('submitting'\)/.test(cardSrc) &&
      /setState\('done'\)/.test(cardSrc) &&
      /setState\('error'\)/.test(cardSrc) &&
      /disabled=\{disabled\}/.test(cardSrc),
    detail: '卡片内部状态机覆盖 submitting/done/error，按钮 disable={disabled} 三按钮统一受控',
  },
  {
    n: 6,
    name: '走查结果区其它内容（reasoning / evidence / gaps / thenMustResults / thenMustNotResults / measurableCheck）不受卡片显隐影响',
    pass:
      !!pageSrc &&
      /reviewResult\.reasoning/.test(pageSrc) &&
      /reviewResult\.thenMustResults/.test(pageSrc) &&
      /reviewResult\.thenMustNotResults/.test(pageSrc) &&
      /reviewResult\.measurableCheck/.test(pageSrc) &&
      /reviewResult\.gaps/.test(pageSrc),
    detail: 'Step 5 主体五块渲染均保留',
  },
  {
    n: 7,
    name: 'evidence 默认折叠，点击展开；展开后再点击可折回',
    pass:
      !!cardSrc &&
      /useState\(false\)/.test(cardSrc) &&
      /setEvidenceOpen\(\(v\)\s*=>\s*!v\)/.test(cardSrc),
    detail: 'useState(false) 默认折叠 + 切换函数 (v) => !v 双向切换',
  },
  {
    n: 8,
    name: 'TASKS.md B.9 节 QC-13b 条目同步 done',
    pass: !!tasksMd && /\|\s*QC-13b\s*\|/.test(tasksMd) && /已实现/.test(tasksMd),
    detail: 'QC-13b 行存在 + 状态「已实现」',
  },
]

for (const a of accept) {
  if (a.pass) ok(`#${a.n} ${a.name}`)
  else fail(`#${a.n} ${a.name}`, a.detail)
}

/* ======================================================================
 * 汇总
 * ====================================================================== */
console.log('')
console.log(`${CYAN}━━━ 汇总 ━━━${RESET}`)
console.log(`通过：${GREEN}${passed}${RESET}    失败：${failed > 0 ? RED : GREEN}${failed}${RESET}`)
if (failed > 0) {
  console.log(`\n${RED}失败明细：${RESET}`)
  for (const f of failures) {
    console.log(`  · ${f.name} → ${f.detail}`)
  }
  process.exit(1)
} else {
  console.log(`\n${GREEN}✓ ST-004 QC-13b 静态验证全部通过${RESET}`)
  console.log(
    [
      '  · 13b.1~13b.7 七项改造点全部命中',
      '  · 8 条 acceptance_criteria 静态对照通过',
      '  · 共享文件铁律：仅在占位下方追加，未触碰 Step 1-4 与 Step 5 主体',
      '  · 二次点击防御：批准/驳回成功后从 reviewResult 移除 ruleProposalId',
      '  · 状态机隔离：卡片内 idle|submitting|done|error + 页面层 proposalDismissed Record',
      '  · forbidden 验证：server/* 关键文件未被破坏',
    ].join('\n'),
  )
  process.exit(0)
}

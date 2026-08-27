/**
 * 增强版提示词构建
 * 在原始 prompt 基础上注入：代码变更摘要 + 知识库检索上下文
 */
import {
  SYSTEM_PROMPT,
  buildUserContent,
  getEffectiveGenerationSpec,
  buildEnhancedJsonTail,
} from './prompt.js'

/**
 * @param {string} [depth] dev | planning | qa
 */
export function buildEnhancedSystemPrompt(depth, caseTarget) {
  const s = getEffectiveGenerationSpec(depth, caseTarget)
  return `${SYSTEM_PROMPT}

8. **代码上下文分析**（⚠️ 仅当用户消息中出现「--- 项目源码」区块且内容非空时生效；否则本条全部忽略）：
   - 在未提供项目源码时：**禁止**根据想象推测类名、文件名、模块名来编写用例；module 只能使用需求文档中的功能/步骤表述。
   - 在提供源码时：逐一阅读每个代码文件，理解其**类结构、关键函数、公开接口、条件分支、异常处理、配置读取**。
   - 对每个与**当前需求相关**的公开函数/方法，覆盖：正常路径、异常/错误路径、边界值、关键条件分支、状态转换、并发/时序（以代码中有线索者为限）。
   - module 可与代码中的类名/路径结合需求语义命名（如「新手引导/TutorialManager」），但**不得**单独把与需求无关的类拉成一大组凑数用例。
   - 配置表、事件监听、定时器/延时等：仅在代码中出现时补充对应用例。

9. **用例数量与分布**（数值以用户消息中的「详细程度与数量策略」为准，须同时满足）：
   - 最低 cases 条数：不少于策略中的 ${s.minCases} 条；需求步骤多时可扩充至约 ${s.minCases}～${s.stretchMax} 条。
   - ${s.perStepHint}
   - 非纯主流程用例合计占比：不低于约 ${s.nonMainMinPct}%（见策略块）。
   - ${s.typeDistHint}
   - 有项目源码时：${s.codePerClassHint}
   - **严禁**只输出主流程；禁止为凑条数输出无法在**需求原文**或**已提供源码**中溯源的用例。

10. **知识库上下文利用**（当系统检索到相关知识时）：
   - 知识库可能包含历史踩坑记录、已有测试用例参考、业务规则说明。
   - 应参考知识中提到的**风险点、历史 bug**设计回归用例。
   - 不要照搬知识库中的用例，而是根据当前需求和代码做针对性调整。
   - 在 remarks 字段中可标注「参考知识库」。

11. **需求文档覆盖要求**（优先级最高）：
   - 将需求按**步骤或独立功能块**拆解（可用 Step1、Step2 或文档原有标题），为每一块建立可识别的 module/subModule 分组，避免遗漏末尾步骤（如「弱引导退出」「附录优化」等）。
   - 每个步骤/块：按「详细程度与数量策略」生成足够用例（正常执行、失败回退、非法操作、中断恢复等，以文档有描述或合理可观测者为限）。
   - **标识符与原文**：需求中出现的**任何**可区分实体的具体写法（编号、ID、配置键、资源路径、文件名、按钮文案、提示语原文等），在相关用例的 steps 或 expected 中须**与需求一致**；**禁止**用「某个 ID」「某组件」「某文件」等模糊措辞**替换**需求中已写明的具体值。**若需求全文未出现具体 ID/键名，则不得编造**，改用文档中的自然语言描述操作对象。
   - **文案与媒体（通用）**：仅当需求**实际列出**某条界面文案、某个音效/语音/图片/视频等资源名或路径时，才为该项编写验证用例（是否展示/播放、内容或文件名是否与原文一致、触发或消失条件是否与描述一致）。**不得假设**统一命名规范（如固定前缀）；**若需求未出现任何媒体或独立文案条目，则不生成**此类专项用例。
   - **状态与分支**：文档中「若…则…」「未…则返回上一步」等条件，每个分支至少一条可执行用例。
   - **强引导 / 弱引导**（若文档提及）：强引导须验证阻断其它操作；弱引导须验证消失或降级条件。
   - **自检**：输出前按步骤清单逐项勾选，确认无段落未被任何用例覆盖。

12. **用例颗粒度与可执行性**：
   - 每条用例只验证一个测试点。
   - **summary** 一句说清验证点；禁止空泛的「验证某某功能正常」。
   - **steps** 须含操作对象 + 动作 + 条件/数据；**expected** 须可判定 pass/fail。
   - **preconditions** 写明前置状态；若使用具体 ID/资源名，须与需求原文一致或标注「文档未明确」。

13. **输出聚焦与可溯源**：
   - 每条用例须能指出其依据：**需求文档段落/步骤**，或**已提供源码中的文件/逻辑**；无法指出的用例禁止输出。
   - **禁止**生成需求文档**未描述**的业务模块或功能面（例如从代码里看到但与当前需求无关的类，不得单开一组用例）。
   - 若受输出长度限制无法覆盖全部，**优先**保证需求步骤全覆盖，其次再补充代码衍生用例。`
}

export function buildTestPlanMessages(params) {
  const documents = Array.isArray(params.documents) ? params.documents : []
  const docText = buildTestPlanDocText(documents, params.maxTotalChars ?? 100_000)
  const focusText = String(params.focusText || '').trim()
  const selectedTypes = Array.isArray(params.selectedTypes) ? params.selectedTypes.join('、') : '功能测试'
  const depth = String(params.depth || 'qa')
  const planningContext = String(params.planningContext || '').trim().slice(0, 28_000)

  const system = `你是资深测试架构师，负责把需求材料拆成可审计的测试计划账本。
最高优先级：诚实。未知不说、绝不捏造；所有条目仅基于当前需求材料与提供的上下文证据。
只输出合法 JSON，不要 Markdown，不要解释。`

  const user = `请基于需求材料生成 REQ 需求账本与 TP 测试点账本。

上下文：
- 测试类型：${selectedTypes}
- 详细程度：${depth}
${focusText ? `- 生成重点：${focusText}` : ''}

输出 JSON Schema：
{
  "reqItems": [
    {
      "id": "REQ-001",
      "type": "module|feature|branch|gap",
      "title": "需求条目标题",
      "module": "所属模块",
      "parentId": "",
      "source": {
        "documentName": "来源文档名",
        "heading": "来源标题或章节",
        "excerpt": "可追溯的原文摘要，80字以内"
      },
      "testPointIds": [],
      "gaps": [],
      "coverageStatus": "uncovered|planned|covered|gap"
    }
  ],
  "testPoints": [
    {
      "id": "TP-001",
      "title": "测试点标题",
      "sourceReqIds": ["REQ-001"],
      "coverageType": "主流程|异常|边界|状态|兼容|安全|信息不足",
      "designMethod": "等价类|边界值|判定表|状态迁移|场景法|错误推测",
      "designBasis": "采用该方法的具体输入域、边界或条件组合",
      "priority": "P0|P1|P2",
      "isInformationGap": false,
      "agentStage": "test_point_planning",
      "sourceEvidence": ["REQ-001: 原文摘要"],
      "caseIds": [],
      "gaps": [],
      "coverageStatus": "planned|gap"
    }
  ],
  "coverage": {
    "reqTotal": 0,
    "testPointTotal": 0,
    "uncoveredReqIds": [],
    "informationGapReqIds": [],
    "informationGapTestPointIds": []
  }
}

硬性要求：
1. REQ 是需求账本，不是测试用例；TP 是测试点，不写详细步骤和预期。
2. 每个非模块类 REQ 至少应被 1 个 TP 覆盖；覆盖关系同时写入 REQ.testPointIds 和 TP.sourceReqIds。
3. 如果需求信息不足，创建 type="gap" 的 REQ，并创建 isInformationGap=true 的 TP，明确 gaps。
4. ID 必须稳定递增：REQ-001、REQ-002；TP-001、TP-002。
5. 保留完整 Agent 编排扩展字段：agentStage、sourceEvidence、coverageStatus、caseIds、gaps。
6. 测试点必须落实行业标准设计方法：有输入域时划分有效/无效等价类；有数值、长度、次数、时间等有序域时覆盖边界值及邻域；多个条件共同决定结果时使用判定表覆盖关键组合。
7. designMethod 与 designBasis 必须写清采用的方法和具体依据，不能只写空泛标签。
8. 不要为了凑数量编造需求。需求很大时优先覆盖所有模块和关键分支，保持条目轻量。

${planningContext ? `补充上下文证据（代码分析、知识库与需求分析结论，仅用于补充当前需求的测试风险）：\n${planningContext}\n` : ''}

需求材料：
${docText}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

function buildTestPlanDocText(documents, maxTotalChars) {
  return documents.map((doc, idx) => {
    const name = String(doc?.name || `文档${idx + 1}`)
    const role = doc?.role ? `（${doc.role}）` : ''
    const text = String(doc?.text || '').slice(0, 45_000)
    return `## ${name}${role}\n${text}`
  }).join('\n\n---\n\n').slice(0, maxTotalChars)
}

export function buildRequirementLedgerMessages(params) {
  const documents = Array.isArray(params.documents) ? params.documents : []
  const docText = buildTestPlanDocText(documents, params.maxTotalChars ?? 100_000)
  const focusText = String(params.focusText || '').trim()
  const selectedTypes = Array.isArray(params.selectedTypes) ? params.selectedTypes.join('、') : '功能测试'
  const depth = String(params.depth || 'qa')

  const system = `你是资深测试架构师，负责把需求材料拆成可审计的 REQ 需求账本。
最高优先级：诚实。未知不说、绝不捏造；所有条目仅基于当前需求材料。
只输出合法 JSON，不要 Markdown，不要解释。`

  const user = `请只生成 REQ 需求账本，不要生成 TP 测试点，也不要生成测试用例。

上下文：
- 测试类型：${selectedTypes}
- 详细程度：${depth}
${focusText ? `- 生成重点：${focusText}` : ''}

输出 JSON Schema：
{
  "reqItems": [
    {
      "id": "REQ-001",
      "type": "module|feature|branch|gap",
      "title": "需求条目标题",
      "module": "所属模块",
      "parentId": "",
      "source": {
        "documentName": "来源文档名",
        "heading": "来源标题或章节",
        "excerpt": "可追溯的原文摘要，80字以内"
      },
      "testPointIds": [],
      "gaps": [],
      "coverageStatus": "uncovered|gap"
    }
  ]
}

硬性要求：
1. REQ 是需求账本，不是测试点，不写详细测试步骤和预期。
2. 按需求文档中的模块、功能、条件分支、异常/边界描述拆分；不要为了凑数量编造需求。
3. 如果需求信息不足，创建 type="gap" 的 REQ，并在 gaps 中明确缺什么信息。
4. ID 必须稳定递增：REQ-001、REQ-002。
5. 每个 REQ 必须带 source.excerpt，保证可追溯到原文。

需求材料：
${docText}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function buildTestPointBatchMessages(params) {
  const reqItems = Array.isArray(params.reqItems) ? params.reqItems : []
  const batchReqItems = Array.isArray(params.batchReqItems) ? params.batchReqItems : []
  const focusText = String(params.focusText || '').trim()
  const selectedTypes = Array.isArray(params.selectedTypes) ? params.selectedTypes.join('、') : '功能测试'
  const depth = String(params.depth || 'qa')
  const batch = Number(params.batchIndex || 0) + 1
  const total = Number(params.totalBatches || 1)

  const system = `你是资深测试架构师，负责基于已确认的 REQ 需求账本生成 TP 测试点。
最高优先级：诚实。TP 只能覆盖本批 REQ；未知不说、绝不捏造。
只输出合法 JSON，不要 Markdown，不要解释。`

  const user = `请为本批 REQ 生成 TP 测试点。本次只处理 batch=${batch}/${total} 中列出的 REQ，不要重复生成其它批次的测试点。

上下文：
- 测试类型：${selectedTypes}
- 详细程度：${depth}
${focusText ? `- 生成重点：${focusText}` : ''}

全量 REQ 摘要（用于理解上下文，不要全量生成）：
${JSON.stringify(reqItems.map((req) => ({
  id: req.id,
  type: req.type,
  title: req.title,
  module: req.module,
  excerpt: req.source?.excerpt || '',
  gaps: req.gaps || [],
})), null, 2)}

本批 REQ（只为这些生成 TP）：
${JSON.stringify(batchReqItems, null, 2)}

输出 JSON Schema：
{
  "testPoints": [
    {
      "id": "TP-001",
      "title": "测试点标题",
      "sourceReqIds": ["REQ-001"],
      "coverageType": "主流程|异常|边界|状态|兼容|安全|信息不足",
      "designMethod": "等价类|边界值|判定表|状态迁移|场景法|错误推测",
      "designBasis": "采用该方法的具体输入域、边界或条件组合",
      "priority": "P0|P1|P2",
      "isInformationGap": false,
      "agentStage": "test_point_planning",
      "sourceEvidence": ["REQ-001: 原文摘要"],
      "caseIds": [],
      "gaps": [],
      "coverageStatus": "planned|gap"
    }
  ]
}

硬性要求：
1. TP 是测试点，不是测试用例；不要写详细 steps/expected。
2. 每个非 module 且非 gap 的本批 REQ 至少生成 1 个 TP；关键分支可生成多个 TP。
3. TP.sourceReqIds 只能引用本批 REQ 的 id；不得引用不存在的 REQ。
4. 如果本批 REQ 信息不足，生成 isInformationGap=true 的 TP，并明确 gaps。
5. 有输入域时使用等价类；有数值、长度、次数、时间等有序域时覆盖边界值及邻域；多个条件共同决定结果时使用判定表覆盖关键组合。
6. designMethod 与 designBasis 必须写清采用的方法和具体依据，不能只写空泛标签。
7. id 可从 TP-001 开始；服务端会统一重编号。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 增强块内「代码附录」上限，避免与文档抢满 120k 后总过长导致模型敷衍 */
const ENHANCED_CODE_APPEND_MAX = 55_000
/** 增强块内「知识库附录」上限 */
const ENHANCED_RAG_APPEND_MAX = 14_000
/** buildUserContent 之外：关键要求列表 + 分隔线等预估占用 */
const ENHANCED_EXTRA_OVERHEAD = 10_000
/** 文档材料最低保留字符预算（再少则需求信息丢太多） */
const ENHANCED_DOC_FLOOR = 32_000

/**
 * 构建增强版用户内容
 * @param {object} params
 * @param {object[]} params.documents
 * @param {string} params.focusText
 * @param {string[]} params.selectedTypes
 * @param {string} params.depth
 * @param {string} params.timezone
 * @param {number} params.maxTotalChars
 * @param {string} [params.codeChangeSummary] 代码变更摘要（原始代码或预分析结论）
 * @param {string} [params.ragContext] 知识库检索上下文
 * @param {string} [params.requirementAnalysis] Step 2 需求分析结论（pipeline 模式）
 * @param {boolean} [params.pipelineMode] 是否为 pipeline 模式（代码已预分析）
 * @param {object} [params.testPlan] 结构化 REQ/TP 覆盖计划
 * @param {string} [params.skillsContext] 用户选择的 Skill 内容
 * @param {'fresh'|'append'} [params.generationMode] 生成模式；append 表示在已有用例基础上追加下一批
 * @param {object[]} [params.existingCases] 已有用例摘要，用于追加批次避重
 * @param {{ min?: number, max?: number }} [params.batchTarget] 追加批次目标条数
 */
export function buildEnhancedUserContent(params) {
  const maxTotalChars = params.maxTotalChars ?? 120_000
  const depth = params.depth
  const s = getEffectiveGenerationSpec(depth, params.caseTarget)
  const hasCode = Boolean(params.codeChangeSummary?.trim())
  const hasRag = Boolean(params.ragContext?.trim())

  let codeUse = 0
  if (hasCode) {
    codeUse = Math.min(ENHANCED_CODE_APPEND_MAX, params.codeChangeSummary.trim().length)
  }
  let ragUse = 0
  if (hasRag) {
    ragUse = Math.min(ENHANCED_RAG_APPEND_MAX, params.ragContext.trim().length)
  }

  let docBudget = maxTotalChars
  if (hasCode || hasRag) {
    let doc = maxTotalChars - ENHANCED_EXTRA_OVERHEAD - codeUse - ragUse
    while (doc < ENHANCED_DOC_FLOOR && (codeUse > 0 || ragUse > 0)) {
      if (codeUse > 0) {
        const step = Math.min(codeUse, ENHANCED_DOC_FLOOR - doc)
        codeUse -= step
        doc += step
        continue
      }
      const step = Math.min(ragUse, ENHANCED_DOC_FLOOR - doc)
      ragUse -= step
      doc += step
    }
    docBudget = Math.max(20_000, doc)
  }

  const baseContent = buildUserContent({ ...params, maxTotalChars: docBudget })

  const parts = [baseContent]

  parts.push('')
  parts.push('⚠️⚠️⚠️ **关键要求（违反将导致输出不合格）**：')
  parts.push(`1. **数量**：cases 不少于 ${s.minCases} 条；需求步骤多时建议 ${s.minCases}～${s.stretchMax} 条。禁止为凑数编造无依据用例。`)
  parts.push(
    `2. **非主流程占比**：异常、边界、专项、资源与 UI、兼容与中断等合计不低于约 ${s.nonMainMinPct}%。`,
  )
  parts.push(`3. **逐步对照**：按需求步骤/功能块拆解，${s.perStepHint}，避免遗漏文档末尾或附录要求。`)
  parts.push(
    '4. **原文标识**：需求中出现的具体标识符、资源名、文案须在 steps/expected 中原样使用；未出现者不得编造。操作对象若无 ID，用文档中的界面名称、区域名描述。',
  )
  parts.push(
    '5. **文案与媒体**：仅对需求中**实际写出**的每条独立提示文案、每个媒体/资源文件名（任意命名风格）编写验证；需求无媒体内容则不写音频类用例。',
  )
  parts.push('6. **可溯源**：每条用例对应需求某一步或（如有）源码某处；无关模块禁止输出。')
  parts.push(`7. **自检**：核对步骤清单无遗漏；cases 数是否 ≥ ${s.minCases}；非主流程占比是否达标。`)

  parts.push(
    `8. **信息不足标注**：若需求文档对某功能的使用场景、购买流程、奖励规则等描述不完整，导致无法生成具体可执行的测试步骤，必须输出一条信息不足占位用例（priority="P1", caseType 选最接近的, summary 写明缺什么信息, steps=[], expected="信息不足，无法验证", remarks="信息不足：需要XXX说明"）。禁止用模糊的通用步骤掩盖信息缺失。`,
  )
  if (!hasCode) {
    parts.push('9. **当前无项目源码区块**：禁止用臆测的代码类名、文件名作为 module 或测试主题。')
  }

  const existingCases = Array.isArray(params.existingCases)
    ? params.existingCases
      .map((tc) => ({
        id: String(tc?.id || '').trim(),
        module: String(tc?.module || '').trim(),
        subModule: String(tc?.subModule || '').trim(),
        summary: String(tc?.summary || '').trim(),
        expected: String(tc?.expected || '').trim(),
        priority: String(tc?.priority || '').trim(),
        caseType: String(tc?.caseType || '').trim(),
        sourceReqIds: Array.isArray(tc?.sourceReqIds) ? tc.sourceReqIds.map(String).filter(Boolean) : [],
        testPointIds: Array.isArray(tc?.testPointIds) ? tc.testPointIds.map(String).filter(Boolean) : [],
        designMethod: String(tc?.designMethod || '').trim(),
      }))
      .filter((tc) => tc.summary || tc.expected)
      .slice(0, 180)
    : []
  const targetTestPointIds = Array.isArray(params.targetTestPointIds)
    ? [...new Set(params.targetTestPointIds.map(String).map((id) => id.trim().toUpperCase()).filter(Boolean))]
    : []
  if (targetTestPointIds.length > 0) {
    parts.push('')
    parts.push('--- 自动覆盖批次（本段优先级高于前述通用数量建议）---')
    parts.push(`本批只允许覆盖以下测试点：${targetTestPointIds.join('、')}。`)
    parts.push(`本批输出 ${s.minCases}～${s.stretchMax} 条用例；每条 testPointIds 必须至少包含一个上述 ID，不得生成其它测试点的用例。`)
    parts.push('优先保证每个目标测试点至少有一条完整、可执行、可判定的用例，再为边界值或判定表补充必要组合。')
  }
  if (params.generationMode === 'append' && existingCases.length > 0) {
    const targetMin = Number.isFinite(Number(params.batchTarget?.min)) ? Number(params.batchTarget.min) : 30
    const targetMax = Number.isFinite(Number(params.batchTarget?.max)) ? Number(params.batchTarget.max) : 60
    parts.push('')
    parts.push('--- 追加生成模式（本批必须避重补洞）---')
    parts.push(`当前页面已有 ${existingCases.length} 条用例摘要。你本次只生成「下一批新增用例」，目标 ${targetMin}～${targetMax} 条；不要重写、总结或返回已有用例。`)
    parts.push('已有用例摘要（用于避重）：')
    parts.push(JSON.stringify(existingCases, null, 2))
    parts.push('')
    parts.push('本批追加要求：')
    parts.push('- 禁止生成与已有 summary、expected 高度相似的用例；若测试点相同但步骤略变，也视为重复。')
    parts.push('- 已有用例带 testPointIds 时，只补充尚未被这些 ID 覆盖的测试点；已覆盖测试点不要重复生成。')
    parts.push('- 优先补已有用例未覆盖的模块、子模块、异常分支、边界值、兼容/中断恢复、资源与 UI 验证、权限/非法操作、信息不足占位。')
    parts.push('- 若需求或代码证据不足，按诚实性原则输出「信息不足」占位用例，而不是编造细节。')
    parts.push('- 每条新增用例仍必须能溯源到需求文档、需求深度分析、代码预分析或知识库上下文。')
  }

  if (params.testPlan?.testPoints?.length) {
    const compactPlan = {
      reqItems: (params.testPlan.reqItems || []).map((req) => ({
        id: req.id,
        type: req.type,
        title: req.title,
        module: req.module,
        source: req.source,
        gaps: req.gaps,
      })),
      testPoints: params.testPlan.testPoints.map((tp) => ({
        id: tp.id,
        title: tp.title,
        sourceReqIds: tp.sourceReqIds,
        coverageType: tp.coverageType,
        designMethod: tp.designMethod,
        designBasis: tp.designBasis,
        priority: tp.priority,
        isInformationGap: tp.isInformationGap,
        sourceEvidence: tp.sourceEvidence,
        gaps: tp.gaps,
      })),
    }
    parts.push('')
    parts.push('--- 已确认的需求与测试点覆盖计划（最终用例必须以此为主索引）---')
    parts.push(JSON.stringify(compactPlan, null, 2))
    parts.push('')
    parts.push('覆盖计划执行要求：')
    parts.push('- 每条非信息不足 TP 至少生成一条可执行用例；不得跳过 TP，也不得生成无法关联到 TP 的无依据用例。')
    parts.push('- 每条用例必须返回 sourceReqIds、testPointIds、designMethod；ID 必须来自上方账本。')
    parts.push('- 等价类、边界值和判定表等方法必须真正体现在测试数据、条件组合、步骤和预期中，但 summary/description/remarks 不展示方法术语。')
    parts.push('- 信息不足 TP 生成对应占位用例，禁止补写未提供的业务规则。')
  }

  if (params.requirementAnalysis?.trim()) {
    parts.push('')
    parts.push('--- 需求深度分析（由独立分析 Agent 预先生成）---')
    parts.push(params.requirementAnalysis.trim())
    parts.push('')
    parts.push('以上需求分析已由独立 Agent 完成。请严格基于此分析中的功能点拆解和信息不足项来设计用例：')
    parts.push('- 对分析中列出的每个功能点/步骤，生成对应的测试用例。')
    parts.push('- 对分析中标注的「信息不足」项，必须输出信息不足占位用例。')
    parts.push('- 对分析中指出的测试风险，设计针对性的异常/边界用例。')
  }

  if (params.codeChangeSummary?.trim()) {
    parts.push('')
    if (params.pipelineMode) {
      parts.push('--- 代码预分析结论（由独立分析 Agent 逐文件生成，非原始代码）---')
      parts.push(params.codeChangeSummary.trim().slice(0, codeUse))
      parts.push('')
      parts.push('以上是独立 Agent 对每个代码文件的结构化分析结论。请基于这些结论：')
      parts.push('- 针对分析中列出的关键接口和异常分支，补充边界和异常用例。')
      parts.push('- 针对分析中标注的风险点，设计验证用例。')
      parts.push('- 针对分析中标注的「信息不足」项，输出信息不足占位用例。')
    } else {
      parts.push('--- 项目源码（已根据需求自动检索/扫描）---')
      parts.push(params.codeChangeSummary.trim().slice(0, codeUse))
      parts.push('')
      parts.push(
        '**代码分析要求**（在生成用例前，先对每个源码文件完成以下内部分析，不需要输出分析过程，但须影响用例设计）：',
      )
      parts.push('- 该文件的核心职责是什么？与当前需求的哪个步骤/功能相关？')
      parts.push('- 关键公开函数/接口有哪些？入参校验、异常分支、边界条件是什么？')
      parts.push('- 该文件是否依赖配置/事件/定时器？配置缺失或异常时会怎样？')
      parts.push('- 信息不足（如函数调用了未提供的其他文件、配置表结构不明等），在相关用例 remarks 中标注"信息不足：需要XXX"。')
      parts.push('')
      parts.push(
        '基于以上分析，补充与**当前需求相关**的异常和边界用例；勿引入与需求无关的模块凑数。',
      )
    }
    parts.push(
      `来自代码视角的补充用例，在「${s.label}」模式下合计不宜超过总条数的约 ${s.key === 'planning' ? '25' : s.key === 'qa' ? '40' : '35'}%，且每条仍须与需求或上述源码片段可对应。`,
    )
  }

  if (params.ragContext?.trim()) {
    parts.push('')
    parts.push('--- 知识库参考（历史经验/规则）---')
    parts.push(params.ragContext.trim().slice(0, ragUse))
    parts.push('')
    parts.push('请参考以上知识库信息，关注历史风险点和已知问题，在用例设计中融入相关场景。')
  }

  if (params.skillsContext?.trim()) {
    parts.push('')
    parts.push('--- 用户选择的 Skill 规范（必须遵循；仅作为方法与输出约束，不得编造需求事实）---')
    parts.push(params.skillsContext.trim().slice(0, 60_000))
  }

  return parts.join('\n')
}

/**
 * 构建增强版 messages 数组（直接交给 OpenAI-compatible API）
 */
export function buildEnhancedMessages(params) {
  const depth = params.depth
  const userText = buildEnhancedUserContent(params)
  const tail = buildEnhancedJsonTail(depth)
  return [
    { role: 'system', content: buildEnhancedSystemPrompt(depth) },
    { role: 'user', content: userText + tail },
  ]
}

/** @deprecated 请使用 buildEnhancedSystemPrompt(depth)；保留为兼容旧引用（等价于 QA 档） */
export const ENHANCED_SYSTEM_PROMPT = buildEnhancedSystemPrompt('qa')

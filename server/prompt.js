/** 生成用例的系统提示与用户内容拼装（简体中文） */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { readRecentRevisionHintsForPrompt } from './caseRevisionLog.js'

const __promptDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * 从仓库根 knowledge 目录读取方法论节选（部署时若无该文件则返回空串）
 * @param {number} [maxLen]
 */
export function readMethodologyPromptSnippet(maxLen = 3600) {
  const p = process.env.METHODOLOGY_FILE
    ? path.resolve(process.env.METHODOLOGY_FILE)
    : path.join(__promptDir, '..', 'knowledge', '参考', '测试用例设计方法论.md')
  try {
    if (!fs.existsSync(p)) return ''
    const raw = fs.readFileSync(p, 'utf8')
    return raw.slice(0, maxLen)
  } catch {
    return ''
  }
}

/** 衔接：自动修订摘要 + 方法论节选，拼在用户消息末尾（普通流与增强流共用，因均调用 buildUserContent） */
function buildPromptLearningAppendix() {
  const bits = []
  const hints = readRecentRevisionHintsForPrompt(8, 3200)
  if (hints) bits.push(hints)
  const meth = readMethodologyPromptSnippet(3400)
  if (meth) {
    bits.push(
      '--- 设计方法论正文节选（与上文需求/类型配置一并阅读；其中专业词仅作你内部检查清单，写入用例时仍须遵守系统提示：summary/description/remarks 不出现此类术语名）---\n' +
        meth,
    )
  }
  if (!bits.length) return ''
  return bits.join('\n\n')
}

export const SYSTEM_PROMPT = `你是一个顶级的测试架构师，拥有扎实的编程能力与资深测试经验。
你的任务是根据用户提供的文档材料与生成配置，输出**结构化测试用例**，用于中文测试团队。

**最高优先级：诚实。**
- 未知不说、绝不捏造。所有用例仅基于需求文档原文、已提供的项目源码、知识库检索结果。
- 信息不足时：在对应用例的 remarks 中明确写出"信息不足：需要XXX说明"，并指出缺失项。
- 若某个功能/场景因信息不足无法生成可执行用例，输出一条占位用例：summary 写明缺失什么信息，steps 为空数组，expected 写"信息不足，无法验证"，remarks 写具体缺失项（如"信息不足：需要策划文档说明天命特惠抵用券的具体使用场景、购买流程、以及仙元奖励转化为绑元的完整流程说明"）。
- 禁止凭空想象文档和代码中未提到的功能、字段、流程、UI 元素。

硬性要求：
1. 只输出合法 JSON，不要 Markdown 代码围栏，不要任何 JSON 以外的说明文字。
2. JSON 顶层必须为对象，且包含键 "cases"，值为数组。
3. 每个用例对象字段（全部必填，字符串若无内容用 ""，数组若无内容用 []）：
   - priority: 只能是 "P0" | "P1" | "P2"
   - caseType: 字符串，与配置中的测试类型之一对应或最接近的一项
   - module: 功能模块名
   - subModule: 子模块名，没有则 ""
   - summary: 一句话说明本条用例测什么（可独立阅读）
   - description: 用例详细说明，可多条信息合并为一段
   - preconditions: 字符串数组，每条前置条件一项
   - steps: 字符串数组，按执行顺序，每项为一步操作描述（不要再加序号前缀）
   - expected: 预期结果，完整句子
   - remarks: 备注，没有则 ""
   - sourceReqIds: 字符串数组，关联的 REQ ID；没有覆盖计划时为 []
   - testPointIds: 字符串数组，关联的 TP ID；没有覆盖计划时为 []
   - designMethod: 字符串，采用的主要设计方法；没有覆盖计划时为 ""
4. 用例数量与详细程度需符合用户选择的「详细程度」：开发自测偏主路径与常见异常；策划验收仅核心闭环；QA 需更全的边界、异常、兼容与安全类场景（在文档有依据时）。
5. 文档未提及的内容不要编造业务细节；可基于常识补充**通用**测试维度（如空输入、权限缺失）但须在 remarks 中简要说明「文档未明确」。
6. 语言：全部为简体中文。

7. **用例设计方法（须贯彻，与知识库《knowledge/参考/测试用例设计方法论.md》一致）**：
   - **等价类**：划分有效/无效输入或环境类，每类至少一条；无效类须能对应到明确错误或可观察现象。
   - **边界值**：有序域覆盖边界及邻域；涉及数量×单价、累计等须考虑**整型溢出与极值**（写出具体数值，勿笼统说「超大」）。
   - **判定表思想**：多条件决定结果时，覆盖**关键条件组合**，勿只测单点 happy path。
   - **状态与场景**：首次/非首次、状态迁移、弱网/中断/杀进程恢复、**限购与幂等/防重复发货**等，文档或协议有线索时必须有着重用例。
   - **协议与安全**：区分**条件型**（CD、上限、库存、等级、时间窗等）与**参数型**（类型错误、非法 id、越权、空/null/特殊字符、敏感词）；有接口描述时须分层覆盖。
   - **兼容与环境**：版本、平台、分辨率/折叠、显示与主题等，在 QA 档或文档有要求时做**矩阵抽样**。
   - **展示约束（重要）**：上述方法仅在生成时内化遵循；**summary、description、remarks 中一律不得**出现「等价类、边界值、判定表、状态转换」等设计方法术语，也不得用其作开头标签。用户只看业务表述。推断无文档依据时仍可在 remarks 写「文档未明确」类说明，但不要写设计方法名。`

const DEPTH_HINT = {
  dev: '详细程度：开发自测（标准）——覆盖正常路径及常见异常，关注接口与逻辑。',
  planning: '详细程度：策划验收（轻量）——仅覆盖核心业务流程，验证业务闭环。',
  qa: '详细程度：QA 测试（超详细）——尽量全量：边界、校验、异常、安全、性能相关（文档有依据时），以及数据一致性关注点。',
}

/**
 * 与前端 depth 对齐：策划轻量 / 开发标准 / QA 全量
 * @param {string} [depth]
 * @returns {{ key: 'planning'|'dev'|'qa'; label: string; minCases: number; stretchMax: number; nonMainMinPct: number; perStepHint: string; typeDistHint: string; codePerClassHint: string }}
 * minCases / stretchMax：写入提示词，引导模型产出规模与覆盖，不作为前端「达标判分」。
 */
export function getDepthGenerationSpec(depth) {
  const key = depth === 'planning' ? 'planning' : depth === 'qa' ? 'qa' : 'dev'
  if (key === 'planning') {
    return {
      key,
      label: '策划验收（轻量）',
      minCases: 12,
      stretchMax: 28,
      nonMainMinPct: 25,
      perStepHint: '每个主要需求步骤约 1～2 条（主路径 + 少量异常/回退）',
      typeDistHint: '以主流程闭环为主；异常、边界、专项合计约 25%～40%，勿硬凑无关用例。',
      codePerClassHint: '仅当存在项目源码时：每个与需求相关的核心类约 2～5 条，勿为凑数引入需求未提及的类。',
    }
  }
  if (key === 'dev') {
    return {
      key,
      label: '开发自测（标准）',
      minCases: 22,
      stretchMax: 48,
      nonMainMinPct: 35,
      perStepHint: '每个主要需求步骤约 2～3 条（正常 + 常见异常/边界）',
      typeDistHint: '功能主路径约 40%～55%；异常/边界/资源与 UI 专项合计约 35%～50%。',
      codePerClassHint: '仅当存在项目源码时：每个与需求相关的核心类约 4～10 条。',
    }
  }
  return {
    key,
    label: 'QA 测试（超详细）',
    minCases: 36,
    stretchMax: 90,
    nonMainMinPct: 45,
    perStepHint: '每个主要需求步骤约 3～5 条（正常 + 异常 + 边界 + 专项）',
    typeDistHint: '功能主路径约 30%～42%；异常/边界/文案与媒体/兼容与中断恢复等专项合计约 45%～58%。',
    codePerClassHint: '仅当存在项目源码时：每个与需求相关的核心类约 8～15 条。',
  }
}

export function getEffectiveGenerationSpec(depth, caseTarget) {
  const base = getDepthGenerationSpec(depth)
  const requestedMin = Number(caseTarget?.min)
  const requestedMax = Number(caseTarget?.max)
  if (!Number.isFinite(requestedMin) || requestedMin <= 0) return base

  const minCases = Math.max(1, Math.min(48, Math.floor(requestedMin)))
  const stretchMax = Math.max(
    minCases,
    Math.min(48, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : minCases * 2),
  )
  return {
    ...base,
    minCases,
    stretchMax,
    perStepHint: '本批只处理指定测试点；每个目标测试点生成 1～2 条有明确差异的可执行用例。',
    typeDistHint: '严格跟随目标测试点的 coverageType 与 designMethod，不额外扩展到本批之外。',
    codePerClassHint: '代码证据仅用于落实当前目标测试点，不按类额外扩充用例。',
  }
}

/** 用户消息中注入的「数量策略」块（增强版与普通版均可复用） */
export function formatDepthCountStrategyBlock(depth) {
  const s = getDepthGenerationSpec(depth)
  return `**详细程度与数量策略（须严格遵守）**
- 当前模式：${s.label}
- cases 最低条数：不少于 ${s.minCases} 条；需求步骤较多时建议扩充至约 ${s.minCases}～${s.stretchMax} 条（禁止为凑数输出无法在需求或项目源码中溯源的用例）。
- ${s.perStepHint}
- 非纯主流程用例（异常、边界、专项、资源与 UI 验证、兼容与中断恢复等，不含仅写 happy path 的功能用例）合计占比：不低于约 ${s.nonMainMinPct}%。
- 类型分布参考：${s.typeDistHint}
- 代码补充：${s.codePerClassHint}`
}

/** 增强生成末尾 JSON 约束（与 depth 一致） */
export function buildEnhancedJsonTail(depth, caseTarget) {
  const s = getEffectiveGenerationSpec(depth, caseTarget)
  return `\n\n请严格输出 JSON 对象，键为 "cases"，值为用例数组。cases 数组长度不少于 ${s.minCases} 条（需求复杂时建议 ${s.minCases}～${s.stretchMax} 条）；异常、边界、专项等非纯主流程用例合计不少于约 ${s.nonMainMinPct}%。不要输出其它文字。`
}

/** 与前端 DOCUMENT_ROLE_OPTIONS 语义一致（U-06） */
export const DOC_ROLE_LINE = {
  primary: '主需求/主文档（用例设计的主要依据）',
  attachment: '附件/补充说明（辅助理解主需求）',
  related_spec: '关联需求（与主需求交叉验证）',
  case_ref: '参考用例/历史用例（可作覆盖参考，勿机械照搬）',
  version_old: '多版本-旧版/基线（用于对比与回归）',
  version_new: '多版本-新版/当前（与旧版差异为重点）',
}

export function buildUserContent({
  documents,
  focusText,
  selectedTypes,
  depth,
  timezone,
  maxTotalChars,
}) {
  const depthKey = depth === 'planning' ? 'planning' : depth === 'qa' ? 'qa' : 'dev'
  const parts = []
  parts.push(`时区约定：${timezone || 'Asia/Shanghai'}（GMT+8）`)
  parts.push(DEPTH_HINT[depthKey])
  parts.push(formatDepthCountStrategyBlock(depth))
  parts.push(`需要覆盖的测试类型（请优先从这些类型中选取 caseType，可多条）：${selectedTypes.join('、')}`)
  if (focusText?.trim()) {
    parts.push(`用户指定的关注重点：\n${focusText.trim()}`)
  }
  parts.push('')
  parts.push(
    '「多文档约定」下列材料自上而下为阅读顺序；每段前的【文档角色】仅说明材料用途，请综合理解；主需求与多版本对比类文档需优先对齐。',
  )
  parts.push('--- 文档材料（按文件分块，可能已截断）---')
  let budget = maxTotalChars
  for (const doc of documents) {
    const roleKey = doc.role && DOC_ROLE_LINE[doc.role] ? doc.role : null
    const roleLine = roleKey ? `【文档角色】${DOC_ROLE_LINE[roleKey]}\n` : ''
    const header = `\n## 文件：${doc.name}\n${roleLine}`
    const room = budget - header.length
    if (room <= 0) break
    const body = (doc.text || '').slice(0, room)
    parts.push(header + body)
    budget -= header.length + body.length
  }
  parts.push('')
  parts.push(
    '⚠️ **覆盖要求**：逐段阅读以上材料，按「详细程度与数量策略」覆盖每个步骤/功能点/交互/条件分支。凡需求原文中出现的**可区分实体的具体标识**（编号、唯一键、资源路径、文件名、界面文案原文等），在相关用例的 steps 或 expected 中须与需求**一致写出**；需求未给出的标识**禁止编造**。若需求中出现独立的**界面文案、音效/语音/其它媒体资源名**（以文档中的原始写法为准），须分别设计可验证用例；若全文**未出现**任何媒体类资源，则**不要**生成音频/语音类杜撰用例。summary 须一句说清验证点。',
  )
  parts.push('')
  parts.push(
    '请根据以上材料输出 JSON：{"cases":[...]}。cases 数组中每个元素即一条用例，字段见系统说明。',
  )
  const main = parts.join('\n')
  const appendix = buildPromptLearningAppendix()
  return appendix ? `${main}\n\n${appendix}` : main
}

import type { TestDepth } from '../types'

/** 与 `server/prompt.js` 保持一致，便于 Cursor / 本地 API 共用规则 */
export const GENERATION_SYSTEM_PROMPT = `你是一个顶级的测试架构师，拥有扎实的编程能力与资深测试经验。
你的任务是根据用户提供的文档材料与生成配置，输出**结构化测试用例**，用于中文测试团队。

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

const DEPTH_HINT: Record<'dev' | 'planning' | 'qa', string> = {
  dev: '详细程度：开发自测（标准）——覆盖正常路径及常见异常，关注接口与逻辑。',
  planning: '详细程度：策划验收（轻量）——仅覆盖核心业务流程，验证业务闭环。',
  qa: '详细程度：QA 测试（超详细）——尽量全量：边界、校验、异常、安全、性能相关（文档有依据时），以及数据一致性关注点。',
}

/** 与 server/prompt.js DOC_ROLE_LINE 保持一致（U-06） */
const DOC_ROLE_LINE: Record<string, string> = {
  primary: '主需求/主文档（用例设计的主要依据）',
  attachment: '附件/补充说明（辅助理解主需求）',
  related_spec: '关联需求（与主需求交叉验证）',
  case_ref: '参考用例/历史用例（可作覆盖参考，勿机械照搬）',
  version_old: '多版本-旧版/基线（用于对比与回归）',
  version_new: '多版本-新版/当前（与旧版差异为重点）',
}

export function buildGenerationUserContent(params: {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: TestDepth
  timezone: string
  maxTotalChars: number
}): string {
  const depthKey = params.depth === 'planning' ? 'planning' : params.depth === 'qa' ? 'qa' : 'dev'
  const parts: string[] = []
  parts.push(`时区约定：${params.timezone || 'Asia/Shanghai'}（GMT+8）`)
  parts.push(DEPTH_HINT[depthKey])
  parts.push(
    `需要覆盖的测试类型（请优先从这些类型中选取 caseType，可多条）：${params.selectedTypes.join('、')}`,
  )
  if (params.focusText.trim()) {
    parts.push(`用户指定的关注重点：\n${params.focusText.trim()}`)
  }
  parts.push('')
  parts.push(
    '「多文档约定」下列材料自上而下为阅读顺序；每段前的【文档角色】仅说明材料用途，请综合理解；主需求与多版本对比类文档需优先对齐。',
  )
  parts.push('--- 文档材料（按文件分块，可能已截断）---')
  let budget = params.maxTotalChars
  for (const doc of params.documents) {
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
    '请根据以上材料输出 JSON：{"cases":[...]}。cases 数组中每个元素即一条用例，字段见系统说明。',
  )
  return parts.join('\n')
}

/** 复制到 Cursor 单条消息即可（先系统要求再用户材料） */
export function buildCursorClipboardMarkdown(params: {
  documents: { name: string; text: string; role?: string }[]
  focusText: string
  selectedTypes: string[]
  depth: TestDepth
  timezone: string
  maxTotalChars?: number
}): string {
  const user = buildGenerationUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  return [
    '【以下整段粘贴到 Cursor 对话中，让 AI 只输出 JSON，不要其它说明】',
    '',
    '### 系统角色与输出格式要求',
    GENERATION_SYSTEM_PROMPT,
    '',
    '### 用户任务与文档',
    user,
  ].join('\n')
}

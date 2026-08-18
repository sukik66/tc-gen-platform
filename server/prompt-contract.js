/** 质量契约（用户层草稿）提取 — 与测试用例生成分离，避免互相污染提示词
 * 理念对齐：知识库《AI 驱动的下一代测试平台》（MeYoung / TesterHome #43886）—
 * 「用户层」= 业务规则 + 推荐验证方式 + 边界提示；执行层（具体文件/接口/页面/数据）由运行时引擎补全，不在本输出中编造。
 *
 * 版本演进（2026-04-29 / QC-15 · 两层架构回归）：
 *   - V2（默认 · 当前激活）：4 字段用户层（rule / verifyMethods / verifyRationale / boundaryHint）+ layer 元数据。
 *     QC-12 期间引入的执行层骨架（given / when / then_must / then_must_not / measurable）被回滚——
 *     这些是 Skill 自推断的执行层细节，不应让 QA 在用户层填写。layer 保留为库内元数据，但不上 prompt 渲染、不上前端展示。
 *     LLM 摆烂防御保留：4 类 boundaryHint 正例 + 模糊词黑名单 + Few-shot 好例。
 *   - V1（保留）：作为热切回路径；当上游切换 prompt 失败时改用 V1 即可，无需改 server/llm/* 调用代码。
 *
 * 调用约定：server/llm/openai-contracts.js / gemini-contracts.js 仅 import 默认名
 *   CONTRACT_SYSTEM_PROMPT / buildContractUserContent → 始终指向当前激活版本（V2）。
 */
import { DOC_ROLE_LINE } from './prompt.js'

// ============================================================================
// V1 系统提示词（保留作回滚路径，未启用时仍可被 V1 后缀显式 import）
// ============================================================================
export const CONTRACT_SYSTEM_PROMPT_V1 = `你是一个资深测试架构师，擅长从需求文档中提炼**质量契约（用户层）**：业务规则与验证意图，而不是编写「绑定实现的操作步骤」式测试用例。

## 与原文一致的核心区分
- **测试用例**：描述「怎么一步步去验证」（点击、输入、断言某元素），强绑定实现与界面。
- **质量契约（用户层）**：描述「系统应该满足什么」；**verifyMethods** 只表达「宜用哪类手段验证」（读代码 / 调接口 / 操作 UI），**不写**具体文件路径、接口 URL、页面路由、元素选择器、逐步操作脚本——这些属于执行层，由后续引擎结合代码仓库补全。

## 每条契约的字段语义
- **moduleLabel**：模块或业务场景名，简短、可分类（如「订单 > 优惠券叠加」）。
- **rule**：用简体中文陈述句写清**可审计的业务规则**；避免模糊词；不要写操作步骤；除非需求原文明确要求，不要绑定具体页面文案。
- **boundaryHint**：与规则相关的**边界、精度、并发、权限、时间窗口**等风险与特例；无则写 ""。不要把「推荐理由」整段塞在这里——理由放在 verifyRationale。
- **priority**：只能是 "P0" | "P1" | "P2"。资金、安全、合规、不可逆操作为 P0；重要主流程为 P1；其余 P2。
- **verifyMethods**：字符串数组，每项必须是以下之一（可多选），表示**推荐验证手段**（与原文「读代码 / 接口调用 / UI 测试」一致）：
  - "code_review"：逻辑、顺序、阈值、幂等、权限分支等，**读代码即可高度确认**的。
  - "api_test"：数值/状态/集成/精度/压测指标等，**需实际调用接口或运行服务**才能确认的。
  - "ui_test"：**必须操作真实界面**才能确认的展示、动效、实时刷新、纯前端交互。
- **verifyRationale**：**必填**，字符串，建议 20～200 字。用**一条连贯说明**解释：为何本条契约选择上述 verifyMethods 组合（供 QA 审核「方案是否合理」）。遵守金字塔与成本意识：**能 code_review 说清的不要无谓堆 ui_test**；P0 涉及资金/安全时可组合多种方式；P2 可单一方式。禁止编造具体类名、文件路径、HTTP 路径；信息不足时可写「文档未明示实现位置，建议 QA 结合仓库确认验证手段」。

## 验证方式推荐（与原文决策表一致，按规则特征选）
- **纯逻辑 / 阈值 / 幂等 / 权限**：优先含 "code_review"；必要时加 "api_test" 做数据层确认。
- **金额、分摊、舍入、精度**：至少 "code_review" + "api_test"（走查逻辑 + 接口验边界）。
- **前后端展示一致、订单金额展示等**：可 "code_review" + "api_test" + "ui_test" 组合，但须在 verifyRationale 中说明为何需要 UI。
- **纯交互（选券后实时刷新、无需看接口即可定义的行为）**：以 "ui_test" 为主，可辅以 "code_review"。
- **性能指标（P99、吞吐等）**：以 "api_test" 为主（压测/实测），可辅以 "code_review" 查是否有计时与限流逻辑。

## 硬性输出要求
1. 只输出合法 JSON，不要 Markdown 代码围栏，不要 JSON 以外的文字。
2. JSON 顶层必须为对象，且包含键 "contracts"，值为数组。
3. 每个契约对象字段（全部必填）：
   - moduleLabel, rule, boundaryHint, priority, verifyMethods（数组至少一项合法枚举）, verifyRationale
4. 不要编造需求未出现的业务实体、接口路径、金额与字段名；不确定的规则不要写进 rule，可写入 boundaryHint 并标「待确认」。
5. 语言：全部为简体中文。`

// ============================================================================
// V2 系统提示词（QC-15，默认激活 · 两层架构回归）
// ============================================================================
export const CONTRACT_SYSTEM_PROMPT_V2 = `你是一个资深测试架构师，擅长从需求文档中提炼**质量契约（用户层）**：业务规则 + 推荐验证方式 + 边界提示，而不是编写「绑定实现的操作步骤」式测试用例。

## 与原文一致的核心区分（两层架构）
- **测试用例**：描述「怎么一步步去验证」（点击、输入、断言某元素），强绑定实现与界面。
- **质量契约（用户层）**：描述「系统应该满足什么」；用户层只填**业务规则 + 推荐验证手段 + 边界提示**。
- **执行层细节由 Skill 自推断**：具体文件路径、接口 URL、页面路由、元素选择器、逐步操作脚本、不变量分解、反例命题、可测量量表达式——这些**属于执行层**，由后续引擎结合代码仓库自动推断与补全，**不要在本次输出中编造**。
- **verifyMethods** 只表达「宜用哪类手段验证」（读代码 / 调接口 / 操作 UI），不写实施细节。
- **不是按句号复述需求文档**：每条契约都应是跨场景的不变量，而不是把需求段落分行重写。

## 字段语义

每条契约对象必须同时含以下 7 个字段：

- **moduleLabel**：模块或业务场景名，简短、可分类（如「订单 > 优惠券叠加」）。
- **rule**：用简体中文陈述句写清**可审计的业务规则**（一句话，跨场景的不变量）；避免模糊词；不要写操作步骤；除非需求原文明确要求，不要绑定具体页面文案。
- **boundaryHint**：**可选**字段（无明显边界时**写空字符串 ""**），用于点出与规则相关的**边界、精度、并发、权限、时间窗口、状态切换临界**等风险与特例。详细规范见下方「boundaryHint 撰写指引」。
- **priority**：只能是 "P0" | "P1" | "P2"。资金、安全、合规、不可逆操作为 P0；重要主流程为 P1；其余 P2。
- **verifyMethods**：字符串数组，每项必须是以下之一（可多选）：
  - "code_review"：逻辑、顺序、阈值、幂等、权限分支等，**读代码即可高度确认**的。
  - "api_test"：数值/状态/集成/精度/压测指标等，**需实际调用接口或运行服务**才能确认的。
  - "ui_test"：**必须操作真实界面**才能确认的展示、动效、实时刷新、纯前端交互。
- **verifyRationale**：**必填**字符串，建议 20～200 字。用**一条连贯说明**解释：为何本条契约选择上述 verifyMethods 组合（供 QA 审核「方案是否合理」）。遵守金字塔与成本意识：能 code_review 说清的不要无谓堆 ui_test；P0 涉及资金/安全时可组合多种方式；P2 可单一方式。禁止编造具体类名、文件路径、HTTP 路径；信息不足时可写「文档未明示实现位置，建议 QA 结合仓库确认验证手段」。
- **layer**：三选一枚举，必填，作为契约层级元数据：
  - "data"：数据层规则（持久化、ID 唯一性、外键、幂等键、并发写、事务边界）。
  - "business"：业务层规则（金额计算、状态机迁移、权限判定、业务逻辑校验）。
  - "ux"：用户交互层规则（界面提示、动效、流程引导、可访问性、纯前端交互）。

## 验证方式推荐（按规则特征选）
- **纯逻辑 / 阈值 / 幂等 / 权限**：优先含 "code_review"；必要时加 "api_test" 做数据层确认。
- **金额、分摊、舍入、精度**：至少 "code_review" + "api_test"（走查逻辑 + 接口验边界）。
- **前后端展示一致、订单金额展示等**：可 "code_review" + "api_test" + "ui_test" 组合，但须在 verifyRationale 中说明为何需要 UI。
- **纯交互（选券后实时刷新、无需看接口即可定义的行为）**：以 "ui_test" 为主，可辅以 "code_review"。
- **性能指标（P99、吞吐等）**：以 "api_test" 为主（压测/实测），可辅以 "code_review" 查是否有计时与限流逻辑。

## boundaryHint 撰写指引（重点防 LLM 摆烂）

### 4 类典型边界正例（看到规则属于这 4 类就在 boundaryHint 写明，否则可留空）

1. **数值边界**（金额、百分比、阈值、精度）——例：
   - "金额最终 ≥ 0 且小数位 ≤ 2，中间舍入只在最终步骤合并"
   - "折扣率 ∈ [0, 1]，超出时按 0 或 1 截断"

2. **集合大小边界**（数量、条数、批次）——例：
   - "购物车单笔最多 50 件商品；超过则按 50 件截断并提示"
   - "优惠券一次只能选 1 张，UI 列表最多展示 20 条"

3. **时序边界**（窗口、超时、并发）——例：
   - "30 秒内同一订单号的重复 POST 必须按幂等返回首次响应"
   - "请求超时 ≥ 5s 自动重试 1 次，重试间窗口固定 1s"

4. **状态切换临界点**（开关、disabled→enabled、状态机切换瞬间）——例：
   - "角色血量从 1 降到 0 的瞬间触发死亡动画且不可撤销"
   - "支付按钮在订单状态从 pending 转为 paid 时由 enabled 变 disabled"

### 反面引导（哪些不该塞进 boundaryHint）
- 强引导/独占交互类描述（如「强引导期间其他按钮不可交互」「弹窗必须挡住底层菜单」）应写在 **rule** 主句中作为不变量，而不是塞进 boundaryHint——boundaryHint 只描述"边界与例外"，不复述主行为。
- 不要把 verifyRationale 整段塞在 boundaryHint 里——理由放在 verifyRationale。
- 不要在 boundaryHint 中编造文件路径、接口 URL、字段名。

### 留空许可（重要）
- 多数纯交互/UX 类规则确实没有数值/集合/时序/状态临界——此时**写空字符串 ""**，比强行编造一个似是而非的边界更好。
- 留空不会被扣分；编造会被审核打回。

## 模糊词黑名单（必须规避）

下列词汇会让规则不可审计，**禁止直接出现在 rule / verifyRationale / boundaryHint 中**：
明显、合理、足够快、防止、应当、适当、可能、一般、通常、基本

替代写法示例：
- ❌ "金额计算应当合理"  ✅ "中间结果每步四舍五入到分，最终金额非负"
- ❌ "提示足够快消失"  ✅ "用户滑动屏幕后 ≤ 200ms 内提示消失"
- ❌ "防止重复提交"  ✅ "同一订单号 30 秒内的第二次 POST 必须返回与第一次相同的响应"

## Few-shot 好例（请按此密度写）

\`\`\`json
{
  "moduleLabel": "新手引导 > 进入战斗",
  "rule": "首次进入游戏的玩家在关卡选择界面中第一关被默认选中且为唯一可点击关卡，点击「开始战斗」直接进入第一关战斗场景",
  "boundaryHint": "玩家此前未通关任何关卡时，第二关及之后关卡按钮处于 disabled；玩家曾通关后再次走新手引导仍默认聚焦第一关",
  "priority": "P0",
  "verifyMethods": ["code_review", "ui_test"],
  "verifyRationale": "默认选中态与按钮 disabled 由代码逻辑决定（code_review 可定位状态机分支），视觉反馈与点击导航需操作真实界面确认（ui_test 兜底）。组合可平衡成本与覆盖度。",
  "layer": "ux"
}
\`\`\`

**为什么是好例**：rule 是跨场景不变量（写明对象、状态、动作三要素）；boundaryHint 落在「状态切换临界点」类（disabled / 二次进入），与主规则互补不重复；verifyRationale 给出选 code_review + ui_test 的成本权衡说明；规避全部模糊词；layer 标为 "ux" 反映规则属于交互层。

## 硬性输出要求
1. 只输出合法 JSON，不要 Markdown 代码围栏，不要 JSON 以外的文字。
2. JSON 顶层必须为对象，且包含键 "contracts"，值为数组。
3. 每个契约对象**必填字段（共 7 个）**：moduleLabel, rule, boundaryHint, priority, verifyMethods（数组至少一项合法枚举）, verifyRationale, layer。
4. **禁止输出**任何执行层骨架字段（不变量分解、反向断言、可测量量表达式等）——这些由 Skill 自推断，不在用户层暴露。
5. boundaryHint 可写空字符串 ""，但其他 6 个字段必须非空。
6. 不要编造需求未出现的业务实体、接口路径、金额与字段名；不确定的规则不要写进 rule，可写入 boundaryHint 并标「待确认」。
7. 语言：全部为简体中文。
8. **模糊词黑名单铁律**：明显/合理/足够快/防止/应当/适当/可能/一般/通常/基本 不得出现在任何字段值中。`

// ============================================================================
// 默认导出：当前激活版本（V2）
// 兼容性：server/llm/openai-contracts.js / gemini-contracts.js 仅 import 默认名，
// 无需改动即可生效。需要回滚时把下行右值改回 CONTRACT_SYSTEM_PROMPT_V1 即可。
// ============================================================================
export const CONTRACT_SYSTEM_PROMPT = CONTRACT_SYSTEM_PROMPT_V2

// ============================================================================
// CONTRACT_DEPTH 默认条数下限砸半（QC-12 · 12.3 / 老板 Q2 决议）
// 信息密度上去后条数自然砸半，是 prompt v2 的内在属性
// 旧值：planning 6-14 / dev 12-28 / qa 20-48
// 新值：planning 3-14 / dev 6-28 / qa 10-48（max 不变，min 砸半）
// ============================================================================
const CONTRACT_DEPTH = {
  planning: { label: '策划轻量', min: 3, max: 14, hint: '只提炼核心闭环与高风险规则；信息密度优先于条数。' },
  dev: { label: '开发标准', min: 6, max: 28, hint: '覆盖主流程及常见异常对应的规则；信息密度优先于条数。' },
  qa: { label: 'QA 全量', min: 10, max: 48, hint: '在文档有依据时尽量覆盖边界、组合、一致性、权限与安全相关规则。' },
}

// ============================================================================
// V1 用户内容构造（保留作回滚路径）
// ============================================================================
/**
 * @param {{ documents: {name:string,text:string,role?:string}[], focusText?: string, depth?: string, timezone?: string, maxTotalChars?: number }} p
 */
export function buildContractUserContentV1(p) {
  const depthKey = p.depth === 'planning' ? 'planning' : p.depth === 'qa' ? 'qa' : 'dev'
  const spec = CONTRACT_DEPTH[depthKey]
  const maxTotalChars = p.maxTotalChars ?? 120_000
  const parts = []
  parts.push(`时区约定：${p.timezone || 'Asia/Shanghai'}（GMT+8）`)
  parts.push(`详细程度：${spec.label} — ${spec.hint}`)
  parts.push(
    `契约条数：请输出不少于 ${spec.min} 条、一般不超过 ${spec.max} 条「contracts」；若文档极短可少于 ${spec.min}，须在 boundaryHint 或 verifyRationale 中说明「文档信息不足」。`,
  )
  if (p.focusText?.trim()) {
    parts.push(`用户指定的关注重点：\n${p.focusText.trim()}`)
  }
  parts.push('')
  parts.push('「多文档约定」下列材料自上而下为阅读顺序；每段前的【文档角色】仅说明材料用途。')
  parts.push('--- 文档材料（按文件分块，可能已截断）---')
  let budget = maxTotalChars
  for (const doc of p.documents) {
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
    '请根据以上材料输出 JSON：{"contracts":[...]}。每个元素须含 verifyRationale 字段。contracts 数组中每个元素为一条质量契约，字段见系统说明。',
  )
  return parts.join('\n')
}

// ============================================================================
// V2 用户内容构造（默认 · QC-15 两层架构回归）
// 与 V1 的差异：尾部输出指令明确 7 字段必填（含 layer 元数据），boundaryHint 可写 ""
// ============================================================================
/**
 * @param {{ documents: {name:string,text:string,role?:string}[], focusText?: string, depth?: string, timezone?: string, maxTotalChars?: number }} p
 */
export function buildContractUserContent(p) {
  const depthKey = p.depth === 'planning' ? 'planning' : p.depth === 'qa' ? 'qa' : 'dev'
  const spec = CONTRACT_DEPTH[depthKey]
  const maxTotalChars = p.maxTotalChars ?? 120_000
  const parts = []
  parts.push(`时区约定：${p.timezone || 'Asia/Shanghai'}（GMT+8）`)
  parts.push(`详细程度：${spec.label} — ${spec.hint}`)
  parts.push(
    `契约条数：请输出不少于 ${spec.min} 条、一般不超过 ${spec.max} 条「contracts」；若文档极短可少于 ${spec.min}，须在 boundaryHint 或 verifyRationale 中说明「文档信息不足」。信息密度优先：宁少勿多，避免把需求段落分行复述。`,
  )
  if (p.focusText?.trim()) {
    parts.push(`用户指定的关注重点：\n${p.focusText.trim()}`)
  }
  parts.push('')
  parts.push('「多文档约定」下列材料自上而下为阅读顺序；每段前的【文档角色】仅说明材料用途。')
  parts.push('--- 文档材料（按文件分块，可能已截断）---')
  let budget = maxTotalChars
  for (const doc of p.documents) {
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
    '请根据以上材料输出 JSON：{"contracts":[...]}。每条契约必填字段：moduleLabel, rule, boundaryHint（可写空字符串 ""）, priority, verifyMethods, verifyRationale, layer。',
  )
  return parts.join('\n')
}

# AI 测试平台 · 会话与决策上下文

> **维护方式**：与老板对话中产生的产品决策、架构调整、范围裁剪，由助手**摘要写入本文**「变更纪要」；详细条目仍以 **[TASKS.md](./TASKS.md)** 为唯一权威任务源。  
> **回复习惯**（老板要求）：助手在涉及本项目的回复**末尾**附上 **推进任务清单**（从 `TASKS.md` 提炼，见 `.cursor/rules/ai-test-platform.mdc`）。

---

## 1. 项目定位

- **持续集成的 AI 原生测试平台**，纯中文，默认时区 **GMT+8**（`Asia/Shanghai`）。
- **第一期**：先把 **测试用例自动生成** 做稳；全链路「智能测试」自动化建设周期长，**其余模块先占位、暂停推进**。

---

## 2. 信息架构（当前）


| 路径                                                               | 模块     | 说明                                    |
| ---------------------------------------------------------------- | ------ | ------------------------------------- |
| `/`                                                              | 功能目录   | 功能卡片入口（见 `featureCatalog.ts`） |
| `/generation`                                                    | 测试用例生成 | **首期主战场**；未来「智能测试」**复用**本模块（组件或包拆分）   |
| `/contracts`                                                     | 质量契约（草稿） | 规则 + 验证方式 + 可选代码关联；**服务端 `data/quality-contracts.json`**，与用例生成数据隔离 |
| `/smart-test`、`/records`、`/reports`                              | 预留     | 暂停说明页，文案来自 `featureCatalog.ts` |
| `/knowledge`、`/case-library`                                     | 知识库 / 用例库 | 已实现独立页面（与 TASKS §0 历史「占位」表述不一致时以 TASKS B.8 / B.6 为准） |


---

## 3. 关键产品决策（来自对话）

1. **功能目录页**：与单功能页分离，避免自动化全链路未完成时阻塞用例生成入口。
2. **独立「测试用例生成」页**：**不展示**左侧 10 步「执行流水线」时间线；该 UI **仅计划在「智能测试」** 中实现。`PIPELINE_STEPS` 仍保留在 `constants.ts` 供后续复用。
3. **生成演示**：去掉逐步流水线动画后，点击「开始生成用例」为约 **1.6s** 占位逻辑，再追加一条演示用例（真实模型与解析未接）。
4. **本地启动**：`cd ai-test-platform` → `npm install`（首次）→ `npm run dev`；端口以终端为准（5173 被占用时会递增）。
5. **收尾预览**：改代码后助手应后台起 `npm run dev` 并告知 URL（见项目 Cursor 规则）。
6. **2026-04-03 新增**：维护本文作为上下文；**每轮相关回复末尾输出任务清单**便于老板点下一步。
7. **用例展示交互**：卡片**单击**展开/收起详情；**双击**进入**内联编辑**（非弹窗），双击落在带 `data-edit-field` 的区域时聚焦对应字段并尽量用 `caretRangeFromPoint` 还原光标；保留「✎ 编辑此用例」入口。表格**双击行**在内联展开表单；**新增用例**仍为弹窗。
8. **大模型**：不在浏览器直连密钥；经 **Node `server/`** 调用 OpenAI 兼容接口或 Gemini；前端 `fetch('/api/generate-test-cases')`，开发态 Vite 代理到 `8787`。
9. **不配 API 密钥时**：浏览器**无法**调用 Cursor 内置模型；采用侧栏 **「Cursor 辅助」**：复制与 `server/prompt.js` 对齐的提示词到 Cursor 聊天，将模型返回的 JSON 贴回页面解析追加。`/api/health` 在无密钥时返回 `ok: false`，禁用「API 生成」按钮以免误点。
10. **多厂商模型**：除 Gemini 走 Google SDK 外，其余国产与 OpenAI 均经 **OpenAI 兼容 Chat Completions** 接入，路由与默认 Base URL 见 `server/llm/providers.js` 与 `README.md` 配置表。
11. **页面切换通道**：`GET /api/llm-providers` 返回各通道是否已在 `.env` 就绪；`POST /api/generate-test-cases` 可带 `llmProvider` 覆盖单次请求；前端侧栏下拉 + `localStorage`（键 `ai-test-platform.llmProvider`）。
12. **演进路线与 CI 约束（详本见 §8）**：终局为 **CI 自动跑**；允许 **Web 多人点测** 作中间垫脚石，但必须 **CI 友好**、控制 Web 期范围、设 **退出条件**；大模型调用须符合 **§8.5 密钥策略**。推进智能测试 / 执行引擎 / CI 集成时，助手须对照 §8 检视，**有违反须向老板明确质疑**（见 §8.6）。
13. **用例设计方法论**：SuperAI 仓库根下 `**knowledge/参考/测试用例设计方法论.md`**
14. **多Agent用例评审**：三个独立Agent（QA看方法论清单、策划看需求文档、程序看代码上下文）并行评审。用户手动触发（按钮），评审结果不自动仲裁，全部展示给用户判断。每条用例旁三枚独立小徽标。修改需用户勾选确认后应用。代码上下文：Plastic SCM 通过本地路径 `fs.readdir/readFile` 读取（平台为本地运行工具，Express与用户同机）；GitLab 后端仓库后续接入。分三 Phase 实施：Phase 1 评审核心（已实现）→ Phase 2 代码上下文 → Phase 3 修改应用。（相对本目录为 `../knowledge/参考/…`；已写入知识库 `knowledge/data/kb.db`，条目 id 可查库）；含 ISTQB 类黑盒方法与记忆库兼容/弱网/协议维度映射；`server/prompt.js` 与 `src/lib/generationPrompt.ts` 已嵌入摘要规则。改提示词或评审生成质量时须与该文档对齐。
15. **契约库（已定案，实现待排期）**：与用例库 **共用 `projectId` + `moduleId`（本期即携带 moduleId，与用例库模块树 id 对齐）**；契约与用例 **分文件/API 管理**，独立「契约库」列表与编辑流。每条契约 **`status`**：`draft` | `active`；**`draft→active`** 按助手与老板对齐的默认：**编辑保存时可选勾选「标记为 active」或列表单项「启用」**（实现 fork 二选一或并存均可）。**`codeContext`** 仍仅存「取证范围」配置 JSON（`mode` + `repos` 检索参数），**不含**源码/diff 正文快照。AI 提取 **预览不落库，点确认写入才落服务端**。旧浏览器 IndexedDB 契约数据：**首次进入契约相关页时提示并一键迁移**到服务端，以规避丢失。**入口**：**功能目录（`featureCatalog`）** 与 **`/contracts` 质量契约页** 均须提供进入契约库的链接；具体路由实现后回写 §2 表。

---

## 4. 技术栈与目录提示

- **前端**：Vite + React + TypeScript + Tailwind v4；路由 `react-router-dom`。  
- **核心文件**：`src/App.tsx`（路由）、`src/pages/HomePage.tsx`、`src/pages/TestCaseGenerationPage.tsx`、`src/pages/ReservedFeaturePage.tsx`、`src/featureCatalog.ts`。  
- **任务与上下文**：`TASKS.md`（全量清单）、`CONTEXT.md`（本文）、`README.md`（快速开始）。

---

## 5. 变更纪要


| 日期         | 摘要                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-03 | 初建平台骨架、TASKS；功能目录 + `/generation` 独立；去掉用例生成页左侧流水线侧栏；补充启动说明。                                                                                                  |
| 2026-04-03 | 新增 `CONTEXT.md`；约定回复末尾附推进任务清单（见 Cursor 规则）。                                                                                                                  |
| 2026-04-03 | §7：如何核对上下文是否漏记（方法论 + 覆盖核对表）；§7.4 与 TASKS 分工及概括项声明。                                                                                                           |
| 2026-04-03 | 用例生成页：上传支持拖拽；浏览器端抽取 PDF/docx/xlsx/文本；图片无 OCR；生成前需至少一份解析成功。                                                                                                   |
| 2026-04-07 | 卡片单击展开/收起；双击内联编辑与光标定位；表格行内联编辑；`CaseDraftForm` 组件抽取。                                                                                                          |
| 2026-04-07 | 大模型：`server/index.js` + `LLM_PROVIDER`（openai/gemini）；`POST /api/generate-test-cases`；`npm run dev` 双进程；密钥仅放 `.env`。                                         |
| 2026-04-07 | 新增 **§8**「演进路线与平台约束」：**CI 终局**、**Web 多人点测** 作中间形态、**CI 友好** / **Web 期范围** / **退出条件**、**密钥与 Coding Plan**；**§7.5** 与 §7.3 表新增维度；**§3-12**；**§8.6** 约定助手违反须质疑。 |
| 2026-04-03 | Cursor 辅助生成路径：`CursorAssistPanel`、`generationPrompt.ts`、`normalizeCasesFromJson.ts`；health 检测密钥以区分 API 生成是否可用。                                               |
| 2026-04-07 | 用例设计方法论：`knowledge/参考/测试用例设计方法论.md` 入库（`kb.db`）；`server/prompt.js` / `generationPrompt.ts` 与 `.cursor/rules/ai-test-platform.mdc` 对齐。                        |
| 2026-04-10 | ~~F-01 用例评审 Phase 1~~（已撤销，见 2026-04-14） |
| 2026-04-14 | **F-01 评审功能已移除**：不再提供多 Agent 评审面板、Fix Agent、相关 API 与 `server/review`；用例生成仍以「文档 + 模型生成 + Cursor 辅助」为主；覆盖导向的质量方案后续单独立项。 |
| 2026-04-15 | 新增 **`/contracts` 质量契约（草稿）**：独立路由与首页卡片；表单 + 复用 `CodeChangePanel`；契约草稿已改为 **服务端 JSON** 持久化；**不修改**用例生成页逻辑与 API。 |
| 2026-04-15 | 契约页增加 **上传需求 → `POST /api/generate-contracts` AI 提取**（独立 `prompt-contract.js`），预览后可批量入库；与用例生成接口分流。 |
| 2026-04-15 | 契约页 **`POST /api/contract-code-review`**：规则（或需求摘录）+ `CodeChangePanel` 收集代码 → LLM 举证式走查（pass/fail/uncertain）；TASKS 增 **§D** 其它验证 backlog。 |
| 2026-04-15 | `gatherCodeContext` 改为返回 `{ text, stats }`：对「清单有、正文无」的路径追加 **未纳入上下文** 说明；走查接口 `meta.codeContextStats`；增强生成/预览已改用 `.text`。 |
| 2026-04-15 | 契约 AI 提取：`prompt-contract.js` 与知识库《AI 驱动的下一代测试平台》（TesterHome #43886）对齐用户层定义；模型输出增加 **verifyRationale**（验证推荐理由），`TASKS` **QC-10**。 |
| 2026-04-15 | **知识库 + 契约草稿** 与用例库对齐：改为 `data/knowledge.json`、`data/quality-contracts.json` + REST API；旧浏览器 IndexedDB 数据不自动迁移（无数据期可忽略）。 |
| 2026-04-16 | **契约库定案**（见 §3-15）：`projectId`+`moduleId`、`status` draft/active、预览不落库、IDB **首次进入一键迁移**、**功能目录 + `/contracts` 双入口**；与用例库分库、项目对齐。 |
| 2026-04-22 | **CodeReviewSkill 架构升级（见 §9）**：走查从「一次性 gather → 一次 LLM」改为「Phase 1 目录推断 + Phase 2 agent 迭代读文件（tool calling）+ Phase 3 举证 + Phase 4 输出」；步骤④ CodeChangePanel 对 code_review 方法变为可选；知识库历史缺陷模式接入 Phase 3。 |
| 2026-04-29 | **QC-12 质量契约提取 prompt v2 升级**（绑定 QC-13a/13b 三任务组）：`server/prompt-contract.js` 新增 `CONTRACT_SYSTEM_PROMPT_V2`（layer / given / when / then_must / then_must_not / measurable 骨架 + 模糊词黑名单 + Few-shot 1 坏 1 好），V1 同名后缀保留作回滚路径；`server/normalize-contracts.js` 输出加 `version: 1\|2` 字段，v2 必填齐全且 then_must_not 缺失时填 `null`（区分「未知」与「已检查无反例 `[]`」）；`CONTRACT_DEPTH` 默认条数下限砸半（planning 6→3 / dev 12→6 / qa 20→10，老板 Q2 决议）；前端 `ContractCard.tsx` v1/v2 双分支渲染（v2 三色 layer 角标 + 红色反例徽章；v1 灰色「v1 契约」标签 + 引导文字），`QualityContractsPage` Step 3 aiPreview 同步 v2 字段。**老板 5 项决议穿透**：Q1 全端点 maxTokens=8192（QC-13a 落地）/Q2 条数下限砸半（本任务）/Q3 Gemini 通道半升级仅小字提示/Q4 AI 提案首发即开/Q5 Pass 2 同步路径锁定。**向后兼容铁律**：现存 27 条 v1 契约不重跑提取，normalize 后 version=1 渲染干净降级，无 v2 角标污染；后续 v1→v2 迁移走 QC-13f 后置批量重跑工具。看板 `TKT-20260429-002`。 |
| 2026-04-29 | **QC-13a code_review skill 改造主体**（绑定 QC-12/13b 三任务组，看板 `TKT-20260429-003`）：(A) `server/prompt-code-review.js` 重写 V2 system prompt（含**反例优先策略**：every then_must_not 主动 `grepRepo` 找反例存在证据 → 找到=violated/搜遍未发现=safe；searchedPaths 必填）+ `buildCodeReviewUserContent` v2 分节拼 prompt（given/when/then_must/then_must_not/measurable 各自分块）；v1 旧契约退化为旧字段语义。(B) `server/normalize-code-review.js` 升级判定矩阵 schema：`{version,overallVerdict,overallConfidence,thenMustResults[],thenMustNotResults[],measurableCheck,filesRead,toolCallsUsed,gaps}` + v1 兼容；前端 `QualityContractsPage` Step 5 拆分展示三块（独立卡片 / 色标 / searchedPaths 透明度）。(C) 反例优先策略系统级铁律：searchedPaths 必填、找反例 → violated。(D) **新增 `grepRepo` 工具**（dirHint 必填+落在 dirHints 子树校验、3s 超时、IGNORE_DIRS、500KB 上限、maxHits=20）+ CODE_REVIEW_TOOLS 注册第 4 工具；`MAX_TOOL_CALLS` 12→16。**Token 双档闸门**：dispatchToolCall 累计字符 ≥60K 注入软警告（让模型主动收尾），≥70K 强制 finalize（禁用 tools 跳出循环）+ 单契约硬闸门 then_must+then_must_not≤6（超过端点 400 拒绝）。**maxTokens 全端点强下限 8192**（OpenAI + Gemini 通道，Q1 决议）。**AI 自写规则提案 Pass 2**：fallback=true && 至少 1 条 violated 反例 → `runRuleProposalPass2` 独立 LLM 反推规则草稿（maxTokens 强下限 8192，dispatcher pass_2_token_budget_anchor）→ `jaccard≥0.6` 去重（与 unity-domain-rules.json + 历史 rule-proposals.json 比对，命中仅 append evidence 不新建）→ 写入 `data/rule-proposals.json` 且内联 `reviewResult.ruleProposalDraft` 给前端（Q5 同步路径）。**双层 UNITY_DOMAIN_MAP**：内置层（code-review-agent.js BUILTIN_UNITY_DOMAIN_MAP）+ 用户批准层（`data/unity-domain-rules.json`），`server/vcs/domainRules.js` 启动时合并加载 + approve 端点写文件后热加载（无需重启服务）。**REST API 3 端点**：`GET /api/rule-proposals[?status=]` / `POST /api/rule-proposals/:id/approve` / `POST /api/rule-proposals/:id/reject`。**Gemini 半升级（Q3 决议 GEMINI.1）**：消费 enrichedParams（与 OpenAI 同源，修复 PR-0 后「未配置仓库」退化）+ maxOutputTokens=8192；输出 schema 仍为 v1（前端 Gemini 通道选中时显示一行小字提示「Gemini 暂不支持反例判定矩阵」）。**Feature Flag**：`data/feature-flags.json` 含 `aiRuleProposalEnabled:true`（Q4 决议首发即开），重度回退路径见 7.2.d；`data/rule-proposals-stats.json` 周指标埋点（produced/deduped/approved/rejected/deferred）。**前端类型扩展**：`src/api/codeReview.ts` 增 thenMustResults/thenMustNotResults/measurableCheck/ruleProposalId/ruleProposalDraft + 强类型 CodeContextStats 导出。**顺手修 11 个预存 lint**：`QualityContractsPage` saveContractDraft 调用补 status/projectId/moduleId 默认值；codeContextStats 由 unknown 改为强类型。**新文件**：`server/vcs/rule-proposal-generator.js` / `server/vcs/domainRules.js` / `data/{rule-proposals,unity-domain-rules,feature-flags,rule-proposals-stats}.json`。**铁律保留**：Gemini tool calling 升级后置（QC-13e）；Pass 2 不走异步/SSE（Q5）；27 条 v1 契约走查行为不变。 |


---

## 6. 待老板拍板的开放项（可选）

- 后端选型（FastAPI / Node）与文档解析、模型 API 密钥管理（`.env`）。  
- 导出：Excel / XMind / Checklist 的库选择与文件格式细节。  
- 智能测试页何时启动、如何嵌套复用 `TestCaseGenerationPage` 或抽共享包。
- **质量契约**：草稿已与用例库同为服务端 JSON；是否与「用例生成结果」做引用关联（同一需求下双视图）。

---

## 7. 如何核对「上下文有没有漏记」（重要）

**结论先说**：单靠助手写摘要，**无法形式化证明**「对话里每一个关键点都已进文档」——摘要本质是取舍，可能漏。能做的是 **降低漏记概率 + 让你能快速发现遗漏**。

### 7.1 分工：什么以谁为准


| 文档                      | 角色                                        |
| ----------------------- | ----------------------------------------- |
| **TASKS.md**            | **功能与实现状态**的权威清单；漏任务优先在这里暴露。              |
| **CONTEXT.md**          | **为什么这么做、范围与决策**的叙事与纪要；与 TASKS 互补，不重复抄全表。 |
| **代码 + featureCatalog** | **真实行为**；与文档不一致时，以代码为准并回头改文档。             |


### 7.2 建议你用的核对方式（任选或组合）

1. **按下面「覆盖核对表」扫一眼**（§7.3）：每个维度在 CONTEXT / TASKS 里是否至少有一处对应描述。
2. **里程碑式口令**：例如每段对话结束说一句「把今天对话里还没写进 CONTEXT 的决策补进 §3 和变更纪要」，让助手显式 diff 一轮。
3. **对照聊天记录**：用 IDE / 搜索在 transcript 里搜关键词（如「不要」「只做」「预留」「路由」），看 CONTEXT §3 是否提到。
4. **双写敏感项**：凡是你口头强调的 **禁止/暂缓/唯一入口**，要求必须同时出现在 **CONTEXT §3** 和 **TASKS 备注或 §0**，减少只写一处被漏改的情况。

### 7.3 对话覆盖核对表（助手更新 CONTEXT 时应自检）

更新 `CONTEXT.md` 后，应对照本表在内心（或回复里）过一遍；**若有勾选「应记录」却文档无对应句，则补写**。


| 维度                           | 应是否进 CONTEXT / TASKS | 当前常见落点            |
| ---------------------------- | -------------------- | ----------------- |
| 产品范围（做 / 不做 / 暂停）            | 是                    | §1、§3、TASKS §0    |
| 路由与模块边界                      | 是                    | §2、TASKS §0       |
| 显式 UI 决策（出现 / 隐藏某块）          | 是                    | §3、TASKS A 节备注    |
| 工程约定（启动、预览、端口）               | 是                    | §3、README         |
| 与助手协作习惯（文末清单等）               | 是                    | § 顶部说明、Cursor 规则  |
| 未决 / 开放问题                    | 是                    | §6                |
| 演进路线 / CI / Web 中间形态 / 密钥与计费 | 是                    | §8、§7.5、§3 第 12 条 |
| 具体实现细节（某组件 props）            | 可选                   | 代码为准，CONTEXT 只写结论 |


### 7.4 本轮已知「曾详述但未逐字写入 CONTEXT」的内容

以下在对话或 TASKS 中有依据，**§3 已概括性覆盖**；若你需要「可审计级」逐条，可把该条从 TASKS 备注拉长或单独开 `decisions/YYYY-MM-DD.md`：

- 参考截图中的 **10 步流水线名称与顺序**（见 TASKS §A，不在 CONTEXT 逐条重复）。  
- **用例类型 10 项、详细程度 3 档、导出三种形态**等业务细则（见 TASKS §B、首期需求描述；CONTEXT 不重复列表）。  
- **Gemini 2.5 等**仅作历史参考，当前产品文案为「模型可配置」，未绑定具体厂商版本。

### 7.5 演进路线、密钥与中间形态

凡涉及 **智能测试、执行引擎、CI、多人 Web 跑用例、厂商套餐与密钥**，更新 CONTEXT 或评审方案时须对照 **§8**（与 §7.3 表中「演进路线 / CI / Web 中间形态 / 密钥与计费」行一致）。

---

## 8. 演进路线与平台约束（CI · Web 中间形态 · 密钥）

本节为 **硬约束**：后续任务设计与实现应遵守；**冲突时以本节与老板最新口头决策为准**，并回写 §3 / 变更纪要。

### 8.1 终局与中间形态


| 阶段          | 形态             | 说明                                                 |
| ----------- | -------------- | -------------------------------------------------- |
| **终局**      | **CI 自动跑**     | 门禁以流水线结果为准；支持 nightly / PR / main 等触发。             |
| **允许的中间形态** | **多人 Web 点着测** | 在 CI 未就绪前，用 Web 并行验证用例、报告、模型/网关对接；**不等于**长期唯一真相来源。 |


**结论**：短期做 Web 多人验证 **合理且推荐**，前提是 **与终局 CI 同一套可执行规格**（见 8.2），并设 **退出条件**（见 8.4）。

### 8.2 强制对齐：CI 友好

**原则**：页面上可以「点」，但 **判定对错** 必须与未来 CI 使用 **同一套** 可执行物与入口。

**应做到**

- **单一事实来源**：用例执行 = 仓库内可复现命令或脚本（如统一 CLI、`pnpm test:xxx`、`python -m …`）或「数据文件 + 唯一 `run` 入口」；Web 仅 **选套件 / 触发 / 展示**，底层调用同一入口。
- **本地 = Web = CI**：三者跑同一命令（仅环境变量如 `API_BASE`、`MODEL`、超时不同）；禁止「网页里一套逻辑、CI 里另一套」。
- **断言机器可读**：优先 JUnit XML、JSON 报告、约定 exit code；截图等可作为辅助，**不能**作为唯一通过依据。
- **环境显式化**：模型名、温度、超时、重试策略等用配置或 env 注入，且文档化，避免「仅某开发本机可跑通」。

**反例（视为违反，须质疑）**

- 仅在页面上人工勾选「通过」、无对应自动化步骤。
- 断言逻辑只存在于浏览器内嵌脚本，仓库内无法复现。
- 依赖未提交的 `.env` 或个人机器路径，CI 无法复现。

### 8.3 Web 期范围控制

**此阶段应优先**

- **冒烟**：鉴权、调用模型、解析响应、基础错误码与延迟。
- **核心回归**：少量高价值场景（如输出格式、工具调用、安全边界、固定 prompt 的 golden 行为等，按业务挑选 **约 5～15 条** 量级，可随项目调整）。
- **统一报告格式**：通过/失败、耗时、token 粗估、请求 id 等，便于日后 CI 用同一解析器。

**此阶段刻意不做满（除非合规强制）**

- 完整 RBAC、多租户、计费拆分。
- 复杂全局队列与配额治理（可用简单限流与排队提示代替）。
- 全量 flaky 自动化治理（可先记录失败原因与重试策略，CI 期再接）。

**原则**：允许「丑但真」—— **能跑同一套可执行规格、能出一致报告** 即可。

### 8.4 退出条件（避免 Web 长期成为唯一真相）

中间形态须 **有时间盒与里程碑**，示例（可组合，老板可改数值）：

- **时间**：Web 验证启动后 **例如 2 周内** 上线 **最小** CI job（至少 smoke）。
- **稳定性**：连续 **例如 10 次** 全绿，或 flaky 率低于约定阈值。
- **覆盖**：核心回归 **≥ 约定条数**，且全部由 **同一 CLI/入口** 驱动。
- **流程**：**main / 发布分支** 逐步以 **CI 结果** 为门禁；Web 保留为单条调试、模型对比、详 trace，**不**作为最终发布唯一依据。

**反例**：长期仅以「谁在网页上点过」为发布依据、无自动化门禁。

### 8.5 密钥与厂商套餐策略

**密钥**

- **禁止**向多人发放 **裸露** 的共享 Key（尤其写入前端、贴仓库、群发聊天）。
- **默认**：Key 仅在 **服务端**（或 CI 密钥库）持有；Web 与 CI 经后端或代理调用模型。
- **推荐**：**Web 与 CI 分 Key 或分环境**（如 `dev` / `ci`），泄露时可单独轮换。
- **极简内测例外**：仅可信极小团队、极短期可在服务端用一把 Key，须配 **预算告警、限流监控、轮换预案**，并标注为 **技术债**、有截止日期。

**Coding Plan 类编程订阅套餐**

- **不适用于** 测试平台 **CI 自动跑**、后端代跑、多用户自动化：**条款通常限制** 交互式编程工具场景，禁止自动化脚本/后端/批量非交互调用；用于 CI 有 **合规与封号** 风险。
- 平台应优先 **标准大模型推理 API / 按量后付 / 资源包** 等正式计费形态（具体以各厂商最新协议为准）。

### 8.6 助手义务：违反检测与质疑

凡用户请求、方案或实现涉及 `**ai-test-platform` 的智能测试、执行链路、CI、密钥、多人 Web 跑用例**，助手应：

1. **主动查阅** 本文 **§8**（及 §3 第 12 条摘要）。
2. **对照检视**：若方案出现 8.2～8.5 中的 **反例** 或与之等价的结构（例如「前端直持 Key」「仅 Web 可跑的断言」「用 Coding Plan 撑 CI」），须在回复中 **明确质疑**，说明 **违反哪一条**、**风险**、**建议改法**。
3. 若老板 **坚持** 违反约束的实现，助手应 **保留书面质疑记录**（建议记入 §5 变更纪要一句），再按指示执行或另开 TASKS 备注风险。

---

## 9. CodeReviewSkill 架构设计（2026-04-22 定案）

> 本节为代码走查能力的**权威设计文档**；实现须与本节对齐，改设计须先更新本节。

### 9.1 与旧架构的核心差异

| 维度 | 旧实现（gather 一次 → LLM 一次） | 新 CodeReviewSkill |
|------|----------------------------|--------------------|
| 文件定位 | 关键词搜索命中 80+ 路径，塞进固定 token 预算 | Phase 1 按 Unity 约定从模块名推断候选目录 |
| 上下文构建 | 全量拼盘，重要/不重要文件争同一预算 | Phase 2 agent 迭代读文件，LLM 自主决定下一步读哪里 |
| 推理方式 | 一次 LLM 调用，材料不足就 uncertain | Phase 3 先定位再举证，找不到入口也能明确说明 gaps |
| 知识库 | 无 | Phase 3 先查历史缺陷模式，作为 system prompt 附加上下文 |
| 前端依赖 | 步骤④ CodeChangePanel 必填 | 步骤④对 code_review 方法变为**可选**（仍可配置辅助目录） |

### 9.2 四阶段流程

```
契约规则 + 边界提示 + 模块名（+ 可选辅助目录）
        │
        ▼
┌──────────────────────────────────┐
│ Phase 1 · 路径侦察               │
│  模块名 → Unity 目录约定推断      │
│  输出：3-6 个候选目录 + 初始文件   │
└────────────────┬─────────────────┘
                 ▼
┌──────────────────────────────────┐
│ Phase 2 · 定向阅读（Agent 循环）  │
│  工具：listDir / readFile        │
│  LLM 自主决定每一跳读哪里         │
│  最多 4 跳追溯，每文件限 300 行   │
│  输出：3-15 个有正文的相关文件    │
└────────────────┬─────────────────┘
                 ▼
┌──────────────────────────────────┐
│ Phase 3 · 逻辑判断               │
│  知识库查历史缺陷模式             │
│  在读到的代码里找规则关键路径证据  │
│  每条 finding 必须有文件名+方法名  │
└────────────────┬─────────────────┘
                 ▼
┌──────────────────────────────────┐
│ Phase 4 · 结构化输出              │
│  verdict / evidence[] / gaps     │
│  / confidence                    │
└──────────────────────────────────┘
```

### 9.3 Phase 1 — Unity 目录推断规则

模块名 → 候选目录（按约定，不依赖关键词搜索）：

```
输入："新手引导"
→ Scripts/Client/Managers/ 中含 Tutorial/Guide/Novice 的子目录
→ Scripts/Client/UI/ 中含 Guide/Tutorial 的文件
→ Scripts/ExternalClient/UI/ 中含 Guide/Cutout 的文件
→ 对应 Server/DS 工程中同名模块目录

输入："战斗 · 移动/转向"
→ Scripts/Client/Systems/ 中含 Move/Weapon/RVO 的文件
→ Scripts/Client/Managers/FlowFieldAndRVO/
→ ds/Assets/Scripts/ 中同名逻辑

输入："小地图"
→ Scripts/Client/BattleUI/View/MiniMapPanel*
→ Scripts/Client/Managers/GameManager.MiniMap*
```

推断策略优先级：
1. **完全命中**：目录名或文件名直接含模块关键字
2. **前缀/后缀匹配**：`Manager`/`System`/`Controller`/`View` 后缀 + 模块词
3. **服务端对称**：`client/` 侧找到后，同步推断 `ds/`（DS 服务端）中的对称目录
4. **兜底**：模块名无法推断时，返回 uncertain，gaps 写「无法从模块名定位相关目录，建议在步骤④手动指定」

### 9.4 Phase 2 — Agent 工具集

LLM 可调用的工具（服务端实现，不经前端）：

| 工具 | 签名 | 说明 |
|------|------|------|
| `listDir` | `(repoId, dirPath)` | 列出目录下一级文件/子目录（仅代码类扩展名） |
| `readFile` | `(repoId, filePath, opts?)` | 读取单个文件；`opts.maxLines`（默认 300）、`opts.startLine` |
| `searchInFile` | `(repoId, filePath, pattern)` | 在单文件内 grep，返回命中行 ± 5 行上下文 |

约束：
- **最大工具调用轮次**：12 次（超出强制进入 Phase 3 汇总）
- **单文件最大行数**：300 行（超出按 `readFile` 的 `maxLines` 截断，并提示 LLM 可用 `startLine` 续读）
- **累计字符上限**：80,000（约等于旧的 `MAX_TOTAL_CHARS`，但分布在真正相关的文件上）

### 9.5 置信度与结论规则

| 情况 | verdict | confidence |
|------|---------|------------|
| 找到明确关键路径，逻辑与规则完全吻合 | pass | 75-95 |
| 找到明确关键路径，逻辑与规则明确矛盾 | fail | 75-95 |
| 找到部分代码，关键路径不完整（缺服务端/另一端） | uncertain | 30-60 |
| Phase 1 找不到相关目录/文件 | uncertain | 5-20 |
| 找到文件但逻辑通过间接调用无法直接验证 | uncertain | 40-65 |

### 9.6 输出格式（JSON）

```json
{
  "verdict": "pass|fail|uncertain",
  "confidence": 85,
  "reasoning": "一段自然语言推理摘要",
  "evidence": [
    {
      "file": "Assets/Scripts/Client/Managers/GameManager.MiniMap.cs",
      "method": "OnTutorialEnterBattle()",
      "lineHint": "52-67",
      "description": "调用顺序：先 applyReduction 再 applyDiscount，符合先满减后折扣规则"
    }
  ],
  "gaps": "服务端 DS 工程中未找到对应的状态同步逻辑，无法验证服务端侧是否同步执行相同顺序",
  "filesRead": ["路径1", "路径2"],
  "toolCallsUsed": 8
}
```

### 9.7 前端影响

- 步骤④（CodeChangePanel）对 `verifyMethods` 含 `code_review` 的契约变为**可选**：用户可不配置，Skill 自主定位；也可配置以**补充 Skill 推断不到的路径**（作为 Phase 1 的额外 hint）。
- 结果展示新增 `evidence[]`（每条含文件+方法名+描述）和 `filesRead`（本次实际读了哪些文件，透明度）。
- `meta.toolCallsUsed` 替代旧的 `meta.codeContextChars`（仍保留字符数参考）。

### 9.8 v2 升级摘要（QC-13a · 2026-04-29 · 看板 `TKT-20260429-003`）

> 本节为 9.1-9.7 之上的 v2 增量，与 §5 变更纪要 2026-04-29 QC-13a 条目互为索引；详细决策见 `F:\SuperAI\context\tasks\TKT-20260429-003\scratchpad\analyst.md`。

**新增工具**：第 4 工具 `grepRepo(repoId, pattern, dirHint, fileExt?, maxHits?)` — **专用于 then_must_not 反例优先策略**。dirHint 必填且必须落在 Phase 1 dirHints 内（防止仓库根全 grep 触发 IO 风暴），3s 超时，maxHits 上限 20，单文件 500KB 上限。`MAX_TOOL_CALLS` 12→16。

**新输出格式（v2 contract）**：
```json
{
  "version": 2,
  "overallVerdict": "pass|fail|uncertain",
  "overallConfidence": 0-100,
  "reasoning": "...",
  "thenMustResults": [{ "claim", "verdict": "satisfied|violated|unverified", "confidence", "evidence[]", "reasoning" }],
  "thenMustNotResults": [{ "claim", "verdict": "safe|violated|unverified", "confidence", "searchedPaths[]: 必填", "evidence[]", "reasoning" }],
  "measurableCheck": { "kind", "expression", "verdict": "satisfied|violated|unverified", "evidence[]", "reasoning" },
  "filesRead[]", "toolCallsUsed", "gaps"
}
```
v1 旧契约（normalize 后 `version=1`）走 v1 退化：旧 verdict + findings + evidence schema 不变。

**反例优先策略（C 改造铁律）**：每条 then_must_not 必须主动 grepRepo 找反例；找到 → violated（evidence 必填）；搜遍未发现 → safe（confidence 略低于 satisfied）；searchedPaths 必填记录搜过哪些目录。

**Token 容量保护**（Challenger 风险 1 应对）：
- maxTokens 全端点强下限 8192（OpenAI + Gemini，Q1 决议）
- 单契约硬闸门：then_must.length + then_must_not.length > 6 → 端点 400 拒绝并提示拆条
- 工具循环 totalChars ≥60K → 注入 system 软警告让模型主动收尾
- 工具循环 totalChars ≥70K → 强制 finalize（禁用 tools 跳出循环 + 直接输出 JSON）

**AI 自写规则提案（Pass 2 同步路径，Q5）**：
- 触发：fallback=true && thenMustNotResults 至少 1 条 violated && 有 evidence（合取条件）
- 实现：`server/vcs/rule-proposal-generator.js` `maybeGenerateRuleProposal` → `runRuleProposalPass2`（独立 LLM 调用，maxTokens 强下限 8192：dispatcher pass_2_token_budget_anchor「宁愿 token 翻倍也保 schema 完整」，1 个月后看账单与产出比再考虑降级 B）
- 去重：jaccard ≥ 0.6（基于 keywords 字符串 bigram 集合）→ 命中仅 append evidence 不新建
- 数据：`data/rule-proposals.json`（提案队列）+ `data/unity-domain-rules.json`（用户批准的规则）+ `data/feature-flags.json`（aiRuleProposalEnabled 物理开关）+ `data/rule-proposals-stats.json`（周指标埋点）
- REST：`GET /api/rule-proposals[?status=]` / `POST /:id/approve`（写 unity-domain-rules.json + 热加载 domainRules）/ `POST /:id/reject`
- 双层 domainRules：内置层 BUILTIN_UNITY_DOMAIN_MAP + 文件层 unity-domain-rules.json，`server/vcs/domainRules.js` 启动时合并 + approve 后 reloadDomainRules 热加载

**Gemini 半升级（GEMINI.1，Q3）**：
- 输入：消费 enrichedParams（与 OpenAI 同源），修复 PR-0 后 user prompt 显示「未配置仓库」的退化
- 输出：仍为 v1 verdict + findings；前端通道选择器附近显示一行小字提示「Gemini 暂不支持反例判定矩阵」
- tool calling 升级后置（QC-13e）

**判定矩阵 overallVerdict 计算规则**：
- 全部 thenMustResults=satisfied 且 thenMustNotResults=safe 且 measurableCheck=satisfied → pass
- 任一 thenMustResults=violated 或 thenMustNotResults=violated → fail
- 含 unverified 但无 violated → uncertain
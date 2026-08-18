# AI 原生测试平台 · 项目任务清单

> **维护约定**：在实现或评审进展后，将对应条目的「状态」更新为 `待实现` / `实现中` / `已实现`，并可在「备注」中补充日期与说明。  
> **第一期范围**：用例自动生成（含文档解析、生成配置、展示与导出）。  
> **产品语言**：纯中文。**默认时区**：GMT+8（`Asia/Shanghai`）。

---

## 状态图例


| 状态  | 含义     |
| --- | ------ |
| 待实现 | 未开工    |
| 实现中 | 开发或联调中 |
| 已实现 | 可交付使用  |


---

## 0. 信息架构与路由（持续集成平台）


| 路径              | 模块       | 说明                                                                      | 状态  |
| --------------- | -------- | ----------------------------------------------------------------------- | --- |
| `/`             | 功能目录     | 六宫格入口：用例生成、智能测试（预留）、知识库、用例库、测试记录、报告存档                                   | 已实现 |
| `/generation`   | 测试用例生成   | **首期主战场**，独立页面；未来「智能测试」复用同一模块（组件或共享包）                                   | 实现中 |
| `/contracts`    | 质量契约（草稿） | 规则/验证方式/可选代码关联；`data/quality-contracts.json` + API；复用 `CodeChangePanel` | 已实现 |
| `/smart-test`   | 智能测试     | 预留说明页，全链路自动化暂缓                                                          | 占位  |
| `/knowledge`    | 知识库      | 条目 + 文件库；`data/knowledge.json` + `/api/knowledge/`*                     | 已实现 |
| `/case-library` | 用例库      | 项目→模块（树形）→用例 + 用例集横向聚合；双栏布局；生成页导入弹窗                                     | 已实现 |
| `/records`      | 测试记录     | 预留说明页                                                                   | 占位  |
| `/reports`      | 报告存档     | 预留说明页                                                                   | 占位  |


功能清单数据源：`src/featureCatalog.ts`（与首页卡片、预留页文案同步）。

---

## A. 参考流水线（截图 10 步 · 任务追踪）

与参考产品中的纵向流水线对齐，用于后端任务编排；**第一期优先落地「测试点生成」及其前置输入**。全链路编排随「智能测试」推进；**当前产品入口以 `/generation` 为主**。  
**UI 说明**：10 步纵向流水线**不**在独立「测试用例生成」页展示，仅在未来的「智能测试」中保留/实现；`constants.ts` 中 `PIPELINE_STEPS` 供该模块复用。


| ID   | 步骤        | 说明                    | 状态  | 备注                                                         |
| ---- | --------- | --------------------- | --- | ---------------------------------------------------------- |
| P-01 | 输入处理      | 验证文档与任务 ID、输入完整性      | 实现中 | 前端已有上传与校验占位；任务 ID 待设计                                      |
| P-02 | 代码准备      | 拉取 Git 日志与 Diff（可选能力） | 已实现 | Plastic SCM + Git CLI 封装 + 仓库配置 API（见 B.7 CC-01/02/04/07）  |
| P-03 | 文件分析      | 并发分析各文件改动 / 文档结构      | 待实现 | 含多版本需求、关联文档                                                |
| P-04 | 分析汇总      | 汇总各文件分析结果             | 待实现 |                                                            |
| P-05 | 知识库检索     | 历史案例与风险识别（RAG / 向量库）  | 已实现 | LightRAG HTTP 客户端 + RAG REST API（见 B.7 CC-03/08）；生成时自动检索注入 |
| P-06 | 需求综合      | 整合需求分析                | 待实现 |                                                            |
| P-07 | **测试点生成** | **生成测试用例（第一期核心）**     | 已实现 | API 生成 + Cursor 辅助双通路；含提示词拼装、JSON 规范化                      |
| P-08 | 流程图生成     | 生成 Mermaid 流程图        | 待实现 | 可放入报告或单独导出                                                 |
| P-09 | 报告组装      | 整合分析结果                | 待实现 |                                                            |
| P-10 | 结果保存      | 保存报告文件（本地/项目目录）       | 待实现 |                                                            |


---

## B. 第一期：用例自动生成（需求拆解）

### B.1 上传


| ID   | 功能                    | 状态  | 备注                                                                                        |
| ---- | --------------------- | --- | ----------------------------------------------------------------------------------------- |
| U-01 | 多文件上传（点击选择）           | 已实现 | 多选；异步解析；`accept` 已收窄（无 .doc）                                                              |
| U-02 | 多文件拖拽上传               | 已实现 | 拖拽高亮；与点击共用入队逻辑                                                                            |
| U-03 | 支持 Excel / Word / PDF | 已实现 | **浏览器端**：docx（mammoth）、pdf（pdfjs）、xls/xlsx（xlsx）；**.doc 不支持**；图片走 OCR                     |
| U-04 | 文档内**文字**提取           | 已实现 | 浏览器抽取纯文本；扫描版 PDF 可能无字；图片走 Tesseract OCR                                                   |
| U-05 | 文档内**图片**提取与分析        | 已实现 | **浏览器端** Tesseract.js（`chi_sim+eng`），串行 OCR；**不做**服务端多模态 API                              |
| U-06 | 支持多版本需求、关联需求/用例文档     | 已实现 | 每文件可选「文档角色」、列表上下顺序即进模型顺序；提示词含 `【文档角色】` 与多文档约定（前后端 `prompt.js` / `generationPrompt.ts` 对齐） |
| U-07 | 上传列表展示、删除、解析状态        | 已实现 | 解析中 / 已解析（字数、附注）/ 失败说明；含文档角色下拉、上移下移、图片显示「OCR 识别中…」；生成须至少一份解析成功                            |


### B.2 生成配置


| ID   | 功能                                                                 | 状态  | 备注                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | 用例类型多选：功能测试、弱网测试、异常操作、协议安全、客户端性能、服务端性能、兼容适配、容灾容错、UI/UX体验、checklist | 已实现 | 10 种类型常量 + 侧栏多选按钮 + 传入提示词                                                                                                                                           |
| C-02 | 详细程度单选：开发自测 / 策划验收 / QA测试                                          | 已实现 | 与文案一致                                                                                                                                                               |
| C-03 | 关注重点（可选文本）                                                         | 已实现 |                                                                                                                                                                     |
| C-04 | 调用大模型（Gemini / OpenAI 兼容等）                                         | 已实现 | `server/llm/providers.js`：`gemini`、`openai`、`qwen`、`ernie`、`doubao`、`glm`、`minimax`、`kimi`、`deepseek`；**无密钥**时侧栏「Cursor 辅助」                                         |
| C-05 | 流式输出与取消                                                            | 已实现 | 后端新增 SSE 端点 `/api/generate-test-cases-stream`；OpenAI 兼容通道 `stream:true`、Gemini `generateContentStream`；前端 `streamGenerateTestCases` + AbortController；实时流式面板 + 停止按钮 |


### B.3 输出展示


| ID   | 功能                                       | 状态  | 备注                                            |
| ---- | ---------------------------------------- | --- | --------------------------------------------- |
| O-01 | 卡片视图：简略（优先级、类型、模块、一句话描述）                 | 已实现 | 可展开详细                                         |
| O-02 | 卡片视图：详细（+ 前置条件、步骤、预期结果等）                 | 已实现 |                                               |
| O-03 | 表格视图：标准用例列（模块、子模块、描述、优先级、类型、前置、步骤、预期、备注） | 已实现 |                                               |
| O-04 | 卡片/表格双击编辑                                | 已实现 | 内联表单（无弹窗）；双击区块可聚焦对应字段并尽量还原光标                  |
| O-05 | 行/卡片间悬停「＋」插入用例                           | 已实现 | 卡片区插入条；表格「＋插入」行；新增用例仍用弹窗                      |
| O-06 | 复制 / 删除单条用例                              | 已实现 |                                               |
| O-07 | **脑图（XMind）视图**                          | 已实现 | Markmap 实现；**默认优先**展示；可缩放/拖拽/折叠；模块→用例→步骤/预期层级 |
| O-08 | Cursor 辅助「撤销追加」按钮                        | 已实现 | 仅移除通过 Cursor 辅助面板追加的用例，不影响示例与 API 生成结果        |
| O-09 | 测试计划账本（REQ/TP）展示与可观测性                    | 已实现 | 生成 REQ/TP 后展示需求/测试点统计与前 20 个测试点；后端按 REQ→TP 分批→覆盖审计执行并输出固定日志；支持折叠后重新展开；非流式生成显示等待秒数、120/180 秒提示与取消按钮 |


### B.4 导出


| ID   | 功能                        | 状态  | 备注                              |
| ---- | ------------------------- | --- | ------------------------------- |
| E-01 | 导出 Excel（全字段标准表）          | 已实现 | `xlsx` 浏览器端生成；11 列全字段；自动列宽      |
| E-02 | 导出 XMind 思维导图（.xmind）     | 已实现 | JSZip 生成 `.xmind`；模块→用例→步骤/预期层级 |
| E-03 | 导出 Checklist（精简一句话 Excel） | 已实现 | 6 列精简表（ID、优先级、类型、模块、描述、预期）      |


### B.5 其他


| ID   | 功能                 | 状态  | 备注                                                   |
| ---- | ------------------ | --- | ---------------------------------------------------- |
| M-01 | 中文 UI 全文           | 已实现 |                                                      |
| M-02 | 时区 GMT+8 约定与展示     | 已实现 | 见界面文案与 `constants.ts`                                |
| M-03 | 本地后端 API（解析+生成+导出） | 挂起  | 生成/健康/厂商列表已有；导出为浏览器端实现，服务端导出随多人协作阶段再做                |
| M-04 | 配置与密钥（.env）        | 已实现 | `.env.example` 全量模板已提供（9 厂商）；`.gitignore` 已排除 `.env` |


### B.6 用例库（v2 · 项目-模块-用例集 层级结构）


| ID   | 功能                            | 状态  | 备注                                                                            |
| ---- | ----------------------------- | --- | ----------------------------------------------------------------------------- |
| L-01 | IndexedDB 存储层 v2（5 Store）     | 已实现 | `projects` / `modules` / `cases` / `suites` / `suite-case-links`；DB_VERSION=2 |
| L-02 | 项目管理（创建/切换/删除）                | 已实现 | Header 下拉 + 新建项目；删除级联清除模块/用例/套件                                               |
| L-03 | 模块树（多级嵌套、折叠/展开/新增/重命名/删除）     | 已实现 | `ModuleTree.tsx` 独立组件；左侧导航；每条用例唯一归属一个模块                                       |
| L-04 | 用例集管理（创建/删除，横向聚合）             | 已实现 | 多对多关系（`SuiteCaseLink`）；「按用例集」视图 Tab 切换                                        |
| L-05 | 用例列表（按模块/全量/用例集展示，搜索/筛选/展开详情） | 已实现 | 右侧内容区；优先级/类型筛选；多选+批量删除                                                        |
| L-06 | 用例 CRUD（编辑弹窗、手动新建、单条/批量删除）    | 已实现 | 编辑弹窗支持切换归属模块；手动新建自动归属当前项目+模块                                                  |
| L-07 | 生成页「加入用例库」导入弹窗                | 已实现 | `ImportToLibraryModal.tsx`；选择目标项目+模块，可就地新建项目/模块                               |
| L-08 | featureCatalog 状态 + 路由        | 已实现 | `/case-library` → `CaseLibraryPage`；首页卡片 `available`                          |
| L-09 | 项目目录页（首屏项目卡片列表）               | 已实现 | 进入用例库先展示项目目录，选择后进入双栏工作台；支持重命名/删除；顶部保留项目切换                                     |
| L-10 | 导入弹窗智能推荐模块                    | 已实现 | 从用例 `module` 字段提取模块名匹配已有模块；未匹配可一键创建缺失模块                                       |
| L-11 | 用例列表多级排序                      | 已实现 | 表头点击排序（正序/倒序）；默认入库时间正序；次级链：入库时间→优先级→类型                                        |
| L-12 | 导入顺序保持                        | 已实现 | 每条用例 `addedAt` 递增 1ms，正序排列还原生成页原始顺序                                           |


### B.7 代码变更关联 + 知识库增强生成


| ID    | 功能                 | 状态  | 备注                                                                                                                          |
| ----- | ------------------ | --- | --------------------------------------------------------------------------------------------------------------------------- |
| CC-01 | Plastic SCM CLI 封装 | 已实现 | `server/vcs/plastic.js`：listChangesets / getChangesetDetail / diffChangesets / branchDiff / listBranches / showFile         |
| CC-02 | Git CLI 封装         | 已实现 | `server/vcs/git.js`：listCommits / diffCommits / commitDiff / branchDiff / timeDiffContent / grepCode                        |
| CC-03 | LightRAG HTTP 客户端  | 已实现 | `server/rag/lightrag.js`：queryContext（only_need_context）/ insertDocument / checkHealth；对接 6002 端口                           |
| CC-04 | 仓库配置管理             | 已实现 | `server/vcs/repos.js`：JSON 文件持久化；CRUD API；默认初始化 C:\Demo 下四仓库（client/ds/config/gameplay）                                     |
| CC-05 | 增强版 Prompt 构建      | 已实现 | `server/prompt-enhanced.js`：注入代码变更摘要 + RAG 知识上下文；扩展 SYSTEM_PROMPT（代码变更感知 + 知识库利用）                                           |
| CC-06 | 增强版 SSE 流式端点       | 已实现 | `/api/generate-enhanced-stream`：并行获取代码变更+RAG上下文→注入 Prompt→SSE 流式输出；meta 事件通知前端注入详情                                          |
| CC-07 | VCS REST API       | 已实现 | `/api/repos` CRUD + `/api/vcs/:id/branches` + `/api/vcs/:id/changesets` + `/api/vcs/:id/diff` + `/api/vcs/:id/diff-content` |
| CC-08 | RAG REST API       | 已实现 | `/api/rag/health` + `/api/rag/query`                                                                                        |
| CC-09 | 前端代码变更面板           | 已实现 | `CodeChangePanel.tsx`：仓库多选 + 三种筛选模式（时间/分支/变更集）+ 变更集列表复选                                                                     |
| CC-10 | 前端生成页集成            | 已实现 | 侧栏嵌入代码变更面板 + RAG 状态指示器 + 增强生成调用 + meta 注入信息展示                                                                               |
| CC-11 | 每日变更扫描             | 已实现 | `server/scheduler/dailyScan.js`：node-cron 定时任务；遍历所有仓库获取 24h 变更；RAG 关联风险；Markdown 报告                                         |
| CC-12 | 扫描 REST API        | 已实现 | `/api/scan/run`（手动触发）+ `/api/scan/last`（查最近结果）+ `/api/scan/scheduler`（启停定时任务）                                               |


### B.8 知识库（Phase 1 · 骨架 + 文件自动存入）


| ID   | 功能                                 | 状态  | 备注                                                                                                                        |
| ---- | ---------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------- |
| K-01 | 服务端 JSON 存储（`data/knowledge.json`） | 已实现 | 文章 + 文件元数据 + 版本记录；文件体 Base64 存 JSON；REST `/api/knowledge/`*；前端 `knowledgeStore.ts` 走 HTTP（列表不拉二进制，下载时 `ensureKbFileBlob`） |
| K-02 | 分类体系                               | 已实现 | 8 大一级分类（需求文档/缺陷模式/测试经验/规范策略/历史用例/工具脚本/测试报告/其他），各含二级子分类；标签多维检索                                                             |
| K-03 | 知识条目 CRUD                          | 已实现 | 手动新建/编辑/删除；Markdown 正文编辑+预览；分类/标签/来源字段                                                                                    |
| K-04 | 全文搜索                               | 已实现 | 标题+正文+分类+标签关键词匹配（文章+文件共用搜索）                                                                                               |
| K-05 | 文件库浏览与管理                           | 已实现 | 文件列表（名称/分类/大小/来源/时间）；下载原文件；删除（级联变更记录）                                                                                     |
| K-06 | 文件变更记录查看                           | 已实现 | 按文件查看历史变更：时间、大小变化、哈希变化、变更说明                                                                                               |
| K-07 | 生成页文件自动存入知识库                       | 已实现 | 上传解析成功后后台静默存入，不改变原始格式/内容                                                                                                  |
| K-08 | 文件去重三级策略                           | 已实现 | ①同名+同哈希→跳过 ②同名+内容相似(≥30%)→覆盖+变更记录 ③同名+内容差异大→另存新名保留旧文件                                                                     |
| K-09 | 手动上传文件到知识库                         | 已实现 | 知识库页面右上角上传按钮，可选分类，复用去重策略                                                                                                  |
| K-10 | 路由 + featureCatalog                | 已实现 | `/knowledge` → `KnowledgePage`；首页卡片 `available`                                                                           |


### B.9 质量契约（草稿 · MVP）


| ID    | 功能                                                                                                                            | 状态  | 备注                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------- |
| QC-01 | 路由 `/contracts` + 功能目录入口                                                                                                      | 已实现 | `App.tsx`、`featureCatalog.ts`、`HomePage` 文案                                                                                |
| QC-02 | 契约草稿表单（规则、边界、优先级、验证方式）                                                                                                        | 已实现 | 验证方式：代码走查 / 接口测试 / UI 测试                                                                                                   |
| QC-03 | 复用代码仓库关联面板                                                                                                                    | 已实现 | 与用例生成页相同 `CodeChangePanel` + `documentText` 来自规则摘录                                                                         |
| QC-04 | 契约草稿持久化                                                                                                                       | 已实现 | `data/quality-contracts.json` + `GET/POST/DELETE /api/quality-contracts/drafts`；前端 `contractDraftStore.ts` 走 HTTP（与用例库同策略） |
| QC-05 | 草稿列表与删除                                                                                                                       | 已实现 | 列表按创建时间倒序                                                                                                                  |
| QC-06 | 后端 `POST /api/generate-contracts`                                                                                             | 已实现 | 独立提示词 `prompt-contract.js` + `normalize-contracts.js`；与 `/api/generate-test-cases` 分流                                      |
| QC-07 | 需求上传 + AI 提取 + 预览批量入库                                                                                                         | 已实现 | 复用 `extractDocumentText`；详细度沿用 `DEPTH_OPTIONS`；通道 `llmProvider` 与用例页同源 localStorage                                        |
| QC-08 | 契约页「运行代码走查」+ `gatherCodeContext` 统计                                                                                           | 已实现 | 返回 `{ text, stats }`；命中但未读入正文的路径写入 prompt 专节；`meta.codeContextStats`；增强生成/预览取 `.text`                                      |
| QC-09 | （可选）契约 AI 提取阶段接入摘要级代码上下文                                                                                                      | 待实现 | **P3 储备**：灰/白盒增强；当前 `POST /api/generate-contracts` 仅需求侧；产品决策与看板任务见 SuperAI `**TKT-20260415-001`**                          |
| QC-10 | 契约提取模板对齐知识库《AI 驱动的下一代测试平台》+ verifyRationale                                                                                   | 已实现 | 用户层/执行层分界、验证方式决策表；JSON 字段 `verifyRationale`；`normalize-contracts` 兜底；草稿可选字段                                                |
| QC-11 | **契约库**：与用例库同 **projectId + moduleId**、分 API/存储；`status` draft/active；同页编辑块；预览不落库；**IDB→服务端一键迁移**；**功能目录 + `/contracts` 双入口** | 待实现 | 已定案见 `CONTEXT.md` §3-15；暂不多用户                                                                                              |
| QC-12 | **质量契约提取 prompt v2 升级**：`prompt-contract.js` 新增 V2（layer / given / when / then_must / then_must_not / measurable 骨架 + 模糊词黑名单 + Few-shot），V1 保留作回滚；`normalize-contracts.js` 输出 `version` 字段 + then_must_not 缺失填 `null`；`CONTRACT_DEPTH` 默认条数下限砸半（planning 6→3 / dev 12→6 / qa 20→10）；ContractCard / Step 3 aiPreview v1/v2 双分支渲染 | 已实现 | 工时 6-8h；负责人 engineer（看板 `TKT-20260429-002` / ST-001，2026-04-29）。绑定 QC-13a (TKT-003) / QC-13b (TKT-004) 三任务组下游消费。**向后兼容**：现存 27 条 v1 契约不重跑（normalize 后 version=1 干净降级，ContractCard 显示灰色「v1 契约」标签）；流式解析嵌套 measurable 已端到端验证（脚本 18/18 通过）。**老板 5 项决议穿透**：Q1/Q2/Q3/Q4/Q5（详见 CONTEXT §5 变更纪要 2026-04-29 条目）。 |
| QC-13a | **code_review skill 改造主体**（A 输入升级 + B 输出升级 + C 反例优先 + D grepRepo + AI 自写规则提案 + REST 3 端点 + Token 双档闸门 + Gemini 半升级 + 11 个预存 lint 顺手修）：`prompt-code-review.js` V2 system prompt（反例优先策略） + buildCodeReviewUserContent v2 分节；`normalize-code-review.js` 输出判定矩阵 schema（thenMustResults / thenMustNotResults / measurableCheck）+ v1 兼容；`code-review-agent.js` 新增 grepRepoForAgent 工具（dirHint 校验 + 3s 超时 + 500KB 上限 + maxHits 20）+ MAX_TOOL_CALLS 12→16 + Token 60K 软警告/70K 硬上限 + UNITY_DOMAIN_MAP 双层加载；`openai-code-review.js` maxTokens 强下限 8192 + Pass 2 提案独立 LLM 调用入口；`server/vcs/rule-proposal-generator.js` jaccard≥0.6 去重 + maybeGenerateRuleProposal 主入口；`server/vcs/domainRules.js` 双层规则合并加载 + approve 后热加载；`server/index.js` 单契约硬闸门（then_must+then_must_not≤6）+ 3 个 REST 端点（GET/approve/reject）+ Pass 2 触发；`gemini-code-review.js` 消费 enrichedParams（修复 PR-0 后退化）+ maxOutputTokens=8192；`QualityContractsPage` Step 5 v2 判定矩阵展示 + Gemini 通道小字提示 + saveContractDraft 调用补 status/projectId/moduleId；`codeReview.ts` 类型扩展（thenMustResults / thenMustNotResults / measurableCheck / ruleProposalId / ruleProposalDraft + CodeContextStats 强类型）。新建数据文件 4 个（rule-proposals / unity-domain-rules / feature-flags / rule-proposals-stats）。 | 已实现 | 工时 20-23h；负责人 engineer（看板 `TKT-20260429-003` / ST-003，2026-04-29）。**老板 5 项决议穿透**：Q1 全端点 maxTokens=8192 / Q3 Gemini 半升级 / Q4 aiRuleProposalEnabled:true 首发即开 / Q5 Pass 2 同步路径。**铁律**：v1 契约走查行为不变（旧 verdict + findings schema）；Pass 2 不走异步/SSE；jaccard≥0.6 命中仅 append evidence 不新建；grepRepo dirHint 必须落在 Phase 1 dirHints 内；overallVerdict 算子见 CONTEXT §9.8 末尾。**端到端验证**：`verify-st003.mjs` 13 条 acceptance 全过；npm build 通过。 |
| QC-13b | **规则提案审批 UI MVP**（集成点 A：走查结果页内联草稿卡片）：`src/api/ruleProposals.ts`（新）listRuleProposals / approveRuleProposal / rejectRuleProposal 三 API，错误处理与 codeReview.ts 同源；`src/components/RuleProposalCard.tsx`（新）violet 风格草稿卡：标题「AI 草拟规则建议」+ keywords 正则 / hints / fileKeywords / evidence(默认折叠) / affectsModules?；三按钮「批准入库 / 驳回 / 稍后再说」+ submitting 时 disable + spinner + error 重试；`QualityContractsPage` Step 5 reviewResult 渲染块底部条件挂载 RuleProposalCard（line 711 占位下方追加）；顶层 `proposalDismissed: Record<string,boolean>` 独立状态机与 reviewResult 隔离；批准/驳回成功后通过 `setReviewResult(prev => prev ? { ...prev, ruleProposalId: undefined, ruleProposalDraft: undefined } : prev)` 二次点击防御；toast 复用 setMsg（不引新库）：批准→「规则已入库，下次相关走查将直接命中」/驳回→「提案已驳回」/稍后→仅卡片消失不弹 toast。 | 已实现 | 工时 4-6h；负责人 engineer（看板 `TKT-20260429-004` / ST-004，2026-04-29）。三任务绑定组最后一块。**MVP 不做**：独立 /rule-proposals 管理页（QC-13c 后置）/ 走查后轻 toast 提醒（QC-13d 后置）/ 已驳回提案复审 / 批量批准。**铁律**：共享文件 QualityContractsPage 仅在 line 711 占位下方追加，禁改 Step 1-4 与 Step 5 拆分展示主体；二次点击防御铁律落地（成功后从 reviewResult 移除 ruleProposalId）；状态机隔离铁律落地（卡片内部 idle\|submitting\|done\|error + 页面层 proposalDismissed 双层独立）。**端到端验证**：`verify-st004.mjs` 静态 + 集成检查全过；npm build 通过。 |
| QC-15 | **两层架构回归 + skill IO 单层化 + verdict alias 桥接**：`prompt-contract.js` V2 仅保留 4 字段用户层（rule/verifyMethods/verifyRationale/boundaryHint）+ layer 元数据透传不渲染；`prompt-code-review.js` System Prompt + buildCodeReviewUserContent 单层 4 字段精简版；`normalize-code-review.js` 输出 `{conclusion, verdict(同值alias), confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed}`；ST-004 触发条件迁移到 `conclusion=='fail' && evidence.length>0`；防 LLM 摆烂 5 道防线（正例引导/黑名单/Few-shot/必填强约/空许可）落地。 | 已实现 | 工时 12-15h；负责人 engineer（看板 `TKT-20260429-010`，2026-04-29）。**老板 5 项决议穿透**：Q1/Q2/Q3/Q4/Q5（详见 010/handoffs/004 KD-1~7）。**铁律**：layer 字段降级为元数据（不前端渲染、不上 LLM prompt）；verdict 同值 alias 临时桥接；零数据迁移。**端到端验证**：跨会话独立硬验证 19/19 PASS + 评审专家终审 APPROVED_WITH_DEBT。 |
| QC-16 | **codeReviewSkill 完整流程 MVP**（批量调度→落盘→展示）：`server/contractReviewResults.js`（新）独立 result store 持久化 `data/contract-review-results.json`，每契约 FIFO 截断到最近 3 条历史，原子写 tmp+rename；`server/index.js` 新增 `POST /api/quality-contracts/drafts/:id/code-review`（按 id 找契约 → 复用 gatherCodeContext+inferCandidateDirs+runCodeReview\* → tryParseCodeReviewResponse → contractReviewResults.appendResult 落盘 → 返回带 savedAt；保留 ST-004 Pass 2 提案触发）+ `GET /api/quality-contracts/drafts/:id/code-review-results?limit=3`；`src/api/codeReview.ts` 新增 `runContractCodeReviewById(id, body)` / `listContractReviewResults(id, limit)` + `PersistedContractCodeReviewResult` 类型（runAt/savedAt/llmProvider）；`QualityContractsPage` Step 5 改造：批量走查按钮（默认动作，灰按主按钮）+ 进度条 X/N + 三色总览徽章（emerald/red/amber + 错误明细折叠）+ AbortController 取消，保留单条按钮做兼容；contract 卡片传 `reviewResult={batchResults[id] ?? null}`；`ContractCard` 新增可选 `reviewResult` prop（向后兼容）：ReviewResultBadge 渲染结论+置信度+reasoning 截断 80 字+证据折叠区（每条 file/method/lineHint/description 一行），LayerDetailFold（BD-1 L1）渲染 layer/given/when/then_must/then_must_not/measurable 任一字段存在时的折叠区，全部不存在则整块不渲染；`ContractLibraryPage` 进入页 `Promise.all(contracts.map → listContractReviewResults(id, 1))` 并发拉每条最新走查结果传 prop（已记 N+1 待办 DT-3）。 | 已实现 | 工时 6-8h；负责人 engineer（看板 `TKT-20260429-014`，2026-04-30）。**6 项 BD 决策落地**：BD-1 L1 layer 折叠区 / BD-2 SR1 走查范围=当前页 rows / BD-3 沿用既有代码定位 / BD-4 listDrafts() 按 id 查 / BD-5 codeChanges body 优先 → contract.codeContext 降级 → 400 / BD-6 独立 result table 每契约 3 条历史。**铁律**：后端 LLM 主链路一字不改（仅 import 新模块 + 新增两条路由）；contract.layer 不存在时整块不渲染（向后兼容）。**已知 N+1**：ContractLibraryPage 每条契约 1 个 GET 请求；契约 ≥ 10 条时有可见延迟，本轮 MVP 接受（DT-3 后续合并端点）。**已知数据缺口**：当前 contractLibrary.js#createDraft 不保存 layer/given/when/then_must 字段，所以 LayerDetailFold 在现有 26 条 v1 数据下不会显示；待后续任务（DT-014-A 执行层具体逻辑验证 P1）补齐保存链路。**端到端验证**：模块导入 OK + tsc 无错 + vite build 4.96s 成功 + ST-1 单测 4 次 append 截断到 3 条 + ST-2 GET HTTP 200/POST 400 错误路径 + 真实 contract id 端到端 append+GET 验证。 |


---

## C. 后续阶段（占位，便于持续维护）


| ID   | 方向             | 状态  | 备注                                                                                                                                                                            |
| ---- | -------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | 用例评审与批注        | 已移除 | 2026-04-14：评审与 Fix Agent 相关前后端代码已全部下线（`POST /api/review-test-cases-stream`、`patch-case`/`rewrite-case`/`generate-missing-cases`、`server/review/`*、`ReviewPanel` 等）；后续质量方案另立需求 |
| F-02 | 与缺陷管理联动        | 待实现 |                                                                                                                                                                               |
| F-03 | CI 触发回归建议      | 待实现 |                                                                                                                                                                               |
| F-04 | 多项目空间          | 待实现 |                                                                                                                                                                               |
| F-05 | 插桩测试（覆盖率等）接入评估 | 备忘  | 暂不实现，仅备忘：是否与「智能测试」执行链、测试记录/报告对接；SuperAI 看板 **TKT-20260415-002**（[P3]）                                                                                                         |


---

## 变更记录


| 日期         | 变更摘要                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-03 | 初版：合并截图流水线 + 用户文字需求；创建本地 `ai-test-platform` 骨架与 TASKS                                                                                                                                                                                                              |
| 2026-04-03 | 新增 `CONTEXT.md`（会话上下文）；Cursor 规则约定：相关回复末尾附「推进任务清单」（摘自 TASKS）                                                                                                                                                                                                       |
| 2026-04-03 | 上传：拖拽、浏览器端解析（txt/md/csv/json、docx、pdf、xlsx）、列表状态与生成门槛（须至少一份解析成功）                                                                                                                                                                                                   |
| 2026-04-07 | 用例卡片：单击展开/收起；双击内联编辑（`CaseDraftForm`）；双击标题/描述/预期等尽量还原光标；表格双击行内联编辑；新增用例仍弹窗                                                                                                                                                                                           |
| 2026-04-07 | 大模型：`server/` Express API；`LLM_PROVIDER=openai                                                                                                                                                                                                                     |
| 2026-04-03 | 侧栏「Cursor 辅助」：复制完整提示词到 Cursor 对话，粘贴返回 JSON 追加用例；`/api/health` 无密钥时 `ok:false` 引导该路径                                                                                                                                                                                |
| 2026-04-08 | U-05 浏览器端 Tesseract.js OCR（中英）；U-06 多文件文档角色 + 顺序；U-03/U-04 状态更新为已实现                                                                                                                                                                                                |
| 2026-04-08 | O-07 脑图（XMind）默认视图（Markmap）；O-08 Cursor 辅助「撤销追加」按钮                                                                                                                                                                                                                 |
| 2026-04-08 | P-07 测试点生成已实现（API + Cursor 双通路）；M-04 .env 配置已实现；全量状态自检                                                                                                                                                                                                             |
| 2026-04-08 | 用例库 v2 重构：项目→模块（树形多级）→用例 + 用例集横向聚合；5 Store IndexedDB；ModuleTree 组件；双栏布局（左侧树+右侧列表）；导入弹窗选项目+模块                                                                                                                                                                       |
| 2026-04-08 | 用例库增强：项目目录首屏、导入弹窗智能模块推荐、多级排序（入库时间→优先级→类型）、导入顺序保持                                                                                                                                                                                                                   |
| 2026-04-08 | C-05 流式输出：SSE 端点 + OpenAI/Gemini 流式 + 前端实时面板 + AbortController 取消                                                                                                                                                                                                  |
| 2026-04-09 | 知识库 Phase 1：独立 IndexedDB（3 Store）、8 大分类体系、知识条目 CRUD + Markdown 编辑、文件库、文件自动存入（三级去重+变更记录）、全文搜索                                                                                                                                                                       |
| 2026-04-10 | F-01 用例评审 Phase 1：多Agent评审核心（3独立Agent QA/策划/程序并行评审 + 通用LLM chat层 + 协调器 + 结果打包 + SSE流式端点 + 评审面板UI + 三视角独立徽标）；后端 `server/llm/chat.js` + `server/review/{prompts,coordinator,aggregate}.js` + API端点；前端 `ReviewPanel` + `CaseReviewDetail` 组件 + `reviewCases.ts` API封装 |
| 2026-04-14 | F-01 下线：移除评审 SSE、修复三端点、`server/review/`*、`server/llm/chat.js`、前端评审面板与相关类型                                                                                                                                                                                          |
| 2026-04-13 | B.7 代码变更关联 + 知识库增强生成：Plastic SCM/Git CLI 封装、LightRAG 对接、仓库配置管理、增强版 Prompt+SSE、前端代码变更面板集成、node-cron 每日扫描                                                                                                                                                            |
| 2026-04-13 | 新增根目录 `启动说明.md`：本地启动步骤、npm 脚本表、常见问题与文档索引                                                                                                                                                                                                                           |
| 2026-04-15 | B.9：新增 `/contracts` 质量契约（草稿）MVP（IndexedDB + `CodeChangePanel`）；不影响用例生成                                                                                                                                                                                             |
| 2026-04-15 | B.9：QC-06/07 需求驱动 AI 提取契约（`POST /api/generate-contracts`）+ 预览后批量存草稿                                                                                                                                                                                                |
| 2026-04-15 | B.9：QC-08 `gatherCodeContext` 清单/正文对齐 + 走查 `meta.codeContextStats`                                                                                                                                                                                                 |
| 2026-04-15 | B.9：新增 **QC-09**（P3 储备）— 可选将摘要级代码上下文接入契约 AI 提取；SuperAI 看板 `**TKT-20260415-001`** 同步立项                                                                                                                                                                              |
| 2026-04-15 | B.9：**QC-10** 契约提取提示词对齐 TesterHome #43886；输出 **verifyRationale**；IndexedDB 草稿兼容可选字段                                                                                                                                                                                |
| 2026-04-15 | **统一持久化**：质量契约草稿、知识库由 IndexedDB 迁至服务端 `data/quality-contracts.json`、`data/knowledge.json`（与 `case-library.json` 同策略）；需同时启动 `npm run dev`（Vite 代理 API）                                                                                                              |
| 2026-04-15 | 章节 C：新增 **F-05**（备忘）— 插桩测试/覆盖率是否接入本平台的评估项；与看板 **TKT-20260415-002** 对齐                                                                                                                                                                                              |
| 2026-04-16 | B.9：新增 **QC-11**（待实现）— 契约库：项目+模块、状态、双入口、迁移与同页编辑；定案见 CONTEXT §3-15                                                                                                                                                                                                  |
| 2026-04-22 | Kimi 默认与示例：`KIMI_MODEL=kimi-k2.6`；`providers.js` 中 `inferSharedContextWindowTokens` 识别 K2.5/K2.6 为 256k 共享窗；TOKEN_BUDGETS / 前端体量提示文案同步                                                                                                                                     |
| 2026-04-22 | Kimi K2.5/K2.6：`openAiCompatTemperature` 固定 `temperature=1`（避免 Moonshot 400）；`openai.js` / `openai-contracts.js` / `openai-code-review.js` 接入；新增 `npm run smoke:llm-four`（`scripts/smoke-four-llm.mjs`）四通道最小 chat 冒烟                                                                 |
| 2026-04-22 | DeepSeek 默认改为 `deepseek-reasoner`（`.env` / `providers.js` / `.env.example` 注释）                                                                                                                                                                        |
| 2026-04-22 | jbt.model123.dev：实测 `claude-sonnet-4-6` 可用、`claude-sonnet-4.6` 503；`.env` 已改连字符；新增 `npm run probe:anthropic-models` |
| 2026-04-22 | **LLM 调用追踪（Trace Viewer）**：新增 `server/llm/llm-trace-store.js` 内存循环缓冲区（100 条），6 个 LLM 模块插桩，`/api/llm-traces` + `/:id` API 端点，前端 `/llm-traces` 页面，首页功能卡片入口。可查看每次调用的完整 System Prompt + User Prompt + 模型返回 + 耗时 + Token 用量 |
| 2026-04-27 | **撤回 LLM Trace Viewer 集成方案**：改为独立代理工具 `toolbox/llm-proxy-monitor`（不在测试平台内）。删除 `llm-trace-store.js`、`LlmTracesPage.tsx`、`/llm-traces` 路由、首页卡片、6 个 LLM 模块的 `startTrace/endTrace/updateTraceMessages` 埋点。原因：观测工具应独立于业务平台，避免代码耦合（TKT-20260427-001） |
| 2026-04-29 | B.9：**QC-15** 两层架构回归 + skill IO 单层化 + verdict alias 桥接 — 看板 `TKT-20260429-010`；layer 字段降级为元数据，prompt-code-review/contract V2 单层 4 字段，normalize-code-review 输出 alias，ST-004 提案触发迁移到 `conclusion='fail' && evidence.length>0`，防 LLM 摆烂 5 道防线落地；评审专家终审 APPROVED_WITH_DEBT |
| 2026-04-30 | B.9：**QC-16** codeReviewSkill 完整流程 MVP（批量调度→落盘→展示）— 看板 `TKT-20260429-014`；新增 `server/contractReviewResults.js` 独立 result table（每契约 3 条历史 FIFO） + `POST/GET /api/quality-contracts/drafts/:id/code-review[-results]` 两端点；前端批量走查按钮 + 进度条 + 三色徽章 + AbortController；ContractCard 加 `reviewResult` prop（结论徽章 + 证据折叠）和 `LayerDetailFold`（BD-1 L1 执行层详情，向后兼容）；ContractLibraryPage 并发拉每条最新走查（已知 N+1，DT-3 待办）。**老板 6 项 BD 决策全落地**；后端 LLM 主链路一字不改 |
| 2026-05-13 | B.3：新增 **O-09** 测试计划账本（REQ/TP）展示与可观测性：账本折叠不清空数据，保留展开入口；`/api/generate-test-plan` 增加 240 秒超时、AbortSignal 与 start/done/error 日志；前端显示等待秒数、120/180 秒提示与取消按钮 |
| 2026-05-13 | B.3：O-09 追加 REQ/TP 阶段化改造：`/api/generate-test-plan` 从一次性大 JSON 改为 REQ 需求账本 → TP 按 REQ 分批（默认每批 3 个）→ 本地覆盖审计；新增 `req_start/req_done`、`tp_batch_start/tp_batch_done/tp_batch_error`、`coverage_start/coverage_done`、`done` 固定日志 |

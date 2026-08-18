# AI 代码走查系统

> 隶属于 **AI 测试平台（ai-test-platform）** 的首个工作流模块。
> 文档维护人：梁 | 最后更新：2026-05-14

---

## 1. 系统定位

代码提交后，结合 AI 能力执行一轮自动化走查，快速暴露明显的需求点遗漏和代码隐患（附带发现），为人工 review 提供聚焦线索。

---

## 2. 整体流程

### 一句话概括

> 读需求 → 提契约 → 搜代码 → 给判定 → 出报告

### 流程总览（含脚本驱动步骤）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   📄 需求文档                                                                │
│   (.docx/.md)                                                                │
│       │                                                                      │
│       ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 0: run_review.py init  [脚本强制]                    │            │
│   │  → 新鲜度检测（对比 manifest 缓存中已记录文件的 mtime+size，│            │
│   │    标记变更文件和新增文件）                                   │            │
│   │  → 依赖图谱加载（优先探测开发提供的 Roslyn 编译器索引文件， │            │
│   │    如 dependency-graph-cache.json / script-structure-index   │            │
│   │    .json；未找到则降级为脚本正则自建）                       │            │
│   │  → 历史反馈加载（读取 disagree 标注，生成 few-shot 修正示例）│            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 1: 契约提取  [LLM]                                   │            │
│   │  → 提取质量契约 + SR 子要求拆解                              │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 1.5: run_review.py scan  [脚本强制]                  │            │
│   │  → ast-grep 结构化扫描（8条自定义规则）                      │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 1.7: run_review.py search  [脚本强制]                │            │
│   │  → 脚本先把所有 SR 关键词拿去代码库搜一遍                   │            │
│   │  → 能直接出结论的（禁止类/运行时类）脚本自动判定            │            │
│   │  → 其余 SR 把搜到的真实代码片段打包交给 AI 后续判定         │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 2: 代码走查  [LLM]                                   │            │
│   │  → 搜索 → 阅读 → 判定（仅处理 pending_llm 的 SR）          │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Step 3.5: run_review.py verify-evidence  [脚本强制]        │            │
│   │  → Evidence 3级磁盘验证 + 修正循环（最多2轮）               │            │
│   │  → 2轮后仍失败的 evidence → 标记 verified:false             │            │
│   │    → 全部证据失败 → 判定降级为 uncertain                     │            │
│   │    → 部分证据失败 → 判定不变，报告标注未验证项              │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 3: 报告生成  [LLM]                                   │            │
│   │  → 生成 results.json（AI 数据源） + 走查报告.md（人读）     │            │
│   └─────────────┬───────────────────────────────────────────────┘            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │  Phase 3 末尾: run_review.py validate  [脚本强制]           │            │
│   │  → 报告完整性校验                                            │            │
│   └─────────────────────────────────────────────────────────────┘            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**设计原则**：能用脚本硬编码的步骤绝不让 LLM 自由发挥。`run_review.py` 是统一入口，5 个子命令覆盖所有确定性步骤。

---

## 3. 关键概念

### 3.1 质量契约 (Quality Contract)

| 字段 | 说明 |
|------|------|
| `moduleLabel` | 模块名，用于分类（如「新手引导 > 关卡选择」） |
| `rule` | 简体中文陈述句，可审计的业务规则 |
| `boundaryHint` | 边界/精度/并发等风险与特例 |
| `priority` | P0（资金/安全/不可逆）/ P1（重要主流程）/ P2（其余） |
| `verifyMethods` | `code_review` / `api_test` / `ui_test` |
| `layer` | `data` / `business` / `ux` |
| `subRequirements` | （可选）原子级子要求数组 |

### 3.2 子要求拆解 (Sub-Requirement, SR)

一条业务规则可能包含多个可独立验证的断言。每个 SR 有独立的 `checkType`、`keywords`、`passCondition`、`failCondition`。

**为什么要拆**：如果整体判定，AI 可能因为 SR-1 通过了就整条判 pass，漏掉 SR-2 其实没实现。拆开后每个 SR 独立判定，任一 fail → 整条 fail。

### 3.3 checkType 路由（共 5 种）

```
                        子要求 SR
                           │
                     checkType 是什么？
                           │
         ┌────────┬────────┼────────┬────────┐
         ▼        ▼        ▼        ▼        ▼

   grep_existence  grep_forbidden  ast_pattern  llm_semantic  runtime_only
   "功能存不存在"   "禁止的东西      "代码结构     "需要读懂     "只能运行
                    有没有出现"       匹配"        代码语义"     时才能看出"
```

| # | checkType | 适用场景 | 判定方式 | 举例 |
|---|-----------|---------|---------|------|
| 1 | `grep_existence` | 某功能/方法是否存在 | 脚本预搜索 + LLM 确认 | "拖拽安装功能" → 搜 `DragPart` |
| 2 | `grep_forbidden` | 需求明确禁止的东西 | **脚本自动判定** | "不做弹簧平滑" → 搜 `SmoothDamp` |
| 3 | `ast_pattern` | 代码结构模式匹配 | ast-grep 自定义 YAML 规则 | "事件 += 有没有对应 -=" |
| 4 | `llm_semantic` | 需要理解代码含义才能判定 | AI 判定（受防护规则约束） | "拖拽失败后回退逻辑是否正确" |
| 5 | `runtime_only` | 纯运行时行为 | **脚本自动判定**：直接标 uncertain | "动画播放是否流畅" |

### 3.4 判定防护规则体系

| 层级 | 规则名 | 通俗解释 | 防止什么 |
|------|--------|---------|---------|
| 1 | Pass 防护铁律 | 想判「通过」？先证明每个子要求都有实打实的代码证据 | 防止虚高 pass |
| 2 | Fail 推定规则 | 关键词搜遍了全库确实 0 结果 → 判 fail | 让真缺失的功能被准确标记 |
| 2.1 | 强制豁免自检 | 判 fail 前排除 3 种假阴性 | 防止误杀 |
| 2.2 | 空实现条款 | 方法存在但 body 为空 → 仍判 fail | 防止空壳豁免 |
| 3 | 否决铁律 | 发现和需求矛盾的证据 → 绝不判 pass | 防止矛盾证据被忽略 |

**强制豁免自检的 3 种检查**：

| # | 检查场景 | 怎么检查 | 真实案例 |
|---|---------|---------|---------|
| A | **通用机制实现** | 功能是否通过通用系统间接完成？ | 没有 `ReturnToBag()` 但 `OnDrop` 里有位置重置 |
| B | **回调/事件模式** | 功能是否通过回调参数、事件派发实现？ | 没有 `anyClick()` 但通过回调委托实现 |
| C | **配置驱动** | 功能是否通过 Prefab/Animator 实现？ | .cs 没设置高亮色但 Prefab Button 已配置 |

### 3.5 附带发现与违规性分级

| 违规性 | 含义 | 后续动作 |
|--------|------|---------|
| **违规** | 与需求文档某条明确约束矛盾 | 升级为新契约或补充 SR → fail |
| **潜在违规** | 看起来不对但无直接矛盾条款 | 需与策划/开发确认 |
| **建议改进** | 代码质量/健壮性问题，不违反需求 | 值得修复但不阻塞 |
| **待确认** | 需运行时验证才能判定 | 下次测试时关注 |

### 3.6 Evidence 程序化验证 + 修正循环

**做法**：

```
run_review.py verify-evidence --run-date YYYY-MM-DD
  │
  ├─ 3 级磁盘验证（文件存在 → 行号有效 → 方法名匹配）
  ├─ 失败项附带 actual_content（该行号真实代码 ±3 行）
  ├─ 文件找不到时附带 suggested_paths（候选路径）
  │
  ▼
corrections 非空？
  ├─ 是 → LLM 根据 actual_content 修正 → 重新验证（最多2轮）
  └─ 否 → 验证通过
  │
  ▼
2 轮后仍失败？→ 兜底规则：
  ├─ 全部 evidence 失败 → 判定降级为 uncertain
  └─ 部分 evidence 失败 → 判定不变，报告标注未验证项
```

---

## 4. 脚本驱动架构

### 4.1 run_review.py 统一入口

| 子命令 | 阶段 | 做什么 | 输入 | 输出 |
|--------|------|--------|------|------|
| `init` | Phase 0 | 新鲜度检测 + 依赖图谱 + 反馈加载 | `--scan-dir` | 新鲜度/图谱/修正示例 |
| `scan` | Phase 1.5 | ast-grep 结构化扫描（8条规则） | `--scan-dir` `--classes` | AST 扫描结果 JSON |
| `search` | Phase 1.7 | SR 关键词预搜索 + 确定性自动判定 | `--scan-dirs` `--contracts` | auto_judged + pending_llm |
| `verify-evidence` | Step 3.5 | Evidence 校验 + 修正信息 | `--run-date` | corrections + actual_content |
| `validate` | Phase 3 末尾 | 报告完整性校验 | `--report` | 缺失区段/警告列表 |

### 4.2 依赖图谱双源架构

```
run_review.py init --scan-dir <目录>
  │
  ├─ 探测开发索引文件（Roslyn 编译器生成）
  │   ├─ dependency-graph-cache.json    → 类间依赖关系
  │   └─ script-structure-index.json    → 文件结构索引
  │
  ├─ 有开发索引？
  │   ├─ 是 → 加载开发索引（~150ms）              ← 新项目走这条
  │   └─ 否 → 降级自建 build_dep_graph.py（正则）  ← 老项目走这条
```

### 4.3 全部脚本清单

| 脚本 | 功能 | 调用方式 |
|------|------|---------|
| `run_review.py` | 统一入口，5 个子命令 | Agent 直接调用 |
| `freshness_check.py` | mtime+size 新鲜度检测 | init 内部调用 |
| `build_dep_graph.py` | 正则依赖图谱自建 | init 内部调用（降级路径） |
| `feedback_stats.py` | 历史反馈统计 + few-shot 修正 | init 内部调用 |
| `ast_grep_scan.py` | ast-grep 结构化扫描 | scan 内部调用 |
| `verify_evidence.py` | Evidence 3 级磁盘验证 | verify-evidence 内部调用 |
| `validate_report.py` | 报告完整性校验 | validate 内部调用 |
| `update_mapping.py` | 映射缓存更新 | Phase 2 结束后 Agent 调用 |
| `repo_config.py` | 仓库路径统一管理 | 被所有脚本 import |

---

## 5. 产出文件与读者分工

### 5.1 谁读哪份文件

| 文件 | 格式 | 读者 | 定位 |
|------|------|------|------|
| **contract-review-results.json** | JSON | **AI**（下次走查/回归对比/反馈统计） | 唯一机器数据源，包含全部结构化字段 |
| **quality-reports/*.md** | Markdown | **人**（策划/开发/测试/周会） | 排版摘要，聚焦判定结论和证据要点 |

> ⚠️ AI 下游任务（增量走查、回归对比、反馈回注）应读 `results.json`，**不应解析 `.md` 报告**。

### 5.2 全部数据文件说明

| 文件 | 一句话解释 | 写入方 | 读者 | 保留策略 |
|------|-----------|--------|------|---------|
| **quality-contracts.json** | 从需求文档提取的检查规则清单 | Phase 1 | Phase 1.7 + Phase 2（AI） | 永久保留，可追加 |
| **contract-review-results.json** | 走查完整机器数据（判定/证据/附带发现/AST摘要/验证详情） | Phase 2 + 3.5 | AI 下游任务 | 永久保留，按日期追加 |
| **quality-reports/\*.md** | 给人看的排版报告 | Phase 3 | 人工阅读 | 按日期命名，永久保留 |
| **module-file-mapping.json** | "模块 → 代码文件"对应关系缓存 | 映射脚本 | 下次走查加速搜索 | 走查后自动更新 |
| **ast-grep-latest.json** | 本次 AST 扫描原始结果（快照） | AST 脚本 | 映射脚本 | 每次走查覆盖 |
| **依赖图谱缓存** | 类间依赖 + 文件结构索引 | init 脚本 | Phase 2 走查 | 检测变更后更新 |
| **反馈数据** | 人工标注的"准确/误判/遗漏" | 人工录入 | init 脚本 → Few-shot | 持续积累 |

> 📋 待办 TKT-20260514-001：补全 results.json Schema，确保 sideFindings / astScanSummary / evidenceVerification / searchPreExecution 全部结构化存储。

---

## 6. ast-grep 自定义规则库（8 条）

| 规则 ID | 检测内容 | 严重级 | 走查用途 |
|---------|---------|--------|---------|
| `empty-method-body` | 空方法体 | warning | 直接支撑「空实现条款」判定 |
| `event-subscribe-unpaired` | 事件 += 订阅点 | info | 配合 unsubscribe 做配对分析 |
| `event-unsubscribe` | 事件 -= 取消点 | info | 未配对 = 潜在内存泄漏 |
| `coroutine-no-yield` | IEnumerator 无 yield | warning | 未完成的协程实现 |
| `getcomponent-no-null-check` | GetComponent 调用 | info | 供后续分析 null 安全 |
| `singleton-pattern` | 单例模式检测 | info | 设计模式标签 |
| `scriptableobject-config` | ScriptableObject 配置类 | info | 设计模式标签 |
| `object-pool-usage` | 对象池使用 | info | 设计模式标签 |

---

## 7. 仓库配置

| repoId | 名称 | 路径 | 版本管理 |
|--------|------|------|---------|
| `client` | Client（客户端） | `C:\Demo\client` | Plastic SCM |
| `client_2` | Client_2（新客户端） | `C:\Demo\client_2` | Plastic SCM |
| `ds` | DS（战斗服） | `C:\Demo\ds` | Plastic SCM |
| `config` | Config（配置表） | `C:\Demo\config` | Plastic SCM |
| `gameplay` | Gameplay（局外服务端） | `C:\Demo\gameplay` | Git |

---

## 8. 踩过的坑与优化经验

### 8.1 AI 判定不稳定 → 子要求拆解 + 确定性分流

**问题**：不同 LLM 模型对同一需求走查差异大。**解法**：规则拆为原子级 SR → 程序确定性判的不让 AI 判 → 加防护规则。

### 8.2 虚假 Pass → Pass 防护铁律

**问题**：搜到文件名就判 pass。**解法**：每个 SR 必须有 ≥1 条正面 evidence。

### 8.3 判定偏软 → Fail 推定规则

**问题**：全库 0 命中也不敢判 fail。**解法**：关键词 ≥3 变体全库 0 命中 + AST 无调用链 → 判 fail。

### 8.4 假 Fail → 豁免自检 / 8.5 豁免过度 → 空实现条款

**两者互制**：豁免自检（防误杀）+ 空实现条款（防过度豁免）。

### 8.6 否定式约束漏检 → grep_forbidden

**解法**：独立 checkType，搜到 = fail，搜不到 = pass，脚本自动判定。

### 8.7 AI 证据幻觉 → Evidence 程序化验证 + 修正循环

**解法**：脚本 3 级磁盘验证 → 失败项附 actual_content → LLM 修正 → 重验（最多2轮）→ 仍失败则标记 + 降级。

### 8.8 附带发现被忽视 → 违规性分级

**解法**：4 级违规性标注。

### 8.9 AST 确定性判定不足 → ast-grep 自定义规则库

**解法**：8 条 YAML 规则，全部改为 kind+regex 匹配。**踩坑**：pattern 语法对 C# Allman 风格和 += 运算符兼容性不足。

### 8.10 LLM 判定不一致 → Few-shot 校准

**解法**：3 个典型示例（pass / fail / uncertain）。

### 8.11 AI 遗忘搜索结果 → 证据预采集

**解法**：步骤 1.8 evidenceCandidates 汇总，判定时必须从列表引用。

### 8.12 LLM 不执行 SKILL.md 指令 → 脚本硬编码

**问题**：LLM 遵从度不稳定，经常跳步。**解法**：`run_review.py` 统一入口，5 子命令硬编码。

### 8.13 搜索阶段 LLM 编造行号 → SR 搜索预执行

**解法**：`run_review.py search` 脚本批量搜索，输出真实 file/line/snippet。

### 8.14 Evidence 验证失败无法修正 → 修正循环

**解法**：失败项附带 actual_content + suggested_paths，LLM 据此修正。

### 8.15 ast-grep 在 Windows 超时挂死 → shell=True 修复

**解法**：移除 shell=True，解析 .CMD 包装器找到 sg.exe 真实路径。

### 8.16 开发索引比自建图谱更准确 → 双源架构

**解法**：优先 Roslyn 编译器索引，无则降级自建。

### 8.17 开发索引 JSON 含 UTF-8 BOM → utf-8-sig 处理

**解法**：统一 encoding="utf-8-sig"。

---

## 9. 优化迭代记录

```
v0 (04-30)      初始版本：LLM 端到端判定
v0.5 (05-06)    基础增强：AST 扫描 + 映射缓存 + Evidence 验证
v1.0 (05-08)    阶段0 工具链修复
v1.1 (05-08)    阶段1 判定结构化：SR 拆解 + checkType + 防护规则
v1.2 (05-08~09) 阶段1 热补：豁免自检 + 空实现条款
v1.3 (05-09)    阶段1.5 热补：grep_forbidden + 附带发现分级
v2.0 (05-09)    阶段2：ast-grep 5条规则 + Few-shot + 证据预采集
v2.1 (05-11)    阶段2 热补：ast-grep 规则修正（pattern→kind+regex）
v3.0 (05-12~13) 阶段3：run_review.py 脚本驱动 + 8条规则 + 新鲜度 + 图谱 + 校验 + 反馈
v3.1 (05-13)    阶段3 增强：SR搜索预执行 + Evidence修正循环 + 开发索引优先
```

---

## 10. 当前状态与后续路线图

### 当前状态：v3.1

已实现的能力：

- ✅ 契约提取 + SR 子要求拆解
- ✅ 5 种 checkType 路由（含 `grep_forbidden`）
- ✅ 3 层判定防护规则
- ✅ Evidence 程序化验证 + 修正循环（含 2 轮后兜底规则）
- ✅ 映射缓存
- ✅ 附带发现违规性分级
- ✅ ast-grep 自定义规则库（8 条 YAML 规则）
- ✅ Few-shot 校准
- ✅ 证据预采集
- ✅ `run_review.py` 统一脚本入口（5 个子命令）
- ✅ 依赖图谱双源架构（开发索引 + 自建降级）
- ✅ 新鲜度检测
- ✅ 反馈机制框架
- ✅ SR 搜索预执行
- ⚠️ LLM 遵从度仍不稳定（search / verify-evidence 在最新报告中未被执行）

### 待实现清单

| 优先级 | 项目 | 说明 |
|--------|------|------|
| **高** | 补全 results.json Schema（TKT-20260514-001） | 确保 AI 下游任务的唯一数据源完整 |
| **高** | LLM 遵从度提升 | search / verify-evidence 脚本已就绪但 Agent 不执行 |
| 中 | 增量走查 | 只重查变更文件相关契约 |
| 中 | 契约提取脚本化 | 避免 PowerShell Unicode 损坏 |
| 低 | 报告对比/回归工具 | 同模块两次走查差异对比 |
| 低 | 脚本单元测试 | 9 个 Python 脚本无测试覆盖 |

---

## 11. 适用场景与局限性

### 适合

- 有明确需求文档的项目
- 代码可被文本搜索的项目
- 需要高频回归核查的场景
- 多仓库交叉验证

### 不适合 / 有局限

| 场景 | 原因 |
|------|------|
| 纯运行时行为验证 | 代码走查无法覆盖 |
| 无需求文档或需求极度模糊 | 无法提取有效契约 |
| 高度动态的配置表/数据驱动逻辑 | 代码中看不到最终行为 |
| 第三方 SDK / 加密代码 | 无法搜索和阅读 |

---

## 12. 使用方式

### 基本用法

```
走查 @d:\Downloads\需求文档.docx
```

### 高级用法

| 指令 | 效果 |
|------|------|
| `走查 @文档.docx` | 使用已有契约 + 缓存（最快） |
| `走查 @文档.docx 重新搜索代码` | 保留契约，全量重新搜索 |
| `走查 @文档.docx 重新提取契约 重新搜索代码` | 完全从头来过 |

---

## 附录：目录结构

```
f:\SuperAI\ai-test-platform\
├── docs\
│   └── ai-code-review-0514-0030.md  ← 本文档
├── data\
│   ├── quality-contracts.json       ← 契约库
│   ├── contract-review-results.json ← 走查结果（AI 数据源）
│   ├── module-file-mapping.json     ← 映射缓存
│   ├── ast-grep-latest.json         ← AST 扫描结果
│   ├── cache\                       ← 依赖图谱缓存
│   ├── feedback\                    ← 反馈数据
│   └── quality-reports\             ← 走查报告（人读）
└── ...

f:\SuperAI\.cursor\skills\quality-contract-review\
├── SKILL.md                         ← 走查流程定义
├── extract-contracts.md             ← 契约提取规则
├── report-template.md               ← 报告模板
├── result-schema.md                 ← 结果 Schema
└── scripts\
    ├── run_review.py                ← 统一入口（5 子命令）
    ├── ast_grep_scan.py
    ├── verify_evidence.py
    ├── build_dep_graph.py
    ├── freshness_check.py
    ├── feedback_stats.py
    ├── validate_report.py
    ├── update_mapping.py
    ├── repo_config.py
    └── ast-rules\                   ← 8 条 YAML 规则
```

# AI 代码走查系统

> 隶属于 **AI 测试平台（ai-test-platform）** 的首个工作流模块。
> 文档维护人：梁 | 最后更新：2026-05-13

---

## 1. 系统定位

**一句话说明**：从需求文档自动提取「质量契约」，然后在代码仓库中搜索证据并判定每条契约的实现状态（pass / fail / uncertain），最终输出结构化报告。

**解决的核心问题**：

| 痛点 | 传统做法 | 本方案 |
|------|---------|--------|
| 需求写完后，要人工逐条核对代码是否实现 | 测试/开发手动 review，耗时且容易遗漏 | AI 自动从需求文档提取检查项，逐条在代码中搜证据并判定 |
| 不同人对同一条需求的判定结论不同 | 依赖个人经验和理解 | 结构化判定规则 + 防护机制，减少主观波动 |
| 代码频繁变更，回归核查成本高 | 每次都要重新人工对照 | 一条指令重跑走查，几分钟出报告 |

**目标**：高频、稳定、低成本地自动化执行代码走查，输出可审计的结构化报告。

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
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 0: run_review.py init  [脚本强制]    │                            │
│   │  → 新鲜度检测 → 依赖图谱 → 反馈加载         │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 1: 契约提取 [LLM]                     │                            │
│   │  → 提取质量契约 + SR 子要求拆解               │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 1.5: run_review.py scan  [脚本强制]  │                            │
│   │  → ast-grep 结构化扫描（8条自定义规则）       │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 1.7: run_review.py search [脚本强制] │  ← 🆕 v3.1                │
│   │  → SR 关键词预搜索 → 自动判定确定性 SR       │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 2: 代码走查 [LLM]                     │                            │
│   │  → 搜索 → 阅读 → 判定（仅 pending_llm SR）  │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Step 3.5: run_review.py verify-evidence    │  ← 🆕 v3.1                │
│   │  → Evidence 校验 + 修正循环（最多2轮）       │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 3: 报告生成 [LLM]                     │                            │
│   │  → 结构化 Markdown 报告                       │                            │
│   └─────────────┬───────────────────────────────┘                            │
│                 ▼                                                             │
│   ┌─────────────────────────────────────────────┐                            │
│   │  Phase 3 末尾: run_review.py validate       │                            │
│   │  → 报告完整性校验                             │                            │
│   └─────────────────────────────────────────────┘                            │
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
| 1 | `grep_existence` | 某功能/方法是否存在 | 程序自动：Grep 搜关键词 | "拖拽安装功能" → 搜 `DragPart` |
| 2 | `grep_forbidden` | 需求明确禁止的东西 | **脚本自动判定**：搜到 = fail | "不做弹簧平滑" → 搜 `SmoothDamp` |
| 3 | `ast_pattern` | 代码结构模式匹配 | 程序自动：ast-grep 自定义 YAML 规则 | "事件 += 有没有对应 -="、"空方法体" |
| 4 | `llm_semantic` | 需要理解代码含义才能判定 | AI 判定（受防护规则约束） | "拖拽失败后回退逻辑是否正确" |
| 5 | `runtime_only` | 纯运行时行为，代码看不出来 | **脚本自动判定**：直接标 uncertain | "动画播放是否流畅" |

> 🆕 v3.1 变化：`grep_forbidden` 和 `runtime_only` 由 `run_review.py search` 脚本自动判定，完全不经 LLM。

### 3.4 判定防护规则体系

| 层级 | 规则名 | 通俗解释 | 防止什么 |
|------|--------|---------|---------|
| 1 | Pass 防护铁律 | 想判「通过」？先证明每个子要求都有实打实的代码证据 | 防止「搜到文件名就判通过」的虚高 |
| 2 | Fail 推定规则 | 关键词搜遍了全库确实 0 结果 → 功能确实没做 → 判不通过 | 让真正缺失的功能被准确标为 fail |
| 2.1 | 强制豁免自检 | 判 fail 前先想想：是不是换了个名字实现了？ | 防止「搜不到关键词就判不通过」的误杀 |
| 2.2 | 空实现条款 | 找到了方法但里面是空的 → 没做就是没做，不能豁免 | 防止空壳方法被当作「已实现」 |
| 3 | 否决铁律 | 代码里发现了和需求矛盾的证据 → 绝不能判通过 | 防止有矛盾证据还硬判 pass |

**强制豁免自检的 3 种检查详解**：

| # | 检查场景 | 怎么检查 | 真实案例 |
|---|---------|---------|---------|
| A | **通用机制实现** | 功能是否通过已有的通用系统间接完成了？ | 需求写「拖拽失败后组件回退」，代码里没有 `ReturnToBag()`，但 `OnDrop` 通用逻辑里有 `transform.position = HitHolder.position` |
| B | **回调/事件模式** | 功能是否通过回调参数、事件派发实现？ | 需求写「点击任意位置关闭」，没有 `anyClick()` 方法，但通过 `AssistantPanelData(outSideAction=FinishAction)` 回调实现 |
| C | **配置驱动** | 功能是否通过 Unity Prefab、Animator 实现，而非 .cs 代码？ | 需求写「按钮高亮」，.cs 里没设置高亮色，但 Prefab Button 组件已配置 `m_HighlightedColor` |

### 3.5 附带发现与违规性分级

| 违规性 | 含义 | 后续动作 |
|--------|------|---------|
| **违规** | 与需求文档中的某条明确约束矛盾 | 升级为新契约或补充 SR → fail |
| **潜在违规** | 看起来不对但没有直接矛盾的需求条款 | 需与策划/开发确认 |
| **建议改进** | 代码质量/健壮性问题，不违反任何需求 | 值得修复但不阻塞 |
| **待确认** | 需运行时验证才能判定 | 下次测试时关注 |

### 3.6 Evidence 程序化验证 + 修正循环 🆕

**为什么需要这个**：AI 有时会"幻觉"——编造不存在的文件路径或行号作为证据。最新报告中 Evidence 失败率高达 31-47%。

**做法**（v3.1 改进）：

```
走查完成后
  │
  ▼
run_review.py verify-evidence --run-date YYYY-MM-DD
  │
  ├─ 3 级磁盘验证（文件存在 → 行号有效 → 方法名匹配）
  ├─ 失败项附带 actual_content（该行号的真实代码内容）     ← 🆕
  ├─ 文件找不到时附带 suggested_paths（候选路径）          ← 🆕
  │
  ▼
corrections 非空？
  ├─ 是 → LLM 根据 actual_content 修正 evidence → 重新验证（最多2轮）  ← 🆕
  └─ 否 → 验证通过，继续生成报告
```

> 从「事后标记错误」升级为「当场修正错误」。

---

## 4. 脚本驱动架构 🆕

### 4.1 run_review.py 统一入口

> **设计原因**：之前所有步骤写在 SKILL.md 规则文件中让 LLM 执行，但 LLM 遵从度不稳定——有时不执行 ast-grep 扫描、不跑 Evidence 验证。改为 Python 脚本硬编码，LLM 只需调用一条命令。

| 子命令 | 阶段 | 做什么 | 输入 | 输出 |
|--------|------|--------|------|------|
| `init` | Phase 0 | 新鲜度检测 + 依赖图谱 + 反馈加载 | `--scan-dir` | 新鲜度/图谱路径/修正示例 |
| `scan` | Phase 1.5 | ast-grep 结构化扫描（8条规则） | `--scan-dir` `--classes` | AST 扫描结果 JSON |
| `search` 🆕 | Phase 1.7 | SR 关键词预搜索 + 确定性自动判定 | `--scan-dirs` `--contracts` | auto_judged + pending_llm |
| `verify-evidence` 🆕 | Step 3.5 | Evidence 校验 + 修正信息 | `--run-date` | corrections + actual_content |
| `validate` | Phase 3 末尾 | 报告完整性校验 | `--report` | 缺失区段/警告列表 |

### 4.2 依赖图谱双源架构 🆕

```
run_review.py init --scan-dir <目录>
  │
  ├─ 探测开发索引文件（Roslyn 生成，精度高）
  │   ├─ dependency-graph-cache.json    → 类间依赖关系
  │   └─ script-structure-index.json    → 文件结构索引
  │
  ├─ 有开发索引？
  │   ├─ 是 → 加载开发索引（~150ms）              ← 新项目走这条
  │   └─ 否 → 降级自建 build_dep_graph.py（正则）  ← 老项目走这条
```

| 项目类型 | 依赖图谱来源 | 精度 | 速度 |
|---------|------------|------|------|
| 新项目（有开发工具） | Roslyn 编译器生成 | 高（含继承/接口/泛型） | ~150ms |
| 老项目（无开发工具） | `build_dep_graph.py` 正则自建 | 低（仅正则匹配） | ~2s |

### 4.3 SR 搜索预执行 🆕

```
run_review.py search --scan-dirs "C:\Demo\client_2\Assets\Voxel Play\AlienStar"
  │
  ├─ 一次加载所有 .cs 文件到内存索引（最多 500 个）
  ├─ 对每条 SR 的 keywords 批量搜索（所有 SR 共享索引，避免重复 I/O）
  │
  ├─ grep_forbidden → 自动判定（搜到=fail / 没搜到=pass）
  ├─ runtime_only   → 自动判定（直接 uncertain）
  ├─ grep_existence → 输出 evidence_candidates（真实 file/line/snippet）
  ├─ llm_semantic   → 输出 evidence_candidates（辅助 LLM）
  │
  ▼
LLM 只处理 pending_llm 中的 SR，且引用脚本提供的真实行号
```

**实测数据**（alienstar 项目 29 文件、109 SR）：
- 索引 546ms + 搜索 1.4s = **总共 2 秒**
- 2 条 grep_forbidden 自动判定（100% 确定性）
- 15 条有命中（附带真实 file/line/snippet）
- 62 条 llm_semantic（需 LLM 全流程判定）

### 4.4 全部脚本清单

| 脚本 | 功能 | 调用方式 | 备注 |
|------|------|---------|------|
| `run_review.py` | 统一入口，5 个子命令 | Agent 直接调用 | 🆕 v3.0 新建 |
| `freshness_check.py` | mtime+size 新鲜度检测 | init 内部调用 | 检测代码变更 |
| `build_dep_graph.py` | 正则依赖图谱自建 | init 内部调用（降级路径） | 老项目用 |
| `feedback_stats.py` | 历史反馈统计 + few-shot 修正 | init 内部调用 | 反馈闭环 |
| `ast_grep_scan.py` | ast-grep 结构化扫描 | scan 内部调用 | 8 条自定义规则 |
| `verify_evidence.py` | Evidence 3 级磁盘验证 | verify-evidence 内部调用 | 反幻觉核心 |
| `validate_report.py` | 报告完整性校验 | validate 内部调用 | 检查必要区段 |
| `update_mapping.py` | 映射缓存更新 | Phase 2 结束后 Agent 调用 | 越用越准 |
| `repo_config.py` | 仓库路径统一管理 | 被所有脚本 import | 5 个仓库配置 |

---

## 5. ast-grep 自定义规则库

### 8 条规则总览

| 规则 ID | 检测内容 | 严重级 | 走查用途 |
|---------|---------|--------|---------|
| `empty-method-body` | 空方法体 | warning | 直接支撑「空实现条款」判定 |
| `event-subscribe-unpaired` | 事件 += 订阅点 | info | 配合 unsubscribe 做配对分析 |
| `event-unsubscribe` | 事件 -= 取消点 | info | 与订阅配对，未配对 = 潜在内存泄漏 |
| `coroutine-no-yield` | IEnumerator 无 yield | warning | 未完成的协程实现 |
| `getcomponent-no-null-check` | GetComponent 调用 | info | 供后续分析 null 安全 |
| `singleton-pattern` 🆕 | 单例模式检测 | info | 设计模式标签 |
| `scriptableobject-config` 🆕 | ScriptableObject 配置类 | info | 设计模式标签 |
| `object-pool-usage` 🆕 | 对象池使用 | info | 设计模式标签 |

**踩坑经验**：初版规则使用 `pattern:` 语法，在实测中发现 ast-grep 的 C# pattern 解析对 Allman 大括号风格和 `+=/-=` 运算符支持不佳。修正方案：全部改为 `kind:` + `regex:` 结构化匹配。

**Windows 超时问题**：`ast_grep_scan.py` 使用 `subprocess.run(shell=True)` 调用 `sg.exe`，Windows 上 `timeout` 参数只能杀死 `cmd.exe` 而非实际的 `sg.exe` 子进程，导致进程挂死。修正：移除 `shell=True`，直接解析 `.CMD` 包装器找到 `sg.exe` 真实路径。

---

## 6. 仓库配置

| repoId | 名称 | 路径 | 版本管理 |
|--------|------|------|---------|
| `client` | Client（客户端） | `C:\Demo\client` | Plastic SCM |
| `client_2` | Client_2（新客户端） | `C:\Demo\client_2` | Plastic SCM |
| `ds` | DS（战斗服） | `C:\Demo\ds` | Plastic SCM |
| `config` | Config（配置表） | `C:\Demo\config` | Plastic SCM |
| `gameplay` | Gameplay（局外服务端） | `C:\Demo\gameplay` | Git |

---

## 7. 踩过的坑与优化经验

### 7.1 ~ 7.11（同前，略）

> 详见上一版文档 6.1 ~ 6.11 节。

### 7.12 LLM 不执行 SKILL.md 指令 → 脚本硬编码 🆕

**问题**：Stage 3 的多个优化（新鲜度检测、依赖图谱、报告校验等）写在 SKILL.md 中，但走查 Agent 经常不执行。报告中无新鲜度检测记录、无依赖图谱、无报告校验。

**根因**：LLM 对长指令文件的遵从度不稳定，尤其是多步骤串联时容易跳步。

**解法**：创建 `run_review.py` 统一入口脚本，将所有确定性步骤硬编码。Agent 只需调用一条命令，脚本内部自动串联所有子步骤。

### 7.13 Evidence 验证失败后无法修正 → 修正循环 🆕

**问题**：`verify_evidence.py` 标记 evidence 为 `verified: false`，但不告诉 LLM 那一行实际内容是什么，LLM 无法自我修正。

**解法**：`run_review.py verify-evidence` 为每条失败 evidence 附带 `actual_content`（该行号 ±3 行的真实代码）和 `suggested_paths`（文件找不到时的候选路径），LLM 据此修正后重新验证。

### 7.14 搜索阶段 LLM 编造行号 → SR 搜索预执行 🆕

**问题**：LLM 在搜索阶段自行调用 Grep 时，有时记错或编造搜索结果的文件路径/行号，导致后续判定基于错误证据。

**解法**：`run_review.py search` 在 LLM 判定前，用 Python 脚本对所有 SR 关键词执行真实搜索，输出结构化 `evidence_candidates`（真实 file/line/snippet）。LLM 从中选取而非自行搜索，减少编造。

### 7.15 ast-grep 在 Windows 上超时挂死 → shell=True 修复 🆕

**问题**：`ast_grep_scan.py` 用 `subprocess.run(shell=True)` 调用 `sg.exe`，超时时 `timeout` 参数只杀 `cmd.exe` 不杀 `sg.exe`，导致进程挂死一小时以上。

**解法**：移除 `shell=True`，增加 `_resolve_sg_cmd()` 函数检测 npm 安装的 `.CMD` 包装器，解析出 `sg.exe` 真实路径后直接 `subprocess.run`。

### 7.16 开发索引比自建图谱更准确 → 双源架构 🆕

**问题**：`build_dep_graph.py` 基于正则匹配，精度低（很多 0 边图谱，基本没用上）。

**解法**：优先使用开发团队通过 Roslyn 编译器生成的 `dependency-graph-cache.json` 和 `script-structure-index.json`。新项目有这两个文件时直接加载（~150ms），老项目无文件时降级为自建。

### 7.17 开发索引 JSON 含 UTF-8 BOM → utf-8-sig 处理 🆕

**问题**：开发工具生成的 JSON 文件含 UTF-8 BOM，Python `json.load(encoding="utf-8")` 静默失败。

**解法**：统一使用 `encoding="utf-8-sig"` 打开开发提供的 JSON 文件。

---

## 8. 优化迭代记录

### 迭代时间线

```
v0 (04-30)     初始版本：LLM 端到端判定
    │
v0.5 (05-06)   基础增强：AST 扫描 + 映射缓存 + Evidence 验证
    │
v1.0 (05-08)   阶段0 工具链修复
    │
v1.1 (05-08)   阶段1 判定结构化：SR 拆解 + checkType + 防护规则
    │
v1.2 (05-08~09) 阶段1 热补：豁免自检 + 空实现条款
    │
v1.3 (05-09)   阶段1.5 热补：grep_forbidden + 附带发现分级
    │
v2.0 (05-09)   阶段2：ast-grep 5条规则 + Few-shot + 证据预采集
    │
v2.1 (05-11)   阶段2 热补：ast-grep 规则修正（pattern→kind+regex）
    │
v3.0 (05-12~13) 阶段3：run_review.py 脚本驱动 + 8条ast-grep规则      ← 🆕
    │            + 新鲜度检测 + 依赖图谱 + 报告校验 + 反馈机制
    │
v3.1 (05-13)   阶段3 增强：SR搜索预执行 + Evidence修正循环            ← 🆕
    │            + 开发索引优先 + shell=True超时修复
    │
🔜 v4.0        待定
```

### 详细变更记录

#### 阶段 0 ~ 2（略，同前版文档）

#### 阶段 3 — 脚本驱动 + 基础设施（2026-05-12 ~ 05-13）🆕

> **目标**：解决 LLM 遵从度问题——将所有确定性步骤从 SKILL.md 规则迁移到 Python 脚本硬编码。

| # | 改动项 | 内容 | 解决的问题 |
|---|--------|------|-----------|
| 3-A | `run_review.py` 统一入口 | 5 个子命令：init / scan / search / verify-evidence / validate | LLM 不执行 SKILL.md 中的脚本调用指令 |
| 3-B | 新鲜度检测 `freshness_check.py` | mtime+size 对比 manifest 缓存，检测代码变更 | 走查前不知道代码是否有变化 |
| 3-C | 依赖图谱 `build_dep_graph.py` | 正则扫描 .cs 提取类定义/继承/调用/设计模式 | 纯 Grep 搜索缺乏代码结构信息 |
| 3-D | 反馈机制 `feedback_stats.py` | 加载历史 disagree 反馈，生成 few-shot 修正示例 | 误判无持续纠偏机制 |
| 3-E | 报告校验 `validate_report.py` | 检查报告必要区段是否齐全 | LLM 生成的报告缺少必要区段 |
| 3-F | ast-grep 规则扩展 | 新增 3 条设计模式规则（8 条总计） | 设计模式标签缺失 |
| 3-G | ast-grep shell=True 修复 | 移除 shell=True + 解析 .CMD 包装器 | sg.exe 在 Windows 上超时挂死 |

#### 阶段 3 增强 — SR 预搜索 + Evidence 修正（2026-05-13）🆕

> **目标**：解决 Evidence 准确率低的核心痛点（31-47% 失败率）。

| # | 改动项 | 内容 | 解决的问题 |
|---|--------|------|-----------|
| 3.1-A | SR 搜索预执行 `search` | 脚本批量搜索所有 SR 关键词，提供真实 file/line/snippet | LLM 搜索时编造行号 |
| 3.1-B | Evidence 修正循环 `verify-evidence` | 失败项附带 actual_content，LLM 据此修正 | 验证失败后无法修正 |
| 3.1-C | 开发索引优先 | 检测 Roslyn 生成的索引文件并优先加载 | 自建图谱精度低 |
| 3.1-D | UTF-8 BOM 处理 | 开发索引文件使用 utf-8-sig 编码 | JSON 加载静默失败 |

---

## 9. 已产出的走查报告

| 报告文件 | 日期 | 模块 | 阶段 | 备注 |
|----------|------|------|------|------|
| `2026-04-30-新手引导.md` | 04-30 | 新手引导 | v0 初始版本 | 首次走查 |
| `2026-05-07-1456-新手引导.md` | 05-07 | 新手引导 | v0.5 | Sonnet 4.6 模型 |
| `2026-05-07-1520-新手引导.md` | 05-07 | 新手引导 | v0.5 | Opus 4.7 模型（质量对比基准） |
| `2026-05-08-1733-新手引导.md` | 05-08 | 新手引导 | v1.2 | 豁免自检验证 |
| `2026-05-08-2001-alienstar-exp-slice-1.md` | 05-08 | AlienStar | v1.2 | 跨项目验证 |
| `2026-05-09-2010-新手引导.md` | 05-09 | 新手引导 | v2.0 | ast-grep + Few-shot |
| `2026-05-11-1548-新手引导.md` | 05-11 | 新手引导 | v2.1 | ast-grep 规则修正验证 |
| `2026-05-12-1118-新手引导.md` | 05-12 | 新手引导 | v3.0 | 脚本驱动首次验证 |
| `2026-05-13-1946-alienstar-exp-slice-1.md` | 05-13 | AlienStar | v3.0 | 开发索引+脚本驱动 |
| `2026-05-13-2300-新手引导.md` | 05-13 | 新手引导 | v3.1 | 最新（search 未生效） |
| `2026-05-13-2310-alienstar-exp-slice-1.md` | 05-13 | AlienStar | v3.1 | 最新（search 未生效） |

---

## 10. 当前状态与后续路线图

### 当前状态：v3.1（阶段 3 完成 + SR 预搜索 + Evidence 修正）

已实现的能力：

- ✅ 契约提取 + SR 子要求拆解
- ✅ 5 种 checkType 路由（含 `grep_forbidden`）
- ✅ 3 层判定防护规则
- ✅ Evidence 程序化验证 **+ 修正循环** 🆕
- ✅ v2 映射缓存
- ✅ 附带发现违规性分级
- ✅ ast-grep 自定义规则库（**8 条** YAML 规则）🆕
- ✅ Few-shot 校准
- ✅ 证据预采集
- ✅ `run_review.py` 统一脚本入口（**5 个子命令**）🆕
- ✅ 依赖图谱双源架构（开发索引 + 自建降级）🆕
- ✅ 新鲜度检测 🆕
- ✅ 反馈机制框架 🆕
- ✅ SR 搜索预执行（`search` 子命令）🆕
- ⚠️ LLM 遵从度仍不稳定（search / verify-evidence 在最新报告中未被执行）

### 待实现清单

| 优先级 | 项目 | 说明 |
|--------|------|------|
| **高** | LLM 遵从度提升 | search / verify-evidence 脚本已就绪但 Agent 不执行；需考虑入口脚本化或走查指令中显式提醒 |
| 中 | api_test / ui_test 支持 | 当前仅 code_review |
| 中 | 跨仓库依赖追踪 | 契约涉及多仓库时需手动切换 |
| 中 | 增量走查 | 只重查变更文件相关契约 |
| 中 | 契约提取脚本化 | 避免 PowerShell Unicode 损坏 |
| 低 | 报告对比/回归工具 | 同模块两次走查差异对比 |
| 低 | 脚本单元测试 | 9 个 Python 脚本无测试覆盖 |
| 低 | VCS 自动更新 | Plastic SCM 适配层 |

---

## 11. 适用场景与局限性

### 适合

- 有明确需求文档的项目（详设、PRD、功能说明书）
- 代码可被文本搜索的项目（非混淆/非二进制）
- 需要高频回归核查的场景
- 有多个代码仓库需要交叉验证的项目

### 不适合 / 有局限

| 场景 | 原因 |
|------|------|
| 纯运行时行为验证（"动画是否流畅"） | 代码走查无法覆盖，标为 uncertain |
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

### 强制脚本步骤（遵从度不稳定时手动提醒）

```
走查 @文档.docx 重新提取契约 重新搜索代码
注意：走查前必须执行 run_review.py init、
契约提取后执行 run_review.py search、
判定后执行 run_review.py verify-evidence、
报告写完执行 run_review.py validate
```

---

## 附录：目录结构

```
f:\SuperAI\ai-test-platform\
├── docs\
│   └── ai-code-review-0513-2330.md  ← 本文档
├── data\
│   ├── quality-contracts.json       ← 契约库
│   ├── contract-review-results.json ← 走查结果
│   ├── module-file-mapping.json     ← 映射缓存
│   ├── ast-grep-latest.json         ← AST 扫描结果
│   ├── cache\                       ← 依赖图谱缓存 🆕
│   ├── feedback\                    ← 反馈数据 🆕
│   │   ├── feedback-schema.json
│   │   └── feedbacks.json
│   └── quality-reports\             ← 走查报告
│       ├── 2026-05-13-2310-alienstar-exp-slice-1.md
│       └── ...
└── ...

f:\SuperAI\.cursor\skills\quality-contract-review\
├── SKILL.md                         ← 走查流程完整定义
├── extract-contracts.md             ← 契约提取规则
├── report-template.md               ← 报告模板
├── result-schema.md                 ← 结果 Schema
├── unity-assets-search.md           ← Unity 资产搜索规则
└── scripts\
    ├── run_review.py                ← 🆕 统一入口（5 子命令）
    ├── ast_grep_scan.py             ← AST 扫描
    ├── verify_evidence.py           ← Evidence 验证
    ├── build_dep_graph.py           ← 🆕 依赖图谱自建
    ├── freshness_check.py           ← 🆕 新鲜度检测
    ├── feedback_stats.py            ← 🆕 反馈统计
    ├── validate_report.py           ← 🆕 报告校验
    ├── update_mapping.py            ← 映射缓存更新
    ├── repo_config.py               ← 仓库配置
    └── ast-rules\                   ← ast-grep 自定义 YAML 规则（8 条）
        ├── empty-method-body.yaml
        ├── event-subscribe-unpaired.yaml
        ├── event-unsubscribe.yaml
        ├── coroutine-no-yield.yaml
        ├── getcomponent-no-null-check.yaml
        ├── singleton-pattern.yaml         ← 🆕
        ├── scriptableobject-config.yaml   ← 🆕
        └── object-pool-usage.yaml         ← 🆕
```

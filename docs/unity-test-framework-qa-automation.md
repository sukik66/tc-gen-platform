# Unity Test Framework 自动化测试说明与扩展规划

> 面向 Unity 项目的自动化测试能力说明。
> 重点说明 Unity Test Framework 在 EditMode / PlayMode 下分别能覆盖什么测试，以及如何与当前本地 QA 自动化工具逐步融合。

---

## 1. 文档目的

本文用于说明 Unity Test Framework 在游戏项目中的测试定位、可覆盖范围、适用边界与后续扩展方向。

当前 `client_2` 项目已经建立了一个本地隔离的 QA 自动化雏形：

```text
Assets/_LocalOnly/QAAutomation/
Tools/QAAutomation/
TestResults/
Logs/
```

其中包含两类能力：

| 能力 | 当前状态 | 说明 |
|------|----------|------|
| Unity Test Framework 测试骨架 | 已建立 | 包含 EditMode / PlayMode 测试程序集 |
| 自定义 Editor QA Validator | 已跑通 | 通过 Unity batchmode + `-executeMethod` 执行确定性资源检查 |

当前已验证可执行的入口是：

```powershell
powershell -ExecutionPolicy Bypass -File C:\Demo\client_2\Tools\QAAutomation\Run-EditModeTests.ps1
```

该入口当前能生成：

```text
C:\Demo\client_2\TestResults\EditMode.xml
```

并能通过退出码表达结果：

```text
0 = 全部通过
1 = 检测到 QA 问题
2 = 执行异常或结果文件未生成
```

---

## 2. Unity Test Framework 是什么

Unity Test Framework 是 Unity 官方测试框架，用于在 Unity 项目内编写和执行自动化测试。

它基于 NUnit，并额外提供 Unity 相关能力，例如：

- 在 Unity Editor 中运行测试
- 在 Play 模式中运行测试
- 支持协程测试（`UnityTest`）
- 访问 Unity API、场景、GameObject、Prefab、AssetDatabase
- 通过命令行或 Test Runner 窗口执行测试

它和 Python 里的 `pytest` / `unittest` 类似，都是测试框架，但运行环境不同：

| 维度 | pytest / unittest | Unity Test Framework |
|------|-------------------|----------------------|
| 运行环境 | Python 进程 | Unity Editor / Unity Player |
| 测试对象 | Python 函数、类、模块 | C# 代码、Unity 资源、场景、GameObject、运行时流程 |
| 常见断言 | `assert`、`self.assertEqual` | `Assert.AreEqual`、`Assert.IsTrue`、`UnityTest` |
| 是否能访问 Unity Editor API | 否 | EditMode 可以 |
| 是否能测试游戏运行流程 | 需要额外工具 | PlayMode 原生支持 |

---

## 3. EditMode 测试可以覆盖什么

EditMode 测试运行在 Unity Editor 环境下，不进入真正的游戏运行状态。

它适合做快速、稳定、确定性的编辑器层检查。

### 3.1 资源完整性检查

适合检查：

- AssetDatabase 中登记的资源路径是否真实存在
- Prefab 是否能正常加载
- Prefab 是否存在 Missing Script
- 材质、贴图、动画、音效等资源是否缺失
- `.meta` 是否异常
- 资源命名、目录结构是否符合规范

示例：

```text
检查所有 Prefab 是否存在 Missing Script
检查所有启用场景文件是否真实存在
检查资源路径是否还有效
```

### 3.2 Build Settings 检查

Build Settings 中的 `Scenes In Build` 是最终构建会包含的场景列表，并且有顺序。

EditMode 可以通过 `EditorBuildSettings.scenes` 检查：

- 启用场景文件是否存在
- 第一个启用场景是否符合项目约定
- 测试场景、临时场景、Debug 场景是否误加入构建
- 场景顺序是否符合发布要求

示例规则：

```text
第 0 个启用场景必须是主入口场景
Build Settings 中不得包含 Test / Debug / Temp 场景
所有启用场景必须存在于磁盘
```

### 3.3 Prefab / GameObject 结构检查

EditMode 可以加载 Prefab，并检查其内部 GameObject 与组件结构。

适合检查：

- 是否存在 Missing Script
- 是否存在 Missing Material / Missing Reference
- 必要组件是否存在
- UI Prefab 是否包含 Canvas / RectTransform / 指定脚本
- 特效 Prefab 是否包含粒子系统、生命周期脚本等
- 发布包中是否误带 Debug / GM / Cheat 对象

Debug 对象可通过以下规则识别：

| 规则类型 | 示例 |
|----------|------|
| 名称关键词 | `Debug`、`Test`、`GM`、`Cheat`、`Dev` |
| Tag | `DebugOnly`、`TestOnly`、`ReleaseForbidden`、`EditorOnly` |
| 组件脚本 | `DebugConsole`、`GMPanel`、`CheatManager`、`FpsCounter` |
| 资源路径 | `Assets/Dev/`、`Assets/Debug/`、`Assets/Test/`、`Assets/_Temp/` |

### 3.4 配置资产检查

很多 Unity 项目会把配置放在：

```text
ScriptableObject
JSON
CSV
Excel 导出文件
Addressables 配置
自定义 .asset 文件
```

EditMode 适合检查：

- 配置是否能被加载
- 必填字段是否为空
- ID 是否重复
- 资源引用是否断裂
- 表数据是否符合范围约束
- 本地化 key 是否缺失

### 3.5 Editor 工具自测

如果项目内有自定义 Editor 工具，例如资源扫描器、打包工具、配置生成器，也可以用 EditMode 测试：

- 工具入口是否能执行
- 输出文件是否生成
- 异常输入是否有明确报错
- 生成内容是否符合格式

---

## 4. PlayMode 测试可以覆盖什么

PlayMode 测试会进入 Unity 的运行状态，更接近真实游戏运行。

它适合验证运行时行为、场景加载、对象生成、流程冒烟。

### 4.1 场景加载冒烟测试

可以检查：

- 主入口场景是否能加载
- 战斗场景是否能加载
- 场景加载后是否有必要对象
- 是否存在运行时 Error / Exception

示例：

```text
加载主场景后，必须存在 UI Root
加载战斗场景后，必须生成 Camera
进入战斗后，必须存在 BattleManager
```

### 4.2 运行时对象生成检查

有些项目的场景本身很空，例如 `RuntimeEmptyScene`。

这类场景可能只是运行时容器，真正对象由代码动态创建：

- 战斗管理器
- 摄像机
- 地图
- 玩家 / 敌人
- UI
- 特效
- 网络对象

PlayMode 可以验证这些对象是否在运行时正确生成。

### 4.3 基础流程测试

适合做低成本流程冒烟：

- 启动游戏
- 进入主界面
- 点击某个入口
- 进入战斗
- 退出战斗
- 返回主界面

这类测试不要求覆盖全部业务分支，但要保证核心流程不崩。

### 4.4 UI / 输入测试

PlayMode 可以结合 Unity UI、Input System 或自定义输入模拟做：

- 按钮是否存在
- 按钮点击后是否跳转
- 弹窗是否显示 / 关闭
- 关键 UI 文案是否出现
- 基础键鼠 / 触控 / 手柄输入是否生效

如果项目暂未接入 Input System，也可以先做非输入类运行时检查，等输入框架稳定后再扩展。

### 4.5 运行时日志检查

PlayMode 测试可以监听 Unity 日志，检查流程中是否出现：

```text
Error
Exception
Assert
MissingReferenceException
NullReferenceException
```

这类检查很适合作为每日构建或主流程冒烟的一部分。

---

## 5. EditMode 与 PlayMode 的分工建议

| 测试目标 | 推荐模式 | 原因 |
|----------|----------|------|
| 资源是否存在 | EditMode | 快，不需要进入游戏 |
| Prefab 是否 Missing Script | EditMode | 可直接扫描资产 |
| Build Settings 配置 | EditMode | Editor API 可直接读取 |
| 场景文件是否存在 | EditMode | 文件级检查即可 |
| 场景加载后对象是否生成 | PlayMode | 需要运行时验证 |
| 主界面按钮是否可点 | PlayMode | 需要 UI 和运行流程 |
| 战斗流程是否能进入 | PlayMode | 需要运行时逻辑 |
| 是否出现运行时异常 | PlayMode | 需要真实运行 |
| Editor 工具是否能执行 | EditMode | 运行在编辑器侧 |

建议原则：

```text
能在 EditMode 快速确定的问题，不放到 PlayMode。
只有必须进入运行态才能判断的问题，才放到 PlayMode。
```

这样可以减少测试耗时和不稳定性。

---

## 6. 当前本地 QA 框架与 Unity Test Framework 的关系

当前项目中已经建立了 Unity Test Framework 风格测试骨架：

```text
Assets/_LocalOnly/QAAutomation/EditMode/
Assets/_LocalOnly/QAAutomation/PlayMode/
```

同时建立了一个更直接的同步 Editor QA 入口：

```text
Assets/_LocalOnly/QAAutomation/Editor/QaCliValidator.cs
```

原因是：在 `client_2` 项目中，直接使用 Unity 原生 `-runTests` 或 TestRunner API 曾受到 batchmode 编译 / domain reload 影响，结果文件生成不稳定。

因此当前采用分层策略：

| 层级 | 当前用途 |
|------|----------|
| Unity Test Framework 测试骨架 | 保留，便于未来接入 Test Runner / 标准测试生态 |
| QaCliValidator | 当前稳定可执行的本地资源 QA 门禁 |
| PowerShell 脚本 | 启动 Unity、等待结果、解析 XML、返回退出码 |

短期内，`QaCliValidator` 负责跑确定性资源检查；中长期再逐步把稳定规则迁移或同步到 Unity Test Framework 标准测试中。

---

## 7. 当前已覆盖的检查项

当前 EditMode QA 已覆盖：

| 检查项 | 说明 |
|--------|------|
| `AllAssetDatabasePathsPointToExistingFiles` | 检查 AssetDatabase 中的 `Assets/` 路径是否真实存在 |
| `PrefabsDoNotContainMissingScripts` | 检查所有 Prefab 是否存在 Missing Script |
| `EnabledBuildScenesExistOnDisk` | 检查 Build Settings 中启用的场景文件是否存在 |
| `ProjectContainsAtLeastOneScene` | 检查项目中至少存在一个 `.unity` 场景 |

当前已检测到真实问题：

```text
Assets/_Effect/VFX/Xcl/EffPrefab/D3-1.prefab
GameObject: Effect_Battle_MissilesFly01
问题: Missing Script
```

---

## 8. 未来扩展规划

### 阶段一：完善 EditMode 资源质量门禁

优先扩展低成本、确定性的检查：

- Prefab Missing Material 检查
- Prefab Missing Reference 检查
- 场景 Missing Script 检查
- Build Settings 场景顺序检查
- Debug / GM / Cheat 对象扫描
- 资源命名规范检查
- 目录黑名单检查，例如 `Assets/Test/` 不允许进包
- `.meta` GUID 异常检查

目标：

```text
在进入构建和人工测试前，先发现明显资源问题。
```

### 阶段二：规则配置化

当前检查规则写在代码里，后续建议抽成配置文件，例如：

```json
{
  "requiredFirstScene": "Scenes/FlyingCard_NoHotFix",
  "forbiddenSceneKeywords": ["Test", "Debug", "Temp"],
  "forbiddenObjectNames": ["Debug", "GM", "Cheat"],
  "forbiddenTags": ["DebugOnly", "TestOnly", "ReleaseForbidden"],
  "forbiddenComponents": ["DebugConsole", "CheatManager", "GMPanel"]
}
```

配置化后，不同项目可以复用同一套检测器，只替换规则配置。

目标：

```text
把团队发布约定沉淀成可维护的 QA 规则。
```

### 阶段三：PlayMode 主流程冒烟

在资源门禁稳定后，再扩展 PlayMode：

- 主界面场景能否加载
- 主界面必要对象是否存在
- 战斗空场景是否能进入
- 运行时是否生成 BattleManager / Camera / UI Root
- 核心流程是否出现 Error / Exception

目标：

```text
确认游戏能跑起来，核心路径不崩。
```

### 阶段四：与每日构建 / CI 集成

将脚本接入自动任务：

```text
本地提交前
每日自动构建前
CI 构建前置检查
发布分支质量门禁
```

推荐执行顺序：

```text
EditMode 资源门禁
  ↓
PlayMode 冒烟测试
  ↓
Unity 正式构建
  ↓
构建产物验收
```

这样可以把便宜、快速、定位明确的问题提前暴露，减少构建失败和人工排查成本。

### 阶段五：报告与平台化

后续可以把 XML 结果转换成更易读的报告：

- Markdown 报告
- HTML 报告
- 失败项截图 / 资源路径
- 按严重程度分组
- 与 AI 测试平台联动
- 历史趋势统计

目标：

```text
从“脚本能跑”升级到“团队能看、能追踪、能治理”。
```

---

## 9. 建议优先级

| 优先级 | 方向 | 原因 |
|--------|------|------|
| P0 | Missing Script / Missing Reference | 直接影响运行稳定性，且容易自动检测 |
| P1 | Build Settings / 场景顺序 | 影响构建入口和发布包内容 |
| P1 | Debug 对象扫描 | 防止测试工具、作弊入口、GM 面板误入发布包 |
| P2 | 命名规范 / 目录规范 | 有治理价值，但误报风险较高 |
| P2 | PlayMode 主流程冒烟 | 价值高，但比 EditMode 更慢、更容易受环境影响 |
| P3 | 覆盖率 / 性能指标 | 适合在基础门禁稳定后再做 |

---

## 10. 总结

Unity Test Framework 可以覆盖两类测试：

```text
EditMode：偏资源、配置、Prefab、场景、Editor 工具检查
PlayMode：偏运行时、流程、UI、对象生成、异常日志检查
```

当前项目已经先跑通了一个更稳定的本地 Editor QA 入口，用于资源质量门禁。后续建议先扩展 EditMode 资源检查，再逐步补 PlayMode 主流程冒烟，最后接入每日构建和 AI 测试平台报告体系。

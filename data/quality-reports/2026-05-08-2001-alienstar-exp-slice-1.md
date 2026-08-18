# 质量契约走查报告

- 日期：2026-05-08 20:01
- 需求文档：implementation-brief-exp-slice-1.md
- 走查引擎：Cursor Agent
- 代码仓库：C:\Demo\client_2（AlienStar EXP-SLICE-1）

## 总览

| 指标 | 数量 |
|------|------|
| 契约总数 | 15 |
| 代码走查 (code_review) | 15 |
| 通过 (pass) | 12 |
| 违规 (fail) | 1 |
| 存疑 (uncertain) | 2 |
| 跳过 (非 code_review) | 0 |
| 调度模式 | 并行（3组：玩家原体9条 / 星球系统4条 / 跨系统2条） |
| ast-grep | 已启用（methods:0, calls:0, inheritance:0 — C# 泛规则未命中，降级为 Grep+Read） |
| Evidence 验证 | total=144, verified=108, failed=36(method_not_found), downgraded=3（含历史批次） |
| 映射缓存(v2) | modules_updated=4, +13 files, +0 deps, +27 clusters, +8 links |

### 判定分布

| 模块前缀 | 总数 | Pass | Fail | Uncertain |
|----------|------|------|------|-----------|
| 玩家原体 | 9 | 7 | 1 | 1 |
| 星球系统 | 4 | 3 | 0 | 1 |
| 跨系统 | 2 | 2 | 0 | 0 |
| **合计** | **15** | **12** | **1** | **2** |

---

## 走查详情

### 1. [玩家原体 > 状态机] — pass (92%)

**规则**：玩家原体状态机有且仅有4个状态：[存在]、[行走中]、[跳跃上升]、[下落]；状态数量和流转条件不可自行增减或修改

**边界提示**：[存在]为初始静止态；[行走中]由WASD输入触发；[跳跃上升]由空格键触发；[下落]由离开地面且非跳跃触发

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 枚举恰好4个状态值 | grep_existence | pass | 95% |
| SR-2 | 状态流转仅允许文档规定路径 | llm_semantic | pass | 90% |

**推理**：PlayerStateMachine.cs 定义 PlayerState enum 恰好包含 Idle/Walking/JumpAscending/Falling 4 个值。Evaluate 方法 switch-case 覆盖全部 4 状态，转换条件与文档完全一致。

**证据**：
- `PlayerStateMachine.cs` L3-9 `PlayerState` — enum 恰好 4 值: Idle, Walking, JumpAscending, Falling
- `PlayerStateMachine.cs` L22-70 `Evaluate` — switch 覆盖全部 4 状态，转换路径与文档一致

**附带发现**：
- [关注] `PlayerStateMachine.cs` L73 `ForceState` — 允许外部强制设置任意状态，绕过 Evaluate 状态机逻辑

---

### 2. [玩家原体 > 移动管线] — pass (85%)

**规则**：每帧结算流程中先处理水平移动再合成重力分量，二者结算顺序固定不可调换

**边界提示**：失效语义指[存在]态下输入不产生位移而非不接收输入

**判定**：pass | 置信度 85%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 水平→重力结算顺序固定 | llm_semantic | pass | 90% |
| SR-2 | [存在]状态下不产生位移 | llm_semantic | pass | 80% |

**推理**：PlayerMovementPipeline.Tick 方法中 L58 先计算 horizontalDisplacement，L63-67 再计算重力，L70 合成 totalDisplacement。Idle 状态下管线仍运行但无输入时位移为零。

**证据**：
- `PlayerMovementPipeline.cs` L44-89 `Tick` — L58 水平位移 → L63 重力 → L70 合成
- `AlienStarBootstrap.cs` L170-175 `Update` — 每帧调用 Pipeline.Tick

**缺口**：管线运行在 Update 非 FixedUpdate；Idle 态管线仍运行（但无有效位移输出）

---

### 3. [玩家原体 > 水平移动与方向] — pass (90%)

**规则**：按下WASD当帧移动，松开当帧停止，方向色块朝向同步切换

**判定**：pass | 置信度 90%

**证据**：
- `AlienStarInputAdapter.cs` L17-51 `Poll` — Input.GetKey(WASD) 当帧采集
- `PlayerMovementPipeline.cs` L49-58 `Tick` — 同帧计算位移
- `PlayerEntity.cs` L87-103 `SetFacing` — 翻转 localScale.x 实现朝向切换

---

### 4. [玩家原体 > 碰撞检测] — pass (92%)

**规则**：水平移动阻挡、垂直着地判定、天花板碰撞速度归零

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 水平碰撞阻挡 | llm_semantic | pass | 95% |
| SR-2 | 着地判定 | llm_semantic | pass | 92% |
| SR-3 | 天花板速度归零 | llm_semantic | pass | 90% |

**证据**：
- `PlayerCollisionStrategy.cs` L42-165 `Resolve` — 三轴碰撞解算完整
- `PlayerCollisionStrategy.cs` L90-94 — 天花板碰撞 verticalVelocity=0
- `VoxelCollisionService.cs` L120-185 `QueryCollision` — 面采样阻挡判定
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 5点底面着地采样

---

### 5. [玩家原体 > 跳跃规则] — pass (88%)

**规则**：空格键跳跃自然抛物线，空中控制系数小于地面

**判定**：pass | 置信度 88%

**证据**：
- `PlayerMovementPipeline.cs` L60-67 `Tick` — 跳跃初速 + 每帧重力 = 抛物线
- `PlayerMovementPipeline.cs` L53-56 `Tick` — 地面 WalkSpeed vs 空中 WalkSpeed×AirControlFactor

**缺口**：AirControlFactor 实际数值需确认 config asset 中是否 < 1.0

---

### 6. [玩家原体 > 控制响应] — ❌ fail (95%)

**规则**：跳跃键当帧起跳；崖边走出后的短窗口内按跳跃仍能生效（土狼时间）；着地前短窗口内按跳跃键着地瞬间自动跳起（预输入缓冲）

**边界提示**：土狼时间和预输入缓冲的时长为可调参数；来源 D slice-1 落地三件套 B2

**判定**：fail | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 跳跃键当帧起跳 | grep_existence | pass | 95% | GetKeyDown(Space) 同帧检测 |
| SR-2 | 土狼时间参数存在 | grep_existence | **fail** | 95% | 全库 0 命中 coyote/graceTime |
| SR-3 | 预输入缓冲参数存在 | grep_existence | **fail** | 95% | 全库 0 命中 jumpBuffer/preInput |

**汇总**：SR-2 fail + SR-3 fail → 整条 fail

**推理**：当帧起跳通过 Input.GetKeyDown 实现，正确。但土狼时间（coyoteTime）和预输入缓冲（jumpBuffer）**完全缺失**——全库搜索 coyote、graceTime、jumpBuffer、preInput、inputBuffer 均零命中。跳跃条件严格检查 IsGrounded，离地后立即进入 Falling 无宽限窗口。

**证据**：
- `AlienStarInputAdapter.cs` L27 — Input.GetKeyDown(KeyCode.Space) 当帧检测 ✓
- `PlayerMovementPipeline.cs` L60-61 — 跳跃严格检查 IsGrounded，无 coyoteTime 宽限 ✗
- `PlayerStateMachine.cs` L28-35 — Idle→Falling 仅检查 !isOnGround，无土狼延迟 ✗

---

### 7. [玩家原体 > 镜头跟随] — ⚠️ uncertain (55%)

**规则**：第三人称硬跟模式，无可感知漂浮/延迟/弹性拉扯；镜头不穿透体素几何

**边界提示**：「硬跟」指无SmoothDamp/Lerp的直接位置赋值或极小平滑量

**判定**：uncertain | 置信度 55%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 即时跟随无延迟 | llm_semantic | **uncertain** | 50% | SmoothDamp(0.15s) 与「硬跟」存疑 |
| SR-2 | 垂直跟随方块可见 | llm_semantic | pass | 90% | SmoothDamp 含垂直分量 |
| SR-3 | 镜头不穿透体素 | llm_semantic | pass | 88% | HandleObstruction 推近逻辑完整 |

**汇总**：SR-1 uncertain → 整条 uncertain

**推理**：OrbitCamera.UpdatePivot 使用 `Vector3.SmoothDamp(followSmoothTime=0.15f)`，0.15 秒平滑时间在快速移动时可能产生可感知延迟，与需求文档「硬跟/即时/无 SmoothDamp」定义矛盾。镜头避障（推近逻辑）和垂直跟随已正确实现。

**证据**：
- `OrbitCamera.cs` L90-103 `UpdatePivot` — SmoothDamp(followSmoothTime=0.15f) ⚠️
- `OrbitCamera.cs` L106-135 `HandleObstruction` — 体素遮挡推近 ✓
- `OrbitCamera.cs` L137-159 `ApplyCameraTransform` — 地面碰撞检测 ✓

**缺口**：followSmoothTime=0.15s 是否构成「可感知延迟」需运行时验证；需求文档定义「硬跟」为「无 SmoothDamp 或极小平滑量」，0.15s 是否属于「极小」有争议

---

### 8. [玩家原体 > 空间呈现] — pass (90%)

**规则**：极薄方块高约一体素单位（厚度≈0.05），脚底精确贴合体素顶面

**判定**：pass | 置信度 90%

**证据**：
- `PlayerEntity.cs` L11-13 — VISUAL_WIDTH=1, VISUAL_HEIGHT=1, VISUAL_DEPTH=0.05
- `PlayerEntity.cs` L116-139 `CreateFallbackVisualBlock` — localPosition.y = HEIGHT×0.5 脚底对齐原点
- `PlayerCollisionStrategy.cs` L131-136 `Resolve` — 着地时 allowed.y = GroundHeight - position.y 精确贴地

---

### 9. [玩家原体 > 异常兜底] — pass (90%)

**规则**：穿模排斥推回合法位置；跌出边界重置到安全位置

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 穿模排斥 | llm_semantic | pass | 92% |
| SR-2 | 坠落边界重置 | llm_semantic | pass | 90% |

**证据**：
- `PlayerCollisionStrategy.cs` L57-65 `Resolve` — 穿模检测 → EjectFromSolid 排斥
- `PlayerCollisionStrategy.cs` L68-76 `Resolve` — IsBelowFallBoundary → 重置 spawnPoint + LogError
- `PlayerCollisionStrategy.cs` L167-191 `EjectFromSolid` — 60步抬升排斥，失败回退 spawnPoint
- `PlayerCollisionStrategy.cs` L97-122 `Resolve` — 后置穿模修复 40 步，失败回退

**附带发现**：
- [关注] `PlayerCollisionStrategy.cs` L70 — 坠落边界 LogError 在高频坠落场景可能产生大量日志

---

### 10. [星球系统 > 状态机] — pass (95%)

**规则**：星球系统状态机有且仅有2个状态：[未加载]和[已加载]

**判定**：pass | 置信度 95%

**证据**：
- `PlanetManager.cs` L6-10 `PlanetState` — enum 恰好 2 值: Unloaded, Loaded
- `PlanetManager.cs` L65-77 `OnVoxelPlayInitialized` — 加载完成后 State=Loaded, OnReady 触发

---

### 11. [星球系统 > 碰撞查询服务] — ⚠️ uncertain (62%)

**规则**：对solid返回阻挡、对air返回通过；边界clamp；不可用时返回不可用信号

**判定**：uncertain | 置信度 62%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | solid/air 判定 | llm_semantic | pass | 90% | IsSolidAt 委托 VoxelPlay |
| SR-2 | 边界 clamp | llm_semantic | **uncertain** | 40% | 无显式 clamp 代码 |
| SR-3 | 不可用信号 | grep_existence | pass | 95% | IsServiceAvailable 三重检查 |

**汇总**：SR-2 uncertain → 整条 uncertain

**推理**：solid/air 判定正确委托 VoxelPlayEnvironment.CheckCollision。IsServiceAvailable 三重检查（_available + env != null + env.initialized）覆盖不可用信号。但**坐标边界 clamp 未在 VoxelCollisionService 中显式实现**，完全依赖 VoxelPlay 插件内部行为，无法从 AlienStar 代码层确认。

**缺口**：坐标边界 clamp 依赖 VoxelPlay 第三方插件内部行为，AlienStar 代码层无法审查

---

### 12. [星球系统 > 着地查询] — pass (92%)

**规则**：E系统返回正确地面高度值

**判定**：pass | 置信度 92%

**证据**：
- `VoxelCollisionService.cs` L58-115 `QueryGround` — AABB 底面 5 点采样 + RayCast 取最高地面
- `PlayerCollisionStrategy.cs` L125-136 `Resolve` — D系统消费 QueryGround 结果精确贴地

---

### 13. [星球系统 > 重力参数] — pass (95%)

**规则**：multiplier clamp [0.1, 5.0]，默认1.0，未加载返回1.0

**判定**：pass | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 可被D系统读取 | grep_existence | pass | 95% |
| SR-2 | clamp [0.1, 5.0] | grep_existence | pass | 95% |
| SR-3 | 配置缺失默认1.0 | llm_semantic | pass | 95% |
| SR-4 | 未加载返回1.0 | llm_semantic | pass | 95% |

**证据**：
- `GravityParams.cs` L5-7 — MIN_MULTIPLIER=0.1, MAX_MULTIPLIER=5.0, DEFAULT=1.0
- `GravityParams.cs` L14-25 `Initialize` — Mathf.Clamp + null fallback
- `GravityParams.cs` L12 `Multiplier` — 未初始化返回 DEFAULT

---

### 14. [跨系统 > D↔E接口方向] — pass (92%)

**规则**：碰撞查询 E→D 方向，重力参数 E维护→D只读

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 碰撞 E提供→D消费 | llm_semantic | pass | 92% |
| SR-2 | 重力 E维护→D只读 | llm_semantic | pass | 90% |

**证据**：
- `PlanetManager.cs` L18-19 — E系统持有 GravityParams 和 VoxelCollisionService
- `AlienStarBootstrap.cs` L119-127 `SpawnPlayer` — D系统通过 PlanetManager 注入碰撞服务
- `PlayerMovementPipeline.cs` L65 `Tick` — D系统仅读取 _gravityParams.Multiplier

**附带发现**：
- [关注] `GravityParams.cs` Initialize/Reset 方法为 public，D系统理论上可调用修改值——建议限制为 internal

---

### 15. [跨系统 > 碰撞不可用退化] — pass (90%)

**规则**：D系统收到「不可用」后退化为无碰撞模式继续运行

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 |
|----|------|------|------|--------|
| SR-1 | 显式不可用处理分支 | llm_semantic | pass | 92% |
| SR-2 | 退化模式不崩溃 | llm_semantic | pass | 88% |

**证据**：
- `PlayerCollisionStrategy.cs` L48-53 `Resolve` — null/!IsServiceAvailable → IsOnGround=false, return raw displacement
- `VoxelCollisionService.cs` L51 `IsSolidAt` — !IsServiceAvailable → return false
- `VoxelCollisionService.cs` L61-66 `QueryGround` — !IsServiceAvailable → GroundFound=false
- `OrbitCamera.cs` L110 `HandleObstruction` — 镜头也检查 IsServiceAvailable

**附带发现**：
- [待确认] 退化时 IsOnGround=false 持续 Falling，方块无限下落直到触发坠落边界重置——退化行为预期但可能循环重置

---

## 未走查契约

无（全部 15 条均为 code_review 类型，已全部走查）。

---

## 关键缺口汇总

| # | 契约 | 问题 | 严重程度 | 建议 |
|---|------|------|----------|------|
| 1 | qc-006 控制响应 | coyoteTime 和 jumpBuffer **完全缺失** | ❌ 高 | 实现土狼时间和预输入缓冲，参数化配置 |
| 2 | qc-007 镜头跟随 | SmoothDamp(0.15s) 与「硬跟」定义矛盾 | ⚠️ 中 | 将 followSmoothTime 降至 ≤0.02s 或改为直接赋值 |
| 3 | qc-011 碰撞查询 | 坐标边界 clamp 依赖第三方插件 | ⚠️ 低 | 在 VoxelCollisionService 层添加显式边界检查 |

## 附带发现汇总

| 文件 | 行号 | 级别 | 问题 |
|------|------|------|------|
| PlayerStateMachine.cs | L73 | 关注 | ForceState 方法允许绕过状态机逻辑 |
| PlayerCollisionStrategy.cs | L70 | 关注 | 高频坠落场景 LogError 可能大量日志 |
| GravityParams.cs | Initialize/Reset | 关注 | public 方法允许 D 系统误改 E 系统参数 |
| PlayerCollisionStrategy.cs | L51 | 待确认 | 碰撞退化时 Falling+坠落重置可能循环 |

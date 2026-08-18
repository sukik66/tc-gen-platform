# 质量契约走查报告

- 日期：2026-05-11 21:00
- 需求文档：implementation-brief-exp-slice-1.md
- 走查引擎：Cursor Agent

## 总览

| 指标 | 数量 |
|------|------|
| 契约总数 | 15 |
| 代码走查 (code_review) | 15 |
| 通过 (pass) | 11 |
| 违规 (fail) | 2 |
| 存疑 (uncertain) | 2 |
| 跳过 (非 code_review) | 0 |
| 调度模式 | 并行（3组：玩家原体/星球系统/跨系统） |
| ast-grep | 已启用（sg v0.42.1; custom_rules: event-subscribe-unpaired×9处, event-unsubscribe×3处, empty-method-body×0, coroutine-no-yield×0, getcomponent-no-null-check×0; event_pairing: 0对真实未配对） |
| Evidence 验证 | total=39, verified=15(精确匹配), soft_fail=24(lineHint范围格式), file_not_found=0 |
| 映射缓存(v2) | 重新搜索模式，缓存跳过 |

## 走查详情

### 1. 玩家原体 > 状态机 — pass (92%)

**规则**：玩家原体状态机有且仅有4个状态：[存在]、[行走中]、[跳跃上升]、[下落]；状态数量和流转条件不可自行增减或修改

**边界提示**：[存在]为初始静止态；[行走中]由WASD输入触发；[跳跃上升]由空格键且grounded触发；[下落]由失去地面支撑或垂直速度≤0触发

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 状态枚举恰好包含4个状态值 | grep_existence | pass | 95% | PlayerStateMachine.cs L3-9 enum PlayerState {Idle,Walking,JumpAscending,Falling} |
| SR-2 | 状态流转逻辑覆盖4状态间合法转换路径 | llm_semantic | pass | 90% | Evaluate L22-71 switch覆盖全部4状态，转换条件与I2矩阵一致 |

**汇总**：全部SR pass → 契约pass

**证据**：
- `PlayerStateMachine.cs` L3-9 `PlayerState` — 枚举定义4个状态
- `PlayerStateMachine.cs` L22-71 `Evaluate` — switch完整覆盖4状态转换

**缺口**：无

---

### 2. 玩家原体 > 移动管线 — uncertain (58%)

**规则**：每帧结算流程中先处理水平移动再合成重力分量，二者结算顺序固定不可调换；移动管线仅在非[存在]状态下产生有效位移

**边界提示**：失效语义指[存在]态下输入不产生位移而非不接收输入

**判定**：uncertain | 置信度 58%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | Tick方法中水平位移在重力之前执行 | llm_semantic | pass | 90% | PlayerMovementPipeline.cs L58水平在L65重力之前 |
| SR-2 | [存在]状态下不产生有效位移 | llm_semantic | uncertain | 55% | Tick中无Idle态门控，位移在状态评估前生效 |

**汇总**：SR-2 uncertain → 整条uncertain

**推理**：Tick统一处理所有状态的位移，状态评估(_stateMachine.Evaluate)在位移应用(L75)之后执行。当Idle态收到输入时，位移在同帧内产生，随后状态切换为Walking。严格语义不符需求"仅在非[存在]状态下产生有效位移"，但功能影响极小（仅单帧0.08单位位移）。

**证据**：
- `PlayerMovementPipeline.cs` L58 `Tick` — 水平位移计算
- `PlayerMovementPipeline.cs` L82-88 `Tick` — Evaluate在位移应用后调用

**缺口**：代码中无Idle态位移门控逻辑。已验证: Grep 'Idle.*return|CanMove|state.*skip' → 0命中。

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlayerMovementPipeline.cs` | L82 | `Tick` | 状态评估在位移应用后执行，Idle→Walking转换帧内位移已生效 | 潜在违规 |

---

### 3. 玩家原体 > 水平移动与方向 — pass (88%)

**规则**：按下WASD方向键当帧方块沿对应方向移动，松开当帧停止，无加速曲线和惯性；按反方向键时方块翻转行进方向

**判定**：pass | 置信度 88%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | WASD按下当帧产生位移无Lerp/SmoothDamp | llm_semantic | pass | 85% | direction * speed * dt 直接乘法 |
| SR-2 | 反方向键时朝向翻转 | grep_existence | pass | 90% | SetFacing→localScale.x翻转 |
| SR-3 | 不使用弹簧/阻尼做移动平滑 | grep_forbidden | pass | 90% | SmoothDamp/Lerp在移动管线0命中 |

**证据**：
- `PlayerMovementPipeline.cs` L58 `Tick` — `intent.HorizontalDirection * (horizontalSpeed * dt)` 直接乘法
- `PlayerEntity.cs` L87-103 `SetFacing` — localScale.x翻转实现朝向切换
- `AlienStarInputAdapter.cs` L17-51 `Poll` — GetKey直接映射无平滑

**缺口**：无

---

### 4. 玩家原体 > 碰撞检测 — pass (90%)

**规则**：方块水平移动时消费E系统碰撞查询返回solid时被阻挡；着地判定生效；头顶碰撞天花板时垂直速度归零

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 水平碰撞solid时位移被阻挡 | llm_semantic | pass | 90% | QueryCollision→AllowedDisplacement.x=0 |
| SR-2 | 垂直着地判定生效 | llm_semantic | pass | 90% | QueryGround+distToGround≤threshold→IsOnGround |
| SR-3 | 头顶碰撞时速度归零 | llm_semantic | pass | 88% | WasCeilingHit=true, verticalVelocity=0 |

**证据**：
- `VoxelCollisionService.cs` L138-148 `QueryCollision` — X轴solid→AllowedDisplacement.x=0
- `PlayerCollisionStrategy.cs` L125-148 `Resolve` — QueryGround+着地对齐
- `PlayerCollisionStrategy.cs` L90-94 `Resolve` — 天花板碰撞→verticalVelocity=0

**缺口**：无

---

### 5. 玩家原体 > 跳跃规则 — pass (88%)

**规则**：按空格键从地面腾起，抛物线轨迹；空中按方向键可微调水平方向，空中控制系数<1.0

**判定**：pass | 置信度 88%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 空格键触发跳跃赋予初始速度 | grep_existence | pass | 90% | JumpInitialSpeed=8f, Space→JumpPressed |
| SR-2 | 空中控制系数<1.0 | llm_semantic | pass | 88% | AirControlFactor=0.5, Range(0.3,0.8) |

**证据**：
- `AlienStarInputAdapter.cs` L27 — `Input.GetKeyDown(KeyCode.Space)`
- `PlayerMovementPipeline.cs` L60-61 — `_verticalVelocity = _config.JumpInitialSpeed`
- `AlienStarMovementConfig.cs` L26 — `airControlFactor = 0.5f`

**缺口**：无

---

### 6. 玩家原体 > 控制响应 — ❌ fail (85%)

**规则**：跳跃键按下当帧即起跳（无延迟）；崖边走出后短窗口内按跳跃仍生效（土狼时间）；着地前短窗口内按跳跃键着地瞬间自动跳起（预输入缓冲）

**判定**：fail | 置信度 85%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 跳跃当帧即起跳无延迟 | llm_semantic | pass | 85% | 同帧JumpPressed→verticalVelocity赋值 |
| SR-2 | 土狼时间参数存在 | grep_existence | ❌ fail | 90% | 全库0命中(6种变体) |
| SR-3 | 预输入缓冲参数存在 | grep_existence | ❌ fail | 90% | 全库0命中(6种变体) |

**汇总**：SR-2/SR-3 fail → 整条fail

**推理**：Grep搜索coyoteTime/coyoteTimer/CoyoteTime/graceTime/hangTime/lateJump和jumpBuffer/inputBuffer/JumpBuffer/preJump/jumpQueued/earlyJump → 全部0命中。代码中不存在土狼时间和预输入缓冲机制。Fail推定自检: A通用机制✗(无计时器变量) B回调模式✗ C配置驱动✗(.yaml/.asset 0命中) → 全部未命中，判fail。

**证据**：
- `PlayerMovementPipeline.cs` L60-61 `Tick` — JumpPressed同帧直接赋值（SR-1 pass）

**缺口**：SR-2/SR-3功能完全缺失，需求明确要求的土狼时间和预输入缓冲在代码中不存在。

---

### 7. 玩家原体 > 镜头跟随 — ❌ fail (82%)

**规则**：方块移动时镜头即时跟随不做弹簧/阻尼平滑；跳跃/下落时镜头垂直跟随；被遮挡时自动推近

**判定**：fail | 置信度 82%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 不使用SmoothDamp | grep_forbidden | ❌ fail | 90% | OrbitCamera.cs L102 Vector3.SmoothDamp |
| SR-2 | 跳跃/下落时垂直跟随 | llm_semantic | pass | 80% | desiredPivot跟踪target.position含Y |
| SR-3 | 被遮挡时自动推近 | grep_existence | pass | 90% | HandleObstruction+IsSolidAt探测 |

**汇总**：SR-1 fail → 整条fail

**推理**：OrbitCamera.cs L102明确使用`Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime)`做相机pivot跟随平滑。需求B1明确规定"不做弹簧/阻尼平滑"，SmoothDamp即阻尼平滑的标准实现，直接违反约束。

**证据**：
- `OrbitCamera.cs` L102 `UpdatePivot` — **Vector3.SmoothDamp** 阻尼平滑跟随（违反约束）
- `OrbitCamera.cs` L92-93 `UpdatePivot` — desiredPivot含Y坐标（垂直跟随正常）
- `OrbitCamera.cs` L106-135 `HandleObstruction` — IsSolidAt探测+radius推近

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `OrbitCamera.cs` | L102 | `UpdatePivot` | SmoothDamp(followSmoothTime=0.15f)做镜头跟随平滑，与需求B1"硬跟模式"矛盾 | 违规 |

---

### 8. 玩家原体 > 空间呈现 — pass (82%)

**规则**：极薄方块高度约一个体素单位（厚度约0.05单位），脚底精确贴合体素顶面

**判定**：pass | 置信度 82%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 高度≈1体素，厚度≈0.05 | grep_existence | pass | 95% | VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f |
| SR-2 | 脚底精确贴合地面 | llm_semantic | pass | 80% | allowed.y=GroundHeight-position.y |
| SR-3 | 方向色块可辨朝向 | runtime_only | uncertain | — | 需运行时验证 |

**汇总**：SR-3为runtime_only不影响pass判定 → 整条pass

**证据**：
- `PlayerEntity.cs` L11-13 — VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f
- `PlayerCollisionStrategy.cs` L135 — 着地时Y坐标精确对齐地面

**缺口**：SR-3需运行时目视确认

---

### 9. 玩家原体 > 异常兜底 — pass (92%)

**规则**：穿模检测发现方块进入solid时推回最近合法位置；跌出场景边界时坐标重置到出生点

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 穿模排斥：抬升推回 | grep_existence | pass | 92% | EjectFromSolid+BoundsOverlapSolid |
| SR-2 | 边界重置到spawnPoint | grep_existence | pass | 92% | IsBelowFallBoundary+_spawnPoint |

**证据**：
- `PlayerCollisionStrategy.cs` L57-65 — BoundsOverlapSolid→EjectFromSolid
- `PlayerCollisionStrategy.cs` L68-76 — IsBelowFallBoundary→重置到_spawnPoint
- `AlienStarBootstrap.cs` L99 — spawnPoint = groundHeight + 1f

**缺口**：无

---

### 10. 星球系统 > 状态机 — pass (95%)

**规则**：星球系统状态机有且仅有2个状态：[未加载]和[已加载]

**判定**：pass | 置信度 95%

**推理**：PlanetState枚举恰好2值{Unloaded, Loaded}。初始State=Unloaded，OnVoxelPlayInitialized中State=PlanetState.Loaded完成唯一转换路径。

**证据**：
- `PlanetManager.cs` L6-10 — enum PlanetState { Unloaded, Loaded }
- `PlanetManager.cs` L74 — State = PlanetState.Loaded

**缺口**：无

---

### 11. 星球系统 > 碰撞查询服务 — uncertain (65%)

**规则**：solid返回阻挡、air返回可通过；超出边界不崩溃返回clamp结果；未就绪时返回不可用

**判定**：uncertain | 置信度 65%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | solid返回阻挡 | grep_existence | pass | 90% | IsSolidAt→CheckCollision |
| SR-2 | air返回可通过 | llm_semantic | pass | 85% | !IsSolidAt=可通过 |
| SR-3 | 边界不崩溃返回clamp | llm_semantic | uncertain | 45% | 无自行clamp，依赖VoxelPlay引擎层 |
| SR-4 | 未就绪返回不可用 | grep_existence | pass | 92% | IsServiceAvailable前置检查 |

**汇总**：SR-3 uncertain → 整条uncertain

**推理**：VoxelCollisionService未自行做坐标边界clamp，直接传递坐标给VoxelPlayEnvironment的CheckCollision/RayCast。引擎层的边界行为无法从当前代码库确认。

**证据**：
- `VoxelCollisionService.cs` L49-53 — IsSolidAt→_env.CheckCollision
- `VoxelCollisionService.cs` L35 — IsServiceAvailable属性

**缺口**：SR-3边界保护依赖VoxelPlay引擎层。已验证: Grep 'Clamp|Bounds.*check|boundary' in VoxelCollisionService.cs → 无显式clamp。结论: 无法从当前代码确认。

---

### 12. 星球系统 > 着地查询 — pass (85%)

**规则**：D系统发起着地查询时，E系统返回正确的地面高度值

**判定**：pass | 置信度 85%

**推理**：QueryGround做5点底面采样(中心+四角)，对每点向下RayCast(距离10)，取最高命中hitInfo.point.y作为GroundHeight返回。多点采样消除站在边缘时的Y轴抖动。

**证据**：
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 5点采样+RayCast+bestHeight

**缺口**：无

---

### 13. 星球系统 > 重力参数 — pass (92%)

**规则**：加载后multiplier可读且与配置一致；clamp[0.1,5.0]；缺失默认1.0；未加载返回1.0

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 加载后可读取 | grep_existence | pass | 95% | Multiplier属性公开 |
| SR-2 | clamp[0.1,5.0] | grep_existence | pass | 95% | Mathf.Clamp(val, 0.1f, 5.0f) |
| SR-3 | 缺失默认1.0 | llm_semantic | pass | 90% | config==null→DEFAULT=1.0f |
| SR-4 | 未加载返回1.0 | llm_semantic | pass | 88% | _initialized=false→DEFAULT=1.0f |

**证据**：
- `GravityParams.cs` L5-7 — MIN=0.1f, MAX=5.0f, DEFAULT=1.0f
- `GravityParams.cs` L12 — Multiplier属性：_initialized ? _multiplier : DEFAULT
- `GravityParams.cs` L22 — Mathf.Clamp(config.GravityMultiplier, MIN, MAX)

**缺口**：无

---

### 14. 跨系统 > D↔E接口方向 — pass (92%)

**规则**：碰撞查询由E提供D消费；重力参数由E维护D只读

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 碰撞查询E→D方向 | llm_semantic | pass | 92% | PlanetManager.CollisionService注入PlayerCollisionStrategy |
| SR-2 | 重力参数E维护D只读 | llm_semantic | pass | 92% | D仅读Multiplier，不调用Initialize/Reset |

**证据**：
- `AlienStarBootstrap.cs` L120-121 — `_planetManager.CollisionService` 注入D
- `PlayerMovementPipeline.cs` L65 — `_gravityParams.Multiplier` 仅读取

**缺口**：无

---

### 15. 跨系统 > 碰撞不可用退化 — pass (90%)

**规则**：D收到不可用信号后退化为无碰撞模式继续运行，不崩溃

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 显式不可用处理分支 | llm_semantic | pass | 90% | Resolve开头null/unavailable检查→return displacement |
| SR-2 | 退化下不崩溃 | llm_semantic | pass | 90% | 直接return无异常，VCS每方法有前置检查 |

**证据**：
- `PlayerCollisionStrategy.cs` L48-53 — `if (!IsServiceAvailable...) return displacement`
- `VoxelCollisionService.cs` L51,61,130 — 每个方法IsServiceAvailable前置检查

**缺口**：无

---

## ast-grep 结构性检测汇总

### 自定义规则命中

| 规则 ID | 命中数 | 严重级 | 代表性命中（至多3条） |
|---------|--------|--------|---------------------|
| empty-method-body | 0 | warning | — |
| event-subscribe-unpaired | 9 | info | `PlanetManager.cs` L46 `_env.OnInitialized += OnVoxelPlayInitialized`（真实订阅）；其余8处为+=运算符误报 |
| event-unsubscribe | 3 | info | `PlanetManager.cs` L54, L69 `_env.OnInitialized -= OnVoxelPlayInitialized` |
| coroutine-no-yield | 0 | warning | — |
| getcomponent-no-null-check | 0 | info | — |

### 事件配对分析

| 事件处理器 | 订阅位置 | 取消位置 | 状态 |
|-----------|---------|---------|------|
| OnVoxelPlayInitialized | `PlanetManager.cs` L46 | `PlanetManager.cs` L54, L69 | ✅ 已配对 |

全部真实事件订阅已配对取消。其余9处event-subscribe-unpaired命中为`+=`复合赋值运算符误报（如`_entity.Position += allowedDisplacement`），非事件订阅。

---

## 隐式发现（代码审查附带发现汇总）

以下问题来自走查过程中的无约束审查，不属于任何契约的SR，但值得注意：

| # | 文件 | 行号 | 方法 | 问题 | 违规性 |
|---|------|------|------|------|--------|
| 1 | `PlayerMovementPipeline.cs` | L82 | `Tick` | 状态评估在位移应用后执行，Idle→Walking转换帧内位移已生效，与"仅在非Idle态产生位移"的精神不完全一致 | 潜在违规 |
| 2 | `OrbitCamera.cs` | L102 | `UpdatePivot` | SmoothDamp(followSmoothTime=0.15f)做镜头跟随平滑，与需求B1"硬跟模式/不做弹簧阻尼"直接矛盾 | 违规 |
| 3 | `PlayerMovementPipeline.cs` | L60 | `Tick` | 跳跃条件仅检查IsGrounded，无土狼时间(coyote time)宽容窗口，玩家体验可能不佳 | 建议改进 |
| 4 | `PlayerCollisionStrategy.cs` | L101 | `Resolve` | 穿模排斥抬升循环硬编码40次×0.05（最大2单位），若方块完全嵌入大型地形可能不足 | 建议改进 |

---

## 涉及文件清单

| 文件路径 | 角色 | 所属系统 |
|----------|------|---------|
| `Scripts/PlayerStateMachine.cs` | 状态机定义与流转 | D (玩家原体) |
| `Scripts/PlayerMovementPipeline.cs` | 每帧移动结算管线 | D |
| `Scripts/PlayerCollisionStrategy.cs` | 碰撞检测策略 | D |
| `Scripts/PlayerEntity.cs` | 玩家实体（视觉+碰撞体） | D |
| `Scripts/AlienStarInputAdapter.cs` | 输入适配器 | D |
| `Scripts/OrbitCamera.cs` | 第三人称轨道相机 | D |
| `Scripts/MovementInputAbsorbGate.cs` | 输入吸收门控 | D |
| `Scripts/VoxelCollisionService.cs` | 体素碰撞查询服务 | E (星球系统) |
| `Scripts/GravityParams.cs` | 重力参数管理 | E |
| `Scripts/PlanetManager.cs` | 星球系统入口 | E |
| `Scripts/AlienStarBootstrap.cs` | 场景引导（D↔E编排） | 跨系统 |
| `Scripts/CreatureRenderer.cs` | 生物渲染器 | B (渲染系统) |
| `Config/AlienStarMovementConfig.cs` | 移动配置SO | D配置 |
| `Config/AlienStarPlanetConfig.cs` | 星球配置SO | E配置 |
| `Config/AlienStarCreatureRenderingConfig.cs` | 渲染配置SO | B配置 |

---

## 未走查契约

无。全部15条均为code_review类型，已全部走查。

（注：契约5和契约7的verifyMethods同时含ui_test，ui_test部分暂不支持，code_review部分已完成走查。）

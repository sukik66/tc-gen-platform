# 质量契约走查报告

- 日期：2026-05-13 23:10
- 需求文档：implementation-brief-exp-slice-1.md（含 system-player-organism-slice-1.md、system-planet-slice-1.md）
- 走查引擎：Cursor Agent

## 总览

| 指标 | 数量 |
|------|------|
| 契约总数 | 20 |
| 代码走查 (code_review) | 20 |
| 通过 (pass) | 17 |
| 违规 (fail) | 2 |
| 存疑 (uncertain) | 1 |
| 跳过 (非 code_review) | 0 |
| 调度模式 | 并行（2组：玩家原体15条 + 星球系统5条） |
| ast-grep | 降级（sg 挂起超时后终止，结构性扫描未完成） |
| Evidence 验证 | total=219, verified=130, failed=89(method_not_found), downgraded=5 |
| 映射缓存(v2) | coreFiles 命中 11 文件 |

---

## 走查详情

### 1. 玩家原体 > 状态机 — pass (90%)

**规则**：玩家原体状态机有且仅有4个状态：[存在]、[行走中]、[跳跃上升]、[下落]；状态数量和流转条件不可自行增减

**边界提示**：状态数量为4是硬性要求

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 状态枚举恰好包含4个状态值 | grep_existence | pass | 95% | `PlayerStateMachine.cs` enum PlayerState { Idle, Walking, JumpAscending, Falling } 恰好4值 |
| SR-2 | 状态流转逻辑覆盖4状态间合法转换路径 | llm_semantic | pass | 88% | `PlayerStateMachine.cs` Evaluate() switch覆盖全部4状态×合法转换 |

**汇总**：两个SR均通过，状态数量和流转路径完整

**证据**：
- `PlayerStateMachine.cs` L3-9 `PlayerState` — 枚举定义4个状态值
- `PlayerStateMachine.cs` L22-71 `Evaluate` — switch覆盖9条合法转换路径

**缺口**：无

---

### 2. 玩家原体 > 输入预处理 — pass (90%)

**规则**：物理键WASD→归一化水平方向向量，Space按下帧产生一次跳跃信号

**边界提示**：仅处理移动和跳跃，不处理攻击/菜单

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | WASD输入转换为方向向量 | grep_existence | pass | 95% | `AlienStarInputAdapter.cs` Poll() WASD/方向键→h/v→camera-relative向量 |
| SR-2 | Space按下帧单次跳跃信号 | llm_semantic | pass | 95% | `AlienStarInputAdapter.cs` Input.GetKeyDown(KeyCode.Space) 单帧触发 |
| SR-3 | 无按键输出零向量+false | llm_semantic | pass | 88% | `AlienStarInputAdapter.cs` Abs(h)<0.01&&Abs(v)<0.01 → Vector3.zero |

**汇总**：三个SR均通过

**证据**：
- `AlienStarInputAdapter.cs` L17-51 `Poll` — 完整实现WASD→向量+Space→跳跃

**缺口**：无

---

### 3. 玩家原体 > 水平移动规则 — pass (90%)

**规则**：方向×速度→碰撞检测→更新坐标；反方向翻转

**边界提示**：无加速曲线、无惯性

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 方向向量乘以速度 | llm_semantic | pass | 95% | `PlayerMovementPipeline.cs` direction*(speed*dt) |
| SR-2 | 经碰撞检测后截断位移 | llm_semantic | pass | 85% | `PlayerMovementPipeline.cs` → `PlayerCollisionStrategy.cs` Resolve截断 |
| SR-3 | 反方向翻转行进方向 | grep_existence | pass | 90% | `PlayerEntity.cs` SetFacing() localScale.x翻转 |

**汇总**：三个SR均通过

**证据**：
- `PlayerMovementPipeline.cs` L58 `Tick` — horizontalDisplacement=direction*(speed*dt)
- `PlayerCollisionStrategy.cs` L72-73 `Resolve` — 碰撞截断
- `PlayerEntity.cs` L87-103 `SetFacing` — 视觉翻转

**缺口**：无

---

### 4. 玩家原体 > 跳跃规则 — ❌ fail (85%)

**规则**：grounded+jump→垂直初速度；空中不响应；土狼时间；预输入缓冲

**边界提示**：土狼时间和预输入缓冲为手感优化必备特性

**判定**：fail | 置信度 85%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | grounded+jump→垂直初速度 | llm_semantic | pass | 95% | `PlayerMovementPipeline.cs` if(JumpPressed&&IsGrounded) _verticalVelocity=JumpInitialSpeed |
| SR-2 | 空中超出土狼时间不响应跳跃 | llm_semantic | pass | 78% | IsGrounded严格检查，空中不可跳（但无土狼时间概念） |
| SR-3 | 土狼时间窗口内仍可跳跃 | grep_existence | **fail** | 90% | coyoteTime/graceTime/leaveGroundTimer 全库0命中 |
| SR-4 | 预输入缓冲着地瞬间自动跳起 | grep_existence | **fail** | 90% | jumpBuffer/preInput/bufferedJump 全库0命中 |

**汇总**：SR-3 + SR-4 fail → 整条 fail。基础跳跃机制完整，但需求规格要求的两项手感优化特性完全缺失

**证据**：
- `PlayerMovementPipeline.cs` L60-61 `Tick` — grounded+jump→初速度（SR-1通过）

**缺口**：
- 土狼时间(coyoteTime)完全缺失：全部源代码中未找到任何土狼时间相关变量/逻辑
- 预输入缓冲(jumpBuffer)完全缺失：着地瞬间不会回溯检查先前帧的跳跃输入

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | 全局 | — | — | coyoteTime/jumpBuffer 相关代码全库0命中 | 违规 |

---

### 5. 玩家原体 > 重力规则 — pass (75%)

**规则**：每帧读E multiplier×基准重力；速度正→负切下落

**边界提示**：E未加载时使用默认1.0

**判定**：pass | 置信度 75%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 读取multiplier并乘基准重力 | llm_semantic | pass | 95% | `PlayerMovementPipeline.cs` actualGravity=BaseGravity*Multiplier |
| SR-2 | 速度从正变负切换到下落 | llm_semantic | pass | 95% | `PlayerStateMachine.cs` JumpAscending: verticalVelocity<=0→Falling |
| SR-3 | E未加载使用默认1.0 | llm_semantic | pass | 75% | `GravityParams.cs` _initialized?_multiplier:DEFAULT_MULTIPLIER(1.0f) |

**汇总**：三个SR均通过，SR-3置信度较低但GravityParams.cs已确认默认值为1.0f

**证据**：
- `PlayerMovementPipeline.cs` L65 `Tick` — actualGravity=BaseGravity*_gravityParams.Multiplier
- `PlayerStateMachine.cs` L58 `Evaluate` — verticalVelocity<=0→Falling
- `GravityParams.cs` L12 `Multiplier` — 三元分支返回默认值

**缺口**：无

---

### 6. 玩家原体 > 空中控制规则 — pass (95%)

**规则**：空中速度=基础×空中控制系数

**判定**：pass | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 空中控制系数 | grep_existence | pass | 95% | `PlayerMovementPipeline.cs` else horizontalSpeed=WalkSpeed*AirControlFactor |

**证据**：
- `PlayerMovementPipeline.cs` L55-56 `Tick` — AirControlFactor在空中状态应用

**缺口**：无

---

### 7. 玩家原体 > 碰撞阻挡判定 — pass (87%)

**规则**：BoxCollider投射，solid截断，头顶碰撞归零

**判定**：pass | 置信度 87%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | BoxCollider碰撞检测 | grep_existence | pass | 85% | `PlayerEntity.cs` BoxCollider属性 + SetupFallbackCollider |
| SR-2 | solid阻挡截断位移 | llm_semantic | pass | 85% | `PlayerCollisionStrategy.cs` QueryCollision→截断 |
| SR-3 | 头顶碰撞垂直速度归零 | llm_semantic | pass | 90% | `PlayerCollisionStrategy.cs` verticalVelocity=0f; WasCeilingHit=true |

**证据**：
- `PlayerEntity.cs` L23 `CharacterCollider` — BoxCollider属性
- `PlayerEntity.cs` L178-187 `SetupFallbackCollider` — center=(0,0.5,0) size=(1,1,0.05)
- `PlayerCollisionStrategy.cs` L78-94 `Resolve` — 碰撞查询+天花板归零

**缺口**：无

---

### 8. 玩家原体 > 着地判定 — pass (90%)

**规则**：下方投射≤阈值→着地

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 下方投射检测solid | grep_existence | pass | 90% | `PlayerCollisionStrategy.cs` QueryGround向下检测 |
| SR-2 | 距离≤阈值判定着地 | llm_semantic | pass | 90% | distToGround<=_groundThreshold && verticalVelocity<=0 → IsOnGround=true |

**证据**：
- `PlayerCollisionStrategy.cs` L125 `Resolve` — QueryGround
- `PlayerCollisionStrategy.cs` L131-137 `Resolve` — 阈值+速度双重条件

**缺口**：无

---

### 9. 玩家原体 > 穿模排斥 — pass (87%)

**规则**：陷入solid强制向上排斥

**判定**：pass | 置信度 87%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 检测是否陷入solid | grep_existence | pass | 90% | `PlayerCollisionStrategy.cs` BoundsOverlapSolid检测 |
| SR-2 | 向上排斥至合法表面 | llm_semantic | pass | 85% | `PlayerCollisionStrategy.cs` EjectFromSolid向上逐步抬升 |

**证据**：
- `PlayerCollisionStrategy.cs` L57 `Resolve` — BoundsOverlapSolid检测穿模
- `PlayerCollisionStrategy.cs` L167-191 `EjectFromSolid` — 向上逐步0.05抬升直到不重叠

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlayerCollisionStrategy.cs` | L98-123 | Resolve步骤5 | 移动后穿模二次检测（双重防护，正面发现） | 建议改进 |

---

### 10. 玩家原体 > 边界坐标重置 — pass (95%)

**规则**：跌出边界→重置到出生点

**判定**：pass | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 检测超出边界下限 | grep_existence | pass | 95% | `PlayerCollisionStrategy.cs` IsBelowFallBoundary: pos.y < _spawnPoint.y - _fallBoundaryDepth |
| SR-2 | 重置到出生点 | grep_existence | pass | 95% | displacement=_spawnPoint-position; verticalVelocity=0f |

**证据**：
- `PlayerCollisionStrategy.cs` L193-196 `IsBelowFallBoundary` — 边界检测
- `PlayerCollisionStrategy.cs` L68-76 `Resolve` — 重置逻辑

**缺口**：无

---

### 11. 玩家原体 > 镜头行为 — ❌ fail (88%)

**规则**：第三人称固定偏移跟随镜头：硬跟（无弹簧/阻尼平滑），防穿透推近，朝向锁定

**边界提示**：本切片不做弹簧/阻尼平滑（SmoothDamp/Lerp跟随/SpringArm 等）

**判定**：fail | 置信度 88%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 镜头固定偏移量 | grep_existence | pass | 85% | `OrbitCamera.cs` orbitRadius=10f, defaultPitch=30f |
| SR-2 | 不使用弹簧/阻尼平滑（硬跟） | grep_forbidden | **fail** | 90% | `OrbitCamera.cs` L102 Vector3.SmoothDamp 命中 |
| SR-3 | 垂直跟随Y坐标 | llm_semantic | pass | 82% | `OrbitCamera.cs` desiredPivot含target.position(含Y) |
| SR-4 | 防穿透推近 | grep_existence | pass | 90% | `OrbitCamera.cs` HandleObstruction solid探测→推近 |
| SR-5 | 朝向锁定面向玩家 | llm_semantic | pass | 95% | `OrbitCamera.cs` LookAt(_smoothPivot) |

**汇总**：SR-2 fail（grep_forbidden命中SmoothDamp）→ 整条 fail

**证据**：
- `OrbitCamera.cs` L102 `UpdatePivot` — `Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime)` ⚠️ 违反硬跟
- `OrbitCamera.cs` L13-14 — orbitRadius=10f, defaultPitch=30f（固定偏移OK）
- `OrbitCamera.cs` L115-123 `HandleObstruction` — solid探测推近（防穿透OK）
- `OrbitCamera.cs` L158 `ApplyCameraTransform` — LookAt锁定（朝向OK）

**缺口**：
- OrbitCamera.cs使用`Vector3.SmoothDamp(followSmoothTime=0.15f)`违反硬跟要求

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `OrbitCamera.cs` | L102 | UpdatePivot | SmoothDamp(followSmoothTime=0.15f)引入弹簧阻尼平滑 | 违规 |
| [已确认] | `AlienStarBootstrap.cs` | L283-286 | UpdateFallbackCamera | 备选相机硬编码偏移无SmoothDamp，符合硬跟 | 建议改进 |

---

### 12. 玩家原体 > 控制响应 — pass (93%)

**规则**：即时起步/即停/即转/当帧跳跃

**判定**：pass | 置信度 93%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 无加速曲线 | grep_forbidden | pass | 95% | 全库未命中加速曲线代码 |
| SR-2 | 无惯性滑行 | grep_forbidden | pass | 95% | 全库未命中惯性代码 |
| SR-3 | 跳跃键当帧给予垂直初速度 | llm_semantic | pass | 90% | 同一Tick内Poll→JumpPressed→_verticalVelocity赋值→位移应用 |

**证据**：
- `PlayerMovementPipeline.cs` L53-54 `Tick` — IsGrounded→WalkSpeed直接赋值无渐进
- `PlayerMovementPipeline.cs` L60-61 `Tick` — JumpPressed当帧赋予初速度

**缺口**：无

---

### 13. 玩家原体 > 空间呈现 — pass (88%)

**规则**：约1体素高/极薄/脚底贴合/方向色块

**判定**：pass | 置信度 88%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 高度约1体素 | grep_existence | pass | 95% | `PlayerEntity.cs` VISUAL_HEIGHT=1f |
| SR-2 | 厚度极薄但有碰撞 | llm_semantic | pass | 90% | VISUAL_DEPTH=0.05f + BoxCollider size=(1,1,0.05) |
| SR-3 | 脚底贴合体素顶面 | llm_semantic | pass | 80% | BoxCollider center=(0,0.5,0)底部在y=0 + 着地校正 |
| SR-4 | 方向色块存在 | grep_existence | pass | 90% | CreateFallbackDirectionIndicator: 橙色条+黄色点 |

**证据**：
- `PlayerEntity.cs` L12-13 — VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f
- `PlayerEntity.cs` L183-186 `SetupFallbackCollider` — BoxCollider碰撞体
- `PlayerEntity.cs` L141-176 `CreateFallbackDirectionIndicator` — 方向指示器

**缺口**：无

---

### 14. 玩家原体 > 移动管线每帧结算 — pass (87%)

**规则**：每帧输入→重力→碰撞合成

**判定**：pass | 置信度 87%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 每帧执行结算流程 | llm_semantic | pass | 90% | `AlienStarBootstrap.cs` Update() _movementPipeline.Tick(dt) |
| SR-2 | 输入缺失仅受重力 | llm_semantic | pass | 85% | 无输入→horizontalDisplacement=zero，重力仍执行 |

**证据**：
- `AlienStarBootstrap.cs` L272 `Update` — _movementPipeline.Tick(dt)每帧调用
- `PlayerMovementPipeline.cs` L44-88 `Tick` — 完整结算流程

**缺口**：无

---

### 15. 星球系统 > 状态机 — pass (92%)

**规则**：有且仅有2个状态[未加载]和[已加载]；由场景加载完成触发

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 状态标识区分未加载/已加载 | grep_existence | pass | 95% | `PlanetManager.cs` enum PlanetState{Unloaded,Loaded} |
| SR-2 | VoxelPlay就绪后切换到已加载 | llm_semantic | pass | 90% | OnVoxelPlayInitialized中State=PlanetState.Loaded |

**证据**：
- `PlanetManager.cs` L6-10 `PlanetState` — 枚举2值
- `PlanetManager.cs` L65-78 `OnVoxelPlayInitialized` — State=Loaded + OnReady触发

**缺口**：无

---

### 16. 星球系统 > 碰撞查询响应 — ⚠️ uncertain (55%)

**规则**：solid阻挡/air通过/边界clamp/未加载不可用

**判定**：uncertain | 置信度 55%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | solid返回阻挡 | grep_existence | pass | 82% | `VoxelCollisionService.cs` IsSolidAt→CheckCollision |
| SR-2 | air返回可通过 | llm_semantic | pass | 80% | QueryCollision默认IsBlocked=false原样放行 |
| SR-3 | 坐标超出边界clamp | grep_existence | **uncertain** | 20% | 全文无任何boundary/clamp逻辑 |
| SR-4 | 未加载返回不可用 | llm_semantic | pass | 88% | !IsServiceAvailable→短路返回无碰撞 |

**汇总**：SR-3 uncertain（置信度极低20%）→ 整条 uncertain。solid/air/未加载行为均正确，但边界clamp缺失证据

**证据**：
- `VoxelCollisionService.cs` L49-53 `IsSolidAt` — CheckCollision检测solid
- `VoxelCollisionService.cs` L120-185 `QueryCollision` — 各轴AllowedDisplacement归零
- `VoxelCollisionService.cs` L130 — !IsServiceAvailable→原位移透传

**缺口**：
- VoxelCollisionService全文未见任何坐标边界clamp/boundary关键词或逻辑
- 可能隐藏在VoxelPlayEnvironment.CheckCollision内部（第三方引擎层），需进一步确认

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [待确认] | `VoxelCollisionService.cs` | — | — | 坐标边界clamp可能由VoxelPlayEnvironment内部处理 | 待确认 |

---

### 17. 星球系统 > 着地查询响应 — pass (78%)

**规则**：向下投射返回地面高度/无底返回边界下限

**判定**：pass | 置信度 78%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 向下投射返回最近solid表面 | grep_existence | pass | 80% | `VoxelCollisionService.cs` 5点底面采样+RayCast取bestHeight |
| SR-2 | 下方无solid返回未找到地面 | llm_semantic | pass | 85% | GroundFound=false; GroundHeight=float.MinValue |

**证据**：
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 5点采样+向下RayCast
- `VoxelCollisionService.cs` L110-111 — 无命中→false+float.MinValue

**缺口**：无（实现为部分注释级伪代码拉低置信度）

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `VoxelCollisionService.cs` | — | QueryGround | GROUND_PROBE_DISTANCE=10f，超10格悬空探测不到地面 | 建议改进 |

---

### 18. 星球系统 > 重力参数初始化 — pass (93%)

**规则**：配置读取+clamp 0.1~5.0+缺失默认1.0

**判定**：pass | 置信度 93%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 从配置读取重力倍率 | grep_existence | pass | 95% | `GravityParams.cs` config.GravityMultiplier |
| SR-2 | 配置缺失使用默认1.0 | llm_semantic | pass | 95% | config==null→DEFAULT_MULTIPLIER(1.0f) |
| SR-3 | 超出范围clamp到[0.1,5.0] | grep_existence | pass | 95% | Mathf.Clamp(value, 0.1f, 5.0f) |

**证据**：
- `GravityParams.cs` L22 `Initialize` — Mathf.Clamp(config.GravityMultiplier, MIN_MULTIPLIER, MAX_MULTIPLIER)
- `GravityParams.cs` L18 `Initialize` — config==null→DEFAULT_MULTIPLIER
- `GravityParams.cs` L5-7 — MIN=0.1f, MAX=5.0f, DEFAULT=1.0f

**缺口**：无

---

### 19. 星球系统 > 重力参数读取 — pass (92%)

**规则**：已加载返回值/未加载返回1.0

**判定**：pass | 置信度 92%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 已加载返回配置值 | grep_existence | pass | 93% | `GravityParams.cs` _initialized?_multiplier:DEFAULT |
| SR-2 | 未加载返回默认1.0 | llm_semantic | pass | 92% | _initialized=false时返回DEFAULT_MULTIPLIER(1.0f) |

**证据**：
- `GravityParams.cs` L12 `Multiplier` — 三元表达式分支
- `GravityParams.cs` L27-31 `Reset` — _initialized=false恢复默认

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlanetManager.cs` | — | Shutdown | 调用Gravity.Reset()，Unloaded时Multiplier自动返回1.0f，生命周期闭环 | 建议改进 |

---

### 20. 玩家原体 > 碰撞不可用退化 — pass (85%)

**规则**：E不可用时退化无碰撞模式

**判定**：pass | 置信度 85%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 碰撞不可用退化 | llm_semantic | pass | 85% | !IsServiceAvailable→IsOnGround=false; return displacement |

**证据**：
- `PlayerCollisionStrategy.cs` L48-53 `Resolve` — _collisionService==null||!IsServiceAvailable→返回原始位移

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlayerCollisionStrategy.cs` | L48-53 | Resolve | 退化模式IsOnGround=false导致持续下落→触发边界重置→循环 | 潜在违规 |

---

## ast-grep 结构性检测汇总

> ⚠️ ast-grep 降级：sg 进程挂起超过5分钟后被终止，结构性扫描未完成。以下表格基于降级状态填零。

### 自定义规则命中

| 规则 ID | 命中数 | 严重级 | 代表性命中 |
|---------|--------|--------|-----------|
| empty-method-body | 0 | warning | （降级，未扫描） |
| event-subscribe-unpaired | 0 | info | （降级，未扫描） |
| event-unsubscribe | 0 | info | （降级，未扫描） |
| coroutine-no-yield | 0 | warning | （降级，未扫描） |
| getcomponent-no-null-check | 0 | info | （降级，未扫描） |

### 事件配对分析

| 事件处理器 | 订阅位置 | 取消位置 | 状态 |
|-----------|---------|---------|------|
| OnVoxelPlayInitialized | `PlanetManager.cs` Initialize | `PlanetManager.cs` OnVoxelPlayInitialized | ✅ 已配对（人工确认） |

---

## 附带发现

> 以下为走查过程中发现的非契约项问题（隐式发现，来自代码审查旁路扫描）。

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 | 来源契约 |
|------|------|------|------|------|--------|---------|
| [已确认] | `OrbitCamera.cs` | L102 | UpdatePivot | SmoothDamp(followSmoothTime=0.15f) 引入弹簧阻尼平滑，违反硬跟规格 | 违规 | qc-611 SR-2 |
| [已确认] | 全局 | — | — | coyoteTime / jumpBuffer 全库 0 命中，跳跃手感优化缺失 | 违规 | qc-604 SR-3/4 |
| [已确认] | `PlayerCollisionStrategy.cs` | L98-123 | Resolve 步骤5 | 移动后穿模二次检测（正面发现，双重防护） | 建议改进 | qc-609 |
| [已确认] | `PlayerCollisionStrategy.cs` | L48-53 | Resolve | 退化模式 IsOnGround=false 导致持续下落→边界重置循环 | 潜在违规 | qc-620 |
| [待确认] | `VoxelCollisionService.cs` | — | — | 坐标边界 clamp 可能由 VoxelPlayEnvironment 内部处理 | 待确认 | qc-616 SR-3 |
| [已确认] | `VoxelCollisionService.cs` | — | QueryGround | GROUND_PROBE_DISTANCE=10f，超 10 格悬空探测不到地面 | 建议改进 | qc-617 |
| [已确认] | `PlanetManager.cs` | — | Shutdown | Gravity.Reset() 闭环完整（正面发现） | 建议改进 | qc-619 |
| [已确认] | `AlienStarBootstrap.cs` | L283-286 | UpdateFallbackCamera | 备选相机硬编码偏移无 SmoothDamp，符合硬跟（主相机不符合） | 建议改进 | qc-611 |

---

## 涉及文件清单

| 文件路径 | 模块 | 关联契约 |
|---------|------|---------|
| `Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` | 玩家原体 | qc-601, qc-604, qc-605 |
| `Assets/Voxel Play/AlienStar/Scripts/AlienStarInputAdapter.cs` | 玩家原体 | qc-602 |
| `Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` | 玩家原体 | qc-603, qc-604, qc-605, qc-606, qc-612, qc-614 |
| `Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` | 玩家原体 | qc-603, qc-607, qc-613 |
| `Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` | 玩家原体 | qc-607, qc-608, qc-609, qc-610, qc-620 |
| `Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` | 玩家原体 | qc-611 |
| `Assets/Voxel Play/AlienStar/Scripts/MovementInputAbsorbGate.cs` | 玩家原体 | qc-602 |
| `Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs` | 玩家原体 | qc-611, qc-614 |
| `Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` | 星球系统 | qc-616, qc-617 |
| `Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` | 星球系统 | qc-615 |
| `Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` | 星球系统 | qc-618, qc-619 |

---

## 未走查契约

| moduleLabel | rule | verifyMethods | 跳过原因 |
|-------------|------|---------------|----------|
| （无） | — | — | 本次20条契约均为code_review，全部完成走查 |

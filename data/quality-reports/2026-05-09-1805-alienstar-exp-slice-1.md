# 质量契约走查报告

- 日期：2026-05-09 18:05
- 需求文档：implementation-brief-exp-slice-1.md（及关联详设 system-player-organism-slice-1.md、system-planet-slice-1.md、cross-system-interfaces.md）
- 走查引擎：Cursor Agent
- 项目：AlienStar EXP-SLICE-1（极薄方块走起来）
- 代码仓库：C:\Demo\client_2\Assets\Voxel Play\AlienStar\

## 总览

| 指标 | 数量 |
|------|------|
| 契约总数 | 15 |
| 代码走查 (code_review) | 15 |
| 通过 (pass) | 11 |
| 违规 (fail) | 2 |
| 存疑 (uncertain) | 2 |
| 跳过 (非 code_review) | 0 |
| 调度模式 | 并行（3组：玩家原体Part1/玩家原体Part2/星球+跨系统） |
| ast-grep | 已启用（3次扫描，输出 ast-grep-latest-A/B/C.json） |
| Evidence 验证 | total=70, verified=43, failed=27(路径格式问题), downgraded=13 |
| 映射缓存(v2) | modules_updated=3, clusters=15, semantic_links=19 |

### 判定汇总

| # | 契约 | 优先级 | 判定 | 置信度 | 关键说明 |
|---|------|--------|------|--------|---------|
| 1 | 玩家原体 > 状态机 | P0 | ✅ pass | 98% | 4状态枚举+合法转换矩阵完整 |
| 2 | 玩家原体 > 移动管线 | P0 | ✅ pass | 93% | 水平→重力顺序固定，Idle隐式零位移 |
| 3 | 玩家原体 > 水平移动与方向 | P1 | ✅ pass | 96% | 直接乘法无Lerp/SmoothDamp，localScale.x翻转 |
| 4 | 玩家原体 > 碰撞检测 | P0 | ✅ pass | 96% | 三轴阻挡+着地+天花板链路完整 |
| 5 | 玩家原体 > 跳跃规则 | P1 | ✅ pass | 97% | 空格触发+抛物线+AirControlFactor=0.5 |
| 6 | 玩家原体 > 控制响应 | P1 | ❌ fail | 95% | **缺失土狼时间和预输入缓冲** |
| 7 | 玩家原体 > 镜头跟随 | P1 | ❌ fail | 95% | **OrbitCamera使用SmoothDamp违反「不做弹簧/阻尼平滑」** |
| 8 | 玩家原体 > 空间呈现 | P1 | ⚠️ uncertain | 80% | 尺寸/贴地pass，方向色块可辨性需运行时确认 |
| 9 | 玩家原体 > 异常兜底 | P0 | ✅ pass | 95% | 穿模排斥+边界重置三级机制完整 |
| 10 | 星球系统 > 状态机 | P0 | ✅ pass | 97% | Unloaded/Loaded两状态，事件驱动转换 |
| 11 | 星球系统 > 碰撞查询服务 | P0 | ⚠️ uncertain | 72% | solid/air/就绪pass，**边界clamp未实现** |
| 12 | 星球系统 > 着地查询 | P0 | ✅ pass | 93% | 5点射线采样返回正确地面高度 |
| 13 | 星球系统 > 重力参数 | P0 | ✅ pass | 97% | Clamp[0.1,5.0]+默认1.0+未加载返回默认 |
| 14 | 跨系统 > D↔E接口方向 | P0 | ✅ pass | 96% | E提供D消费，Grep确认D无写入 |
| 15 | 跨系统 > 碰撞不可用退化 | P0 | ✅ pass | 95% | 显式IsServiceAvailable守卫+退化返回原始位移 |

---

## 走查详情

### 1. 玩家原体 > 状态机 — ✅ pass (98%)

**规则**：玩家原体状态机有且仅有4个状态：[存在]、[行走中]、[跳跃上升]、[下落]；状态数量和流转条件不可自行增减或修改

**边界提示**：[存在]为初始静止态；[行走中]由WASD输入触发；[跳跃上升]由空格键且处于地面触发；[下落]由失去地面支撑或垂直速度≤0触发

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 状态枚举恰好4个值 | grep_existence | ✅ pass | 100% | `PlayerStateMachine.cs` L3-9 enum PlayerState {Idle,Walking,JumpAscending,Falling} |
| SR-2 | 状态流转仅允许合法路径 | llm_semantic | ✅ pass | 97% | `PlayerStateMachine.cs` L22-70 Evaluate方法switch覆盖4 case，转换路径与I2矩阵一致 |

**汇总**：全部SR pass → 契约 pass

**证据**：
- `PlayerStateMachine.cs` L3-9 `enum PlayerState` — 恰好4值：Idle/Walking/JumpAscending/Falling
- `PlayerStateMachine.cs` L22-70 `Evaluate` — switch完整覆盖4状态，无第5状态

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [待确认] | `PlayerStateMachine.cs` | L73-76 | `ForceState` | 无合法性校验，可传入非法枚举值 | 建议改进 |

---

### 2. 玩家原体 > 移动管线 — ✅ pass (93%)

**规则**：每帧结算流程中先处理水平移动再合成重力分量，二者结算顺序固定不可调换；移动管线仅在非[存在]状态下产生有效位移

**边界提示**：失效语义指[存在]态下输入不产生位移而非不接收输入

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 水平移动在重力之前 | llm_semantic | ✅ pass | 98% | `Tick` L58水平 → L63-66重力 → L70合成 |
| SR-2 | Idle态不产生位移 | llm_semantic | ✅ pass | 88% | Idle=无输入=零位移，隐式门控 |

**汇总**：全部SR pass → 契约 pass

**证据**：
- `PlayerMovementPipeline.cs` L44-88 `Tick` — 完整帧结算：输入→水平→跳跃→重力→合成→碰撞→应用→状态评估

**缺口**：Idle门控为隐式实现（无显式if检查），Idle→Walking转换帧存在1帧状态/位移不一致（后评估架构固有特征）

---

### 3. 玩家原体 > 水平移动与方向 — ✅ pass (96%)

**规则**：按下WASD当帧移动，松开当帧停止，无加速曲线和惯性；反方向键翻转朝向

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 即时起步/即停无Lerp | llm_semantic | ✅ pass | 97% | `Poll` L22-25 GetKey + `Tick` L58 直接乘法 |
| SR-2 | 反方向键翻转朝向 | grep_existence | ✅ pass | 95% | `PlayerEntity.SetFacing` L87-103 localScale.x翻转 |

**证据**：
- `AlienStarInputAdapter.cs` L22-25 `Poll` — Input.GetKey持续检测，松开=0
- `PlayerMovementPipeline.cs` L58 `Tick` — 直接乘法无Lerp/SmoothDamp
- `PlayerEntity.cs` L87-103 `SetFacing` — localScale.x正负翻转+指示器位移翻转

**缺口**：SetFacing的localScale翻转仅在fallback visual模式下执行，CreatureRenderer模式需另行验证

---

### 4. 玩家原体 > 碰撞检测 — ✅ pass (96%)

**规则**：水平碰撞solid阻挡；垂直着地判定；天花板碰撞垂直速度归零转[下落]

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 水平solid阻挡 | llm_semantic | ✅ pass | 97% | `QueryCollision` L138-162 X/Z面采样截断 |
| SR-2 | 垂直着地判定 | llm_semantic | ✅ pass | 97% | `QueryGround` L58-115 5点射线 + `Resolve` L125-148 Y吸附 |
| SR-3 | 天花板归零+转Falling | llm_semantic | ✅ pass | 95% | `QueryCollision` L169-182 顶面检测 + `Resolve` L90-94 vVel=0 |

**证据**：
- `PlayerCollisionStrategy.cs` L42-165 `Resolve` — 完整碰撞解算
- `VoxelCollisionService.cs` L58-185 `QueryCollision+QueryGround` — 底层查询实现

**缺口**：无

---

### 5. 玩家原体 > 跳跃规则 — ✅ pass (97%)

**规则**：空格键地面跳跃→自然抛物线；空中控制系数独立且弱于地面

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 空格触发+抛物线 | grep_existence | ✅ pass | 98% | `Poll` L27 GetKeyDown(Space) + `Tick` L60-61 赋JumpInitialSpeed(8) + L63-66 gravity衰减 |
| SR-2 | AirControlFactor<1.0 | llm_semantic | ✅ pass | 98% | `Tick` L52-56 空中速度=Walk*AirControl + `Config` L24-26 默认0.5,Range(0.3,0.8) |

**证据**：
- `PlayerMovementPipeline.cs` L44-88 `Tick` — 跳跃+重力+空中控制完整
- `AlienStarMovementConfig.cs` L14-26 — JumpInitialSpeed=8, BaseGravity=25, AirControlFactor=0.5

**缺口**：无

---

### 6. 玩家原体 > 控制响应 — ❌ fail (95%)

**规则**：跳跃键当帧即起跳；崖边走出后土狼时间内仍可跳跃；着地前预输入缓冲着地瞬间自动跳起

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 当帧即起跳 | llm_semantic | ✅ pass | 95% | `Poll` L27 GetKeyDown + `Tick` L49-61 同帧赋速 |
| SR-2 | 土狼时间 | grep_existence | ❌ **fail** | 97% | 全库0命中coyoteTime/graceTime等全部变体 |
| SR-3 | 预输入缓冲 | grep_existence | ❌ **fail** | 97% | 全库0命中jumpBuffer/inputBuffer等全部变体 |

**汇总**：SR-2 fail + SR-3 fail → 契约 fail

**推理**：跳跃键当帧起跳已实现，但**土狼时间（coyote time）和预输入缓冲（jump buffer）功能完全缺失**。Walking状态下!isOnGround直接转Falling无窗口；跳跃仅在IsGrounded时触发无缓冲。AlienStarMovementConfig仅6个参数，缺少coyoteTime和jumpBufferTime。

**证据**：
- `PlayerStateMachine.cs` L48-49 `Evaluate` — Walking下!isOnGround直接转Falling，无土狼窗口
- `PlayerMovementPipeline.cs` L60 `Tick` — 跳跃仅IsGrounded时触发，无缓冲
- `AlienStarInputAdapter.cs` L27 `Poll` — GetKeyDown只报当帧，不存储缓冲

**缺口**：需在AlienStarMovementConfig新增coyoteTime和jumpBufferTime参数，在PlayerMovementPipeline或PlayerStateMachine中新增计时器逻辑。

---

### 7. 玩家原体 > 镜头跟随 — ❌ fail (95%)

**规则**：第三人称硬跟模式：不做弹簧/阻尼平滑；垂直跟随始终可见；被遮挡时推近

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 禁止SmoothDamp | grep_forbidden | ❌ **fail** | 98% | `OrbitCamera.cs` L102 `Vector3.SmoothDamp` 命中 |
| SR-2 | 垂直跟随 | llm_semantic | ✅ pass | 90% | `UpdatePivot` L92-93 desiredPivot含Y分量 |
| SR-3 | 遮挡推近 | grep_existence | ✅ pass | 95% | `HandleObstruction` L106-135 步进采样+推近 |

**汇总**：SR-1 fail（grep_forbidden命中）→ 契约 fail

**推理**：`OrbitCamera.cs` 第102行使用 `Vector3.SmoothDamp` 做pivot平滑跟随，直接违反需求B1「不做弹簧/阻尼平滑」的明确约束。类注释(line7)明确写"Follows the player with spring-damping"，说明开发者有意为之但与需求矛盾。

**证据**：
- `OrbitCamera.cs` L102 `UpdatePivot` — `_smoothPivot = Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime)` ← **违规点**
- `OrbitCamera.cs` L19-21 — `followSmoothTime = 0.15f` 平滑参数
- `OrbitCamera.cs` L106-135 `HandleObstruction` — 遮挡推近完整实现

**缺口**：需将UpdatePivot中的SmoothDamp替换为硬跟随 `_smoothPivot = desiredPivot`，保留teleportThreshold做瞬移保护。

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `OrbitCamera.cs` | L7 | 类注释 | 自述"spring-damping"设计，与需求B1矛盾 | 违规 |
| [待确认] | `OrbitCamera.cs` | L54 | 初始化 | initialYaw+180f偏移使初始镜头朝-Z方向 | 待确认 |

---

### 8. 玩家原体 > 空间呈现 — ⚠️ uncertain (80%)

**规则**：极薄方块高度约一个体素单位（厚度约0.05），脚底精确贴合体素顶面；方向色块可辨朝向

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 尺寸高度1+厚度0.05 | grep_existence | ✅ pass | 98% | `PlayerEntity.cs` L11-13 VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f |
| SR-2 | 脚底贴合体素顶面 | llm_semantic | ✅ pass | 92% | `Resolve` L129-136 着地时Y=GroundHeight精确对齐 |
| SR-3 | 方向色块可辨 | runtime_only | ⚠️ uncertain | 50% | 需运行时目视确认 |

**汇总**：SR-3 uncertain → 契约 uncertain

**证据**：
- `PlayerEntity.cs` L11-13 — VISUAL_WIDTH=1f, VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f
- `PlayerCollisionStrategy.cs` L129-136 `Resolve` — 着地时allowed.y=ground.GroundHeight-position.y
- `PlayerEntity.cs` L141-176 `CreateFallbackDirectionIndicator` — 橙色DirectionStripe+黄色DirectionDot

**缺口**：方向指示器代码存在且颜色对比明显（橙+黄 vs 主体蓝/紫），但在镜头距离10个体素下是否肉眼可辨需运行时确认。B系统有真实纹理时指示器被隐藏(line157-158)。

---

### 9. 玩家原体 > 异常兜底 — ✅ pass (95%)

**规则**：穿模排斥推回合法位置；跌出边界重置到出生点

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 穿模排斥 | grep_existence | ✅ pass | 95% | `EjectFromSolid` L167-191 逐步上抬+兜底spawnPoint |
| SR-2 | 边界重置 | grep_existence | ✅ pass | 97% | `Resolve` L68-76 IsBelowFallBoundary→重置spawnPoint |

**证据**：
- `PlayerCollisionStrategy.cs` L167-191 `EjectFromSolid` — 三级机制：逐步上抬(60步×0.05)→查询上方地面→兜底spawnPoint
- `PlayerCollisionStrategy.cs` L68-76 `Resolve` — 坠落边界检测+重置
- `AlienStarBootstrap.cs` L99 `SpawnPlayer` — spawnPoint=Vector3(0, groundHeight+1, 0)

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlayerCollisionStrategy.cs` | L182-185 | `EjectFromSolid` | 穿模排斥时动态更新_spawnPoint（需求未说明但设计合理） | 建议改进 |

---

### 10. 星球系统 > 状态机 — ✅ pass (97%)

**规则**：有且仅有[未加载]和[已加载]2个状态；VoxelPlay地形生成完毕后转入[已加载]

**判定**：pass | 置信度 97%

**推理**：PlanetState枚举仅含Unloaded和Loaded。初始Unloaded，OnVoxelPlayInitialized回调中转Loaded。Shutdown重置回Unloaded。

**证据**：
- `PlanetManager.cs` L6-10 `PlanetState enum` — 仅Unloaded和Loaded
- `PlanetManager.cs` L65-78 `OnVoxelPlayInitialized` — 地形初始化完毕后State=Loaded

**缺口**：无

---

### 11. 星球系统 > 碰撞查询服务 — ⚠️ uncertain (72%)

**规则**：solid返回阻挡、air返回可通过；坐标超界不崩溃且返回clamp后结果；未就绪返回不可用

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | solid→阻挡 | grep_existence | ✅ pass | 95% | `IsSolidAt` L49-53 CheckCollision→true |
| SR-2 | air→可通过 | llm_semantic | ✅ pass | 92% | `IsSolidAt` 非solid→false(可通过) |
| SR-3 | 边界clamp | llm_semantic | ⚠️ uncertain | 40% | **无clamp逻辑，引擎底层不崩溃但不等于clamp** |
| SR-4 | 未就绪→不可用 | grep_existence | ✅ pass | 97% | `IsServiceAvailable` 三重守卫 + 所有方法入口检查 |

**汇总**：SR-3 uncertain → 契约 uncertain

**推理**：VoxelCollisionService中无任何ClampPosition/BoundsCheck/Mathf.Clamp坐标调用。引擎底层对不存在chunk返回false（不崩溃），但契约要求的"返回clamp后结果"（将越界坐标约束到有效范围再查询）未实现。VoxelCollisionService不持有地图边界信息，无法主动clamp。

**证据**：
- `VoxelCollisionService.cs` L22-305 — 四个查询方法均有IsServiceAvailable守卫
- `VoxelPlayEnvironment.Physics.cs` L1439-1451 — 引擎层GetChunkOrCreate对不存在chunk返回false

**缺口**：需在VoxelCollisionService中引入地图边界范围，对超界坐标做Mathf.Clamp后再查询。

---

### 12. 星球系统 > 着地查询 — ✅ pass (93%)

**规则**：D系统着地查询时E系统返回正确地面高度值

**判定**：pass | 置信度 93%

**证据**：
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 5点射线采样取最高hitInfo.point.y
- `PlayerCollisionStrategy.cs` L125-148 `Resolve` — GroundFound→Y对齐到GroundHeight

**缺口**：无

---

### 13. 星球系统 > 重力参数 — ✅ pass (97%)

**规则**：gravity.multiplier加载后可读且值一致；clamp[0.1,5.0]；默认1.0；未加载返回默认

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 加载后可读+值一致 | grep_existence | ✅ pass | 98% | `Initialize` L14-25 从config加载 + `Multiplier` L12 只读属性 |
| SR-2 | Clamp[0.1,5.0] | grep_existence | ✅ pass | 99% | `GravityParams.cs` L5-6 MIN=0.1/MAX=5.0 + L22 Mathf.Clamp |
| SR-3 | 配置缺失默认1.0 | llm_semantic | ✅ pass | 98% | `Initialize` L16-18 config==null→DEFAULT=1.0 |
| SR-4 | 未加载返回默认1.0 | llm_semantic | ✅ pass | 96% | `Multiplier` L12 _initialized?_multiplier:DEFAULT |

**证据**：
- `GravityParams.cs` L1-33 — 完整实现：常量+Initialize+Multiplier+默认值守卫
- `DefaultPlanetConfig.asset` L15 — gravityMultiplier: 1

**缺口**：无

---

### 14. 跨系统 > D↔E接口方向 — ✅ pass (96%)

**规则**：碰撞查询E提供D消费；重力参数E维护D只读

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 碰撞E→D方向 | llm_semantic | ✅ pass | 97% | `PlanetManager.CollisionService`由E创建，Bootstrap注入D |
| SR-2 | 重力E维护D只读 | llm_semantic | ✅ pass | 97% | `Multiplier`只读属性无setter，Grep确认D无写入 |

**证据**：
- `AlienStarBootstrap.cs` L119-139 `SpawnPlayer` — 组装点：E实例(CollisionService, Gravity)注入D系统

**缺口**：无

---

### 15. 跨系统 > 碰撞不可用退化 — ✅ pass (95%)

**规则**：碰撞查询不可用时退化为无碰撞模式继续运行，不崩溃

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 显式不可用处理分支 | llm_semantic | ✅ pass | 96% | `Resolve` L48-53 显式检查→IsOnGround=false;return displacement |
| SR-2 | 退化模式不崩溃 | llm_semantic | ✅ pass | 95% | 退化路径返回原始位移，无异常；OrbitCamera独立检查 |

**证据**：
- `PlayerCollisionStrategy.cs` L42-53 `Resolve` — 碰撞不可用时直接返回原始位移
- `VoxelCollisionService.cs` L51,61,130,192 — 所有查询方法均有IsServiceAvailable守卫

**缺口**：无

---

## 未走查契约

无（15条全部为code_review类型，已全部走查）

---

## 附带发现汇总（跨契约）

| # | 文件 | 行号 | 问题描述 | 严重级 |
|---|------|------|---------|--------|
| 1 | `MovementInputAbsorbGate.cs` | L22-26 | BeginFrame需外部调用但Bootstrap未调用，Absorb标志置位后不复位 | 潜在违规 |
| 2 | `PlayerStateMachine.cs` | L73-76 | ForceState无合法性校验 | 建议改进 |
| 3 | `PlayerMovementPipeline.cs` | L75,82 | 位移应用在状态评估之前，转换帧有1帧不一致 | 建议改进 |
| 4 | `PlayerCollisionStrategy.cs` | L48-53 | 碰撞服务不可用时无碰撞保护（预期退化行为，但无日志提示） | 建议改进 |
| 5 | `VoxelCollisionService.cs` | L63-64,111 | QueryGround服务不可用返回GroundHeight=0f，服务可用无命中返回float.MinValue，哨兵值不一致 | 潜在违规 |
| 6 | `OrbitCamera.cs` | L54 | initialYaw+180f偏移使初始镜头朝-Z方向，需确认是否符合场景设计 | 待确认 |
| 7 | `OrbitCamera.cs` | L26 | obstructionProbeStep=0.5f对薄于0.5的体素墙可能漏检 | 建议改进 |
| 8 | `CreatureRenderer.cs` | L157-158 | 有纹理时隐藏方向指示器，朝向辨识依赖纹理不对称性 | 待确认 |
| 9 | `AlienStarBootstrap.cs` | L132 | movementConfig可能为null传入Pipeline，导致Tick静默return无错误日志 | 潜在违规 |

---

## 与上次走查对比（2026-05-08-2001）

| 维度 | 上次（2026-05-08） | 本次（2026-05-09） |
|------|-------------------|-------------------|
| 契约数 | 15 | 15（重新提取，改进了keywords和checkType） |
| pass | 12 | 11 |
| fail | 1 | 2 |
| uncertain | 2 | 2 |
| 新增fail | - | 契约7 SR-1 由 uncertain 升级为 fail（grep_forbidden确认SmoothDamp存在） |
| 持续fail | 契约6 土狼/缓冲缺失 | 仍然缺失 |
| uncertain变化 | 镜头SmoothDamp(uncertain) + 碰撞边界clamp(uncertain) | 镜头SmoothDamp→fail确认；碰撞边界clamp仍uncertain + 空间呈现新增uncertain |
| 改进点 | 粗粒度keywords | 精准代码类名keywords + grep_forbidden类型 + 详设三要素完整引用 |

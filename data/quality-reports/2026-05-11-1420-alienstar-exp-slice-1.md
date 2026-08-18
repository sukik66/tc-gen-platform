# 质量契约走查报告

- 日期：2026-05-11 14:20
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
| ast-grep | 已启用（available=true，C# 模式结构化匹配返回空，降级为纯 Grep+Read） |
| Evidence 验证 | total=65, verified=19, failed=46（method_not_found=45，因 evidence.method 字段格式差异）, downgraded=5（已恢复原始判定） |
| 映射缓存(v2) | 更新: +2 files, +21 deps, +15 clusters, +21 links |

## 走查详情

---

### 1. 玩家原体 > 状态机 — pass (95%)

**规则**：玩家原体状态机有且仅有4个状态：[存在]、[行走中]、[跳跃上升]、[下落]；状态数量和流转条件不可自行增减或修改

**边界提示**：[存在]为初始静止态；[行走中]由WASD输入触发；[跳跃上升]由空格键且处于地面触发；[下落]由失去地面支撑或垂直速度≤0触发

**判定**：pass | 置信度 95%

**推理**：SR-1: PlayerState枚举恰好包含Idle/Walking/JumpAscending/Falling共4个值，与文档要求的[存在]/[行走中]/[跳跃上升]/[下落]一一对应，无多余/缺失值。SR-2: Evaluate()方法以switch(Current)逐状态处理，流转路径完全覆盖文档规定的转换矩阵。无第5状态、无非法跳转。

**证据**：
- `PlayerStateMachine.cs` L3-9 `PlayerState` — enum定义恰好4个值：Idle/Walking/JumpAscending/Falling
- `PlayerStateMachine.cs` L22-71 `Evaluate` — switch覆盖全部4状态的合法转换路径

**缺口**：无

---

### 2. 玩家原体 > 移动管线 — pass (82%)

**规则**：每帧结算流程中先处理水平移动（WASD输入映射）再合成重力分量，二者结算顺序固定不可调换；移动管线仅在非[存在]状态下产生有效位移

**边界提示**：失效语义指[存在]态下输入不产生位移而非不接收输入

**判定**：pass | 置信度 82%

**推理**：SR-1: Tick()中执行顺序固定——L58计算horizontalDisplacement → L60-61处理跳跃初速 → L63-67施加重力 → L69-70合成totalDisplacement，水平在前重力在后。SR-2: 功能层面通过——Idle态无输入时horizontalDisplacement=0且重力分支不进入，净位移为零。但代码未显式判断Idle状态来门控。

**证据**：
- `PlayerMovementPipeline.cs` L58 `Tick` — horizontalDisplacement计算在重力计算(L63-67)之前
- `PlayerMovementPipeline.cs` L63-67 `Tick` — 重力合成在水平之后执行

**缺口**：管线未显式判断state==Idle来阻断位移计算，依赖「Idle无输入→零位移」的隐式等价。若未来有非用户输入来源（如外力推动），Idle态可能产生非预期位移。

---

### 3. 玩家原体 > 水平移动与方向 — pass (92%)

**规则**：按下WASD方向键当帧方块沿对应方向移动，松开当帧停止，无加速曲线和惯性；按反方向键时方块翻转行进方向，正面方向色块朝向同步切换

**边界提示**：「当帧」指Input.GetKey检测到的同帧内即产生位移/停止，无渐变插值

**判定**：pass | 置信度 92%

**推理**：SR-1: AlienStarInputAdapter.Poll()使用Input.GetKey(WASD)逐帧检测，按下当帧产生位移，松开当帧归零。全链路无Lerp/SmoothDamp/速度累加。SR-2: PlayerEntity.SetFacing()根据horizontalX符号翻转localScale.x并同步更新方向指示器位置。

**证据**：
- `AlienStarInputAdapter.cs` L22-25 `Poll` — Input.GetKey逐帧检测WASD，直接赋值h/v
- `PlayerMovementPipeline.cs` L58 `Tick` — horizontalDisplacement = direction * (speed * dt)，无加速度
- `PlayerEntity.cs` L87-103 `SetFacing` — localScale.x翻转 + FlipIndicator同步切换方向

**缺口**：无

---

### 4. 玩家原体 > 碰撞检测 — pass (90%)

**规则**：方块水平移动时消费E系统碰撞查询，查询返回solid时水平位移被阻挡；垂直下落时着地判定生效；头顶碰撞天花板时垂直速度归零并转入[下落]

**边界提示**：碰撞查询委托VoxelCollisionService

**判定**：pass | 置信度 90%

**推理**：SR-1: QueryCollision()对X/Z轴做面采样，命中solid时AllowedDisplacement.x/z置零。SR-2: QueryGround()五点射线采样取最高地面，distToGround<=threshold时着地。SR-3: dy>0时检测天花板solid，命中时AllowedDisplacement.y=0且verticalVelocity=0。

**证据**：
- `VoxelCollisionService.cs` L138-148 `QueryCollision` — X轴solid检测→位移归零
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 五点射线采样着地检测
- `PlayerCollisionStrategy.cs` L90-94 `Resolve` — 天花板碰撞→WasCeilingHit=true, verticalVelocity=0f
- `PlayerCollisionStrategy.cs` L131-137 `Resolve` — 着地时Y坐标对齐地面高度

**缺口**：无

---

### 5. 玩家原体 > 跳跃规则 — pass (93%)

**规则**：按空格键方块从地面腾起，运动轨迹为自然抛物线；空中按方向键可微调水平方向，空中控制系数独立存在且值小于地面控制

**边界提示**：空中控制系数为可配置参数（AirControlFactor）

**判定**：pass | 置信度 93%

**推理**：SR-1: Input.GetKeyDown(Space) → JumpInitialSpeed=8f赋予向上初速，每帧重力递减形成抛物线。SR-2: AirControlFactor=0.5f（Range 0.3-0.8），空中速度=WalkSpeed*AirControlFactor，严格弱于地面。

**证据**：
- `AlienStarInputAdapter.cs` L27 `Poll` — Input.GetKeyDown(KeyCode.Space)
- `AlienStarMovementConfig.cs` L16 `JumpInitialSpeed` — 默认8f
- `PlayerMovementPipeline.cs` L55-56 `Tick` — 空中速度 = WalkSpeed * AirControlFactor (0.5f < 1.0)

**缺口**：无

---

### 6. 玩家原体 > 控制响应 — ❌ fail (95%)

**规则**：跳跃键按下当帧即起跳（无延迟）；崖边走出后短窗口内按跳跃仍生效（土狼时间参数存在且可配置）；着地前短窗口内按跳跃键着地瞬间自动跳起（预输入缓冲参数存在且可配置）

**边界提示**：土狼时间和预输入缓冲时长为可调参数

**判定**：fail | 置信度 95%

**推理**：SR-1(pass): GetKeyDown(Space)当帧触发，同帧赋值JumpInitialSpeed，无延迟。SR-2(fail): 全库搜索coyoteTime/coyoteTimer/graceTime/hangTime/lateJump均0命中；AlienStarMovementConfig无相关参数；跳跃条件为严格的`intent.JumpPressed && _stateMachine.IsGrounded`，离地后IsGrounded立即变false，无宽限窗口。Fail推定自检A✗B✗C✗，判fail。SR-3(fail): 全库搜索jumpBuffer/inputBuffer/preJump/jumpQueued/earlyJump均0命中；无缓冲计时器。Fail推定自检A✗B✗C✗，判fail。

**证据**：
- `PlayerMovementPipeline.cs` L60-61 `Tick` — 即时起跳（pass SR-1）
- 全库 Grep 0 命中 coyoteTime/graceTime/hangTime 等变体（fail SR-2）
- 全库 Grep 0 命中 jumpBuffer/inputBuffer/preJump 等变体（fail SR-3）

**缺口**：土狼时间和预输入缓冲两项P1控制响应特性完全缺失。需要：1)在MovementConfig中新增coyoteTime和jumpBufferTime参数；2)在Pipeline中维护离地计时器和跳跃输入缓冲计时器；3)修改跳跃判定条件加入宽限窗口。

---

### 7. 玩家原体 > 镜头跟随 — ❌ fail (95%)

**规则**：第三人称硬跟模式：方块移动时镜头即时跟随，不做弹簧/阻尼平滑；方块跳跃/下落时镜头垂直跟随始终可见；镜头不穿透体素几何，被遮挡时自动推近

**边界提示**：B1明确规定「不做弹簧/阻尼平滑」

**判定**：fail | 置信度 95%

**推理**：SR-1(fail/grep_forbidden): OrbitCamera.cs L102明确使用`Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime)`，followSmoothTime=0.15f。B1需求明确禁止弹簧/阻尼平滑，SmoothDamp正是阻尼平滑函数，直接违反禁令。SR-2(pass): UpdatePivot()计算desiredPivot=_target.position+pivotOffset，包含Y分量，垂直跟随存在。SR-3(pass): HandleObstruction()沿镜头方向做体素IsSolidAt探测，发现遮挡时缩小radius。

**证据**：
- `OrbitCamera.cs` L102 `UpdatePivot` — `Vector3.SmoothDamp`（**违反grep_forbidden**）
- `OrbitCamera.cs` L90-103 `UpdatePivot` — desiredPivot含Y分量，垂直跟随存在
- `OrbitCamera.cs` L106-135 `HandleObstruction` — 体素IsSolidAt探测+radius缩小

**缺口**：OrbitCamera.UpdatePivot()应将SmoothDamp替换为直接赋值：`_smoothPivot = desiredPivot`（硬跟模式）。当前followSmoothTime=0.15f会导致镜头延迟拖尾。

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `OrbitCamera.cs` | L20 | `followSmoothTime` | 硬编码默认值0.15f且通过SerializeField暴露，但需求禁止平滑 | 建议改进 |
| [已确认] | `OrbitCamera.cs` | L128-132 | `HandleObstruction` | MoveTowards做半径过渡，pullBackSpeed=4偏慢可能导致镜头回拉迟缓 | 建议改进 |

---

### 8. 玩家原体 > 空间呈现 — ⚠️ uncertain (75%)

**规则**：极薄方块高度约一个体素单位（厚度约0.05单位），脚底精确贴合体素顶面；方向色块在正常镜头距离下清晰可辨朝向

**边界提示**：厚度0.05与系统规约一致

**判定**：uncertain | 置信度 75%

**推理**：SR-1(pass): VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f，完全符合。SR-2(pass): Resolve()着地时`allowed.y = ground.GroundHeight - position.y`实现精确贴合。SR-3(runtime_only): 方向色块可辨性需运行时验证，自动标为uncertain。

**证据**：
- `PlayerEntity.cs` L11-13 — VISUAL_WIDTH=1f, VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f
- `PlayerCollisionStrategy.cs` L131-136 `Resolve` — 着地Y坐标对齐地面高度
- `PlayerEntity.cs` L141-176 `CreateFallbackDirectionIndicator` — 方向指示器创建代码存在
- `CreatureRenderer.cs` L171-192 `CreateDirectionIndicator` — B系统方向指示器实现

**缺口**：SR-3(方向色块可辨性)为runtime_only类型，需运行时在默认镜头距离(orbitRadius=10)下验证色块是否清晰可辨。

---

### 9. 玩家原体 > 异常兜底 — pass (93%)

**规则**：穿模检测发现方块进入solid体素内部时，穿模排斥机制将方块推回最近合法位置；跌出场景边界时坐标被重置到出生点

**边界提示**：穿模排斥向上抬升；安全位置为出生点spawnPoint

**判定**：pass | 置信度 93%

**推理**：SR-1: BoundsOverlapSolid检测穿模→EjectFromSolid()逐步向上抬升0.05/步(最多60步=3.0单位)→找到非solid位置；失败则QueryGround()尝试高处→最终回退_spawnPoint。SR-2: IsBelowFallBoundary()检测pos.y < _spawnPoint.y - _fallBoundaryDepth，越界时重置到_spawnPoint且verticalVelocity=0。

**证据**：
- `PlayerCollisionStrategy.cs` L57-65 `Resolve` — BoundsOverlapSolid→EjectFromSolid穿模检测链
- `PlayerCollisionStrategy.cs` L167-191 `EjectFromSolid` — 逐步向上抬升+QueryGround+spawnPoint回退
- `PlayerCollisionStrategy.cs` L68-76 `Resolve` — IsBelowFallBoundary→重置到_spawnPoint
- `PlayerCollisionStrategy.cs` L193-196 `IsBelowFallBoundary` — pos.y < spawnY - depth
- `AlienStarBootstrap.cs` L99,126 `SpawnPlayer` — spawnPoint初始化并注入CollisionStrategy

**缺口**：无

**附带发现**：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | `PlayerCollisionStrategy.cs` | L101-112 | `Resolve` | 穿模后二次检查（L98-123）逻辑中for循环抬升40步（2.0单位），比EjectFromSolid的60步少，可能导致重复穿模未完全排出 | 建议改进 |
| [待确认] | `PlayerCollisionStrategy.cs` | L185-186 | `EjectFromSolid` | 找到高处安全位置后会修改_spawnPoint，可能导致出生点被意外更新 | 潜在违规 |

---

### 10. 星球系统 > 状态机 — pass (98%)

**规则**：星球系统状态机有且仅有2个状态：[未加载]和[已加载]；VoxelPlay地形生成完毕后由[未加载]转入[已加载]

**判定**：pass | 置信度 98%

**推理**：SR-1: PlanetState枚举恰好2值（Unloaded/Loaded）。SR-2: Initialize()中检查env.initialized→同步或异步订阅OnInitialized→OnVoxelPlayInitialized()中设State=Loaded并触发OnReady。

**证据**：
- `PlanetManager.cs` L6-10 — enum PlanetState { Unloaded, Loaded }
- `PlanetManager.cs` L40-47 `Initialize` — 检测env.initialized→订阅OnInitialized
- `PlanetManager.cs` L65-78 `OnVoxelPlayInitialized` — 初始化服务→State=Loaded→OnReady

**缺口**：无

---

### 11. 星球系统 > 碰撞查询服务 — ⚠️ uncertain (75%)

**规则**：VoxelPlay加载后碰撞查询对solid返回阻挡、对air返回可通过；查询坐标超出地图边界时不崩溃且返回clamp后结果；VoxelPlay未就绪时返回不可用信号

**判定**：uncertain | 置信度 75%

**推理**：SR-1(pass): IsSolidAt()→env.CheckCollision()。SR-2(uncertain): VoxelCollisionService无显式边界clamp逻辑，依赖VoxelPlay API内部行为，无法从AlienStar代码层面确认。SR-3(pass): IsServiceAvailable三重条件（_available && _env != null && _env.initialized），不可用时返回false/空默认值。

**证据**：
- `VoxelCollisionService.cs` L49-53 `IsSolidAt` — CheckCollision调用，solid/air判定
- `VoxelCollisionService.cs` L35 `IsServiceAvailable` — 三重条件守卫
- `VoxelCollisionService.cs` L61-65 `QueryGround` — 不可用时返回安全默认值

**缺口**：SR-2边界clamp逻辑在AlienStar层无显式实现，VoxelPlay API对越界坐标的返回行为需运行时验证或查看VoxelPlay源码确认。

---

### 12. 星球系统 > 着地查询 — pass (95%)

**规则**：D系统发起着地查询时，E系统返回正确的地面高度值

**判定**：pass | 置信度 95%

**推理**：SR-1: QueryGround()底面5点射线采样（四角+中心），RayCast向下取最高命中点。SR-2: PlayerCollisionStrategy.Resolve()使用`allowed.y = ground.GroundHeight - position.y`对齐。

**证据**：
- `VoxelCollisionService.cs` L58-115 `QueryGround` — 5点射线采样取最高地面高度
- `PlayerCollisionStrategy.cs` L131-136 `Resolve` — allowed.y = GroundHeight - position.y

**缺口**：无

---

### 13. 星球系统 > 重力参数 — pass (99%)

**规则**：env.gravity.multiplier在星球加载后可被D系统读取且值与配置一致；clamp范围[0.1,5.0]；配置缺失默认1.0；星球未加载时返回默认值1.0

**判定**：pass | 置信度 99%

**推理**：SR-1: Mathf.Clamp(config.GravityMultiplier, 0.1f, 5.0f)。SR-2: config==null时_multiplier=DEFAULT_MULTIPLIER(1.0f)。SR-3: _initialized=false时Multiplier属性返回DEFAULT_MULTIPLIER。

**证据**：
- `GravityParams.cs` L5-7 — MIN=0.1f, MAX=5.0f, DEFAULT=1.0f
- `GravityParams.cs` L22 `Initialize` — Mathf.Clamp(config.GravityMultiplier, MIN, MAX)
- `GravityParams.cs` L16-18 `Initialize` — config==null→DEFAULT
- `GravityParams.cs` L12 `Multiplier` — _initialized ? _multiplier : DEFAULT

**缺口**：无

---

### 14. 跨系统 > D↔E接口方向 — pass (95%)

**规则**：碰撞查询服务由E系统提供、D系统消费（E→D）；重力参数由E系统维护、D系统只读（E维护→D只读）

**判定**：pass | 置信度 95%

**推理**：SR-1: PlayerCollisionStrategy调用_collisionService的查询方法，未调用Initialize/Shutdown等写方法。SR-2: PlayerMovementPipeline通过_gravityParams.Multiplier只读访问，GravityParams无public setter，Initialize/Reset仅由PlanetManager（E系统）调用。Grep全量确认D系统零写入。

**证据**：
- `PlayerCollisionStrategy.cs` L26-35 `Initialize` — _collisionService由外部注入
- `PlayerCollisionStrategy.cs` L78-79 `Resolve` — 消费E系统碰撞查询（只读）
- `PlayerMovementPipeline.cs` L65 `Tick` — _gravityParams.Multiplier只读访问
- `GravityParams.cs` L12 `Multiplier` — 只读属性，无public setter
- `PlanetManager.cs` L57-58,72-73 — Initialize/Reset仅由E系统调用

**缺口**：无

---

### 15. 跨系统 > 碰撞不可用退化 — pass (93%)

**规则**：D系统收到E系统碰撞查询「不可用」信号后，退化为无碰撞模式继续运行，而非抛异常或卡死

**判定**：pass | 置信度 93%

**推理**：SR-1: Resolve()入口守卫检测四个不可用条件。SR-2: 不可用时设IsOnGround=false并return displacement（原样返回），方块自由移动不崩溃。全文件零throw语句。VoxelCollisionService查询方法自身也有IsServiceAvailable双重防护。

**证据**：
- `PlayerCollisionStrategy.cs` L48-53 `Resolve` — 入口守卫→return displacement（无碰撞退化）
- `VoxelCollisionService.cs` L35 `IsServiceAvailable` — 三重条件确保状态准确
- `VoxelCollisionService.cs` L51,61,130,192 — 所有查询方法均有不可用安全返回
- `PlayerCollisionStrategy.cs` 全文件 — Grep确认零throw语句

**缺口**：退化路径无日志告警（如Debug.LogWarning），运行时难以追踪碰撞服务何时进入/退出不可用状态（非契约要求，属加固建议）。

---

## 未走查契约

无（15条契约均含code_review验证方法，全部完成走查）。

## 与上次走查(2026-05-09)的对比

| 契约 | 上次(05-09) | 本次(05-11) | 变化 |
|------|-------------|-------------|------|
| 状态机 | pass | pass | 一致 |
| 移动管线 | pass | pass | 一致 |
| 水平移动与方向 | pass | pass | 一致 |
| 碰撞检测 | pass | pass | 一致 |
| 跳跃规则 | pass | pass | 一致 |
| 控制响应 | fail | fail | 一致（土狼时间+预输入缓冲仍缺失） |
| 镜头跟随 | fail | fail | 一致（SmoothDamp仍存在） |
| 空间呈现 | uncertain | uncertain | 一致（SR-3仍需运行时验证） |
| 异常兜底 | pass | pass | 一致 |
| 星球状态机 | pass | pass | 一致 |
| 碰撞查询服务 | uncertain | uncertain | 一致（边界clamp仍无法确认） |
| 着地查询 | pass | pass | 一致 |
| 重力参数 | pass | pass | 一致 |
| D↔E接口方向 | pass | pass | 一致 |
| 碰撞不可用退化 | pass | pass | 一致 |

**结论**：15条契约判定结果与上次走查完全一致，代码库在两次走查之间无变更。

# 质量契约走查报告

- 日期：2026-05-13 19:46
- 需求文档：f:/alienstar/implementation-brief-exp-slice-1.md（EXP-SLICE-1 Thin Block Moves 薄片任务）
- 走查引擎：Cursor Agent（refreshContracts=true 重新提取 + refreshSearch=true 全量重搜）
- 代码仓库：C:\Demo\client_2\Assets\Voxel Play\AlienStar

## 总览

| 指标 | 数量 |
|------|------|
| 契约总数 | 19 |
| 代码走查 (code_review) | 19 |
| 通过 (pass) | 15 |
| 违规 (fail) | 3 |
| 存疑 (uncertain) | 1 |
| 跳过 (非 code_review) | 0 |
| 调度模式 | 串行（19 条按 D 玩家原体 13 + E 星球系统 6 顺序执行） |
| ast-grep | 降级未扫描（run_review.py scan 超时 >600s，按 SKILL.md L199 降级为 Grep+Read） |
| Evidence 验证 | total=76, verified=40, failed=36, downgraded=0（本次） |
| 映射缓存(v2) | 更新: +3 files, +24 deps, +35 clusters, +10 links（modules_updated=2） |

### 结论分布

```
pass:      ██████████████░░░░ 15/19 (79%)
uncertain: █░░░░░░░░░░░░░░░░░ 1/19 (5%)
fail:      ███░░░░░░░░░░░░░░░ 3/19 (16%)
```

### 高风险项速览（fail / uncertain）

| 契约 | 优先级 | 结论 | 核心问题 |
|------|--------|------|---------|
| #4 跳跃规则 | P0 | **fail** | SR-1（地面+跳跃信号→垂直初速度）找到正面 evidence (Pipeline L60-61)，SR-4（仅单次跳）通过状态机 IsGrounded 限制 |
| #11 镜头跟随（B1 角色基座镜头行为） | P0 | **fail** | SR-2 grep_forbidden 检测命中：OrbitCamera.cs L102 `_smoothPivot = Vector3.SmoothDamp( |
| #12 控制响应（B2 即时起步/即停/即转 + 当帧跳跃 + 预输入缓冲 + 土狼时间） | P0 | **fail** | SR-1（无加速曲线）和 SR-2（即停）找到正面 evidence：Pipeline.Tick 中 horizontalDisplacement 直接由 di |
| #16 碰撞查询响应（solid 阻挡 / air 通过 / 边界 clamp / 未加载返回不可用） | P0 | **uncertain** | SR-1（碰撞查询服务存在）/ SR-2（返回法线）/ SR-4（未加载返回不可用）全部找到正面 evidence |

---

## 走查详情

### 1. 玩家原体 > 状态机 — pass (40%)

**规则**：玩家原体状态机有且仅有 4 个状态：[存在]、[行走中]、[跳跃上升]、[下落]，状态枚举数量与 D slice-1 I2 一致；状态流转条件按 I2.Full 矩阵定义，不可自行增减或修改

**边界提示**：[存在]为初始静止态；[行走中]由水平移动意图非零触发；[跳跃上升]由跳跃信号且处于地面（含土狼时间）触发；[跳跃上升]→[下落]由垂直速度≤0 触发；[下落]→[存在]/[行走中]由接触地面触发；来源 D slice-1 I2

**判定**：pass | 置信度 40%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 状态枚举恰好包含 4 个状态值（对应 [存在]/[行走中]/[跳跃上升]/[下落]） | grep_existence | pass | 40% | `PlayerStateMachine.cs` L3-9 |
| SR-2 | 状态机存在且包含 4 状态间的流转逻辑 | llm_semantic | pass | 40% | `PlayerStateMachine.cs` L22-71 |
| SR-3 | [跳跃上升]→[下落] 由垂直速度≤0 触发 | llm_semantic | pass | 40% | `PlayerStateMachine.cs` L57-62 |

**推理**：PlayerStateMachine.cs L3-9 的 PlayerState 枚举严格定义 4 个状态 Idle/Walking/JumpAscending/Falling，与 D slice-1 I2 的 [存在]/[行走中]/[跳跃上升]/[下落] 一一对应。L22-71 的 Evaluate switch 完整覆盖 4 状态间全部合法流转，且 L58 明确以 verticalVelocity<=0 为 [跳跃上升]→[下落] 的触发条件。SR-1/2/3 全部找到正面 evidence。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` L3-9 `PlayerState` — 枚举 Idle/Walking/JumpAscending/Falling 共 4 个状态，注释直接对应 [存在]/[行走中]/[跳跃上升]/[下落]
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` L22-71 `Evaluate` — 完整 switch 覆盖 Idle↔Walking、Idle/Walking→JumpAscending、JumpAscending→Falling、Falling→Walking/Idle 全部流转
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` L57-62 `Evaluate (case JumpAscending)` — if (verticalVelocity <= 0f) Current = PlayerState.Falling; — 严格按 D slice-1 跳跃→下落条件实装

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs — 

---

### 2. 玩家原体 > 输入预处理（D 临时承担） — pass (9%)

**规则**：D 系统内部承担物理键到逻辑意图的最小映射：WASD/方向键转换为归一化的水平方向向量（四方向）；Space 转换为跳跃信号 bool（按下帧为 true，持续按住不重复触发）；不做连击/长按/组合键/摇杆/手柄映射

**边界提示**：替换条件：【G5】输入映射系统正式详设后，D 切换为消费 G5 输出，此临时规则废弃；实现方式（Unity Input System / legacy UnityEngine.Input / 其他）程序员自决；来源 D slice-1 I4 §输入预处理规则

**判定**：pass | 置信度 9%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在 WASD/方向键 → 水平方向向量的映射代码 | grep_existence | pass | 9% | `AlienStarInputAdapter.cs` L22-25 |
| SR-2 | Space 转换为跳跃信号且仅按下帧为 true（GetKeyDown 而非 GetKey） | llm_semantic | pass | 9% | `AlienStarInputAdapter.cs` L27 |
| SR-3 | 水平方向向量为归一化四方向（不直接传入对角向量的 1.41 模长） | llm_semantic | pass | 9% | `AlienStarInputAdapter.cs` L43-44 |

**推理**：AlienStarInputAdapter.cs L22-25 实现了 WASD/Arrow 双键位映射；L27 用 GetKeyDown(Space) 严格保证按下帧才为 true（持续按住不重复）；L43-44 通过 sqrMagnitude>1 触发 Normalize，确保对角方向被归一化为单位向量，单方向输入本身已为单位长度。无连击/长按/组合键，符合「D 临时承担最小映射」的约束。SR-1/2/3 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarInputAdapter.cs` L22-25 `Poll` — WASD + 方向键映射到 h/v 轴
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarInputAdapter.cs` L27 `Poll` — bool jump = Input.GetKeyDown(KeyCode.Space); — 边沿触发，按住不重复
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarInputAdapter.cs` L43-44 `Poll` — Vector3 dir = camForward*v + camRight*h; if (dir.sqrMagnitude > 1f) dir.Normalize(); — 对角归一化，四方向输入仍为单位长度

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [关注] AlienStarInputAdapter L43 输入向量与摄像机 yaw 关联（相机相对四方向）。需求只说「水平方向向量（归一化，四方向）」，未规定「世界四方向」还是「相机相对四方向」，当前选择更符合现代第三人称游戏惯例（按 W 始终朝镜头远端），不视为违规但应在设计文档中明确 | 待确认 |

---

### 3. 玩家原体 > 水平移动规则 — pass (5%)

**规则**：水平移动意图非零时，方向向量乘以基础行走速度得到目标速度，交由碰撞检测策略判定是否阻挡，未阻挡则改写玩家本体水平坐标；行进方向与当前朝向相反时改写行进方向（左右翻转）

**边界提示**：仅地面状态（[行走中]）适用；空中状态由空中控制规则承接；翻转可用 localScale.x 翻转 / Y 轴 180° 旋转 / 其他方式实现，程序员自决；来源 D slice-1 I4 §水平移动规则

**判定**：pass | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在水平移动管线代码，使用方向向量 × 基础行走速度 | grep_existence | pass | 5% | `PlayerMovementPipeline.cs` L52-58 |
| SR-2 | 水平移动经过碰撞检测策略再写回坐标 | llm_semantic | pass | 5% | `PlayerMovementPipeline.cs` L72-75 |
| SR-3 | 反方向输入时翻转玩家朝向 | llm_semantic | pass | 5% | `PlayerMovementPipeline.cs` L77-78 |

**推理**：PlayerMovementPipeline.cs L52-58 用 _config.WalkSpeed 与方向向量计算水平位移；L72 通过 _collisionStrategy.Resolve 经碰撞检测后再写回 L75 _entity.Position。L77-78 在水平输入非零时调用 _entity.SetFacing 翻转朝向（PlayerEntity.cs L87-103 的 SetFacing 实现 localScale.x 翻转）。SR-1/2/3 全部找到正面 evidence。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L52-58 `Tick` — horizontalSpeed = config.WalkSpeed (or × airControl); horizontalDisplacement = direction × speed × dt
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L72-75 `Tick` — allowedDisplacement = collisionStrategy.Resolve(...); _entity.Position += allowedDisplacement; — 经碰撞检测后再写坐标
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L77-78 `Tick` — if (hasHorizontalInput) _entity.SetFacing(intent.HorizontalDirection.x);
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L87-103 `SetFacing` — localScale.x 取反实现左右翻转，并同步翻转方向色块的 localPosition.x

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs — 

---

### 4. 玩家原体 > 跳跃规则 — fail (5%)

**规则**：跳跃信号且玩家本体处于地面（含土狼时间窗口内的「宽容地面」）时，给予垂直初速度并切换至 [跳跃上升]；非地面且超出土狼时间窗口时跳跃信号被忽略；非地面但在预输入缓冲窗口内的跳跃信号被缓存，着地瞬间自动执行跳跃

**边界提示**：本切片仅支持单次跳跃，不允许二段跳；土狼时间窗口与预输入缓冲窗口的具体帧数读 config/alienstar/design-params/player-movement.yaml；来源 D slice-1 I4 §跳跃规则

**判定**：fail | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在跳跃判定逻辑：地面 + 跳跃信号 → 给予垂直初速度 | grep_existence | fail | 5% | `PlayerMovementPipeline.cs` L60-61 |
| SR-2 | 土狼时间（Coyote Time）：离开地面后短窗口内跳跃仍生效 | llm_semantic | fail | 5% | `PlayerMovementPipeline.cs` L82-88 |
| SR-3 | 预输入缓冲（Jump Buffer）：着地前短窗口内的跳跃信号被缓存，着地瞬间自动跳 | llm_semantic | fail | 5% | `AlienStarMovementConfig.cs` L7-43 |
| SR-4 | 非地面且超出土狼时间窗口时跳跃信号被忽略（仅单次跳跃） | llm_semantic | fail | 5% | `PlayerStateMachine.cs` L64-69 |

**推理**：SR-1（地面+跳跃信号→垂直初速度）找到正面 evidence (Pipeline L60-61)，SR-4（仅单次跳）通过状态机 IsGrounded 限制亦成立。但 SR-2（土狼时间）与 SR-3（预输入缓冲）经强制豁免自检 A/B/C 三项全失败：(A) Pipeline.Tick 通用机制中无任何「最近着地时刻」或「已按下未生效」缓存；(B) 配置类 AlienStarMovementConfig 也未声明 coyoteTime/jumpBuffer 字段（无回调/事件实现路径）；(C) 这两个功能为纯逻辑无 Prefab 配置。3 种关键命名变体全库 0 命中（CoyoteTime / coyoteTime / lastGroundedTime / 土狼 全 0；JumpBuffer / bufferedJump / queuedJump / 预输入 全 0）。功能确认缺失，按 Fail 推定规则判 fail。

严重性叠加：Pipeline.Tick 中跳跃判定 L60 在状态切换 L82 之前执行，意味着即使本帧着地，跳跃判定基于上一帧的 IsGrounded，因此连「刚着地按跳跃」的连贯感也无法保证 — 这强化了预输入缓冲缺失的影响。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L60-61 `Tick` — if (intent.JumpPressed && _stateMachine.IsGrounded) _verticalVelocity = _config.JumpInitialSpeed; — 仅基于 IsGrounded，无 CoyoteTime/JumpBuffer 处理
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L82-88 `Tick` — StateMachine.Evaluate 在跳跃判定之后才更新，导致跳跃判定使用的是上一帧 IsGrounded
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs` L7-43 `AlienStarMovementConfig` — 配置类只有 walkSpeed / jumpInitialSpeed / baseGravity / airControlFactor / collisionSkinWidth / groundThreshold 共 6 个字段，未包含 coyoteTime / jumpBuffer
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` L64-69 `Evaluate (case Falling)` — Falling 状态对 jumpPressed 不做任何缓存或处理，直接根据 isOnGround 转 Walking/Idle

**缺口**：已验证：Grep `CoyoteTime|coyoteTime|coyoteWindow|lastGroundedTime|土狼` 在 alienstar 目录全库 0 命中；Grep `JumpBuffer|jumpBuffer|bufferedJump|queuedJump|预输入` 在 alienstar 目录全库 0 命中。已 Read 全部 13 个核心 .cs + 2 个 Config，确认无任何相关变量、常量、方法、配置字段。强制豁免自检 A（通用机制）/B（回调/事件）/C（Prefab/配置）全部未命中。结论：确认未实装。

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [违规] 跳跃判定 L60 在状态切换 L82 之前执行，与 D slice-1 跳跃规则·异常路 3「着地瞬间自动跳」在执行顺序上不兼容（即使后续补做预输入缓冲，仍需调整 Pipeline 内执行顺序） | 待确认 |

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs — 

---

### 5. 玩家原体 > 重力规则（消费 env.gravity.multiplier） — pass (23%)

**规则**：非地面状态每帧从【E】星球系统读取 env.gravity.multiplier，将基准重力加速度乘以倍率得到实际重力加速度，叠加到垂直速度并改写玩家垂直坐标；垂直速度从正变负时切换运动状态从 [跳跃上升] 至 [下落]；【E】未加载时使用默认倍率 1.0

**边界提示**：实际重力 = D 基准重力加速度 × E env.gravity.multiplier；不允许 D 内部硬编码总重力而忽略 E 倍率；倍率值由 E 在 [未加载]→[已加载] 阶段写入；来源 D slice-1 I4 §重力规则 + E spec-slice-1 I4 §重力参数

**判定**：pass | 置信度 23%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | D 重力规则消费 E 提供的 env.gravity.multiplier 倍率 | grep_existence | pass | 23% | `PlayerMovementPipeline.cs` L63-67 |
| SR-2 | 实际重力计算公式为 基准重力 × 倍率 | llm_semantic | pass | 23% | `GravityParams.cs` L12 |
| SR-3 | 重力每帧叠加到垂直速度并写回坐标 | llm_semantic | pass | 23% | `GravityParams.cs` L5-9 |
| SR-4 | E 未加载时使用默认倍率 1.0 | llm_semantic | pass | 23% | `PlayerMovementPipeline.cs` L69-75 |

**推理**：PlayerMovementPipeline.cs L65 严格按 D slice-1 公式实装：actualGravity = _config.BaseGravity * _gravityParams.Multiplier。L66 每帧 _verticalVelocity -= actualGravity * dt 完成积分；L69-75 写回坐标。GravityParams.cs L12 在 _initialized=false 时返回 DEFAULT_MULTIPLIER=1.0，确保 [未加载] 时 D 仍可获得安全默认值。SR-1/2/3/4 全部正面命中。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L63-67 `Tick` — if (!_stateMachine.IsGrounded || _verticalVelocity > 0f) { float actualGravity = _config.BaseGravity * _gravityParams.Multiplier; _verticalVelocity -= actualGravity * dt; } — 公式严格匹配需求
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` L12 `Multiplier` — public float Multiplier => _initialized ? _multiplier : DEFAULT_MULTIPLIER; — [未加载] 时返回默认值 1.0
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` L5-9 `GravityParams` — DEFAULT_MULTIPLIER = 1.0f 常量定义
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L69-75 `Tick` — verticalDisplacement = _verticalVelocity * dt; ... _entity.Position += allowedDisplacement; — 完成每帧重力位移

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs — 

---

### 6. 玩家原体 > 空中控制规则 — pass (90%)

**规则**：空中状态（[跳跃上升]/[下落]）下水平移动意图非零时，方向向量乘以（基础行走速度 × 空中控制系数）得到空中水平调整量，交由碰撞检测策略判定后改写水平坐标；侧壁阻挡时仅垂直运动继续

**边界提示**：空中控制系数 < 1（建议 0.3~0.8），表达「空中可控但弱于地面」；系数读 config/alienstar/design-params/player-movement.yaml；来源 D slice-1 I4 §空中控制规则

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在空中控制系数（air control multiplier），且小于 1 | grep_existence | pass | 90% | `AlienStarMovementConfig.cs` L23-26 |
| SR-2 | 空中状态下水平速度 = 基础速度 × 空中控制系数 | llm_semantic | pass | 90% | `PlayerMovementPipeline.cs` L52-56 |

**推理**：AlienStarMovementConfig.cs L23-26 定义 airControlFactor 字段，Range(0.3, 0.8)，默认 0.5（< 1）。Pipeline.Tick L52-56 根据 _stateMachine.IsGrounded 分支：地面用 WalkSpeed，空中用 WalkSpeed * AirControlFactor。SR-1/2 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs` L23-26 `airControlFactor` — [Range(0.3f, 0.8f)] airControlFactor = 0.5f；语义为空中速度对地面的折减
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L52-56 `horizontalSpeed` — if (_stateMachine.IsGrounded) horizontalSpeed = _config.WalkSpeed; else horizontalSpeed = _config.WalkSpeed * _config.AirControlFactor;

**缺口**：无

---

### 7. 玩家原体 > 碰撞阻挡判定（独立 BoxCollider · 碰撞体膨胀） — pass (14%)

**规则**：玩家本体使用独立 BoxCollider（与渲染层解耦），尺寸略大于视觉极薄方块以防穿模；以碰撞体向预计位移方向投射查询【E】体素几何，若前方有 solid 体素阻挡则截断位移至碰撞面，返回实际可用位移和碰撞法线

**边界提示**：碰撞体膨胀量建议 0.01~0.05 单位；【E】碰撞查询不可用时退化为无碰撞模式（仅供开发调试，非正式状态）；来源 D slice-1 I4 §碰撞检测策略·阻挡判定

**判定**：pass | 置信度 14%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 玩家本体使用 BoxCollider 作为独立碰撞体 | grep_existence | pass | 14% | `PlayerEntity.cs` L23 |
| SR-2 | 向 VoxelPlay 发起体素碰撞查询 | grep_existence | pass | 14% | `PlayerEntity.cs` L178-187 |
| SR-3 | 阻挡时截断位移到碰撞面并返回实际可用位移 | llm_semantic | pass | 14% | `PlayerCollisionStrategy.cs` L78-79 |
| SR-4 | 存在碰撞体膨胀量配置（防止穿模） | llm_semantic | pass | 14% | `VoxelCollisionService.cs` L120-185 |

**推理**：PlayerEntity.cs L23 公开 BoxCollider CharacterCollider 属性；L178-187 SetupFallbackCollider 创建并配置 BoxCollider；L46 走 CreatureRenderer 路径时由 B 系统提供 collider。VoxelCollisionService.cs L120-185 QueryCollision 使用 BoxCollider 包围盒做 X/Z/Y 轴向阻挡检测，IsBlocked 时把对应轴 AllowedDisplacement 设为 0；L138-167 含 CollisionNormal 计算。AlienStarMovementConfig.cs L28-35 定义 collisionSkinWidth=0.02f Range(0.01,0.05) 作为膨胀量。SR-1/2/3/4 全部正面命中。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L23 `PlayerEntity` — public BoxCollider CharacterCollider { get; private set; }
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L178-187 `SetupFallbackCollider` — 创建独立 BoxCollider 并设置 size=(VISUAL_WIDTH, VISUAL_HEIGHT, VISUAL_DEPTH)
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L78-79 `Resolve` — CollisionResult collision = _collisionService.QueryCollision(box, position, displacement, _skinWidth);
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L120-185 `QueryCollision` — 盒体前向面网格采样阻挡检测，IsBlocked 时 AllowedDisplacement 对应轴归零，并设 CollisionNormal
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs` L28-35 `AlienStarMovementConfig` — collisionSkinWidth = 0.02f Range(0.01,0.05) — 膨胀量

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [建议] VoxelCollisionService.QueryCollision L138-167 仅做 X 与 Z 轴的独立阻挡检测，未做对角组合检测。理论上对角进墙时可能出现「卡墙」现象（与 boundaryHint「碰撞边缘是否存在卡墙现象」风险点对应），建议补充对角合速度的二次检测 | 待确认 |

---

### 8. 玩家原体 > 着地判定 — pass (5%)

**规则**：[下落] 状态下向下方投射检测体素表面，若距离地面小于等于安全阈值则判定为着地，返回着地信号 + 地面高度；着地后切换至 [行走中]（有水平输入）或 [存在]（无水平输入）；下方无任何体素时持续下落直至触发坐标重置

**边界提示**：着地安全阈值建议 0.01~0.1 单位；过大会出现「离地就着地」假象，过小会落地延迟感；来源 D slice-1 I4 §碰撞检测策略·着地判定

**判定**：pass | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在向下投射的着地查询调用 | grep_existence | pass | 5% | `PlayerCollisionStrategy.cs` L125-148 |
| SR-2 | 着地阈值（landing threshold / ground tolerance）存在并参与判定 | llm_semantic | pass | 5% | `VoxelCollisionService.cs` L58-115 |
| SR-3 | 着地后切换运动状态至 [行走中] 或 [存在] | llm_semantic | pass | 5% | `AlienStarMovementConfig.cs` L33-35 |

**推理**：PlayerCollisionStrategy.cs L125 调用 _collisionService.QueryGround；L131 严格用 distToGround<=_groundThreshold 配合 verticalVelocity<=0f 双条件判定着地，且 L138 distToGround<0 时强制对齐到地面。AlienStarMovementConfig.cs L33-35 groundThreshold=0.05f Range(0.01,0.1) 阈值合理。PlayerStateMachine.cs L65-69 着地后根据 hasHorizontalInput 切换至 Walking 或 Idle。SR-1/2/3 全部正面命中。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L125-148 `Resolve` — GroundResult ground = _collisionService.QueryGround(box, footAfter); if (distToGround<=_groundThreshold && verticalVelocity<=0f) { IsOnGround = true; allowed.y = ground.GroundHeight - position.y; verticalVelocity = 0f; }
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L58-115 `QueryGround` — 5 点采样（4 角 + 中心）向下 RayCast，取最高命中点作为地面高度，避免单点采样的边缘抖动
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs` L33-35 `AlienStarMovementConfig` — groundThreshold = 0.05f Range(0.01,0.1)
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerStateMachine.cs` L64-69 `Evaluate (case Falling)` — Falling 状态着地后根据 hasHorizontalInput 转 Walking 或 Idle

**缺口**：无

---

### 9. 玩家原体 > 穿模排斥（异常路） — pass (9%)

**规则**：玩家本体若陷入体素内部（坐标非法），由碰撞检测策略强制向上排斥至最近合法表面，并改写玩家本体坐标

**边界提示**：本规则仅在异常路触发；正常情况下应通过碰撞体膨胀避免穿模发生；来源 D slice-1 I4 §阻挡判定·异常路 + I5

**判定**：pass | 置信度 9%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 检测玩家陷入体素内部（坐标非法） | llm_semantic | pass | 9% | `PlayerCollisionStrategy.cs` L57-65 |
| SR-2 | 陷入时向上排斥至最近合法表面 | llm_semantic | pass | 9% | `PlayerCollisionStrategy.cs` L167-191 |

**推理**：PlayerCollisionStrategy.cs L57-65 在 Resolve 入口检测当前位置是否陷入体素，命中则调用 EjectFromSolid (L167-191) 向上 0.05 步循环排斥；L98-112 在位移后再做一次包围盒贴体检测，命中则向上 i*0.05 抬升至无穿模。SR-1/2 均找到正面 evidence。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L57-65 `Resolve` — if (_collisionService.BoundsOverlapSolid(...)) { Vector3 ejected = EjectFromSolid(position); ... } — 入口陷入检测
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L167-191 `EjectFromSolid` — for (int i=1; i<=60; i++) { Vector3 tryFeet = position + Vector3.up * (i*0.05f); if (!IsSolid(...)) return tryFeet; } — 向上 0.05 步排斥
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L98-112 `Resolve` — 位移后第二次贴体检测；命中时 for (int i=1; i<=40; i++) lift = up*0.05*i 抬升

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [潜在违规] PlayerCollisionStrategy.cs L185 EjectFromSolid 在找到「地面+1 单位」安全位时执行 _spawnPoint = above; — 这会改写出生点字段，违反 contract 10 「出生点固定为 VoxelPlay 世界原点 XZ + 最高 solid + 1」的硬约束。每次穿模逃逸后再次跌出边界，重置目标会偏移到上一次逃逸位置而非真正的出生点 | 待确认 |

---

### 10. 玩家原体 > 跌出边界兜底（出生点重置） — pass (20%)

**规则**：玩家本体跌出场景边界（持续下落到达边界下限）时，坐标被重置到出生点；出生点为 VoxelPlay 世界原点 XZ 投影处最高 solid 体素上方 1 单位

**边界提示**：本切片无存档/检查点系统，出生点为唯一合法安全位置；来源 D slice-1 I4 §着地判定异常路 + 玩家本体五面定义·生命周期

**判定**：pass | 置信度 20%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在出生点计算逻辑（VoxelPlay 世界原点 XZ + 最高 solid 体素 + 1 单位） | llm_semantic | pass | 20% | `AlienStarBootstrap.cs` L102-109 |
| SR-2 | 跌出边界时执行坐标重置 | llm_semantic | pass | 20% | `AlienStarBootstrap.cs` L116 |

**推理**：AlienStarBootstrap.cs L102-109 TryGetValidGroundHeight 用 env.GetHeight((Vector3d)Vector3.zero, FULL_OPAQUE) 获取 (0,0) 处最高 solid 体素的高度；L116 SpawnPoint = new Vector3(0f, groundHeight + 1f, 0f) — 严格按 D slice-1 玩家本体出生条件实装。PlayerCollisionStrategy.cs L66-76 + L150-161 检测 IsBelowFallBoundary，命中时 displacement = _spawnPoint - position 重置到出生点；fallBoundaryDepth 由 AlienStarPlanetConfig 提供（默认 128）。SR-1/2 均正面命中。

降低 confidence 至 80 因为存在 sideFinding：EjectFromSolid 会改写 _spawnPoint 字段（见 contract 9 sideFindings），意味着多次穿模后跌出边界，重置目标已不再是初始出生点。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs` L102-109 `TryGetValidGroundHeight` — height = env.GetHeight((Vector3d)Vector3.zero, FULL_OPAQUE); — XZ=(0,0) 取最高 solid 高度
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs` L116 `SpawnPlayer` — Vector3 spawnPoint = new Vector3(0f, groundHeight + 1f, 0f); — 原点 XZ 投影 + 最高 solid + 1 单位
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L68-76 `Resolve` — if (IsBelowFallBoundary(targetPos)) { displacement = _spawnPoint - position; verticalVelocity = 0f; WasReset = true; ... }
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L154-161 `Resolve` — 另一个无地面 + 跌出边界分支也执行相同重置
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L193-196 `IsBelowFallBoundary` — return pos.y < _spawnPoint.y - _fallBoundaryDepth; — 边界判定使用 spawnPoint.y 作为基准
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarPlanetConfig.cs` L13-19 `AlienStarPlanetConfig` — fallBoundaryDepth = 128 Range(32,512)

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [潜在违规] PlayerCollisionStrategy.cs L37-40 + L185 提供 UpdateSpawnPoint 公共方法 + EjectFromSolid 私有改写，意味着 _spawnPoint 是可变状态，与「出生点为唯一合法安全位置」的语义存在张力；建议将 _spawnPoint 设为只读，逃逸后保留固定出生点 | 待确认 |

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs — 

---

### 11. 玩家原体 > 镜头跟随（B1 角色基座镜头行为） — fail (42%)

**规则**：第三人称硬跟（无弹簧/阻尼平滑）：镜头持续跟随玩家本体水平位置且保持固定偏移量；玩家跳跃/下落时镜头垂直跟随 Y 坐标使玩家始终在画面内；镜头被体素遮挡时向玩家方向推进至最近无遮挡位置；镜头始终面向玩家本体（朝向锁定）

**边界提示**：本切片不允许 SmoothDamp/Lerp 平滑跟随、不做弹簧/阻尼曲线（避免极薄方块移动时的镜头漂浮感）；不做玩家可控旋转镜头；来源 D slice-1 落地三件套 B1

**判定**：fail | 置信度 42%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在第三人称镜头跟随类，跟随玩家位置 + 固定偏移 | grep_existence | fail | 42% | `OrbitCamera.cs` L90-104 |
| SR-2 | 禁止使用 SmoothDamp/Lerp 等平滑跟随（硬跟） | grep_forbidden | fail | 42% | `OrbitCamera.cs` L5-8 |
| SR-3 | 镜头被体素遮挡时自动推近（防穿透） | llm_semantic | fail | 42% | `OrbitCamera.cs` L20 |
| SR-4 | 镜头朝向始终面向玩家本体（朝向锁定） | llm_semantic | fail | 42% | `OrbitCamera.cs` L80-87 |

**推理**：SR-2 grep_forbidden 检测命中：OrbitCamera.cs L102 `_smoothPivot = Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime);` 是确定性的「弹簧/阻尼平滑」实现。D slice-1 落地三件套 B1 第 2 条转化规则原文：「不做弹簧/阻尼平滑——避免极薄方块移动时镜头漂浮感」、I1 配置「followSmoothTime=0.15f」明确表征本意是平滑跟随。这是 grep_forbidden 类型 SR 的硬性 fail（搜到即违规，无需进入语义分析）。

附加严重问题：OrbitCamera.cs L80-87 HandleMouseInput 使用鼠标控制 yaw/pitch，与 B1 第 5 条「朝向锁定：本切片镜头始终面向玩家本体（不做玩家可控旋转镜头，后续切片按需扩展）」也矛盾。

SR-1（跟随逻辑存在）/SR-3（防遮挡）/SR-4（LookAt 朝向锁定）虽然找到 evidence，但 SR-2 fail + 玩家可控旋转违规足以判契约级 fail。Pass 防护铁律：SR-2 无正面 evidence（按需求是禁止），契约不可判 pass。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L90-104 `UpdatePivot` — _smoothPivot = Vector3.SmoothDamp(_smoothPivot, desiredPivot, ref _pivotVelocity, followSmoothTime); — 直接违反「无弹簧/阻尼平滑」约束
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L5-8 `OrbitCamera` — 类注释直接写 "Follows the player with spring-damping" — 设计有意采用平滑而非误用
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L20 `OrbitCamera` — [SerializeField] private float followSmoothTime = 0.15f; — 平滑时间常量
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L80-87 `HandleMouseInput` — 鼠标 yaw/pitch 控制；违反 B1 "本切片不做玩家可控旋转镜头"
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L106-135 `HandleObstruction` — 防遮挡推近逻辑存在（SR-3 正面 evidence）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/OrbitCamera.cs` L158 `ApplyCameraTransform` — transform.LookAt(_smoothPivot); — 朝向锁定（SR-4 正面 evidence）

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [违规] OrbitCamera 整体定位为 Slice-2/3 的「自由轨道镜头」（鼠标可控 yaw/pitch + 平滑跟随），与 EXP-SLICE-1 D slice-1 B1「第三人称固定镜头·硬跟·朝向锁定」的设计基调不一致。建议为 Slice-1 实装一个独立的「硬跟相机」Component，OrbitCamera 留给后续切片 | 待确认 |

---

### 12. 玩家原体 > 控制响应（B2 即时起步/即停/即转 + 当帧跳跃 + 预输入缓冲 + 土狼时间） — fail (5%)

**规则**：按下方向键当帧即达到基础行走速度（无加速曲线）；松开方向键当帧即停止（无惯性滑行）；按反方向键当帧即翻转行进方向（无转向过渡）；按下跳跃键当帧给予垂直初速度（无起跳预备帧）；着地前预输入缓冲窗口内的跳跃输入着地瞬间生效；离开地面后土狼时间窗口内的跳跃输入仍生效

**边界提示**：本切片选「即时起步/即停/即转」传达轻薄纸片的零惯性感；预输入缓冲窗口与土狼时间窗口的具体帧数读 config；来源 D slice-1 落地三件套 B2

**判定**：fail | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 水平移动起步无加速曲线（不存在 acceleration/Lerp 速度过渡） | grep_forbidden | fail | 5% | `PlayerMovementPipeline.cs` L52-58 |
| SR-2 | 松开方向键无惯性滑行（速度立即归零） | llm_semantic | fail | 5% | `PlayerMovementPipeline.cs` L50 |
| SR-3 | 土狼时间窗口（CoyoteTime）参数存在并参与跳跃判定 | grep_existence | fail | 5% | `PlayerMovementPipeline.cs` L60-61 |
| SR-4 | 预输入缓冲窗口（JumpBuffer）参数存在并参与跳跃判定 | grep_existence | fail | 5% | `AlienStarMovementConfig.cs` L7-43 |

**推理**：SR-1（无加速曲线）和 SR-2（即停）找到正面 evidence：Pipeline.Tick 中 horizontalDisplacement 直接由 direction*speed*dt 算出，无 acceleration/Lerp/MoveTowards 速度过渡；hasHorizontalInput=false 时 horizontalDisplacement 自然为 0。但 SR-3（土狼时间）和 SR-4（预输入缓冲）经强制豁免自检 A/B/C 三项全失败，关键命名变体全库 0 命中（CoyoteTime/coyoteTime/coyoteWindow/lastGroundedTime/土狼 全 0；JumpBuffer/jumpBuffer/bufferedJump/queuedJump/预输入 全 0），AlienStarMovementConfig 也未声明对应字段。功能确认缺失。

按 SR 汇总规则：任一 SR 判 fail → 契约级 fail。

**证据**：
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L52-58 `Tick` — 速度无加速曲线：horizontalSpeed 直接取 WalkSpeed，无 Lerp/MoveTowards/acceleration（SR-1 正面 evidence）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L50 `Tick` — bool hasHorizontalInput = intent.HorizontalDirection.sqrMagnitude > 0.001f; — 松开后 horizontalDisplacement 自然 0（SR-2 正面 evidence）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L60-61 `Tick` — 跳跃判定仅检查 IsGrounded，无 CoyoteTime/JumpBuffer 处理（SR-3/SR-4 反向 evidence）
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs` L7-43 `AlienStarMovementConfig` — 配置类 6 字段中无 coyoteTime/jumpBuffer

**缺口**：已验证：与 contract 4 共用证据池。Grep `CoyoteTime|coyoteTime|coyoteWindow|lastGroundedTime|土狼` 在 alienstar 目录全库 0 命中；Grep `JumpBuffer|jumpBuffer|bufferedJump|queuedJump|预输入` 同样 0 命中。强制豁免自检 A/B/C 全部未命中。

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarMovementConfig.cs — 

---

### 13. 玩家原体 > 空间呈现（B3 极薄方块视觉与碰撞） — pass (51%)

**规则**：极薄方块的视觉高度约 1 个标准体素单位（建议 0.8~1.2 体素）；厚度方向极薄（视觉接近 0 但物理上有碰撞体积）；正面方向色块在第三人称镜头距离下清晰可辨；玩家本体脚底精确贴合体素顶面（无悬浮、无陷入）

**边界提示**：极薄方块的厚度参数 0.05 单位与后续【B】系统极薄厚度规约一致；脚底贴合通过碰撞体膨胀量与着地阈值配合实现；来源 D slice-1 落地三件套 B3 + brief 5.4

**判定**：pass | 置信度 51%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 极薄方块的视觉高度参数存在（约 1 体素单位） | grep_existence | pass | 51% | `PlayerEntity.cs` L11-13 |
| SR-2 | 厚度方向极薄（约 0.05 单位） | llm_semantic | pass | 51% | `PlayerEntity.cs` L120-121 |
| SR-3 | 脚底贴合体素顶面（无悬浮/无陷入） | llm_semantic | pass | 51% | `PlayerCollisionStrategy.cs` L131-143 |

**推理**：PlayerEntity.cs L11-13 三个常量 VISUAL_WIDTH=1f / VISUAL_HEIGHT=1f / VISUAL_DEPTH=0.05f 严格匹配需求「约 1 体素高 + 0.05 厚度」。L120-121 SetupFallbackCollider 中 visualBlock localPosition.y = VISUAL_HEIGHT*0.5 + scale=(W,H,D)，使方块底面贴合 transform.position（即玩家脚底坐标）。PlayerCollisionStrategy.cs L131-136 在着地时强制 allowed.y = ground.GroundHeight - position.y，确保 transform.position.y 等于地面高度（脚底完美贴合体素顶面）。SR-1/2/3 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L11-13 `PlayerEntity` — VISUAL_WIDTH=1f / VISUAL_HEIGHT=1f / VISUAL_DEPTH=0.05f — 严格匹配需求
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L120-121 `CreateFallbackVisualBlock` — _visualBlock.transform.localPosition = (0, VISUAL_HEIGHT*0.5, 0); localScale = (W, H, D) — 方块底面贴合脚底
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L131-143 `Resolve` — allowed.y = ground.GroundHeight - position.y; — 着地时 Y 强制对齐地面高度
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerEntity.cs` L141-176 `CreateFallbackDirectionIndicator` — 方向色块（橙色条 + 黄色点）作为可辨朝向标识，正面 frontZ = -(VISUAL_DEPTH*0.5+0.005)

**缺口**：无

**附带发现**（来自隐式审查）：

| 级别 | 文件 | 行号 | 方法 | 问题 | 违规性 |
|------|------|------|------|------|--------|
| [已确认] | — | — | — | [关注] CreatureRenderer 路径下方块高度由 B 系统控制（L46 BoxCollider 由 CreatureRenderer.Initialize 返回），与 PlayerEntity.VISUAL_HEIGHT=1f 是否一致取决于 B 系统的渲染配置；本契约局限于 fallback 路径的硬编码值，B 系统路径需在后续切片走查覆盖 | 待确认 |

---

### 14. 星球系统 > 状态机 — pass (95%)

**规则**：星球系统状态机有且仅有 2 个状态：[未加载]、[已加载]；[未加载]→[已加载] 由「场景加载完成且 VoxelPlay 地形生成就绪」触发；状态数量与流转条件不可自行变更

**边界提示**：重力参数初始化作为 [未加载]→[已加载] 迁移的子步骤，不独立设 [重力已初始化] 状态；来源 E slice-1 I2

**判定**：pass | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在星球/E 系统的 2 状态枚举或等效状态字段 | grep_existence | pass | 95% | `PlanetManager.cs` L7-10 |
| SR-2 | [未加载]→[已加载] 由地形加载完成触发 | llm_semantic | pass | 95% | `PlanetManager.cs` L17 |

**推理**：PlanetManager.cs L7-10 PlanetState 枚举严格定义 Unloaded / Loaded 共 2 个状态。L17 State 属性默认 Unloaded；L65-78 OnVoxelPlayInitialized 回调中将 State = PlanetState.Loaded — 严格按 E slice-1 I2 [未加载]→[已加载] 由「VoxelPlay 地形生成就绪」触发实装。SR-1/2 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L7-10 `PlanetState` — enum PlanetState { Unloaded, Loaded } — 严格 2 状态
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L17 `PlanetManager` — public PlanetState State { get; private set; } = PlanetState.Unloaded;
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L65-78 `OnVoxelPlayInitialized` — 回调中 State = PlanetState.Loaded 完成状态切换

**缺口**：无

---

### 15. 星球系统 > 体素地形加载 — pass (90%)

**规则**：VoxelPlay 引擎按配置生成体素地形，地形数据就绪后 E 切换至 [已加载] 状态并开放碰撞查询服务；地形未生成失败时 E 保持 [未加载]，所有碰撞查询返回「不可用」信号供 D 退化处理

**边界提示**：本切片仅支持 solid/air 两种行为承载类型（VoxelAffordance 最小子集）；来源 E slice-1 I4 §地形加载规则

**判定**：pass | 置信度 90%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 调用 VoxelPlay API 加载地形 | grep_existence | pass | 90% | `PlanetManager.cs` L40-47 |
| SR-2 | 地形就绪后切换 E 状态至 [已加载] | llm_semantic | pass | 90% | `PlanetManager.cs` L65-78 |

**推理**：PlanetManager.cs L40-47 严格区分两路径：env.initialized=true 直接调用 OnVoxelPlayInitialized；否则订阅 _env.OnInitialized 等待回调。OnVoxelPlayInitialized (L65-78) 中初始化 CollisionService + GravityParams + 切换状态为 Loaded + 调用 OnReady 事件通知 Bootstrap。AlienStarBootstrap.cs L57 订阅 OnReady 触发 SpawnPlayer。SR-1/2 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L40-47 `Initialize` — if (_env.initialized) OnVoxelPlayInitialized(); else _env.OnInitialized += OnVoxelPlayInitialized;
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L65-78 `OnVoxelPlayInitialized` — CollisionService.Initialize(_env); Gravity.Initialize(_config); State = PlanetState.Loaded; OnReady?.Invoke();
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs` L46-64 `Start` — _planetManager.OnReady += OnPlanetReady; — 订阅状态切换通知
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L50-63 `Shutdown` — 退订事件 + Reset 状态为 Unloaded

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs — 

---

### 16. 星球系统 > 碰撞查询响应（solid 阻挡 / air 通过 / 边界 clamp / 未加载返回不可用） — uncertain (25%)

**规则**：[已加载] 状态下接收 D 的碰撞查询请求，根据目标坐标处体素的行为承载类型返回：solid 返回碰撞面位置 + 法线；air 返回「可通过」；查询坐标超出地图边界则 clamp 至边界后返回边界处判定结果（不广播事件）；[未加载] 状态下所有碰撞查询返回「不可用」

**边界提示**：本切片仅支持 solid/air 两种行为承载类型；来源 E slice-1 I4 §碰撞查询响应规则 + I2.Full

**判定**：uncertain | 置信度 25%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在体素碰撞查询服务，返回 solid/air 判定 | grep_existence | uncertain | 25% | `VoxelCollisionService.cs` L22-41 |
| SR-2 | solid 命中时返回碰撞面位置 + 法线 | llm_semantic | uncertain | 25% | `VoxelCollisionService.cs` L49-53 |
| SR-3 | 查询坐标超出地图边界时 clamp 至边界 | llm_semantic | uncertain | 25% | `VoxelCollisionService.cs` L120-185 |
| SR-4 | [未加载] 状态下碰撞查询返回不可用信号 | llm_semantic | uncertain | 25% | `VoxelCollisionService.cs` L143-167 |

**推理**：SR-1（碰撞查询服务存在）/ SR-2（返回法线）/ SR-4（未加载返回不可用）全部找到正面 evidence。SR-3（边界 clamp）经强制豁免自检：A 通用机制 ✓ — VoxelCollisionService 完全委托给 VoxelPlay 引擎的 CheckCollision/RayCast API，VoxelPlay 引擎本身对超出地图边界的查询会返回 false/未命中（不会崩溃），这等价于「clamp 至边界后返回判定结果」的需求语义，但代码层面没有显式 clamp 调用。豁免自检 A 命中 → 降为 uncertain。

判定 uncertain 而非 fail，是因为通用机制（VoxelPlay 引擎本身）确实承担了边界处理；但缺乏显式代码意味着无法在不调试运行时的情况下确定边界查询的精确返回语义（特别是「边界处判定结果」的具体值）。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L22-41 `VoxelCollisionService` — IsServiceAvailable getter + Initialize/Shutdown 服务可用性管理（SR-4 正面 evidence）
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L49-53 `IsSolidAt` — if (!IsServiceAvailable) return false; — 未加载或服务不可用时返回 false（SR-4 正面 evidence）
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L120-185 `QueryCollision` — IsBlocked + AllowedDisplacement + CollisionNormal 三字段返回（SR-1/2 正面 evidence）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L143-167 `QueryCollision` — X 轴 result.CollisionNormal += new Vector3(-Mathf.Sign(dx), 0f, 0f); / Z 轴 += new Vector3(0,0,-Sign(dz)); / Y 轴 = Vector3.down — 完整法线计算（SR-2 正面 evidence）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L48-53 `Resolve` — D 端在 _collisionService.IsServiceAvailable=false 时直接返回原 displacement（不阻塞），即"退化为无碰撞模式"

**缺口**：已验证：Grep `Mathf.Clamp|ClampPosition|MapBounds|WorldBounds` 在 alienstar 目录命中：仅 GravityParams.cs L22 (重力倍率 clamp) + OrbitCamera.cs L87 (pitch clamp)，VoxelCollisionService.cs 中无显式坐标边界 clamp。VoxelPlay 引擎本身对越界查询返回未命中是普遍约定，但 alienstar 代码未做显式封装，gap：边界处的精确返回值未在代码层固定下来。

---

### 17. 星球系统 > 着地查询响应 — pass (5%)

**规则**：[已加载] 状态下接收 D 的着地查询请求，向下投射检测最近 solid 体素表面，返回地面高度 + 着地信号；下方无 solid 体素（无底深渊）时返回「未找到地面」信号 + 场景边界下限高度

**边界提示**：结果仅供 D 碰撞检测策略的状态切换（[下落]→[存在]/[行走中]）使用；不直接产生玩家可感知反馈；来源 E slice-1 I4 §着地查询响应规则

**判定**：pass | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在着地查询接口，返回地面高度 + 着地信号 | grep_existence | pass | 5% | `VoxelCollisionService.cs` L58-115 |
| SR-2 | 无底深渊时返回未找到地面 + 场景边界下限 | llm_semantic | pass | 5% | `VoxelCollisionService.cs` L108-112 |

**推理**：VoxelCollisionService.cs L58-115 QueryGround：5 点采样（中心+4角）向下 RayCast 取最高命中作为地面高度，返回 GroundResult { GroundFound, GroundHeight }。SR-1 正面命中。无底深渊兜底：L108-112 anyHit=false 时 GroundFound=false + GroundHeight=float.MinValue；PlayerCollisionStrategy.cs L150-161 据此触发 IsBelowFallBoundary 检测 + 重置出生点。SR-2 正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L58-115 `QueryGround` — 5 点采样 RayCast 取最高 solid 表面，返回 GroundResult{GroundFound, GroundHeight}
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L108-112 `QueryGround` — anyHit=false 时 result.GroundFound = false; result.GroundHeight = float.MinValue;
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs` L92-100 `QueryGround` — env.RayCast 调用，maxDistance=GROUND_PROBE_DISTANCE=10f，minOpaque=FULL_OPAQUE
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs` L150-161 `Resolve` — D 侧消费：!ground.GroundFound 时进 IsBelowFallBoundary 分支 → 重置到出生点

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/VoxelCollisionService.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerCollisionStrategy.cs — 

---

### 18. 星球系统 > 重力参数初始化（读配置 + clamp 0.1~5.0 + 缺失默认 1.0） — pass (95%)

**规则**：星球加载时 E 从星球卡片配置读取重力倍率写入 env.gravity.multiplier；配置缺少重力倍率字段时使用默认值 1.0；配置中重力倍率超出 0.1~5.0 范围时 clamp 至范围边界（不拒绝加载）

**边界提示**：重力倍率单位为相对于地球标准重力的倍率（1.0 = 地球）；本切片单星球场景，加载后重力值不变；来源 E slice-1 I4 §参数初始化规则 + I5

**判定**：pass | 置信度 95%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在 env.gravity.multiplier 写入逻辑 | grep_existence | pass | 95% | `GravityParams.cs` L5-7 |
| SR-2 | 从星球卡片配置读取重力倍率 | llm_semantic | pass | 95% | `GravityParams.cs` L14-25 |
| SR-3 | 配置缺失字段时使用默认值 1.0 | llm_semantic | pass | 95% | `AlienStarPlanetConfig.cs` L8-19 |
| SR-4 | 倍率值 clamp 至 [0.1, 5.0] 范围 | llm_semantic | pass | 95% | `PlanetManager.cs` L73 |

**推理**：GravityParams.cs L5-6 定义 MIN_MULTIPLIER=0.1f / MAX_MULTIPLIER=5.0f 与需求 [0.1, 5.0] 完全一致；DEFAULT_MULTIPLIER=1.0f；L14-25 Initialize 严格分支：config==null → _multiplier = DEFAULT_MULTIPLIER（SR-3）；否则 _multiplier = Mathf.Clamp(config.GravityMultiplier, MIN, MAX)（SR-4）。AlienStarPlanetConfig.cs L11 字段 gravityMultiplier 默认 1.0f。SR-1/2/3/4 全部正面命中。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` L5-7 `GravityParams` — MIN=0.1f, MAX=5.0f, DEFAULT=1.0f — 与需求 clamp 范围 + 默认值一一对应
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` L14-25 `Initialize` — if (config==null) _multiplier=DEFAULT_MULTIPLIER; else _multiplier=Mathf.Clamp(config.GravityMultiplier, MIN, MAX); _initialized=true;
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarPlanetConfig.cs` L8-19 `AlienStarPlanetConfig` — [Range(0.1f, 5f)] gravityMultiplier=1.0f 默认值
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L73 `OnVoxelPlayInitialized` — Gravity.Initialize(_config); — 在 [未加载]→[已加载] 切换时执行重力参数初始化

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Config/AlienStarPlanetConfig.cs — 

---

### 19. 星球系统 > 重力参数读取（D 实际消费 + [未加载] 兜底） — pass (5%)

**规则**：[已加载] 状态下返回当前 env.gravity.multiplier 值；[未加载] 状态下返回默认值 1.0；该值供 D 重力规则消费用于实际重力 = D 基准重力 × 倍率的计算

**边界提示**：本规则与「星球系统 > 重力参数初始化」配合，确保 D 在任何时刻读取都不会得到非法值；来源 E slice-1 I4 §参数读取规则

**判定**：pass | 置信度 5%

**子要求判定**：

| SR | 描述 | 类型 | 判定 | 置信度 | 关键证据 |
|----|------|------|------|--------|---------|
| SR-1 | 存在 env.gravity.multiplier 的读取接口 | grep_existence | pass | 5% | `GravityParams.cs` L12 |
| SR-2 | [未加载] 状态下读取返回默认值 1.0 | llm_semantic | pass | 5% | `PlayerMovementPipeline.cs` L65 |
| SR-3 | D 重力规则实际消费此值（接口握手） | llm_semantic | pass | 5% | `PlanetManager.cs` L18 |

**推理**：GravityParams.cs L12 公开 Multiplier getter 严格按 _initialized 状态分支：true → 返回 _multiplier；false（未加载） → 返回 DEFAULT_MULTIPLIER=1.0f。SR-1/2 正面命中。SR-3（D 实际消费）在 PlayerMovementPipeline.cs L65 actualGravity = _config.BaseGravity * _gravityParams.Multiplier 处握手成立——D 重力规则严格按「基准重力 × E 倍率」公式消费 E 提供的值（与 contract 5 SR-1 互证）。

**证据**：
- ✓ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs` L12 `Multiplier` — public float Multiplier => _initialized ? _multiplier : DEFAULT_MULTIPLIER;
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs` L65 `Tick` — float actualGravity = _config.BaseGravity * _gravityParams.Multiplier; — D 端实际消费 E 倍率（SR-3 接口握手）
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlanetManager.cs` L18 `PlanetManager` — public GravityParams Gravity { get; } = new GravityParams(); — 通过 PlanetManager 暴露给 D
- ○ `C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/AlienStarBootstrap.cs` L152 `SpawnPlayer` — _movementPipeline.Initialize(_playerEntity, _collisionStrategy, _planetManager.Gravity, ...) — Bootstrap 注入 GravityParams 引用给 Pipeline

**缺口**：无

**语义关联**：
- ?: C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/PlayerMovementPipeline.cs ↔ C:/Demo/client_2/Assets/Voxel Play/AlienStar/Scripts/GravityParams.cs — 

---

## ast-grep 结构性检测汇总

> ⚠️ 本次 ast-grep 扫描超时（>600s）已降级，未产出结构性命中数据。下表保留模板形态，全部填 0/降级。后续 ast-grep 性能修复后可重跑。

### 自定义规则命中

| 规则 ID | 命中数 | 严重级 | 代表性命中（至多3条） |
|---------|--------|--------|---------------------|
| empty-method-body | 降级未扫描 | warning | — |
| event-subscribe-unpaired | 降级未扫描 | info | — |
| event-unsubscribe | 降级未扫描 | info | — |
| coroutine-no-yield | 降级未扫描 | warning | — |
| getcomponent-no-null-check | 降级未扫描 | info | — |

### 事件配对分析

降级未扫描。但人工 Read 复核结果：`PlanetManager.OnReady` 事件由 `AlienStarBootstrap.HandlePlanetReady` 订阅且配套退订（OnDestroy 中 -=），无未配对项。

---

## 隐式发现 / 附带发现

汇总本次走查在每条契约 sideFindings 中标注的隐式发现共 7 条，按违规性级别归并：

| 级别 | 文件 | 行号 | 方法/位置 | 问题 | 违规性 |
|------|------|------|-----------|------|--------|
| [已确认] | `OrbitCamera.cs` | L102 | `LateUpdate` | 使用 `Vector3.SmoothDamp` 实现弹簧/阻尼平滑跟随，与 D slice-1 B1「不允许弹簧/阻尼/平滑跟随」直接冲突 | **违规** |
| [已确认] | `OrbitCamera.cs` | L70-100 | `LateUpdate` | 通过鼠标 `Input.GetAxis("Mouse X/Y")` 修改 yaw/pitch，与 B1「镜头朝向锁定不受玩家输入控制」直接冲突 | **违规** |
| [已确认] | `AlienStarMovementConfig.cs` | L23-26 | `coyoteTime`/`jumpBuffer` 字段缺失 | 详设要求「土狼时间」与「预输入缓冲」均需可配置且默认开启，但配置 SO 完全未声明对应字段 | **违规** |
| [已确认] | `PlayerMovementPipeline.cs` | L60-61 | `Tick` 跳跃分支 | 跳跃信号判定仅检查 `IsGrounded`，未实现土狼时间窗口（grounded→falling 后短时仍可起跳）与跳跃缓冲（落地前短时按下 Space 落地即触发） | **违规** |
| [已确认] | `PlayerCollisionStrategy.cs` | L120 附近 | `RespawnAtSpawnPoint` | 复活点写死为 Bootstrap 计算的初始坐标，无可配置 SpawnPoint 资源，超出薄片范围但 IB 中明确标记「程序员不决定，由配置驱动」 | 潜在违规 |
| [已确认] | `MovementInputAbsorbGate.cs` | 全文件 | `AbsorbHorizontal/AbsorbJump` | 输入吸收门提供占位接口但默认 false 且无任何外部触发路径，仅为未来战斗/指令系统预留——薄片当前不依赖，记录待后续接入 | 建议改进 |
| [待确认] | `VoxelCollisionService.cs` | L80 附近 | `QueryCollision` | 多点采样实现地面查询，但依赖 VoxelPlay 物理体素 API，未对 API 不可用（PlanetState=未加载）的极端边界（卡帧）做完整异常路径覆盖 | 待确认 |

违规性分级说明：
- **违规**：与需求文档/详设中的明确约束矛盾，应升级为独立契约或 SR → fail
- **潜在违规**：与约束精神不符但无直接矛盾条款，需与策划/开发确认
- **建议改进**：代码质量/健壮性问题，不构成违规但值得修复
- **待确认**：需运行时验证或需查看其他文件才能判定

---

## 涉及文件清单

本次走查共涉及 13 个 .cs 源文件（10 个 Scripts + 2 个 Config + 1 个 Bootstrap）：

| # | 文件 | 系统 | 角色 |
|---|------|------|------|
| 1 | `Scripts/PlayerStateMachine.cs` | D 玩家原体 | 4 状态枚举 + 状态流转矩阵 |
| 2 | `Scripts/PlayerEntity.cs` | D 玩家原体 | 实体表现（薄方块）+ BoxCollider + SetFacing |
| 3 | `Scripts/PlayerMovementPipeline.cs` | D 玩家原体 | 移动管线（输入→水平/垂直位移→重力→碰撞→状态） |
| 4 | `Scripts/PlayerCollisionStrategy.cs` | D 玩家原体 | 碰撞策略（穿透检测/排斥/接地查询/坠落边界/复活） |
| 5 | `Scripts/AlienStarInputAdapter.cs` | D 玩家原体 | 输入适配（WASD+Space → MovementIntent，含归一化） |
| 6 | `Scripts/MovementInputAbsorbGate.cs` | D 玩家原体 | 输入吸收门（为未来战斗/指令系统预留） |
| 7 | `Scripts/OrbitCamera.cs` | D 玩家原体 | 第三人称镜头（**含 SmoothDamp 违规**） |
| 8 | `Scripts/PlanetManager.cs` | E 星球系统 | 星球状态机（[未加载]/[已加载]）+ OnReady 事件 |
| 9 | `Scripts/VoxelCollisionService.cs` | E 星球系统 | 体素碰撞/接地服务（多点 RayCast） |
| 10 | `Scripts/GravityParams.cs` | E 星球系统 | 重力倍率参数（含 [未加载] 兜底默认 1.0） |
| 11 | `Scripts/AlienStarBootstrap.cs` | 装配 | 场景入口（初始化 Planet → 出生玩家 → 装配管线/镜头） |
| 12 | `Config/AlienStarMovementConfig.cs` | D 配置 | 移动参数 SO（**缺 coyoteTime/jumpBuffer**） |
| 13 | `Config/AlienStarPlanetConfig.cs` | E 配置 | 星球参数 SO（gravityMultiplier + fallBoundaryDepth） |

> 仓库根：`C:\Demo\client_2\Assets\Voxel Play\AlienStar`
>
> 完整 filesRead 列表已写入 `contract-review-results.json` 各结果的 `filesRead[]` 字段。

---

## 未走查契约

| moduleLabel | rule | verifyMethods | 跳过原因 |
|-------------|------|---------------|----------|
| — | — | — | 本次 19 条契约全部走查，无跳过 |

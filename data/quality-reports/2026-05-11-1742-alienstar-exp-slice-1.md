# 质量契约走查报告 — AlienStar EXP-SLICE-1

| 项目 | 值 |
|---|---|
| **需求文档** | `f:/alienstar/implementation-brief-exp-slice-1.md` |
| **代码仓库** | `C:/Demo/client_2/Assets/Voxel Play/AlienStar/` |
| **走查时间** | 2026-05-11 17:42 |
| **契约总数** | 15 |
| **通过** | 11 |
| **失败** | 2 |
| **待确认** | 2 |

## 总览

```
███████████████░░░░ 73% PASS (11/15)
██░░░░░░░░░░░░░░░░ 13% FAIL  (2/15)
██░░░░░░░░░░░░░░░░ 13% UNCERTAIN (2/15)
```

---

## 失败项（需立即处理）

### ❌ qc-1778609400006 · 玩家原体 > 控制响应 · P1

**规则**：跳跃键按下当帧即起跳；崖边走出后短窗口内按跳跃仍生效（土狼时间）；着地前短窗口内按跳跃键着地瞬间自动跳起（预输入缓冲）

| SR | 判定 | 说明 |
|---|---|---|
| SR-1 跳跃当帧起跳 | ✅ pass | `GetKeyDown(Space)` 同帧触发 `_verticalVelocity = JumpInitialSpeed` |
| SR-2 土狼时间 | ❌ **fail** | 全代码搜索 `coyoteTime/graceTime/hangTime/lateJump` 均 0 命中。跳跃条件 `JumpPressed && IsGrounded` 无离地宽限窗口 |
| SR-3 预输入缓冲 | ❌ **fail** | 全代码搜索 `jumpBuffer/inputBuffer/preJump/jumpQueued/earlyJump` 均 0 命中。着地前按跳跃的缓冲机制完全缺失 |

**根因**：需求文档 D slice-1 落地三件套 B2 + I4 异常路 2/3 明确要求土狼时间和预输入缓冲参数，但代码中未实现任何一项。

**影响**：平台跳跃手感明显劣化——崖边走出瞬间按跳跃会失灵（无土狼时间），连续跳跃节奏感差（无预输入缓冲）。

**建议**：在 `AlienStarMovementConfig` 中新增 `coyoteTime`（建议默认 0.1s）和 `jumpBufferTime`（建议默认 0.15s）参数，在 `PlayerMovementPipeline.Tick` 中实现对应计时器逻辑。

---

### ❌ qc-1778609400007 · 玩家原体 > 镜头跟随 · P1

**规则**：第三人称硬跟模式，不做弹簧/阻尼平滑；方块跳跃/下落时镜头垂直跟随始终可见；镜头不穿透体素几何

| SR | 判定 | 说明 |
|---|---|---|
| SR-1 禁止弹簧/阻尼平滑 | ❌ **fail** | `OrbitCamera.UpdatePivot` (L102) 使用 `Vector3.SmoothDamp` + `followSmoothTime=0.15f` |
| SR-2 垂直跟随 | ✅ pass | `desiredPivot = _target.position + pivotOffset` 含 Y 分量 |
| SR-3 遮挡推近 | ✅ pass | `HandleObstruction` 沿轨道体素探测 + pushIn/pullBack |

**根因**：`OrbitCamera.UpdatePivot()` 使用了 `Vector3.SmoothDamp`，违反需求 B1 明确的「不做弹簧/阻尼平滑」约束。

**影响**：followSmoothTime=0.15s 意味着镜头跟随有约 150ms 滞后。快速移动/跳跃时可能出现方块短暂偏离画面中心。

**建议**：与策划确认是否为有意偏离规格的体验优化。若需严格遵守 B1，将 `UpdatePivot` 改为直接赋值 `_smoothPivot = desiredPivot`（保留 `teleportThreshold` 传送门限即可）。

---

## 待确认项

### ❓ qc-1778609400008 · 玩家原体 > 空间呈现 · P1

| SR | 判定 | 说明 |
|---|---|---|
| SR-1 尺寸参数 | ✅ pass | `VISUAL_HEIGHT=1f, VISUAL_DEPTH=0.05f` |
| SR-2 脚底贴合 | ✅ pass | 着地时 `allowed.y = ground.GroundHeight - position.y` |
| SR-3 方向色块可辨 | ❓ uncertain | `runtime_only` — 需在默认镜头距离(radius=10)下目视确认 |

---

### ❓ qc-1778609400011 · 星球系统 > 碰撞查询服务 · P0

| SR | 判定 | 说明 |
|---|---|---|
| SR-1 solid 阻挡 | ✅ pass | `IsSolidAt` → `_env.CheckCollision` |
| SR-2 air 可通过 | ✅ pass | 非 solid 返回 false → 不阻挡 |
| SR-3 边界 clamp | ❓ uncertain | `VoxelCollisionService` 未做显式边界 clamp，依赖 `VoxelPlayEnvironment` 第三方库内部行为 |
| SR-4 未就绪不可用 | ✅ pass | `IsServiceAvailable` 三重检查 + 各方法入口判断 |

**建议**：查验 `VoxelPlayEnvironment.CheckCollision` 和 `RayCast` 在超出地图边界时的行为。若第三方库不保证安全，需在 `VoxelCollisionService` 层补充坐标 clamp。

---

## 通过项汇总

| # | 契约 ID | 模块 | 优先级 | 置信度 | 要点 |
|---|---|---|---|---|---|
| 1 | qc-001 | 玩家原体 > 状态机 | P0 | 0.95 | 4 状态枚举 + 流转矩阵完全一致 |
| 2 | qc-002 | 玩家原体 > 移动管线 | P0 | 0.85 | 水平→重力顺序正确；Idle 零位移通过输入驱动隐式实现 |
| 3 | qc-003 | 玩家原体 > 水平移动与方向 | P1 | 0.90 | GetKey 即时起步/停止，SetFacing localScale.x 翻转 |
| 4 | qc-004 | 玩家原体 > 碰撞检测 | P0 | 0.90 | 水平阻挡/着地/天花板三路径完整 |
| 5 | qc-005 | 玩家原体 > 跳跃规则 | P1 | 0.90 | 空格抛物线 + AirControlFactor=0.5 |
| 6 | qc-009 | 玩家原体 > 异常兜底 | P0 | 0.90 | 穿模排斥 + 坠落边界重置双兜底 |
| 7 | qc-010 | 星球系统 > 状态机 | P0 | 0.95 | Unloaded/Loaded 2 状态正确 |
| 8 | qc-012 | 星球系统 > 着地查询 | P0 | 0.90 | 5 点 AABB 底面射线采样 |
| 9 | qc-013 | 星球系统 > 重力参数 | P0 | 0.95 | clamp[0.1,5.0] / 默认 1.0 / 未加载返回默认 |
| 10 | qc-014 | 跨系统 > D↔E接口方向 | P0 | 0.95 | E 提供碰撞查询/重力参数，D 消费/只读 |
| 11 | qc-015 | 跨系统 > 碰撞不可用退化 | P0 | 0.95 | 退化为无碰撞模式，不崩溃 |

---

## 隐式发现（代码审查中额外发现的问题）

1. **移动管线无显式状态门控**（qc-002）：所有状态均执行完整 Tick 流程，Idle 零位移依赖输入归零隐式实现。功能正确但可读性和维护性稍弱。

2. **穿模排斥多级 fallback 链完整**（qc-009）：60 步抬升 → QueryGround 上方 3 单位 → spawnPoint，三级容错。边界重置有 3 处触发点。设计健壮。

3. **QueryGround 5 点采样优化**（qc-012）：使用 AABB 底面 5 点（四角+中心）而非单中心线射线，减少体素边缘 Y 轴抖动。合理工程优化。

4. **SmoothDamp 可能为有意体验优化**（qc-007）：followSmoothTime=0.15 + teleportThreshold=30 的组合暗示实现者有意加入轻微平滑以避免硬跟导致的画面抖动，需与策划确认。

---

## 代码文件清单

| 文件 | 角色 |
|---|---|
| `PlayerStateMachine.cs` | D 系统 4 状态机 |
| `PlayerMovementPipeline.cs` | D 系统帧结算管线 |
| `PlayerCollisionStrategy.cs` | D 系统碰撞策略 |
| `PlayerEntity.cs` | D 系统玩家实体 |
| `AlienStarInputAdapter.cs` | D 系统输入适配 |
| `OrbitCamera.cs` | 第三人称轨道相机 |
| `VoxelCollisionService.cs` | E 系统碰撞查询 |
| `GravityParams.cs` | E 系统重力参数 |
| `PlanetManager.cs` | E 系统星球管理器 |
| `AlienStarBootstrap.cs` | 场景引导协调 |
| `MovementInputAbsorbGate.cs` | 输入吸收门控 |
| `CreatureRenderer.cs` | B 系统生物渲染器 |
| `AlienStarMovementConfig.cs` | 移动配置 ScriptableObject |
| `AlienStarPlanetConfig.cs` | 星球配置 ScriptableObject |
| `AlienStarCreatureRenderingConfig.cs` | 渲染配置 ScriptableObject |

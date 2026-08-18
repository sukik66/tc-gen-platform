/**
 * CodeReviewSkill — 提示词
 *
 * QC-15 单层输出（与文章原文 IO 对齐）：
 *   - 输入精简：{ rule, boundaryHint, moduleLabel, dirHints, fileKeywords, repos, fallback, extraDirHints, codeContextText }
 *   - 输出对齐文章：{ conclusion: 'pass'|'fail'|'uncertain', confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed }
 *   - grepRepo 工具保留：用于在 dirHint 子树内查找代码模式（含可能的违规证据），dirHint 必填、3s 超时、20 命中上限
 *   - Pass 2 提案 LLM 调用提示词（RULE_PROPOSAL_PASS2_*）保留不动（ST-004 调用链）
 */

/** ─── System Prompt ─────────────────────────────────────────── */
export const CODE_REVIEW_SYSTEM_PROMPT = `你是一名资深游戏工程师，同时具备 QA 视角，擅长在 **Unity 客户端 + 自建游戏服（DS）** 工程中进行代码走查。

## 工程背景
- 客户端：C# / Unity，结构为 Assets/Scripts/Client（业务逻辑）、Assets/Scripts/ExternalClient（通用框架层）、Assets/Scripts/Client/BattleUI（战斗 UI）等。
- 游戏服：ds/Assets/Scripts（战斗/仿真逻辑），与客户端共用 Gameplay.dll 程序集。
- 版本管理：多仓库（client / ds / config / gameplay），通过工具读取本地路径。

## 你的工作流
你将被给予一条**业务规则**、可选的**边界提示**，以及系统**已预检索的相关代码材料**。基于代码事实判断该规则在当前实现中是否成立。

**你可以调用四个工具：**
- \`listDir(repoId, dirPath)\` — 列出目录下的代码文件和子目录
- \`readFile(repoId, filePath, startLine?, maxLines?)\` — 读取文件（默认最多 300 行）
- \`searchInFile(repoId, filePath, pattern)\` — 在单文件内搜索关键词
- \`grepRepo(repoId, pattern, dirHint, fileExt?, maxHits?)\` — 用于在指定 dirHint 子树内查找代码模式（含可能的违规证据），仍受 dirHint 必填、3s 超时、20 命中上限保护

**工作流程（严格按序）：**
1. **首先通读 user prompt 中「🎯 已预检索的相关代码材料」段落**——系统已基于业务关键词在仓库内精确匹配并读取了部分文件。这是你的主要判定依据。
2. 如果预检索材料已经足以判定 conclusion（关键路径清晰），**直接输出 JSON 结论，不要再调任何工具**。
3. 仅当预检索材料缺失关键路径时（如只看到调用方未看到被调方、提示有违规但无具体代码），才用 \`readFile\`/\`grepRepo\` 补充缺失证据。
4. 工具调用上限严格 16 次。每一次调用前问自己：「这次调用是否能补充必要证据？」否则不调。
5. 当出现 system message「⚠️ 工具调用累计字符接近上限」或「🛑 工具调用预算已用尽」时，**立即停止工具调用，输出最终 JSON**——即使证据不完整，把缺失部分写进 \`gaps\` 字段并设 conclusion=uncertain。
6. 最多追溯 4 跳；当你认为已有足够证据时，立即输出 JSON。

**约束：**
- 每次 \`readFile\` 默认 300 行，超长文件用 \`startLine\` 分段续读
- 若某个目录/文件不存在，继续尝试其他候选
- 不要读取无关文件（编辑器工具、第三方库、图集生成等）

## 输出格式（严格 JSON，无 markdown 围栏）

\`\`\`
{
  "conclusion": "pass | fail | uncertain",
  "confidence": 0-100,
  "reasoning": "一段自然语言：说明推理过程、关键发现、为何得出此结论",
  "evidence": [
    { "file": "相对路径", "method": "方法名/类名", "lineHint": "52-67 或 ''", "description": "支撑结论的代码片段说明" }
  ],
  "gaps": "若有关键路径未找到代码证据，说明缺了什么；若证据完整写 ''",
  "filesRead": ["实际读取过正文的文件路径列表"],
  "toolCallsUsed": 0
}
\`\`\`

**conclusion 三选一定义：**
- \`pass\`：在已读取的代码中，找到充分证据表明业务规则成立（关键路径与规则吻合）
- \`fail\`：在已读取的代码中，找到明确证据表明业务规则不成立（关键路径与规则矛盾，或存在违反规则的代码）
- \`uncertain\`：证据不足以判定（未找到关键路径、目录探索受阻、关键文件缺失等）。此时 gaps 必须说明缺了什么

## 置信度参考
- 75-95：找到明确关键路径，逻辑与规则完全吻合或明确矛盾
- 40-65：找到部分代码，关键路径不完整（如只有客户端、缺服务端侧）
- 5-35：无法定位相关目录或文件，材料严重不足

## 行为底线
- 不编造文件路径或行号；listDir / readFile / grepRepo 返回什么就是什么
- 找不到就明确写进 gaps，不要用「可能」「应该」代替证据
- conclusion=fail 时 evidence 至少 1 条且 description 明确说明违反点
- 只输出合法 JSON，不要输出任何其他文字`

/* ─── User Prompt 构建 ───────────────────────────────────────── */

/**
 * 构建 user 初始消息（精简版，仅 4 字段 + 路径侦察输出）
 *
 * @param {{
 *   rule: string,
 *   boundaryHint?: string,
 *   moduleLabel?: string,
 *   dirHints?: string[],
 *   fileKeywords?: string[],
 *   repos?: { repoId: string, repoName: string }[],
 *   fallback?: boolean,
 *   extraDirHints?: string[],
 *   codeContextText?: string,
 * }} p
 */
export function buildCodeReviewUserContent(p) {
  const rule = (p.rule || '').trim()
  const boundary = (p.boundaryHint || '').trim()
  const module = (p.moduleLabel || '').trim()
  const dirHints = [...(p.dirHints || []), ...(p.extraDirHints || [])]
  const fileKeywords = p.fileKeywords || []
  const repos = p.repos || []
  const fallback = p.fallback ?? false
  const codeContextText = String(p.codeContextText || '').trim()

  if (!rule) {
    return '（错误：未提供业务规则，请返回 conclusion=uncertain，confidence=0，gaps 说明原因。）'
  }

  const repoList = repos.length
    ? repos.map((r) => `- repoId: \`${r.repoId}\` · 名称: ${r.repoName}`).join('\n')
    : '（未配置仓库，直接返回 uncertain）'

  const dirSection = dirHints.length
    ? `**兜底候选目录（仅当预检索材料不足时再用 listDir / grepRepo 探索这些目录）：**\n${dirHints.map((d) => `- ${d}`).join('\n')}`
    : '（未能推断候选目录，预检索材料不足时尝试 Assets/Scripts/Client 等顶层目录）'

  const kwSection = fileKeywords.length
    ? `**相关文件名关键词（文件名含这些词的优先读）：** ${fileKeywords.join('、')}`
    : ''

  const fallbackNote = fallback
    ? '\n⚠️ 模块名未能精确匹配到已知功能域，以上为宽泛候选；请结合规则文本自行判断相关性。'
    : ''

  const lines = []
  lines.push(`## 待走查的质量契约（用户层）`)
  if (module) lines.push(`**所属模块**：${module}`)
  lines.push('')
  lines.push(`**业务规则（rule）**：${rule}`)
  if (boundary) lines.push(`**边界 / 风险提示（boundaryHint）**：${boundary}`)

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 代码仓库（可用 repoId 调用工具）')
  lines.push(repoList)

  // ⭐ TKT-20260430-002：智能检索预热材料（核心修复 - 之前被遗漏）
  // 智能检索基于业务关键词在仓库内精确匹配文件，已读取部分正文（受预算保护）。
  // 优先依据这些材料判定，不足时再用工具调用补充——避免 LLM 蒙眼 listDir 浪费工具配额。
  if (codeContextText) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('## 🎯 已预检索的相关代码材料（优先依据，免重复 listDir）')
    lines.push('（系统基于业务关键词在仓库内精确匹配，并已读取部分正文。请先通读这部分判定，工具调用仅用于补充缺失证据。）')
    lines.push('')
    lines.push(codeContextText)
  }

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(dirSection + fallbackNote)
  if (kwSection) lines.push(kwSection)
  lines.push('')
  lines.push('请按上述格式输出最终 JSON 结论：{ conclusion, confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed }。')

  return lines.join('\n')
}

/* ─── Pass 2 提案 LLM 调用提示词（ST-003 · AI.2，保留不动） ─────────── */

export const RULE_PROPOSAL_PASS2_SYSTEM_PROMPT = `你是 Unity 项目目录约定的归纳师。

任务：根据**已找到的反例代码证据**，反推出一条更精确的 Unity 项目「域规则」草稿，用于下次同模块走查直接命中候选目录（避免回退到宽泛搜索）。

## 输入
- 模块名（moduleLabel）
- 规则总览（rule）
- 已找到的反例：含 readDirs（实际读了的目录）+ hitFiles（grepRepo 命中的文件）

## 输出格式（严格 JSON，无 markdown 围栏）

\`\`\`
{
  "keywords": "正则字符串，匹配模块关键词（如『商城|充值|recharge|购买』），简洁聚焦",
  "hints": ["相对仓库根的候选目录数组，3-5 个，最具体的优先"],
  "fileKeywords": ["文件名关键词，3-6 个，PascalCase 或 camelCase"],
  "evidence": {
    "readDirs": ["..."],
    "hitFiles": ["..."]
  },
  "affectsModules": ["可选：本规则可能影响哪些其他模块"]
}
\`\`\`

## 行为底线
- keywords 不要过度宽泛（如 \`.*\`）；不要包含正则元字符的字面意义混用
- hints 必须从已观察到的 readDirs / hitFiles 中归纳，不要编造目录
- 只输出合法 JSON`

/**
 * 构建 Pass 2 提案 LLM user prompt
 *
 * @param {{
 *   moduleLabel: string,
 *   rule: string,
 *   violatedFindings: Array<{ claim: string, evidence: Array<{file:string,method?:string,description?:string}> }>,
 *   readDirs: string[],
 *   hitFiles: string[],
 * }} p
 */
export function buildRuleProposalPass2UserContent(p) {
  const lines = []
  lines.push(`## 模块`)
  lines.push(`${p.moduleLabel || '（未提供）'}`)
  lines.push('')
  lines.push(`## 规则总览`)
  lines.push(p.rule || '（未提供）')
  lines.push('')
  lines.push(`## 走查中找到的违规证据`)
  if (Array.isArray(p.violatedFindings) && p.violatedFindings.length > 0) {
    p.violatedFindings.forEach((f, i) => {
      lines.push(`${i + 1}. **claim**：${f.claim}`)
      ;(f.evidence || []).forEach((e) => {
        lines.push(`   - file: \`${e.file || ''}\`${e.method ? ` · method: ${e.method}` : ''}`)
        if (e.description) lines.push(`     ${e.description}`)
      })
    })
  } else {
    lines.push('（无）')
  }
  lines.push('')
  lines.push(`## 走查实际读了的目录`)
  if (Array.isArray(p.readDirs) && p.readDirs.length > 0) {
    p.readDirs.forEach((d) => lines.push(`- ${d}`))
  } else {
    lines.push('（无）')
  }
  lines.push('')
  lines.push(`## grepRepo 命中文件`)
  if (Array.isArray(p.hitFiles) && p.hitFiles.length > 0) {
    p.hitFiles.forEach((f) => lines.push(`- ${f}`))
  } else {
    lines.push('（无）')
  }
  lines.push('')
  lines.push('请输出一条 Unity 项目域规则草稿（JSON）。')
  return lines.join('\n')
}

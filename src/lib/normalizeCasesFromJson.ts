import type { Priority, TestCase } from '../types'

function newCaseId(): string {
  const n = Math.floor(Math.random() * 900000) + 100000
  return `TC-${n}`
}

const PRI = new Set<Priority>(['P0', 'P1', 'P2'])

export function stripMarkdownJsonFence(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9]*\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return t.trim()
}

/**
 * 转义 JSON 字符串值内部的裸双引号
 *
 * LLM 经常在中文文本里用 "xxx" 做引用标记，但这些引号和 JSON 结构引号
 * 是同一个 ASCII 0x22 字符，导致 JSON.parse 断裂。
 *
 * 策略：逐字符扫描，在 JSON 字符串内部遇到 " 时，检查后面紧跟的
 * 非空白字符是否为 JSON 结构符号（: , } ]）。若不是，说明这个引号
 * 是内容引用而非字符串结束符，转义为 \"。
 */
function escapeContentQuotes(json: string): string {
  const out: string[] = []
  let inStr = false
  let escaped = false

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]

    if (escaped) {
      out.push(ch)
      escaped = false
      continue
    }
    if (ch === '\\' && inStr) {
      out.push(ch)
      escaped = true
      continue
    }

    if (ch !== '"') {
      out.push(ch)
      continue
    }

    if (!inStr) {
      inStr = true
      out.push(ch)
      continue
    }

    // 在字符串内遇到 "，判断是结构结束还是内容引用
    let j = i + 1
    while (j < json.length && /[ \t\r\n]/.test(json[j])) j++
    const next = json[j] as string | undefined
    const isStructural =
      next === undefined ||
      next === ':' || next === ',' ||
      next === '}' || next === ']'

    if (isStructural) {
      inStr = false
      out.push(ch)
    } else {
      out.push('\\', '"')
    }
  }
  return out.join('')
}

/**
 * 尝试修复 LLM 常见的 JSON 格式问题，修复后仍无法 parse 则返回 null
 */
export function repairLlmJson(raw: string): unknown | null {
  let t = raw.trim()

  // 1. 提取 JSON 主体（去掉 LLM 在 JSON 前后加的说明文字）
  const firstBrace = t.indexOf('{')
  const firstBracket = t.indexOf('[')
  if (firstBrace === -1 && firstBracket === -1) return null
  const startChar = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace) ? '[' : '{'
  const startIdx = startChar === '[' ? firstBracket : firstBrace
  t = t.slice(startIdx)

  const endChar = startChar === '{' ? '}' : ']'
  const lastEnd = t.lastIndexOf(endChar)
  if (lastEnd !== -1) {
    t = t.slice(0, lastEnd + 1)
  }

  // 2. 中文引号 → 英文引号
  t = t.replace(/[\u201c\u201d\u2018\u2019\uff02]/g, '"')

  // 3. 尾部多余逗号
  t = t.replace(/,\s*([}\]])/g, '$1')

  // 4. 去掉不可见控制字符（保留 \n \r \t）
  t = t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

  // 5. 先尝试直接 parse
  try {
    return JSON.parse(t)
  } catch {
    // 继续修复
  }

  // 6. 转义字符串值内部的裸双引号（LLM 最常见的错误）
  const escaped = escapeContentQuotes(t)
  try {
    return JSON.parse(escaped)
  } catch {
    // 继续修复
  }

  // 7. 补齐未闭合的括号（LLM 输出被截断）
  let t2 = escaped
  const stack: string[] = []
  let inStr2 = false
  let esc2 = false
  for (const ch of t2) {
    if (esc2) { esc2 = false; continue }
    if (ch === '\\') { esc2 = true; continue }
    if (ch === '"') { inStr2 = !inStr2; continue }
    if (inStr2) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inStr2) t2 += '"'
  t2 = t2.replace(/,\s*$/, '')
  while (stack.length > 0) t2 += stack.pop()
  t2 = t2.replace(/,\s*([}\]])/g, '$1')

  try {
    return JSON.parse(t2)
  } catch {
    return null
  }
}

export function normalizeCasesFromJson(parsed: unknown): TestCase[] {
  let obj: unknown = parsed
  if (typeof parsed === 'string') {
    const stripped = stripMarkdownJsonFence(parsed)
    try {
      obj = JSON.parse(stripped)
    } catch {
      obj = repairLlmJson(stripped)
      if (obj === null) throw new Error('JSON 格式错误，自动修复也无法解析')
    }
  }
  if (!obj || typeof obj !== 'object') throw new Error('JSON 格式错误：应为对象')
  const rawCases = (obj as { cases?: unknown }).cases
  if (!Array.isArray(rawCases)) throw new Error('JSON 必须包含 cases 数组')

  return rawCases.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`cases[${i}] 不是对象`)
    const o = item as Record<string, unknown>
    const p = o.priority
    const priority: Priority = PRI.has(p as Priority) ? (p as Priority) : 'P2'
    const preconditions = Array.isArray(o.preconditions)
      ? o.preconditions.map(String).filter(Boolean)
      : []
    const steps = Array.isArray(o.steps) ? o.steps.map(String).filter(Boolean) : []
    return {
      id: newCaseId(),
      priority,
      caseType: String(o.caseType || '功能测试'),
      module: String(o.module || ''),
      subModule: String(o.subModule || ''),
      summary: String(o.summary || '').trim() || `未命名用例 ${i + 1}`,
      description: String(o.description || ''),
      preconditions,
      steps,
      expected: String(o.expected || ''),
      remarks: String(o.remarks || ''),
    }
  })
}

import type { TestCase } from '../types'

/** 避免 # 与换行破坏 Markdown 标题结构 */
function escHeading(s: string): string {
  return s.replace(/#/g, '\\#').replace(/\n/g, ' ').trim()
}

function trunc(s: string, max: number): string {
  const e = escHeading(s)
  return e.length <= max ? e : `${e.slice(0, max)}…`
}

function groupLabel(tc: TestCase): string {
  const m = tc.module.trim() || '（未填模块）'
  const sm = tc.subModule.trim()
  return sm ? `${m} / ${sm}` : m
}

/**
 * 将用例转为 Markmap 可用的 Markdown 层级（XMind 式：模块 → 用例 → 步骤/预期等）
 */
export function buildTestCasesMindmapMarkdown(cases: TestCase[]): string {
  if (cases.length === 0) {
    return [
      '# 测试用例总览',
      '',
      '## （暂无数据）',
      '',
      '### 请上传文档并生成，或使用侧栏 Cursor 辅助追加用例',
    ].join('\n')
  }

  const lines: string[] = [`# 测试用例总览（${cases.length} 条）`]
  const groups = new Map<string, TestCase[]>()
  for (const tc of cases) {
    const key = groupLabel(tc)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(tc)
  }

  for (const [gkey, list] of groups) {
    lines.push('', `## ${escHeading(gkey)}`)
    for (const tc of list) {
      const head = `[${tc.priority}] ${tc.id} · ${trunc(tc.caseType, 14)} — ${trunc(tc.summary, 48)}`
      lines.push('', `### ${escHeading(head)}`)
      if (tc.description.trim()) {
        lines.push('', `#### 说明：${trunc(tc.description, 120)}`)
      }
      for (let i = 0; i < tc.preconditions.length; i++) {
        lines.push('', `#### 前置 ${i + 1}：${trunc(tc.preconditions[i]!, 100)}`)
      }
      if (tc.steps.length === 0) {
        lines.push('', '#### 步骤：（无）')
      } else {
        for (let i = 0; i < tc.steps.length; i++) {
          lines.push('', `#### 步骤 ${i + 1}：${trunc(tc.steps[i]!, 130)}`)
        }
      }
      lines.push('', `#### 预期：${trunc(tc.expected, 160)}`)
      if (tc.remarks.trim()) {
        lines.push('', `#### 备注：${trunc(tc.remarks, 100)}`)
      }
    }
  }

  return lines.join('\n')
}

import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { TestCase } from '../types'

function ts(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// E-01  导出 Excel（全字段标准用例表）
// ---------------------------------------------------------------------------

const EXCEL_HEADERS = [
  'ID',
  '优先级',
  '用例类型',
  '所属模块',
  '子模块',
  '用例描述（摘要）',
  '详细描述',
  '前置条件',
  '测试步骤',
  '预期结果',
  '备注',
]

function caseToRow(tc: TestCase): string[] {
  return [
    tc.id,
    tc.priority,
    tc.caseType,
    tc.module,
    tc.subModule,
    tc.summary,
    tc.description,
    tc.preconditions.join('\n'),
    tc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    tc.expected,
    tc.remarks,
  ]
}

export function exportExcelFull(cases: TestCase[]): void {
  const data = [EXCEL_HEADERS, ...cases.map(caseToRow)]
  const ws = XLSX.utils.aoa_to_sheet(data)

  const colWidths = EXCEL_HEADERS.map((_, ci) => {
    let max = EXCEL_HEADERS[ci]!.length
    for (const row of data.slice(1)) {
      const cell = row[ci] ?? ''
      const lines = cell.split('\n')
      for (const line of lines) max = Math.max(max, line.length)
    }
    return { wch: Math.min(max + 4, 60) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '测试用例')
  XLSX.writeFile(wb, `测试用例_全量_${ts()}.xlsx`)
}

// ---------------------------------------------------------------------------
// E-03  导出 Checklist（精简一句话 Excel）
// ---------------------------------------------------------------------------

const CK_HEADERS = ['ID', '优先级', '类型', '模块', '用例描述', '预期结果']

export function exportChecklist(cases: TestCase[]): void {
  const data = [
    CK_HEADERS,
    ...cases.map((tc) => [
      tc.id,
      tc.priority,
      tc.caseType,
      tc.module + (tc.subModule ? ` / ${tc.subModule}` : ''),
      tc.summary,
      tc.expected,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = CK_HEADERS.map((_, ci) => {
    let max = CK_HEADERS[ci]!.length
    for (const row of data.slice(1)) {
      max = Math.max(max, (row[ci] ?? '').length)
    }
    return { wch: Math.min(max + 4, 60) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Checklist')
  XLSX.writeFile(wb, `测试用例_Checklist_${ts()}.xlsx`)
}

// ---------------------------------------------------------------------------
// E-02  导出 XMind（.xmind 文件 = zip 内含 content.json + metadata.json）
// ---------------------------------------------------------------------------

interface XMindTopic {
  id: string
  title: string
  children?: { attached: XMindTopic[] }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function buildXMindContent(cases: TestCase[]): XMindTopic {
  const groups = new Map<string, TestCase[]>()
  for (const tc of cases) {
    const key = tc.module.trim() || '（未填模块）'
    const full = tc.subModule.trim() ? `${key} / ${tc.subModule.trim()}` : key
    if (!groups.has(full)) groups.set(full, [])
    groups.get(full)!.push(tc)
  }

  const moduleTopics: XMindTopic[] = []
  for (const [gkey, list] of groups) {
    const caseTopics: XMindTopic[] = list.map((tc) => {
      const children: XMindTopic[] = []
      if (tc.preconditions.length > 0) {
        children.push({
          id: uid(),
          title: '前置条件',
          children: {
            attached: tc.preconditions.map((p) => ({
              id: uid(),
              title: p,
            })),
          },
        })
      }
      if (tc.steps.length > 0) {
        children.push({
          id: uid(),
          title: '测试步骤',
          children: {
            attached: tc.steps.map((s, i) => ({
              id: uid(),
              title: `${i + 1}. ${s}`,
            })),
          },
        })
      }
      children.push({ id: uid(), title: `预期：${tc.expected}` })
      if (tc.remarks.trim()) {
        children.push({ id: uid(), title: `备注：${tc.remarks}` })
      }

      return {
        id: uid(),
        title: `[${tc.priority}] ${tc.caseType} — ${tc.summary}`,
        children: children.length ? { attached: children } : undefined,
      }
    })

    moduleTopics.push({
      id: uid(),
      title: gkey,
      children: { attached: caseTopics },
    })
  }

  return {
    id: uid(),
    title: `测试用例总览（${cases.length} 条）`,
    children: { attached: moduleTopics },
  }
}

export async function exportXMind(cases: TestCase[]): Promise<void> {
  const rootTopic = buildXMindContent(cases)

  const content = [
    {
      id: uid(),
      class: 'sheet',
      title: '测试用例',
      rootTopic,
    },
  ]

  const metadata = {
    creator: { name: 'AI测试平台', version: '1.0.0' },
  }

  const zip = new JSZip()
  zip.file('content.json', JSON.stringify(content))
  zip.file('metadata.json', JSON.stringify(metadata))
  zip.file(
    'manifest.json',
    JSON.stringify({
      'file-entries': {
        'content.json': {},
        'metadata.json': {},
      },
    }),
  )

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/x-xmind' })
  saveAs(blob, `测试用例_${ts()}.xmind`)
}

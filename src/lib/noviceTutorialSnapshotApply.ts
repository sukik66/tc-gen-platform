import type { TestDepth, UploadedFile } from '../types'
/** 源文件为「类 JSON」文本（内含未转义引号），作 prompt 正文即可，勿 JSON.parse */
import noviceRaw from '../fixtures/novice-tutorial-cases.json?raw'

/** 与 `npm run snapshot:novice-tutorial` / `fixtures/generation-snapshots/snapshot-novice-tutorial.json` 对齐 */
export const NOVICE_TUTORIAL_SNAPSHOT_SELECTED_TYPES: string[] = [
  '功能测试',
  '弱网测试',
  '异常操作',
  '协议安全',
  '客户端性能',
  '服务端性能',
  '兼容适配',
  '容灾容错',
  'UI/UX体验',
  'checklist',
]

export const NOVICE_TUTORIAL_SNAPSHOT_DEPTH: TestDepth = 'qa'

export function buildNoviceTutorialSnapshotUploadedFile(): UploadedFile {
  const text = noviceRaw.trim()
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    id,
    name: '参考用例-新手引导套件.json',
    size: text.length,
    mimeType: 'application/json',
    status: 'parsed',
    extractedText: text,
    charCount: text.length,
    documentRole: 'case_ref',
  }
}

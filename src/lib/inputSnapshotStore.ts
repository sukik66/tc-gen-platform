/**
 * 输入快照：将侧栏全部输入状态持久化到 localStorage。
 * 同一时间只保存一份，每次保存覆盖上一份。
 * 不包含大模型通道选择（方便切换通道对比效果）。
 */
import type { UploadedFile, TestDepth } from '../types'
import type { CodeContextPayload } from '../api/vcs'

const KEY = 'ai-test-platform:input-snapshot:v1'

export interface InputSnapshot {
  version: 1
  savedAt: string
  files: UploadedFile[]
  focusText: string
  selectedTypes: string[]
  depth: TestDepth
  codeChanges: CodeContextPayload | null
}

export function saveInputSnapshot(data: Omit<InputSnapshot, 'version' | 'savedAt'>): void {
  const snapshot: InputSnapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...data,
  }
  localStorage.setItem(KEY, JSON.stringify(snapshot))
}

export function loadInputSnapshot(): InputSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as InputSnapshot
    if (data.version !== 1 || !Array.isArray(data.files)) return null
    return data
  } catch {
    return null
  }
}

export function hasInputSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function getInputSnapshotTime(): string | null {
  const s = loadInputSnapshot()
  if (!s) return null
  try {
    const d = new Date(s.savedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return null
  }
}

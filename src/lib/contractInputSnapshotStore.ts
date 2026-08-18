/**
 * 质量契约页·输入快照
 *
 * 用途：把侧栏 AI 提取的输入状态（文档 + 聚焦文本 + 代码变更）持久化到 localStorage，
 *      方便调试时一键复现同一组输入，避免反复上传文档。
 *
 * 设计与 inputSnapshotStore.ts 派生而来，但有两处差异（参见 ST-1）：
 *  - KEY 用独立槽位 `:contract-input-snapshot:v1`，与「测试用例生成」快照互不覆盖。
 *  - 字段精简：契约生成入口没有 selectedTypes / depth 选项，故去掉这两项。
 *
 * 同一时间只保存一份（覆盖式）。不持久化 LLM 通道选择，便于切换通道对比效果。
 */
import type { UploadedFile } from '../types'
import type { CodeContextPayload } from '../api/vcs'

const KEY = 'ai-test-platform:contract-input-snapshot:v1'

export interface ContractInputSnapshot {
  version: 1
  savedAt: string
  files: UploadedFile[]
  focusText: string
  codeChanges: CodeContextPayload | null
}

export function saveContractInputSnapshot(
  data: Omit<ContractInputSnapshot, 'version' | 'savedAt'>,
): void {
  const snapshot: ContractInputSnapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...data,
  }
  localStorage.setItem(KEY, JSON.stringify(snapshot))
}

export function loadContractInputSnapshot(): ContractInputSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as ContractInputSnapshot
    if (data.version !== 1 || !Array.isArray(data.files)) return null
    return data
  } catch {
    return null
  }
}

export function hasContractInputSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function getContractInputSnapshotTime(): string | null {
  const s = loadContractInputSnapshot()
  if (!s) return null
  try {
    const d = new Date(s.savedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return null
  }
}

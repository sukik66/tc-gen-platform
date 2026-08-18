/**
 * 本次浏览器会话内的「生成结果快照」：写入 sessionStorage，关标签页后清空。
 * 用于调试复现、误操作恢复，避免重复消耗 token。
 */
import type { TestCase } from '../types'

const STORAGE_KEY = 'ai-test-platform:generation-session-snapshots:v1'
const MAX_RECORDS = 15

/** 防止 React Strict Mode 或异常双回调在极短时间内写入两条完全相同的快照 */
let lastSnapshotFingerprint = ''
let lastSnapshotAtMs = 0

function fingerprintForSnapshot(cases: TestCase[], label: string): string {
  const ids = cases.map((c) => c.id).join(',')
  return `${label}|${cases.length}|${ids}`
}

export interface GenerationSessionRecord {
  id: string
  createdAt: string
  /** 下拉展示 */
  label: string
  cases: TestCase[]
}

interface PersistShape {
  version: 1
  records: GenerationSessionRecord[]
}

function deepCloneCases(cases: TestCase[]): TestCase[] {
  return JSON.parse(JSON.stringify(cases)) as TestCase[]
}

function formatLabel(caseCount: number, lastSummary: string): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const tail = (lastSummary || '').trim().slice(0, 26)
  const ell = tail.length >= 26 ? '…' : ''
  return `${hh}:${mm}:${ss} · 共 ${caseCount} 条${tail ? ` · ${tail}${ell}` : ''}`
}

export function loadGenerationSessionRecords(): GenerationSessionRecord[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as PersistShape
    if (!p || p.version !== 1 || !Array.isArray(p.records)) return []
    return p.records
  } catch {
    return []
  }
}

function saveRecords(records: GenerationSessionRecord[]) {
  const sliced = records.slice(-MAX_RECORDS)
  const payload: PersistShape = { version: 1, records: sliced }
  const str = JSON.stringify(payload)
  try {
    sessionStorage.setItem(STORAGE_KEY, str)
  } catch {
    if (sliced.length <= 1) return
    saveRecords(sliced.slice(-Math.max(1, Math.floor(sliced.length / 2))))
  }
}

/**
 * 在每次 API 成功合并新用例后调用，追加一条全量列表快照。
 * @returns 更新后的记录列表（供 setState）
 */
export function appendGenerationSessionSnapshot(cases: TestCase[]): GenerationSessionRecord[] {
  if (cases.length === 0) return loadGenerationSessionRecords()
  const last = cases[cases.length - 1]
  const label = formatLabel(cases.length, last?.summary ?? '')
  const fp = fingerprintForSnapshot(cases, label)
  const now = Date.now()
  if (fp === lastSnapshotFingerprint && now - lastSnapshotAtMs < 4000) {
    return loadGenerationSessionRecords()
  }
  lastSnapshotFingerprint = fp
  lastSnapshotAtMs = now

  const rec: GenerationSessionRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    label,
    cases: deepCloneCases(cases),
  }
  const next = [...loadGenerationSessionRecords(), rec]
  saveRecords(next)
  return loadGenerationSessionRecords()
}

export function clearGenerationSessionSnapshots(): void {
  lastSnapshotFingerprint = ''
  lastSnapshotAtMs = 0
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

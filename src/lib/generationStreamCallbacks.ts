import type { MutableRefObject } from 'react'
import type { TestCase, TestPlanLedger } from '../types'
import type { GenerationSessionRecord } from './generationSessionCache'
import { appendGenerationSessionSnapshot } from './generationSessionCache'

export interface GenerationExtra {
  interrupted?: boolean
  interruptReason?: string
  partial?: boolean
  /** 仅承载「结构/完整性」类信号；条数下限不再作为质量判据下发 */
  qualityHints?: {
    actualCases?: number
    partialJson?: boolean
    rawChars?: number
    shortJsonRetry?: boolean
    provider?: string
  }
  testPlan?: TestPlanLedger | null
  completionNotice?: string
}

export interface StreamGenerationDeps {
  casesRef: MutableRefObject<TestCase[]>
  revisionBaselineRef: MutableRefObject<TestCase[] | null>
  setCases: (v: TestCase[] | ((prev: TestCase[]) => TestCase[])) => void
  setSessionSnapshots: (v: GenerationSessionRecord[] | ((prev: GenerationSessionRecord[]) => GenerationSessionRecord[])) => void
  setGenerating: (v: boolean) => void
  setStreamConnected: (v: boolean) => void
  setStreamText: (v: string | ((prev: string) => string)) => void
  setProgressInfo: (v: { chars: number; estimatedCases: number; elapsedSec: number } | null) => void
  abortRef: MutableRefObject<AbortController | null>
  setInterruptMsg: (v: string | null) => void
  setGenerationNotice: (v: string | null) => void
  setGenerateError: (v: string | null) => void
  truncateInterruptReason: (reason: string | undefined, max?: number) => string
  /** 任意一次生成收尾成功时清空（如体量黄条） */
  onGenerationFinishSuccess?: () => void
}

function mergeCases(
  deps: StreamGenerationDeps,
  newCases: unknown[],
): { batch: TestCase[] } {
  const batch = newCases as TestCase[]
  const merged = [...deps.casesRef.current, ...batch]
  deps.revisionBaselineRef.current = structuredClone(merged)
  deps.casesRef.current = merged
  deps.setCases(merged)
  if (batch.length > 0) {
    deps.setSessionSnapshots(appendGenerationSessionSnapshot(merged))
  }
  return { batch }
}

function finishStreamUi(deps: StreamGenerationDeps, withProgress: boolean) {
  deps.setGenerating(false)
  deps.setStreamConnected(false)
  deps.setStreamText('')
  if (withProgress) deps.setProgressInfo(null)
  deps.abortRef.current = null
}

/** 仅在「解析不完整 / 曾触发短输出重试」等客观信号时提示，不用固定条数评判质量 */
export function formatStructuralRiskMsg(
  qh: NonNullable<GenerationExtra['qualityHints']>,
  batchLen: number,
  testPlan?: TestPlanLedger | null,
): string {
  const parts: string[] = []
  if (qh.partialJson) {
    parts.push(`模型输出在结尾处未完整，本批已保留 ${qh.actualCases ?? batchLen} 条可解析用例，未完整的尾部内容未纳入结果。`)
    const uncoveredCount = testPlan?.coverage.uncoveredTestPointIds?.length
    if (typeof uncoveredCount === 'number') {
      parts.push(
        uncoveredCount > 0
          ? `覆盖检查仍有 ${uncoveredCount} 个测试点未覆盖，可点击“补充未覆盖用例”继续生成。`
          : '覆盖检查未发现未覆盖测试点，可继续使用当前结果。',
      )
    }
  }
  if (qh.shortJsonRetry) {
    parts.push('模型首次返回内容不可用，系统已自动重试并保留重试结果。')
  }
  parts.push(
    `技术信息：通道 ${qh.provider ?? '未知'}，模型原始输出约 ${qh.rawChars ?? '?'} 字符。`,
  )
  return parts.join('')
}

export function createEnhancedOnDone(deps: StreamGenerationDeps) {
  return (newCases: unknown[], extra?: GenerationExtra) => {
    const { batch } = mergeCases(deps, newCases)
    finishStreamUi(deps, true)
    deps.onGenerationFinishSuccess?.()

    const qh = extra?.qualityHints
    let qualityMsg = ''
    if (qh && (qh.partialJson || qh.shortJsonRetry)) {
      qualityMsg = formatStructuralRiskMsg(qh, batch.length, extra?.testPlan)
    }
    const notice = [qualityMsg, extra?.completionNotice]
      .filter((message): message is string => Boolean(message?.trim()))
      .join('\n\n')
    deps.setGenerationNotice(null)
    if (extra?.interrupted) {
      const im = `生成被中断（${deps.truncateInterruptReason(extra.interruptReason)}），已保留 ${batch.length} 条已生成用例${extra.partial ? '（部分用例可能不完整）' : ''}`
      deps.setInterruptMsg(qualityMsg ? `${qualityMsg}\n\n${im}` : im)
    } else if (notice) {
      deps.setGenerationNotice(notice)
    }
  }
}

export function createEnhancedOnError(deps: StreamGenerationDeps) {
  return (msg: string, raw?: string) => {
    deps.setGenerationNotice(null)
    deps.setGenerateError(
      raw ? `${msg}\n\n（模型输出片段，便于排查 JSON）\n${String(raw).slice(0, 1200)}` : msg,
    )
    finishStreamUi(deps, true)
  }
}

export function createSimpleOnDone(deps: StreamGenerationDeps) {
  return (newCases: TestCase[], extra?: GenerationExtra) => {
    const { batch } = mergeCases(deps, newCases)
    finishStreamUi(deps, false)
    deps.onGenerationFinishSuccess?.()

    if (extra?.interrupted || extra?.partial) {
      const reason =
        extra.interruptReason && extra.interruptReason.trim()
          ? deps.truncateInterruptReason(extra.interruptReason)
          : '输出可能被截断或解析为部分结果'
      deps.setInterruptMsg(
        `生成未完整结束（${reason}），已保留 ${batch.length} 条用例${extra.partial ? '（条数或字段可能不完整，可调低详细程度或减少上下文后重试）' : ''}`,
      )
    }
  }
}

export function createSimpleOnError(deps: StreamGenerationDeps) {
  return (msg: string, raw?: string) => {
    deps.setGenerateError(
      raw ? `${msg}\n\n（模型输出片段，便于排查 JSON）\n${String(raw).slice(0, 1200)}` : msg,
    )
    deps.setGenerating(false)
    deps.setStreamConnected(false)
    deps.setStreamText('')
    deps.abortRef.current = null
  }
}

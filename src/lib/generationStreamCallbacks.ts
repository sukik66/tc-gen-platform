import type { MutableRefObject } from 'react'
import type { TestCase } from '../types'
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
function formatStructuralRiskMsg(
  qh: NonNullable<GenerationExtra['qualityHints']>,
  batchLen: number,
): string {
  const parts: string[] = []
  if (qh.partialJson) {
    parts.push('返回 JSON 可能未完整（部分解析），请留意是否被截断或 max_tokens / 网关限制。')
  }
  if (qh.shortJsonRetry) {
    parts.push('本次曾自动触发「去掉 JSON 模式」短输出重试。')
  }
  parts.push(
    `本批追加 ${qh.actualCases ?? batchLen} 条；模型原始输出约 ${qh.rawChars ?? '?'} 字符；通道：${qh.provider ?? '未知'}。`,
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
      qualityMsg = formatStructuralRiskMsg(qh, batch.length)
    }
    if (extra?.interrupted) {
      const im = `生成被中断（${deps.truncateInterruptReason(extra.interruptReason)}），已保留 ${batch.length} 条已生成用例${extra.partial ? '（部分用例可能不完整）' : ''}`
      deps.setInterruptMsg(qualityMsg ? `${qualityMsg}\n\n${im}` : im)
    } else if (qualityMsg) {
      deps.setInterruptMsg(qualityMsg)
    }
  }
}

export function createEnhancedOnError(deps: StreamGenerationDeps) {
  return (msg: string, raw?: string) => {
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

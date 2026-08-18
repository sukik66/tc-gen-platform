import { useState, type ReactNode } from 'react'
import type { QualityContractDraft } from '../lib/contractDraftStore'
import { contractMethodLabel } from '../constants'
import { priorityClass } from '../lib/ui-utils'
import type {
  ContractCodeReviewResult,
  PersistedContractCodeReviewResult,
} from '../api/codeReview'

/**
 * 契约卡片：QualityContractsPage Step 7 草稿预览 与 ContractLibraryPage 已入库列表 的统一渲染单元。
 *
 * 设计原则（参考重构 3 问 Checklist）：
 * - 默认渲染所有「业务字段都有但只有一边显示」的内容（codeContext / verifyRationale）—— 这是统一历史遗留差异
 * - 仅保留 showStatus 一个 prop（用于场景差异：草稿预览不需要 active/draft 徽章）
 * - actions / footer / expanded 三个 slot 由调用方自定义
 *
 * QC-15（两层架构修正）：原 QC-12 引入的骨架字段渲染已全部下架。
 * 骨架属于「如何查」层，不应在用户层卡片上展示；本卡片回归单层用户层语义渲染——
 * 仅展示 priority + moduleLabel + rule + boundaryHint + verifyMethods + verifyRationale + codeContext 状态。
 *
 * TKT-20260429-014（QC-16）：
 * - 新增可选 reviewResult prop，用于在卡片内挂载最近一次代码走查结论徽章 + 证据折叠区。
 * - 新增可选 layer 字段渲染（BD-1 L1）：契约附带 layer/given/when/then_must 等元数据时，
 *   提供「执行层详情 ▾」折叠区，仅作老板感知用，不参与 LLM prompt（QC-15 KD-1 决议保留）。
 *   contract 不带 layer 字段时整块不渲染（向后兼容）。
 */

/** 契约附加的执行层元数据（QC-15 KD-1 后端 normalize 透传，前端可选渲染） */
interface ContractLayerMeta {
  layer?: 'data' | 'business' | 'ux' | string
  given?: string
  when?: string
  then_must?: string[]
  then_must_not?: string[] | null
  measurable?: { kind?: string; expression?: string } | null
}

/** ContractCard 接受的契约对象类型：基础字段 + 可选执行层元数据 */
export type ContractCardContract = QualityContractDraft & ContractLayerMeta

export interface ContractCardProps {
  contract: ContractCardContract
  /** 是否显示「已启用 / 草稿」状态徽章。默认 false（QC 草稿预览不需要） */
  showStatus?: boolean
  /** 右上角操作按钮（QC：删除契约；Library：启用/编辑/删除） */
  actions?: ReactNode
  /** 副字段 slot（拼到 codeContext 状态后面，例如时间戳、模块ID） */
  footer?: ReactNode
  /** 展开内容（例如 Library 的内联编辑表单） */
  expanded?: ReactNode
  /**
   * TKT-20260429-014 · 最近一次走查结果（可选）。
   * - QualityContractsPage 批量走查后通过 batchResults[id] 注入
   * - ContractLibraryPage 进入页时通过 listContractReviewResults(id, 1) 拉取最新一条注入
   * - 为 null/undefined 时不渲染走查徽章区（向后兼容）
   */
  reviewResult?: PersistedContractCodeReviewResult | ContractCodeReviewResult | null
}

const VERDICT_LABEL: Record<'pass' | 'fail' | 'uncertain', string> = {
  pass: '✓ 通过',
  fail: '✗ 违规',
  uncertain: '? 存疑',
}

const VERDICT_CLASS: Record<'pass' | 'fail' | 'uncertain', string> = {
  pass: 'bg-emerald-500/20 text-emerald-200',
  fail: 'bg-red-500/20 text-red-200',
  uncertain: 'bg-amber-500/20 text-amber-100',
}

const LAYER_LABEL: Record<string, string> = {
  data: '数据层',
  business: '业务层',
  ux: '交互层',
}

function ReviewResultBadge({
  result,
}: {
  result: PersistedContractCodeReviewResult | ContractCodeReviewResult
}) {
  const [open, setOpen] = useState(false)
  const verdict = (result.conclusion || result.verdict || 'uncertain') as
    | 'pass'
    | 'fail'
    | 'uncertain'
  const reasoning = (result.reasoning || '').trim()
  const reasoningPreview =
    reasoning.length > 80 ? `${reasoning.slice(0, 80)}…` : reasoning || '（无 reasoning）'
  const evidence = Array.isArray(result.evidence) ? result.evidence : []
  const persisted = result as PersistedContractCodeReviewResult
  const runAt = persisted.runAt || persisted.savedAt
  const runAtText = runAt
    ? new Date(runAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : ''
  return (
    <div className="mt-3 rounded border border-white/10 bg-black/25 px-2.5 py-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${VERDICT_CLASS[verdict]}`}>
          {VERDICT_LABEL[verdict]}
        </span>
        <span className="text-zinc-500">置信度 {result.confidence ?? 0}%</span>
        {runAtText && <span className="text-zinc-600">· {runAtText}</span>}
        {persisted.llmProvider && (
          <span className="text-zinc-600">· {persisted.llmProvider}</span>
        )}
      </div>
      <p className="mt-1.5 leading-relaxed text-zinc-300">{reasoningPreview}</p>
      {evidence.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[11px] text-violet-300 hover:text-violet-200"
        >
          {open ? '收起证据 ▴' : `展开证据（${evidence.length} 条）▾`}
        </button>
      )}
      {open && evidence.length > 0 && (
        <ul className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
          {evidence.map((e, i) => (
            <li key={i} className="leading-relaxed text-zinc-400">
              <span className="text-zinc-300">
                {[e.file, e.method, e.lineHint].filter(Boolean).join(' · ') || `证据 ${i + 1}`}
              </span>
              {e.description && (
                <span className="ml-1 text-zinc-500">— {e.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LayerDetailFold({ contract }: { contract: ContractCardContract }) {
  const [open, setOpen] = useState(false)
  const layer = typeof contract.layer === 'string' ? contract.layer.trim().toLowerCase() : ''
  const given = typeof contract.given === 'string' ? contract.given.trim() : ''
  const when = typeof contract.when === 'string' ? contract.when.trim() : ''
  const thenMust = Array.isArray(contract.then_must) ? contract.then_must : []
  const thenMustNot = Array.isArray(contract.then_must_not) ? contract.then_must_not : []
  const measurable = contract.measurable && typeof contract.measurable === 'object'
    ? contract.measurable
    : null
  // 任一字段存在即渲染；都不存在则整块不渲染（BD-1 L1 向后兼容铁律）
  const hasAny = !!(layer || given || when || thenMust.length || thenMustNot.length || measurable)
  if (!hasAny) return null
  const layerText = LAYER_LABEL[layer] || layer || '执行层'
  return (
    <div className="mt-2 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-zinc-400 hover:text-zinc-200"
      >
        {open ? `执行层详情（${layerText}）▴` : `执行层详情（${layerText}）▾`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded border border-white/10 bg-black/20 px-2 py-1.5 leading-relaxed text-zinc-400">
          {given && (
            <p>
              <span className="text-zinc-500">Given：</span>
              <span className="text-zinc-300">{given}</span>
            </p>
          )}
          {when && (
            <p>
              <span className="text-zinc-500">When：</span>
              <span className="text-zinc-300">{when}</span>
            </p>
          )}
          {thenMust.length > 0 && (
            <div>
              <span className="text-zinc-500">Then Must：</span>
              <ul className="ml-3 list-disc text-zinc-300">
                {thenMust.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {thenMustNot.length > 0 && (
            <div>
              <span className="text-zinc-500">Then Must Not：</span>
              <ul className="ml-3 list-disc text-zinc-300">
                {thenMustNot.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {measurable && (measurable.kind || measurable.expression) && (
            <p>
              <span className="text-zinc-500">Measurable：</span>
              <span className="text-zinc-300">
                {measurable.kind ? `${measurable.kind} · ` : ''}
                {measurable.expression || ''}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function ContractCard({
  contract,
  showStatus = false,
  actions,
  footer,
  expanded,
  reviewResult,
}: ContractCardProps) {
  const c = contract

  return (
    <li className="rounded-xl border border-white/10 bg-[#14151f]/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${priorityClass(c.priority)}`}>
            {c.priority}
          </span>
          {showStatus && (
            <span
              className={[
                'ml-2 inline-block rounded border px-2 py-0.5 text-[10px]',
                c.status === 'active'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                  : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400',
              ].join(' ')}
            >
              {c.status === 'active' ? '已启用' : '草稿'}
            </span>
          )}
          <h3 className="mt-1 text-sm font-medium text-white">{c.moduleLabel}</h3>
        </div>
        {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{c.rule}</p>

      {c.boundaryHint?.trim() && (
        <p className="mt-2 border-l-2 border-teal-500/40 pl-2 text-xs text-zinc-400">边界：{c.boundaryHint}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.verifyMethods.map((m) => (
          <span
            key={m}
            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400"
          >
            {contractMethodLabel(m)}
          </span>
        ))}
        {c.verifyMethods.length === 0 && <span className="text-[10px] text-zinc-500">暂无验证方式</span>}
      </div>

      {c.verifyRationale?.trim() && (
        <p className="mt-2 text-[10px] leading-relaxed text-teal-500/85">推荐理由：{c.verifyRationale}</p>
      )}

      {/* TKT-20260429-014 · 走查结论徽章（reviewResult 存在时渲染） */}
      {reviewResult && <ReviewResultBadge result={reviewResult} />}

      {/* TKT-20260429-014 BD-1 L1 · 执行层详情折叠区（layer/given/when/then_must 任一存在时渲染） */}
      <LayerDetailFold contract={c} />

      <p className="mt-2 text-[10px] text-zinc-600">
        {c.codeContext ? '含代码快照' : '无代码快照'}
        {footer && (
          <>
            {' · '}
            {footer}
          </>
        )}
      </p>

      {expanded}
    </li>
  )
}

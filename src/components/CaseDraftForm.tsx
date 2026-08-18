import { useEffect, useRef } from 'react'
import type { Priority, TestCase } from '../types'

export type DraftFocusField =
  | 'module'
  | 'subModule'
  | 'summary'
  | 'description'
  | 'preconditions'
  | 'steps'
  | 'expected'
  | 'remarks'
  | 'caseType'
  | 'priority'
  | null

interface CaseDraftFormProps {
  draft: TestCase
  onChange: (next: TestCase) => void
  onSave: () => void
  onCancel: () => void
  title: string
  /** 打开表单时聚焦的字段；null 表示不自动聚焦 */
  autoFocusField: DraftFocusField
  /** 在 autoFocusField 对应 textarea 中的光标位置 */
  autoFocusCaret: number | null
  /** 变化时重新执行 focus 逻辑 */
  focusKey: number
  variant?: 'inline' | 'modal'
}

export function CaseDraftForm({
  draft,
  onChange,
  onSave,
  onCancel,
  title,
  autoFocusField,
  autoFocusCaret,
  focusKey,
  variant = 'inline',
}: CaseDraftFormProps) {
  const refModule = useRef<HTMLInputElement>(null)
  const refSubModule = useRef<HTMLInputElement>(null)
  const refSummary = useRef<HTMLTextAreaElement>(null)
  const refDescription = useRef<HTMLTextAreaElement>(null)
  const refPre = useRef<HTMLTextAreaElement>(null)
  const refSteps = useRef<HTMLTextAreaElement>(null)
  const refExpected = useRef<HTMLTextAreaElement>(null)
  const refRemarks = useRef<HTMLTextAreaElement>(null)
  const refCaseType = useRef<HTMLInputElement>(null)
  const refPriority = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (!autoFocusField) return
    const map: Record<
      NonNullable<DraftFocusField>,
      React.RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>
    > = {
      module: refModule,
      subModule: refSubModule,
      summary: refSummary,
      description: refDescription,
      preconditions: refPre,
      steps: refSteps,
      expected: refExpected,
      remarks: refRemarks,
      caseType: refCaseType,
      priority: refPriority,
    }
    const el = map[autoFocusField]?.current
    if (!el) return
    el.focus()
    if (autoFocusCaret != null && el instanceof HTMLTextAreaElement) {
      const pos = Math.min(Math.max(0, autoFocusCaret), el.value.length)
      requestAnimationFrame(() => el.setSelectionRange(pos, pos))
    }
  }, [autoFocusField, autoFocusCaret, focusKey])

  const shell = variant === 'inline' ? 'rounded-xl border border-violet-500/25 bg-[#161722]/95 p-4' : ''

  return (
    <div className={shell}>
      <h3
        className={[
          'mb-4 flex items-center gap-2 text-sm font-semibold',
          variant === 'inline' ? 'text-violet-300' : 'text-sky-200',
        ].join(' ')}
      >
        <span aria-hidden>✎</span>
        {title}
      </h3>
      <div className="grid gap-3 text-xs">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-zinc-500">功能模块</span>
            <input
              ref={refModule}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              value={draft.module}
              onChange={(e) => onChange({ ...draft, module: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-zinc-500">子模块</span>
            <input
              ref={refSubModule}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              value={draft.subModule}
              onChange={(e) => onChange({ ...draft, subModule: e.target.value })}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-zinc-500">
            用例描述<span className="text-red-400">＊</span>
          </span>
          <textarea
            ref={refSummary}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
            rows={2}
            value={draft.summary}
            onChange={(e) => onChange({ ...draft, summary: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-zinc-500">详细说明</span>
          <textarea
            ref={refDescription}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
            rows={3}
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-zinc-500">优先级</span>
            <select
              ref={refPriority}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              value={draft.priority}
              onChange={(e) =>
                onChange({ ...draft, priority: e.target.value as Priority })
              }
            >
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-500">用例类型</span>
            <input
              ref={refCaseType}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              value={draft.caseType}
              onChange={(e) => onChange({ ...draft, caseType: e.target.value })}
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-zinc-500">前置条件</span>
            <textarea
              ref={refPre}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              rows={3}
              value={draft.preconditions.join('\n')}
              onChange={(e) =>
                onChange({
                  ...draft,
                  // 保留空行，否则光标在末行按 Enter 会被 filter(Boolean) 吃掉，无法先换行再输入
                  preconditions: e.target.value.split('\n'),
                })
              }
            />
          </label>
          <label className="block">
            <span className="text-zinc-500">
              测试步骤<span className="text-red-400">＊</span>
            </span>
            <textarea
              ref={refSteps}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
              rows={4}
              value={draft.steps.join('\n')}
              onChange={(e) =>
                onChange({
                  ...draft,
                  steps: e.target.value.split('\n'),
                })
              }
            />
          </label>
        </div>
        <label className="block">
          <span className="text-zinc-500">
            预期结果<span className="text-red-400">＊</span>
          </span>
          <textarea
            ref={refExpected}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
            rows={3}
            value={draft.expected}
            onChange={(e) => onChange({ ...draft, expected: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-zinc-500">备注</span>
          <textarea
            ref={refRemarks}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
            rows={2}
            placeholder="添加备注…"
            value={draft.remarks}
            onChange={(e) => onChange({ ...draft, remarks: e.target.value })}
          />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-white/10 pt-4">
        <button
          type="button"
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500"
          onClick={onSave}
        >
          应用修改
        </button>
      </div>
    </div>
  )
}

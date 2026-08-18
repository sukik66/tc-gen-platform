import { useCallback, useState, type ReactNode } from 'react'

/**
 * 删除/危险操作前的统一确认对话框 Hook，替代各处散落的 `window.confirm()`。
 *
 * 优势：
 * - 视觉与平台主题一致（深色 + violet/red 主题）
 * - 支持自定义按钮文案（"删除" / "清空" / "替换" 等业务化措辞）
 * - destructive 模式自动应用红色高危样式
 * - description 接 ReactNode，可显示多行/含强调的描述
 */

export interface ConfirmOptions {
  /** 标题，必填 */
  title: string
  /** 描述文字（可选，支持 ReactNode 用于多行/强调） */
  description?: ReactNode
  /** 确认按钮文案，默认"确认" */
  confirmText?: string
  /** 取消按钮文案，默认"取消" */
  cancelText?: string
  /** 危险操作（确认按钮显示为红色） */
  destructive?: boolean
}

export interface UseConfirmDialogResult {
  /** 调用以打开对话框，返回 Promise<boolean>。点击确认 → true，取消/关闭 → false */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** 渲染槽：放在组件 JSX 末尾以便 fixed 定位覆盖整个视口 */
  dialog: ReactNode
}

interface ActiveDialog extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function useConfirmDialog(): UseConfirmDialogResult {
  const [active, setActive] = useState<ActiveDialog | null>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setActive({ ...opts, resolve })
      }),
    [],
  )

  const handle = (ok: boolean) => {
    if (active) {
      active.resolve(ok)
      setActive(null)
    }
  }

  const dialog: ReactNode = active && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => handle(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#1a1b2e] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">{active.title}</h3>
        {active.description && (
          <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {active.description}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => handle(false)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-300 hover:border-white/25 hover:text-white"
          >
            {active.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            onClick={() => handle(true)}
            className={
              active.destructive
                ? 'rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-500/25'
                : 'rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500'
            }
          >
            {active.confirmText ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  )

  return { confirm, dialog }
}

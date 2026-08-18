import { useRef, useState } from 'react'
import { DOCUMENT_ROLE_OPTIONS } from '../constants'
import { formatBytes } from '../lib/format'
import type { DocumentRole, UploadedFile } from '../types'
import type { UseDocumentUploadResult } from '../hooks/useDocumentUpload'

export type DocumentUploadPanelVariant = 'full' | 'compact'
export type DocumentUploadPanelTheme = 'violet' | 'teal' | 'neutral'

export interface DocumentUploadPanelProps {
  /** 由 useDocumentUpload() 返回的状态对象，整体透传 */
  state: UseDocumentUploadResult
  /**
   * 视觉密度变体：
   * - `full`：大拖拽框 + 文件行带大小/字符数/上下移动/三色徽章（用例生成场景）
   * - `compact`：迷你拖拽 + 文件行只展示文件名/角色/状态文字/删除（质量契约场景）
   */
  variant: DocumentUploadPanelVariant
  /** 主题色：影响拖拽 active 边框、按钮配色 */
  theme?: DocumentUploadPanelTheme
  /** input 的 accept 属性，未传则不限制类型 */
  accept?: string
  /** 整体禁用（如生成中） */
  disabled?: boolean
  /** compact 模式下"选择文件"按钮文案，默认「选择文件」 */
  buttonLabel?: string
  /**
   * full 模式下拖拽区底部的辅助说明文字，
   * 默认「支持 PDF、Word、Excel、文本/Markdown/CSV、图片（OCR）」
   */
  hintText?: string
}

interface ThemeTokens {
  /** 拖拽 active 时的边框/背景 */
  dropActive: string
  /** 拖拽 idle 时的边框/背景 */
  dropIdle: string
  /** 主按钮（compact 模式选择文件按钮） */
  primaryBtn: string
  /** select focus 边框 */
  selectFocus: string
}

const THEME: Record<DocumentUploadPanelTheme, ThemeTokens> = {
  violet: {
    dropActive: 'border-violet-500/70 bg-violet-500/10',
    dropIdle: 'border-white/20 bg-white/[0.02]',
    primaryBtn: 'border-violet-500/40 bg-violet-500/[0.08] text-violet-100 hover:bg-violet-500/20',
    selectFocus: 'focus:border-violet-500/40',
  },
  teal: {
    dropActive: 'border-teal-500/70 bg-teal-500/10',
    dropIdle: 'border-white/20 bg-white/[0.02]',
    primaryBtn: 'border-teal-500/40 bg-teal-600/20 text-teal-100 hover:bg-teal-600/30',
    selectFocus: 'focus:border-teal-500/45',
  },
  neutral: {
    dropActive: 'border-zinc-400/60 bg-white/5',
    dropIdle: 'border-white/20 bg-white/[0.02]',
    primaryBtn: 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10',
    selectFocus: 'focus:border-zinc-400/40',
  },
}

/**
 * 跨页面共用的「上传需求文档」面板。
 *
 * 与 useDocumentUpload Hook 配套使用：
 *   const docs = useDocumentUpload({ defaultRole, onParsed })
 *   <DocumentUploadPanel state={docs} variant="full" theme="violet" accept=".pdf,.docx,..." />
 *
 * variant 视觉差异：
 * - full：拖拽框较大；文件行展示大小/字符数/上下移动按钮/三色徽章；用于用例生成页
 * - compact：拖拽框收敛为单行；文件行仅文件名/角色/状态文字/"删除"按钮；用于质量契约页
 */
export function DocumentUploadPanel(props: DocumentUploadPanelProps) {
  const {
    state,
    variant,
    theme = 'neutral',
    accept,
    disabled = false,
    buttonLabel = '选择文件',
    hintText = '支持 PDF、Word、Excel、文本/Markdown/CSV、图片（OCR）',
  } = props

  const tokens = THEME[theme]
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragDepthRef.current += 1
    setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setDragOver(false)
    }
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragDepthRef.current = 0
    setDragOver(false)
    if (e.dataTransfer.files?.length) state.enqueueFiles(e.dataTransfer.files)
  }

  const dropClass = dragOver ? tokens.dropActive : tokens.dropIdle

  /* 隐藏的 file input，两个 variant 共用 */
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={accept}
      className="hidden"
      disabled={disabled}
      onChange={(e) => {
        state.enqueueFiles(e.target.files)
        e.target.value = ''
      }}
    />
  )

  return (
    <div>
      {variant === 'full' ? (
        <div
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={[
            'rounded-xl border border-dashed px-4 py-8 transition',
            dropClass,
            disabled ? 'cursor-not-allowed opacity-50' : '',
          ].join(' ')}
        >
          <label className={`flex ${disabled ? '' : 'cursor-pointer'} flex-col items-center justify-center text-center text-xs text-zinc-400`}>
            {hiddenInput}
            <span className="mb-1 text-2xl text-zinc-500">⬆</span>
            拖拽文件到此处，或点击选择
            <span className="mt-2 text-[11px] text-zinc-600">{hintText}</span>
          </label>
        </div>
      ) : (
        /* compact：迷你拖拽（收敛成单行） + 显式按钮 */
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={[
            'flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition',
            dropClass,
            disabled ? 'cursor-not-allowed opacity-50' : '',
          ].join(' ')}
        >
          {hiddenInput}
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${tokens.primaryBtn}`}
          >
            {buttonLabel}
          </button>
          <span className="text-xs text-zinc-500">
            {state.files.length > 0 ? `已选择 ${state.files.length} 个文件` : '可拖拽文件到此处'}
          </span>
        </div>
      )}

      {state.files.length > 0 && (
        <ul className={variant === 'full' ? 'mt-1 space-y-2' : 'mt-3 space-y-2'}>
          {state.files.map((f, idx) => (
            <DocumentRow
              key={f.id}
              file={f}
              index={idx}
              total={state.files.length}
              variant={variant}
              theme={theme}
              tokens={tokens}
              disabled={disabled}
              onChangeRole={state.setDocumentRole}
              onMove={state.moveFile}
              onRemove={state.removeFile}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface DocumentRowProps {
  file: UploadedFile
  index: number
  total: number
  variant: DocumentUploadPanelVariant
  theme: DocumentUploadPanelTheme
  tokens: ThemeTokens
  disabled: boolean
  onChangeRole: (id: string, role: DocumentRole) => void
  onMove: (id: string, delta: -1 | 1) => void
  onRemove: (id: string) => void
}

function DocumentRow(props: DocumentRowProps) {
  const { file: f, index, total, variant, tokens, disabled, onChangeRole, onMove, onRemove } = props

  if (variant === 'compact') {
    return (
      <li className="rounded-lg border border-white/10 bg-[#14151f]/80 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-zinc-200 break-all">{f.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(f.id)}
            className="text-red-400/90 hover:underline disabled:opacity-40"
          >
            删除
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">文档角色</span>
          <select
            value={f.documentRole ?? (index === 0 ? 'primary' : 'attachment')}
            onChange={(e) => onChangeRole(f.id, e.target.value as DocumentRole)}
            disabled={disabled}
            className={`rounded border border-white/15 bg-[#0f1018] px-2 py-1 text-zinc-200 outline-none ${tokens.selectFocus}`}
          >
            {DOCUMENT_ROLE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-500">
            {f.status === 'parsing' && '解析中…'}
            {f.status === 'parsed' && `已解析 ${(f.charCount ?? f.extractedText?.length ?? 0).toLocaleString()} 字`}
            {f.status === 'error' && (
              <span className="text-red-400">{f.errorMessage || '解析失败'}</span>
            )}
          </span>
        </div>
        {f.parseNote && <p className="mt-1 text-[10px] text-zinc-600">{f.parseNote}</p>}
      </li>
    )
  }

  /* full */
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="truncate text-zinc-200">{f.name}</div>
        <div className="text-zinc-500">{formatBytes(f.size)}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-zinc-600">文档角色</span>
          <select
            className={`max-w-[200px] rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[10px] text-zinc-200 outline-none ${tokens.selectFocus}`}
            value={f.documentRole ?? (index === 0 ? 'primary' : 'attachment')}
            onChange={(e) => onChangeRole(f.id, e.target.value as DocumentRole)}
            disabled={disabled}
          >
            {DOCUMENT_ROLE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 disabled:opacity-30"
            disabled={disabled || index <= 0}
            title="上移"
            onClick={() => onMove(f.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 disabled:opacity-30"
            disabled={disabled || index >= total - 1}
            title="下移"
            onClick={() => onMove(f.id, 1)}
          >
            ↓
          </button>
        </div>
        {f.status === 'parsed' && f.charCount !== undefined && (
          <div className="mt-1 text-[10px] text-zinc-500">
            已抽取 {f.charCount.toLocaleString()} 字符
            {f.parseNote ? ` · ${f.parseNote}` : ''}
          </div>
        )}
        {f.status === 'error' && f.errorMessage && (
          <div className="mt-1 text-[10px] text-red-300/90">{f.errorMessage}</div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:items-end">
        {f.status === 'parsing' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
            {f.mimeType?.startsWith('image/') ? 'OCR 识别中…' : '解析中…'}
          </span>
        )}
        {f.status === 'parsed' && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
            已解析
          </span>
        )}
        {f.status === 'error' && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-200">失败</span>
        )}
        <button
          type="button"
          className="text-zinc-500 hover:text-red-300 disabled:opacity-40"
          aria-label="删除"
          disabled={disabled}
          onClick={() => onRemove(f.id)}
        >
          ✕
        </button>
      </div>
    </li>
  )
}

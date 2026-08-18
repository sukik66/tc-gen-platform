import type { FC, SVGProps } from 'react'

const svgBase = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 16 16',
  'aria-hidden': true as const,
  ...props,
})

const Icon功能测试: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <circle
      cx="8"
      cy="8"
      r="6.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      className="text-emerald-400/90"
    />
    <path
      d="M5 8.2 7.2 10.4 11.2 5.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-300"
    />
  </svg>
)

const Icon异常操作: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <path
      d="M8 1.6 13.2 4.2v4.8c0 2.9-1.6 5.4-4 6.6l-.8.4-.8-.4c-2.4-1.2-4-3.7-4-6.6V4.2L8 1.6z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      className="text-red-400/95"
    />
  </svg>
)

const IconUIUX: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <rect
      x="2.2"
      y="2.5"
      width="11.6"
      height="11"
      rx="1.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className="text-violet-400/95"
    />
    <path
      d="M2.2 6.2h11.6M6.5 2.5v11"
      stroke="currentColor"
      strokeWidth="1"
      className="text-violet-400/95"
    />
  </svg>
)

const Icon弱网: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <path
      d="M2 11c2.5-2 9.5-2 12 0M4.2 8.2c2.8-1.6 5-1.6 7.6 0M6.5 5.5c1.2-.7 2.3-.7 3.4 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      className="text-amber-400/90"
    />
    <circle cx="8" cy="12.8" r="1.1" className="fill-amber-400/90" />
  </svg>
)

const Icon协议安全: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <path
      d="M8 1.8 12.5 3.4V7.8c0 2.9-1.9 5.6-4.5 6.6L8 14.8l-.5-.4C4.9 13.4 3 10.7 3 7.8V3.4L8 1.8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinejoin="round"
      className="text-cyan-400/90"
    />
    <path
      d="M6.2 7.8 7.4 9 9.8 6.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-cyan-300"
    />
  </svg>
)

const Icon客户端性能: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <path
      d="M9 2.5 5 9h3l-1 4.5 5-7.5H9V2.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinejoin="round"
      className="text-sky-400/90"
    />
  </svg>
)

const Icon服务端性能: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <rect
      x="2.5"
      y="11"
      width="11"
      height="2.2"
      rx="0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="text-indigo-400/90"
    />
    <rect
      x="3.5"
      y="3"
      width="9"
      height="6.5"
      rx="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="text-indigo-400/90"
    />
    <path
      d="M5 6h2M9 6h2M5 8.2h6"
      stroke="currentColor"
      strokeWidth="0.9"
      className="text-indigo-300/80"
    />
  </svg>
)

const Icon兼容: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <rect
      x="2"
      y="3"
      width="6.5"
      height="9"
      rx="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="text-teal-400/90"
    />
    <rect
      x="9.5"
      y="4.5"
      width="4.5"
      height="6.5"
      rx="0.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      className="text-teal-400/70"
    />
  </svg>
)

const Icon容灾: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <path
      d="M8 2.5v3.5M8 10v3.5M4.2 8H1.5M14.5 8H12M5.3 5.3 3.2 3.2M12.8 12.8l-2.1-2.1M5.3 10.7l-2.1 2.1M12.8 3.2l-2.1 2.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      className="text-rose-400/90"
    />
    <circle
      cx="8"
      cy="8"
      r="2.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="text-rose-300/80"
    />
  </svg>
)

const IconChecklist: FC<{ className?: string }> = ({ className }) => (
  <svg {...svgBase({ className })}>
    <rect
      x="2.5"
      y="2.5"
      width="11"
      height="11"
      rx="1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      className="text-zinc-400"
    />
    <path
      d="M5 8l2 2 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-zinc-300"
    />
  </svg>
)

const IconDefault: FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={['text-zinc-500', className].filter(Boolean).join(' ')}>
    <rect x="3" y="4" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path d="M3 6.5h10" stroke="currentColor" strokeWidth="0.9" />
  </svg>
)

type Entry = {
  labelClasses: string
  Icon: FC<{ className?: string }>
}

const TYPE_MAP: Record<string, Entry> = {
  功能测试: {
    labelClasses:
      'border-emerald-500/50 bg-emerald-500/[0.12] text-emerald-200 shadow-[0_0_14px_-6px_rgba(52,211,153,0.45)]',
    Icon: Icon功能测试,
  },
  异常操作: {
    labelClasses:
      'border-red-500/50 bg-red-500/[0.12] text-red-200 shadow-[0_0_14px_-6px_rgba(248,113,113,0.4)]',
    Icon: Icon异常操作,
  },
  'UI/UX体验': {
    labelClasses:
      'border-violet-500/50 bg-violet-500/[0.12] text-violet-200 shadow-[0_0_14px_-6px_rgba(167,139,250,0.45)]',
    Icon: IconUIUX,
  },
  弱网测试: {
    labelClasses:
      'border-amber-500/45 bg-amber-500/[0.1] text-amber-100 shadow-[0_0_12px_-6px_rgba(251,191,36,0.35)]',
    Icon: Icon弱网,
  },
  协议安全: {
    labelClasses:
      'border-cyan-500/45 bg-cyan-500/[0.1] text-cyan-100 shadow-[0_0_12px_-6px_rgba(34,211,238,0.35)]',
    Icon: Icon协议安全,
  },
  客户端性能: {
    labelClasses:
      'border-sky-500/45 bg-sky-500/[0.1] text-sky-100 shadow-[0_0_12px_-6px_rgba(56,189,248,0.3)]',
    Icon: Icon客户端性能,
  },
  服务端性能: {
    labelClasses:
      'border-indigo-500/45 bg-indigo-500/[0.12] text-indigo-100 shadow-[0_0_12px_-6px_rgba(129,140,248,0.35)]',
    Icon: Icon服务端性能,
  },
  兼容适配: {
    labelClasses:
      'border-teal-500/45 bg-teal-500/[0.1] text-teal-100 shadow-[0_0_12px_-6px_rgba(45,212,191,0.3)]',
    Icon: Icon兼容,
  },
  容灾容错: {
    labelClasses:
      'border-rose-500/45 bg-rose-500/[0.1] text-rose-100 shadow-[0_0_12px_-6px_rgba(251,113,133,0.32)]',
    Icon: Icon容灾,
  },
  checklist: {
    labelClasses:
      'border-zinc-500/45 bg-zinc-500/[0.12] text-zinc-200 shadow-[0_0_10px_-6px_rgba(161,161,170,0.25)]',
    Icon: IconChecklist,
  },
}

const DEFAULT_ENTRY: Entry = {
  labelClasses:
    'border-zinc-500/40 bg-white/[0.06] text-zinc-300 shadow-[0_0_8px_-4px_rgba(255,255,255,0.08)]',
  Icon: IconDefault,
}

export interface CaseTypeTagProps {
  caseType: string
  size?: 'md' | 'sm'
  className?: string
  dataEditField?: string
}

export function CaseTypeTag({
  caseType,
  size = 'md',
  className = '',
  dataEditField,
}: CaseTypeTagProps) {
  const entry = TYPE_MAP[caseType] ?? DEFAULT_ENTRY
  const Icon = entry.Icon
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  const iconCls = size === 'sm' ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0'

  return (
    <span
      data-edit-field={dataEditField}
      className={[
        'inline-flex cursor-text select-text items-center gap-1 rounded-full border font-medium',
        pad,
        entry.labelClasses,
        className,
      ].join(' ')}
    >
      <Icon className={iconCls} />
      {caseType}
    </span>
  )
}

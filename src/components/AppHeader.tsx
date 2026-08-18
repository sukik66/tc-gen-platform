import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type AppHeaderTheme = 'violet' | 'teal' | 'neutral'

/** 不同主题对应的「返回按钮 hover 色」与「eyebrow 颜色」 */
const HOVER_BY_THEME: Record<AppHeaderTheme, string> = {
  violet: 'hover:border-violet-500/40 hover:text-violet-200',
  teal: 'hover:border-teal-500/40 hover:text-teal-200',
  neutral: 'hover:border-white/25 hover:text-white',
}

const EYEBROW_BY_THEME: Record<AppHeaderTheme, string> = {
  violet: 'text-violet-400/90',
  teal: 'text-teal-400/90',
  neutral: 'text-zinc-400/90',
}

/**
 * 普通滚动页面顶部 header：返回按钮 · eyebrow · 标题 · subtitle · 右侧 actions。
 *
 * 设计原则：
 * - 标题字号、padding、容器结构强制统一，避免历史遗留差异凝固
 * - 主题色（violet / teal / neutral）影响返回按钮 hover 色和 eyebrow 颜色
 * - eyebrow / subtitle / actions 都是可选 slot，按页面需要传
 * - 不适用 HomePage（首页标题字号自定 text-2xl，eyebrow 颜色固定紫色，自定义 header）
 * - 不适用 TestCaseGenerationPage（全屏 flex 布局自带 header，结构差异过大）
 */
export interface AppHeaderProps {
  /** 标题（必填） */
  title: ReactNode
  /** 标题上方小标签：行业/页面分类等 */
  eyebrow?: ReactNode
  /** 标题下方说明文字 */
  subtitle?: ReactNode
  /** 返回按钮：默认 `{ to: '/', label: '← 功能目录' }`；传 false 隐藏 */
  back?: { to: string; label?: string } | false
  /** 主题色，影响返回按钮 hover 色 + eyebrow 颜色。默认 neutral */
  theme?: AppHeaderTheme
  /** 右侧操作槽：导航按钮、状态徽章等 */
  actions?: ReactNode
  /** 容器最大宽度类名（如 'max-w-4xl' / 'max-w-6xl'）。默认 'max-w-6xl' */
  maxWidth?: string
}

export function AppHeader({
  title,
  eyebrow,
  subtitle,
  back = { to: '/', label: '← 功能目录' },
  theme = 'neutral',
  actions,
  maxWidth = 'max-w-6xl',
}: AppHeaderProps) {
  const hoverCls = HOVER_BY_THEME[theme]
  const eyebrowCls = EYEBROW_BY_THEME[theme]

  return (
    <header className="border-b border-white/10 bg-[#14151f]">
      <div className={`mx-auto flex ${maxWidth} flex-wrap items-center justify-between gap-3 px-4 py-4`}>
        <div className="flex min-w-0 items-start gap-3">
          {back && (
            <Link
              to={back.to}
              className={`mt-0.5 shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-zinc-400 transition ${hoverCls}`}
            >
              {back.label ?? '← 功能目录'}
            </Link>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className={`text-[11px] font-medium uppercase tracking-widest ${eyebrowCls}`}>
                {eyebrow}
              </p>
            )}
            <h1 className="mt-1 text-lg font-semibold text-white">{title}</h1>
            {subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

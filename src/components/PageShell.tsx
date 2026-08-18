import type { ReactNode } from 'react'

/**
 * 普通滚动型页面外壳：统一深色背景 + 文字色 + min-h-screen 保底高度。
 *
 * 适用：HomePage / QualityContractsPage / ContractLibraryPage / CaseLibraryPage / ReservedFeaturePage。
 * 不适用：TestCaseGenerationPage（h-screen + flex-col 全屏布局），CaseLibraryPage 的 inline 编辑全屏视图。
 */
export interface PageShellProps {
  children: ReactNode
}

export function PageShell({ children }: PageShellProps) {
  return <div className="min-h-screen bg-[#0f1018] text-zinc-200">{children}</div>
}

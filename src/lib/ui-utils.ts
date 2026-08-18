import type { Priority } from '../types'

/**
 * 优先级（P0/P1/P2）彩色徽标 Tailwind 类名映射。
 * P0 红 / P1 琥珀 / P2 蓝。各页面契约/用例列表与表单上的优先级标签共用。
 */
export function priorityClass(p: Priority): string {
  if (p === 'P0') return 'border-red-500/50 bg-red-500/15 text-red-200'
  if (p === 'P1') return 'border-amber-500/50 bg-amber-500/15 text-amber-100'
  return 'border-sky-500/50 bg-sky-500/15 text-sky-100'
}

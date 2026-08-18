/**
 * 文件大小人类可读格式化：B / KB / MB。
 * 跨页面共用：用例生成页文件清单、知识库列表/详情/版本对比等。
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

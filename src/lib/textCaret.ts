/** 在只读容器内根据点击坐标计算文本偏移（用于双击后 focus 到 textarea 对应位置） */
export function getTextOffsetAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = root.ownerDocument
  if (!doc.defaultView) return null

  let range: Range | null = null
  if (typeof doc.caretRangeFromPoint === 'function') {
    range = doc.caretRangeFromPoint(clientX, clientY)
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY)
    if (pos?.offsetNode) {
      range = doc.createRange()
      range.setStart(pos.offsetNode, pos.offset)
      range.collapse(true)
    }
  }
  if (!range || !root.contains(range.startContainer)) return null

  const start = range.startContainer
  const off = range.startOffset
  if (start.nodeType !== Node.TEXT_NODE) return null

  let total = 0
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === start) {
      const len = n.textContent?.length ?? 0
      return total + Math.min(off, len)
    }
    total += n.textContent?.length ?? 0
  }
  return null
}

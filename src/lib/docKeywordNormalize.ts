/**
 * 需求文本规范化 + 指纹：减少「仅空白/零宽字符变化」导致重复跑关键词提取，
 * 与后端 extractKeywords 使用的规范化规则保持一致（需同步修改两处）。
 */
export function normalizeDocTextForKeywords(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\u00a0\u200b-\u200d\ufeff\u2028\u2029]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 稳定、轻量的文档指纹（用于判断「需求是否实质变化」） */
export function docKeywordFingerprint(text: string, fileName?: string): string {
  const n = normalizeDocTextForKeywords(text)
  let h = 5381
  for (let i = 0; i < n.length; i++) {
    h = (h * 33) ^ n.charCodeAt(i)
  }
  const unsigned = h >>> 0
  return `${unsigned.toString(16)}:${n.length}:${fileName ?? ''}`
}

/** 参与关键词提取的需求正文最大长度（与后端一致，避免超大 POST） */
export const DOCUMENT_KEYWORD_TEXT_MAX_CHARS = 120_000

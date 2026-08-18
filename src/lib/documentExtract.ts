import mammoth from 'mammoth'
import * as pdfjs from 'pdfjs-dist'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

function extension(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

let pdfWorkerConfigured = false

function configurePdfWorker(): void {
  if (pdfWorkerConfigured) return
  pdfWorkerConfigured = true
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

export interface ExtractResult {
  text: string
  parseNote?: string
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** 内嵌图：数量与分辨率护栏 */
const MAX_DOCX_EMBEDDED_IMAGES = 30
const MAX_IMAGE_LONG_EDGE = 2048

/** 弱文字 PDF 整页 OCR */
const WEAK_PAGE_CHAR_THRESHOLD = 50
const MAX_PDF_PAGES_FULL_OCR = 40
const PDF_RENDER_SCALE = 1.75

/** 串行 OCR：Tesseract worker 不支持并发 recognize */
let ocrSerial = Promise.resolve()

let ocrWorkerPromise: Promise<Awaited<ReturnType<typeof import('tesseract.js').createWorker>>> | null =
  null

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker('chi_sim+eng', 1, {
        logger: () => {},
      })
    })()
  }
  return ocrWorkerPromise
}

/** 对图片二进制做 OCR，返回原始字符串（与 extractImageOcrText 一致保留空白策略由调用方决定） */
async function recognizeImageBlobRaw(blob: Blob): Promise<string> {
  const task = ocrSerial.then(async () => {
    const worker = await getOcrWorker()
    const {
      data: { text },
    } = await worker.recognize(blob)
    return text ?? ''
  })
  ocrSerial = task.then(
    () => {},
    () => {},
  )
  return task
}

const RASTER_EXT = /\.(png|jpe?g|gif|tif{1,2}|bmp|webp)$/i

function isRasterZipPath(p: string): boolean {
  return RASTER_EXT.test(p.split('/').pop() ?? '')
}

/** 将图片降采样为 PNG Blob，长边不超过 maxEdge */
async function blobToDownscaledPng(blob: Blob, maxEdge: number): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  try {
    let w = bmp.width
    let h = bmp.height
    if (w <= 0 || h <= 0) {
      return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: 'image/png' })
    }
    if (w <= maxEdge && h <= maxEdge) {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return blob
      ctx.drawImage(bmp, 0, 0)
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      return out ?? blob
    }
    const scale = maxEdge / Math.max(w, h)
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bmp, 0, 0, w, h)
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    return out ?? blob
  } finally {
    bmp.close()
  }
}

function normalizeZipPath(baseDir: string, target: string): string {
  let t = target.replace(/^\//, '')
  const baseParts = baseDir.split('/').filter(Boolean)
  const segs = t.split('/')
  const stack = [...baseParts]
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return stack.join('/')
}

async function parseDocumentRels(zip: JSZip): Promise<Map<string, string>> {
  const relFile = zip.file('word/_rels/document.xml.rels')
  if (!relFile) return new Map()
  const txt = await relFile.async('text')
  const dom = new DOMParser().parseFromString(txt, 'application/xml')
  const map = new Map<string, string>()
  const pkgNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  let relEls = [...dom.getElementsByTagNameNS(pkgNs, 'Relationship')]
  if (relEls.length === 0) {
    relEls = [...dom.getElementsByTagName('Relationship')]
  }
  for (let i = 0; i < relEls.length; i++) {
    const rel = relEls[i]
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) continue
    const abs = normalizeZipPath('word', target)
    map.set(id, abs)
  }
  return map
}

/** 按 XML 文档顺序收集 r:embed / r:id（blip、VML imagedata） */
function collectImageRelationshipIdsInOrder(body: Element): string[] {
  const ids: string[] = []
  const visit = (el: Element) => {
    if (el.localName === 'blip') {
      const embed =
        el.getAttributeNS(REL_NS, 'embed') ||
        el.getAttribute('embed') ||
        el.getAttributeNS(REL_NS, 'link')
      if (embed && !embed.startsWith('http')) ids.push(embed)
    }
    if (el.localName === 'imagedata') {
      const rid =
        el.getAttributeNS(REL_NS, 'id') ||
        el.getAttributeNS(REL_NS, 'embed') ||
        el.getAttribute('r:id')
      if (rid && !rid.startsWith('http')) ids.push(rid)
    }
  }
  const walk = (el: Element) => {
    visit(el)
    for (const c of el.children) walk(c as Element)
  }
  walk(body)
  return ids
}

function findWordBody(doc: Document): Element | null {
  const stack: Element[] = [doc.documentElement]
  while (stack.length) {
    const el = stack.shift()!
    if (el.localName === 'body' && (el.namespaceURI === W_NS || el.namespaceURI?.includes('wordprocessingml'))) {
      return el
    }
    for (const c of el.children) stack.push(c as Element)
  }
  return null
}

async function extractDocxEmbeddedImagesAppendix(buf: ArrayBuffer): Promise<{
  appendix: string
  notes: string[]
  imageCount: number
}> {
  const notes: string[] = []
  const zip = await JSZip.loadAsync(buf)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return { appendix: '', notes: ['未找到 word/document.xml，跳过内嵌图'], imageCount: 0 }

  const xmlStr = await docFile.async('text')
  const dom = new DOMParser().parseFromString(xmlStr, 'application/xml')
  const perr = dom.querySelector('parsererror')
  if (perr) {
    notes.push('document.xml 解析失败，跳过内嵌图')
    return { appendix: '', notes, imageCount: 0 }
  }

  const body = findWordBody(dom)
  if (!body) {
    notes.push('未找到 w:body，跳过内嵌图')
    return { appendix: '', notes, imageCount: 0 }
  }

  const relMap = await parseDocumentRels(zip)
  const orderedRids = collectImageRelationshipIdsInOrder(body)
  if (orderedRids.length === 0) return { appendix: '', notes, imageCount: 0 }

  const limited = orderedRids.slice(0, MAX_DOCX_EMBEDDED_IMAGES)
  if (orderedRids.length > MAX_DOCX_EMBEDDED_IMAGES) {
    notes.push(`内嵌图超过 ${MAX_DOCX_EMBEDDED_IMAGES} 张，仅处理前 ${MAX_DOCX_EMBEDDED_IMAGES} 张（正文出现顺序）`)
  }

  const ocrByZipPath = new Map<string, string>()
  const blocks: string[] = []
  let idx = 0
  for (const rid of limited) {
    const zipPath = relMap.get(rid)
    if (!zipPath) {
      notes.push(`关系 ${rid} 无对应 Target，已跳过`)
      continue
    }
    if (!isRasterZipPath(zipPath)) {
      notes.push(`跳过非光栅或未知格式：${zipPath}`)
      continue
    }
    const entry = zip.file(zipPath)
    if (!entry) {
      notes.push(`包内不存在：${zipPath}`)
      continue
    }
    let ocrText: string
    if (ocrByZipPath.has(zipPath)) {
      ocrText = ocrByZipPath.get(zipPath)!
    } else {
      const ab = await entry.async('arraybuffer')
      const blob = new Blob([ab], { type: 'application/octet-stream' })
      let pngBlob: Blob
      try {
        pngBlob = await blobToDownscaledPng(blob, MAX_IMAGE_LONG_EDGE)
      } catch {
        pngBlob = blob
      }
      const raw = await recognizeImageBlobRaw(pngBlob)
      ocrText = raw.trim()
      ocrByZipPath.set(zipPath, ocrText)
    }
    idx += 1
    const display = ocrText || '（未识别到可读文字）'
    blocks.push(`[图${idx}]\n${display}`)
  }

  if (blocks.length === 0) {
    notes.push('检测到图形引用但未得到可 OCR 的光栅图（可能为链接图、EMF/WMF 等）')
    return { appendix: '', notes, imageCount: 0 }
  }

  const appendix =
    '\n\n--- 文档内图片 OCR（按正文出现顺序；页眉/页脚/脚注未扫描）---\n' + blocks.join('\n\n')
  notes.push(`已附录 ${blocks.length} 段内嵌图 OCR`)
  return { appendix, notes, imageCount: blocks.length }
}

function meaningfulCharCount(s: string): number {
  return s.replace(/\s/g, '').length
}

async function renderPdfPageToPngBlob(page: Awaited<ReturnType<pdfjs.PDFDocumentProxy['getPage']>>): Promise<Blob> {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const task = page.render({ canvasContext: ctx, viewport, canvas })
  await task.promise
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  )
  if (!blob) throw new Error('页面渲染为 PNG 失败')
  return blobToDownscaledPng(blob, MAX_IMAGE_LONG_EDGE)
}

async function extractPdfWithWeakPageOcr(buf: ArrayBuffer): Promise<ExtractResult> {
  configurePdfWorker()
  const data = new Uint8Array(buf)
  const pdf = await pdfjs.getDocument({ data }).promise
  const notes: string[] = []
  const chunks: string[] = []
  let ocrPageCount = 0
  let skippedWeakCap = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const parts: string[] = []
    for (const item of content.items) {
      if (item && typeof item === 'object' && 'str' in item) {
        const s = (item as { str: string }).str
        if (s) parts.push(s)
      }
    }
    const layerText = parts.join(' ').replace(/\s+/g, ' ').trim()
    const mc = meaningfulCharCount(layerText)
    let block = `【第 ${p} 页 · 文字层】\n${layerText || '（无文字层）'}`

    if (mc < WEAK_PAGE_CHAR_THRESHOLD) {
      if (ocrPageCount < MAX_PDF_PAGES_FULL_OCR) {
        try {
          const png = await renderPdfPageToPngBlob(page)
          const ocrRaw = await recognizeImageBlobRaw(png)
          const ocrT = ocrRaw.trim()
          block += `\n【第 ${p} 页 · 整页 OCR（文字层少于 ${WEAK_PAGE_CHAR_THRESHOLD} 字触发）】\n${ocrT || '（整页 OCR 无结果）'}`
          ocrPageCount += 1
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          notes.push(`第 ${p} 页整页 OCR 失败：${msg}`)
        }
      } else {
        skippedWeakCap += 1
      }
    }
    chunks.push(block)
  }

  const text = chunks.join('\n\n').trim()
  if (skippedWeakCap > 0) {
    notes.push(
      `另有 ${skippedWeakCap} 页因整页 OCR 上限（${MAX_PDF_PAGES_FULL_OCR} 页）未做 OCR，可拆分为图片单独上传或分段处理`,
    )
  }
  if (ocrPageCount > 0) {
    notes.push(`已对 ${ocrPageCount} 页执行整页 OCR（弱文字层触发）`)
  }
  const parseNote =
    [
      !text ? '未能从 PDF 抽出有效内容' : undefined,
      ...notes,
      !text && ocrPageCount === 0 ? '可能为扫描件且未触发 OCR（检查是否超出页数上限）' : undefined,
    ]
      .filter(Boolean)
      .join('；') || undefined

  return { text: text || '', parseNote }
}

/** 浏览器端图片 OCR（U-05：Tesseract.js，中英文，无服务端多模态） */
export async function extractImageOcrText(file: File): Promise<ExtractResult> {
  const raw = await recognizeImageBlobRaw(file)
  const t = raw.trim()
  return {
    text: raw,
    parseNote: t
      ? '浏览器端 OCR（Tesseract，中英文）'
      : 'OCR 未识别到可读文字（可换更清晰截图或上传文字类文档）',
  }
}

/** 浏览器端抽取纯文本；图片走 OCR（U-05）；docx 内嵌图、弱字 PDF 页走附录/整页 OCR */
export async function extractDocumentText(file: File): Promise<ExtractResult> {
  const ext = extension(file.name)
  const mime = file.type

  if (mime.startsWith('image/')) {
    return extractImageOcrText(file)
  }

  if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'log' || ext === 'json') {
    const raw = await file.text()
    const text = raw.trim()
    return { text: raw, parseNote: text ? undefined : '文件为空' }
  }

  if (ext === 'doc') {
    throw new Error('旧版 Word .doc 暂不支持，请另存为 .docx 后上传')
  }

  if (ext === 'docx') {
    const buf = await file.arrayBuffer()
    const { value, messages } = await mammoth.extractRawText({ arrayBuffer: buf })
    const noteFromLib =
      messages.length > 0 ? messages.map((m) => m.message).join('；') : undefined
    let text = value ?? ''
    const extraNotes: string[] = []
    try {
      const { appendix, notes } = await extractDocxEmbeddedImagesAppendix(buf)
      for (const n of notes) extraNotes.push(n)
      if (appendix) text += appendix
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      extraNotes.push(`内嵌图处理异常（已忽略）：${msg}`)
    }
    const merged = [noteFromLib, ...extraNotes].filter(Boolean).join('；') || undefined
    if (!text.trim()) {
      return {
        text,
        parseNote: ['未能从文档中抽出文本', merged].filter(Boolean).join('；'),
      }
    }
    return { text, parseNote: merged }
  }

  if (ext === 'pdf') {
    const buf = await file.arrayBuffer()
    return extractPdfWithWeakPageOcr(buf)
  }

  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm') {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const blocks: string[] = []
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      if (!sheet) continue
      const csv = XLSX.utils.sheet_to_csv(sheet)
      blocks.push(`## ${sheetName}\n${csv}`)
    }
    const text = blocks.join('\n\n').trim()
    return { text, parseNote: !text ? '表格为空' : undefined }
  }

  throw new Error(
    `暂不支持的格式：.${ext || '未知'}，请使用 PDF、Word（docx）、Excel、文本或 Markdown`,
  )
}

import { useCallback, useMemo, useState } from 'react'
import { extractDocumentText } from '../lib/documentExtract'
import type { DocumentRole, UploadedFile } from '../types'

/** 默认角色策略：第 0 个文件设为 primary，其余设为 attachment（用例生成页常用） */
export const defaultRoleFirstPrimary = (idx: number, prevTotal: number): DocumentRole =>
  prevTotal === 0 && idx === 0 ? 'primary' : 'attachment'

/** 全部当作 primary（质量契约页常用，目前不区分主/附） */
export const defaultRoleAllPrimary = (): DocumentRole => 'primary'

export interface UseDocumentUploadOptions {
  /**
   * 新加入文件时的初始角色策略
   * @param idx 该批次内的索引
   * @param prevTotal 入队前已有文件数
   * @returns 该文件的初始 documentRole
   *
   * 默认：`defaultRoleFirstPrimary`（第 0 个 primary，其余 attachment）
   */
  defaultRole?: (idx: number, prevTotal: number) => DocumentRole
  /**
   * 解析成功后的副作用回调，例如同步入知识库。
   * 不传则无副作用——这是知识库暂闭期间的标准做法。
   */
  onParsed?: (file: File, text: string) => void
  /** 初始文件列表（如从快照恢复） */
  initialFiles?: UploadedFile[]
}

export interface UseDocumentUploadResult {
  files: UploadedFile[]
  /** 入队新文件并启动异步解析（与原 enqueueFiles 行为完全一致） */
  enqueueFiles: (list: FileList | null) => void
  /** 删除一个文件 */
  removeFile: (id: string) => void
  /** 修改某文件的文档角色 */
  setDocumentRole: (id: string, role: DocumentRole) => void
  /** 上下移动一个文件（delta = -1 或 1） */
  moveFile: (id: string, delta: -1 | 1) => void
  /** 直接整组替换（用于从输入快照恢复） */
  replaceAll: (files: UploadedFile[]) => void
  /** 重置为空 */
  clear: () => void
  /** 解析中数量 */
  parsingCount: number
  /** 解析成功数量 */
  parsedCount: number
  /** 是否至少有一份解析成功的文件 */
  hasParsed: boolean
  /**
   * 用于跨页面发送给后端的最小载荷：
   * - name: 文件名
   * - text: 抽取出的正文
   * - role: 文档角色（缺省按"第 0 个 primary，其余 attachment"补齐，与原 TCG 保持一致）
   */
  buildParsedDocumentsPayload: () => Array<{ name: string; text: string; role: DocumentRole }>
}

/**
 * 文档上传与解析 Hook：跨页面共用「文件列表 + 解析 + role 切换 + 上下移动」核心逻辑。
 *
 * 跨页面共用：测试用例生成、质量契约提取等所有「上传需求文档 → 抽取文本 → 后续生成」的场景。
 * 配套 UI 组件 `DocumentUploadPanel`（含 full / compact 两个 variant），也可独立消费状态自己渲染。
 *
 * 副作用通过 `onParsed` 回调注入；不传则无副作用，便于在知识库暂闭等场景下解耦。
 */
export function useDocumentUpload(options: UseDocumentUploadOptions = {}): UseDocumentUploadResult {
  const {
    defaultRole = defaultRoleFirstPrimary,
    onParsed,
    initialFiles = [],
  } = options

  const [files, setFiles] = useState<UploadedFile[]>(initialFiles)

  /** 解析单个 File 并回写到对应 row 上 */
  const processOneFile = useCallback(
    async (file: File, id: string) => {
      try {
        const { text, parseNote } = await extractDocumentText(file)
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: 'parsed',
                  extractedText: text,
                  charCount: text.length,
                  parseNote,
                }
              : f,
          ),
        )
        onParsed?.(file, text)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', errorMessage: msg } : f)),
        )
      }
    },
    [onParsed],
  )

  const enqueueFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const arr = Array.from(list)
      setFiles((prev) => {
        const base = prev.length
        const newItems: UploadedFile[] = arr.map((file, i) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mimeType: file.type || undefined,
          status: 'parsing',
          documentRole: defaultRole(i, base),
        }))
        queueMicrotask(() => {
          newItems.forEach((item, i) => {
            void processOneFile(arr[i]!, item.id)
          })
        })
        return [...prev, ...newItems]
      })
    },
    [defaultRole, processOneFile],
  )

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const setDocumentRole = useCallback((id: string, role: DocumentRole) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, documentRole: role } : f)))
  }, [])

  const moveFile = useCallback((id: string, delta: -1 | 1) => {
    setFiles((prev) => {
      const i = prev.findIndex((x) => x.id === id)
      if (i < 0) return prev
      const j = i + delta
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const t = next[i]!
      next[i] = next[j]!
      next[j] = t
      return next
    })
  }, [])

  const replaceAll = useCallback((items: UploadedFile[]) => {
    setFiles(items)
  }, [])

  const clear = useCallback(() => {
    setFiles([])
  }, [])

  const parsingCount = useMemo(
    () => files.filter((f) => f.status === 'parsing').length,
    [files],
  )
  const parsedCount = useMemo(
    () => files.filter((f) => f.status === 'parsed').length,
    [files],
  )
  const hasParsed = parsedCount > 0

  const buildParsedDocumentsPayload = useCallback(() => {
    const parsed = files.filter((f) => f.status === 'parsed')
    return parsed.map((f, idx) => ({
      name: f.name,
      text: f.extractedText ?? '',
      role: f.documentRole ?? (idx === 0 ? 'primary' : 'attachment'),
    }))
  }, [files])

  return {
    files,
    enqueueFiles,
    removeFile,
    setDocumentRole,
    moveFile,
    replaceAll,
    clear,
    parsingCount,
    parsedCount,
    hasParsed,
    buildParsedDocumentsPayload,
  }
}

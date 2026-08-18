/**
 * 代码关联面板 —— 多仓库勾选 + 两种策略：智能检索 / 变更聚合
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchRepos,
  initDefaultRepos,
  smartSearchFiles,
  extractKeywordsFromText,
  type RepoConfig,
  type CodeContextMode,
  type CodeContextPayload,
  type CodeContextRepoItem,
} from '../api/vcs'
import {
  docKeywordFingerprint,
  DOCUMENT_KEYWORD_TEXT_MAX_CHARS,
} from '../lib/docKeywordNormalize'

interface Props {
  value: CodeContextPayload | null
  onChange: (v: CodeContextPayload | null) => void
  documentText?: string
  documentFileName?: string
}

interface RepoSearchResult {
  repoId: string
  repoName: string
  files: { path: string; reason: string }[]
}

export default function CodeChangePanel({ value, onChange, documentText, documentFileName }: Props) {
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const [mode, setMode] = useState<CodeContextMode>('smart')
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set())

  // smart
  const [keywords, setKeywords] = useState('')
  const [searchResults, setSearchResults] = useState<RepoSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [autoExtracted, setAutoExtracted] = useState(false)

  // changes
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const prevDocRef = useRef('')

  const loadRepos = useCallback(async () => {
    setLoading(true)
    try {
      let r = await fetchRepos()
      if (r.length === 0) r = await initDefaultRepos()
      setRepos(r)
    } catch (e) {
      console.warn('获取仓库列表失败', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadRepos() }, [loadRepos])

  /** 从父级恢复（含 sessionStorage 回填）：同步模式、勾选仓与关键词，避免「已保存但面板空白」 */
  const valueSig = JSON.stringify(value ?? null)
  useEffect(() => {
    if (!value?.repos?.length) return
    setMode(value.mode)
    setSelectedRepoIds(new Set(value.repos.map((r) => r.repoId)))
    if (value.mode === 'smart') {
      const flat = value.repos.flatMap((r) => r.keywords || [])
      const uniq = [...new Set(flat.map((k) => String(k).trim()).filter(Boolean))]
      if (uniq.length) setKeywords(uniq.join(', '))
    } else if (value.mode === 'changes') {
      const s0 = value.repos[0]?.since
      const u0 = value.repos[0]?.until
      if (s0) setSince(s0)
      if (u0 !== undefined) setUntil(u0 || '')
    }
  }, [valueSig])

  const toggleRepo = (id: string) => {
    setSelectedRepoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllRepos = () => {
    if (selectedRepoIds.size === repos.length) {
      setSelectedRepoIds(new Set())
    } else {
      setSelectedRepoIds(new Set(repos.map(r => r.id)))
    }
  }

  const emitPayload = useCallback((m: CodeContextMode, items: CodeContextRepoItem[]) => {
    if (items.length === 0) { onChange(null); return }
    onChange({ mode: m, repos: items })
  }, [onChange])

  // --- 智能检索 ---
  const doSearch = useCallback(async (kws: string[], repoIds: Set<string>) => {
    if (kws.length === 0 || repoIds.size === 0) return
    setSearching(true)
    const results: RepoSearchResult[] = []
    const repoItems: CodeContextRepoItem[] = []

    await Promise.all([...repoIds].map(async (rid) => {
      const repo = repos.find(r => r.id === rid)
      if (!repo) return
      try {
        const files = await smartSearchFiles(rid, kws)
        results.push({ repoId: rid, repoName: repo.name, files })
        /** 0 命中也要写入 payload，否则 emit 空数组会把父级 codeChanges 清成 null，表现为「关联代码没保存」 */
        repoItems.push({ repoId: rid, keywords: kws })
      } catch {
        results.push({ repoId: rid, repoName: repo.name, files: [] })
        repoItems.push({ repoId: rid, keywords: kws })
      }
    }))

    setSearchResults(results)
    emitPayload('smart', repoItems)
    setSearching(false)
  }, [repos, emitPayload])

  const handleManualSearch = () => {
    const kws = keywords.split(/[,，、\s]+/).filter(Boolean)
    if (kws.length === 0 || selectedRepoIds.size === 0) return
    doSearch(kws, selectedRepoIds)
  }

  // 自动提取关键词（全文规范化指纹：避免仅前 200 字相同就误判「需求未变」）
  // 注意：prevDocRef 必须在「提取成功」后再写入。若在 await 前写入，React Strict Mode 会
  // 先卸载 effect 再重跑，第二次会因 fp === prevDocRef 直接 return，导致永远不填词。
  useEffect(() => {
    if (!expanded || mode !== 'smart' || autoExtracted) return
    if (!documentText?.trim() || selectedRepoIds.size === 0) return
    const fp = docKeywordFingerprint(documentText, documentFileName)
    if (fp === prevDocRef.current) return

    let cancelled = false
    ;(async () => {
      try {
        const slice = documentText.slice(0, DOCUMENT_KEYWORD_TEXT_MAX_CHARS)
        const kws = await extractKeywordsFromText(slice, documentFileName)
        if (cancelled || kws.length === 0) return
        setKeywords(kws.join(', '))
        setAutoExtracted(true)
        prevDocRef.current = fp
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, mode, documentText, documentFileName, autoExtracted, selectedRepoIds.size])

  useEffect(() => {
    setAutoExtracted(false)
  }, [docKeywordFingerprint(documentText || '', documentFileName)])

  // --- 变更聚合 ---
  const handleChangesConfirm = () => {
    if (selectedRepoIds.size === 0 || !since) return
    const items: CodeContextRepoItem[] = [...selectedRepoIds].map(rid => ({
      repoId: rid, since, until: until || undefined,
    }))
    emitPayload('changes', items)
  }

  const handleClear = () => {
    onChange(null)
    setSearchResults([])
    setSince('')
    setUntil('')
    setAutoExtracted(false)
    setKeywords('')
    prevDocRef.current = ''
  }

  const isConfigured = !!value && value.repos.length > 0
  const totalFiles = searchResults.reduce((sum, r) => sum + r.files.length, 0)

  const modeMeta: Record<CodeContextMode, { label: string; desc: string }> = {
    smart: {
      label: '🔍 智能检索',
      desc: '从需求自动提取关键词，全仓扫描匹配文件',
    },
    changes: { label: '📋 变更聚合', desc: '汇总时间范围内所有勾选仓库的改动文件' },
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="font-medium text-slate-700">关联代码</span>
          {isConfigured && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {value.repos.length} 个仓库
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">可选</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-400">加载仓库...</p>
          ) : (
            <>
              {/* ===== 仓库多选 ===== */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-500">选择仓库（可多选）:</label>
                  <button type="button" className="text-[10px] text-blue-600 hover:underline" onClick={selectAllRepos}>
                    {selectedRepoIds.size === repos.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {repos.map(r => {
                    const sel = selectedRepoIds.has(r.id)
                    const typeBg = r.type === 'plastic' ? 'border-purple-300 bg-purple-50' : 'border-orange-300 bg-orange-50'
                    const selBg = sel ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : typeBg
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-all ${selBg}`}
                        onClick={() => toggleRepo(r.id)}
                      >
                        <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${sel ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300'}`}>
                          {sel && '✓'}
                        </span>
                        <span className="text-slate-700">{r.name}</span>
                        <span className="text-[9px] text-slate-400">({r.type === 'plastic' ? 'P' : 'G'})</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedRepoIds.size === 0 && (
                <p className="text-[10px] text-amber-600">请先勾选至少一个仓库</p>
              )}

              {selectedRepoIds.size > 0 && (
                <>
                  {/* ===== 模式切换 ===== */}
                  <div className="flex gap-1">
                    {(['smart', 'changes'] as CodeContextMode[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors text-center ${mode === m ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        onClick={() => { setMode(m); handleClear() }}
                      >
                        {modeMeta[m].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">{modeMeta[mode].desc}</p>

                  {/* ===== 智能检索 ===== */}
                  {mode === 'smart' && (
                    <div className="space-y-2">
                      {autoExtracted && totalFiles === 0 && searchResults.length === 0 && (
                        <p className="text-[10px] text-violet-300/90">
                          ✓ 已从需求提取关键词，请点击「搜索」在已选仓库中检索匹配文件。
                        </p>
                      )}
                      {totalFiles > 0 && (
                        <p className="text-[10px] text-emerald-600">
                          ✓ 已在 {searchResults.filter(r => r.files.length > 0).length} 个仓库中找到 {totalFiles} 个文件
                        </p>
                      )}
                      <div className="flex gap-1">
                        <input
                          className="text-xs border border-slate-300 rounded px-2 py-1 flex-1"
                          placeholder="关键词，逗号分隔（上传需求后自动提取）"
                          value={keywords}
                          onChange={e => setKeywords(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleManualSearch() }}
                        />
                        <button
                          type="button"
                          className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
                          onClick={handleManualSearch}
                          disabled={searching || !keywords.trim()}
                        >
                          {searching ? '搜索中...' : '搜索'}
                        </button>
                      </div>

                      {searchResults.length > 0 && (
                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded p-2 space-y-2">
                          {searchResults.map(sr => (
                            <div key={sr.repoId}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-semibold text-slate-600">{sr.repoName}</span>
                                <span className={`text-[9px] px-1 rounded ${sr.files.length > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                                  {sr.files.length} 文件
                                </span>
                              </div>
                              {sr.files.length === 0 ? (
                                <p className="text-[10px] text-slate-400 ml-2">未匹配到相关代码</p>
                              ) : (
                                sr.files.slice(0, 10).map((f, i) => (
                                  <div key={i} className="text-[10px] ml-2 flex gap-1.5">
                                    <span className="text-slate-400 shrink-0">{f.reason.length > 18 ? f.reason.slice(0, 18) + '…' : f.reason}</span>
                                    <span className="text-slate-700 font-mono break-all">{f.path}</span>
                                  </div>
                                ))
                              )}
                              {sr.files.length > 10 && (
                                <p className="text-[10px] text-slate-400 ml-2">... 还有 {sr.files.length - 10} 个文件</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== 变更聚合 ===== */}
                  {mode === 'changes' && (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <input type="date" className="text-xs border border-slate-300 rounded px-2 py-1" value={since} onChange={e => setSince(e.target.value)} />
                        <span className="text-xs text-slate-400">~</span>
                        <input type="date" className="text-xs border border-slate-300 rounded px-2 py-1" value={until} onChange={e => setUntil(e.target.value)} />
                        <button type="button" className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700" onClick={handleChangesConfirm} disabled={!since}>
                          确认
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        将同时扫描 {selectedRepoIds.size} 个仓库在该时间段内改动的代码文件。
                      </p>
                    </div>
                  )}

                  {isConfigured && (
                    <button type="button" className="text-[10px] text-red-500 hover:underline" onClick={handleClear}>
                      清除代码关联
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

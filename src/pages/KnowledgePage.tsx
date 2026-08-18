import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  type KBArticle,
  type KBFile,
  type KBFileVersion,
  KB_CATEGORIES,
  getAllArticles,
  getAllFiles,
  createArticle,
  updateArticle,
  deleteArticle,
  deleteFile,
  getFileVersions,
  searchArticles,
  searchFiles,
  getKBStats,
  manualImportFile,
  ensureKbFileBlob,
} from '../lib/knowledgeStore'
import { extractDocumentText } from '../lib/documentExtract'
import { formatBytes } from '../lib/format'

/* ---------- 工具 ---------- */

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const FILE_ACCEPT = '.pdf,.docx,.xls,.xlsx,.xlsm,.txt,.md,.csv,.json,image/*'

/* ========================================================= */

type Tab = 'articles' | 'files'
type ViewMode = 'list' | 'edit'

export function KnowledgePage() {
  const [tab, setTab] = useState<Tab>('articles')
  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  /* ----- 文章 ----- */
  const [articles, setArticles] = useState<KBArticle[]>([])
  const [selectedArticle, setSelectedArticle] = useState<KBArticle | null>(null)
  const [articleView, setArticleView] = useState<ViewMode>('list')
  const [editForm, setEditForm] = useState<Partial<KBArticle>>({})

  /* ----- 文件 ----- */
  const [files, setFiles] = useState<KBFile[]>([])
  const [selectedFile, setSelectedFile] = useState<KBFile | null>(null)
  const [fileVersions, setFileVersions] = useState<KBFileVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadCategory, setUploadCategory] = useState('需求文档')

  /* ----- 统计 ----- */
  const [stats, setStats] = useState({ articleCount: 0, fileCount: 0, totalFileSize: 0 })

  const load = useCallback(async () => {
    const [a, f, s] = await Promise.all([
      keyword ? searchArticles(keyword) : getAllArticles(),
      keyword ? searchFiles(keyword) : getAllFiles(),
      getKBStats(),
    ])
    setArticles(a.sort((x, y) => y.createdAt.localeCompare(x.createdAt)))
    setFiles(f.sort((x, y) => y.createdAt.localeCompare(x.createdAt)))
    setStats(s)
  }, [keyword])

  useEffect(() => { void load() }, [load])

  /* ---------- 文章过滤 ---------- */
  const filteredArticles = useMemo(() => {
    if (!categoryFilter) return articles
    return articles.filter(a => a.category === categoryFilter || a.subCategory === categoryFilter)
  }, [articles, categoryFilter])

  const filteredFiles = useMemo(() => {
    if (!categoryFilter) return files
    return files.filter(f => f.category === categoryFilter)
  }, [files, categoryFilter])

  /* ---------- 文章 CRUD ---------- */
  const startNewArticle = () => {
    setEditForm({
      title: '',
      category: '测试经验',
      subCategory: '踩坑记录',
      tags: [],
      content: '',
      source: 'manual',
    })
    setSelectedArticle(null)
    setArticleView('edit')
  }

  const startEditArticle = (a: KBArticle) => {
    setEditForm({ ...a })
    setSelectedArticle(a)
    setArticleView('edit')
  }

  const saveArticle = async () => {
    if (!editForm.title?.trim()) {
      window.alert('标题不能为空')
      return
    }
    if (selectedArticle) {
      await updateArticle(selectedArticle.id, {
        title: editForm.title,
        category: editForm.category || '',
        subCategory: editForm.subCategory || '',
        tags: editForm.tags || [],
        content: editForm.content || '',
      })
    } else {
      await createArticle({
        title: editForm.title!,
        category: editForm.category || '其他',
        subCategory: editForm.subCategory || '未分类',
        tags: editForm.tags || [],
        content: editForm.content || '',
        source: (editForm.source as KBArticle['source']) || 'manual',
        sourceRef: editForm.sourceRef,
      })
    }
    setArticleView('list')
    setEditForm({})
    setSelectedArticle(null)
    await load()
  }

  const handleDeleteArticle = async (id: string) => {
    if (!window.confirm('确定删除该知识条目？')) return
    await deleteArticle(id)
    await load()
  }

  /* ---------- 文件操作 ---------- */
  const handleManualFileUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    setUploading(true)
    const results: string[] = []
    for (const file of Array.from(fileList)) {
      try {
        const { text } = await extractDocumentText(file)
        const r = await manualImportFile(file, text, uploadCategory)
        if (r.action === 'skipped') results.push(`${file.name}：已存在，跳过`)
        else if (r.action === 'updated') results.push(`${file.name}：内容已更新`)
        else results.push(`${file.name}：已存入`)
      } catch (e) {
        results.push(`${file.name}：上传失败 - ${e instanceof Error ? e.message : '未知错误'}`)
      }
    }
    setUploading(false)
    await load()
    window.alert(results.join('\n'))
  }

  const handleDeleteFile = async (id: string) => {
    if (!window.confirm('确定删除该文件？关联的变更记录也会一并删除。')) return
    await deleteFile(id)
    setSelectedFile(null)
    setShowVersions(false)
    await load()
  }

  const handleViewVersions = async (f: KBFile) => {
    setSelectedFile(f)
    const vs = await getFileVersions(f.id)
    setFileVersions(vs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setShowVersions(true)
  }

  const handleDownloadFile = async (f: KBFile) => {
    try {
      const full = await ensureKbFileBlob(f)
      const url = URL.createObjectURL(full.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = f.displayName
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : '下载失败')
    }
  }

  /* ---------- 分类侧栏组件 ---------- */
  const CategorySidebar = (
    <div className="w-48 shrink-0 space-y-1 overflow-y-auto border-r border-white/10 pr-3">
      <button
        type="button"
        onClick={() => setCategoryFilter('')}
        className={`block w-full rounded px-2 py-1.5 text-left text-xs ${!categoryFilter ? 'bg-violet-600/30 text-violet-200' : 'text-zinc-400 hover:bg-white/5'}`}
      >
        全部分类
      </button>
      {KB_CATEGORIES.map(cat => (
        <div key={cat.id}>
          <button
            type="button"
            onClick={() => setCategoryFilter(cat.label)}
            className={`block w-full rounded px-2 py-1.5 text-left text-xs font-medium ${categoryFilter === cat.label ? 'bg-violet-600/30 text-violet-200' : 'text-zinc-300 hover:bg-white/5'}`}
          >
            {cat.label}
          </button>
          <div className="ml-3 space-y-0.5">
            {cat.children.map(sub => (
              <button
                key={sub}
                type="button"
                onClick={() => setCategoryFilter(sub)}
                className={`block w-full rounded px-2 py-1 text-left text-[11px] ${categoryFilter === sub ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-500 hover:bg-white/5'}`}
              >
                {sub}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  /* ========== 渲染 ========== */
  return (
    <div className="flex h-screen flex-col bg-[#0e0f1a] text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 bg-[#12131c] px-6 py-3">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-zinc-500 hover:text-zinc-200 text-xs">← 返回首页</Link>
          <h1 className="text-lg font-bold">知识库</h1>
          <div className="flex gap-1 rounded-lg border border-white/10 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded-md px-3 py-1 ${tab === 'articles' ? 'bg-white/10 text-white' : 'text-zinc-500'}`}
              onClick={() => setTab('articles')}
            >
              知识条目 ({stats.articleCount})
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1 ${tab === 'files' ? 'bg-white/10 text-white' : 'text-zinc-500'}`}
              onClick={() => setTab('files')}
            >
              文件库 ({stats.fileCount})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="搜索标题、内容、标签…"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            className="w-56 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
          />
          {tab === 'articles' && articleView === 'list' && (
            <button
              type="button"
              onClick={startNewArticle}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
            >
              + 新建知识
            </button>
          )}
          {tab === 'files' && (
            <>
              <select
                value={uploadCategory}
                onChange={e => setUploadCategory(e.target.value)}
                className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none"
              >
                {KB_CATEGORIES.map(c => (
                  <option key={c.id} value={c.label}>{c.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {uploading ? '上传中…' : '+ 上传文件'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept={FILE_ACCEPT}
                onChange={e => { void handleManualFileUpload(e.target.files); e.target.value = '' }}
              />
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {CategorySidebar}

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {/* ===== 文章 Tab ===== */}
          {tab === 'articles' && articleView === 'list' && (
            <ArticleList
              articles={filteredArticles}
              onEdit={startEditArticle}
              onDelete={handleDeleteArticle}
            />
          )}
          {tab === 'articles' && articleView === 'edit' && (
            <ArticleEditor
              form={editForm}
              setForm={setEditForm}
              onSave={saveArticle}
              onCancel={() => { setArticleView('list'); setEditForm({}) }}
              isNew={!selectedArticle}
            />
          )}

          {/* ===== 文件 Tab ===== */}
          {tab === 'files' && !showVersions && (
            <FileList
              files={filteredFiles}
              onDownload={handleDownloadFile}
              onViewVersions={handleViewVersions}
              onDelete={handleDeleteFile}
            />
          )}
          {tab === 'files' && showVersions && selectedFile && (
            <FileVersionView
              file={selectedFile}
              versions={fileVersions}
              onBack={() => { setShowVersions(false); setSelectedFile(null) }}
              onDownload={handleDownloadFile}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ========== 子组件 ========== */

function ArticleList({
  articles,
  onEdit,
  onDelete,
}: {
  articles: KBArticle[]
  onEdit: (a: KBArticle) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (!articles.length) {
    return <div className="py-12 text-center text-sm text-zinc-600">暂无知识条目，点击右上角「新建知识」开始沉淀</div>
  }
  return (
    <div className="space-y-2">
      {articles.map(a => (
        <div key={a.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <div
              className="min-w-0 flex-1 cursor-pointer"
              onClick={() => setExpanded(p => ({ ...p, [a.id]: !p[a.id] }))}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">{a.title}</span>
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">{a.category}</span>
                {a.subCategory && <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-400">{a.subCategory}</span>}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                <span>{formatDate(a.createdAt)}</span>
                {a.tags.length > 0 && <span>标签: {a.tags.join(', ')}</span>}
                <span className="text-zinc-600">{a.source === 'manual' ? '手动' : a.source === 'mistake_book' ? '错题本' : '导入'}</span>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => onEdit(a)} className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/5">编辑</button>
              <button type="button" onClick={() => onDelete(a.id)} className="rounded px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10">删除</button>
            </div>
          </div>
          {expanded[a.id] && (
            <div className="mt-3 whitespace-pre-wrap rounded bg-black/30 p-3 text-xs leading-relaxed text-zinc-300">
              {a.content || '（无正文）'}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ArticleEditor({
  form,
  setForm,
  onSave,
  onCancel,
  isNew,
}: {
  form: Partial<KBArticle>
  setForm: (f: Partial<KBArticle>) => void
  onSave: () => void
  onCancel: () => void
  isNew: boolean
}) {
  const [preview, setPreview] = useState(false)

  const allSubCategories = useMemo(() => {
    const cat = KB_CATEGORIES.find(c => c.label === form.category)
    return cat ? [...cat.children] : []
  }, [form.category])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-200">{isNew ? '新建知识条目' : '编辑知识条目'}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5">取消</button>
          <button type="button" onClick={onSave} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500">保存</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="标题"
        value={form.title || ''}
        onChange={e => setForm({ ...form, title: e.target.value })}
        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] text-zinc-500">一级分类</label>
          <select
            value={form.category || ''}
            onChange={e => setForm({ ...form, category: e.target.value, subCategory: '' })}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none"
          >
            {KB_CATEGORIES.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] text-zinc-500">二级分类</label>
          <select
            value={form.subCategory || ''}
            onChange={e => setForm({ ...form, subCategory: e.target.value })}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none"
          >
            <option value="">请选择</option>
            {allSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] text-zinc-500">标签（逗号分隔）</label>
          <input
            type="text"
            value={(form.tags || []).join(', ')}
            onChange={e => setForm({ ...form, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none"
            placeholder="标签1, 标签2"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">正文（Markdown）</span>
          <button
            type="button"
            onClick={() => setPreview(p => !p)}
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5"
          >
            {preview ? '编辑' : '预览'}
          </button>
        </div>
        {preview ? (
          <div className="min-h-[300px] whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-4 text-xs leading-relaxed text-zinc-300">
            {form.content || '（无内容）'}
          </div>
        ) : (
          <textarea
            value={form.content || ''}
            onChange={e => setForm({ ...form, content: e.target.value })}
            rows={16}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
            placeholder="在这里输入 Markdown 内容…"
          />
        )}
      </div>
    </div>
  )
}

function FileList({
  files,
  onDownload,
  onViewVersions,
  onDelete,
}: {
  files: KBFile[]
  onDownload: (f: KBFile) => void | Promise<void>
  onViewVersions: (f: KBFile) => void
  onDelete: (id: string) => void
}) {
  if (!files.length) {
    return <div className="py-12 text-center text-sm text-zinc-600">暂无文件，上传文件或从用例生成页自动导入</div>
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/10 text-left text-zinc-500">
          <th className="px-2 py-2 font-medium">文件名</th>
          <th className="px-2 py-2 font-medium">分类</th>
          <th className="px-2 py-2 font-medium">大小</th>
          <th className="px-2 py-2 font-medium">来源</th>
          <th className="px-2 py-2 font-medium">存入时间</th>
          <th className="px-2 py-2 font-medium">更新时间</th>
          <th className="px-2 py-2 font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        {files.map(f => (
          <tr key={f.id} className="border-b border-white/5 hover:bg-white/[0.02]">
            <td className="max-w-[200px] truncate px-2 py-2 text-zinc-200" title={f.displayName}>{f.displayName}</td>
            <td className="px-2 py-2 text-zinc-400">{f.category}</td>
            <td className="px-2 py-2 text-zinc-400">{formatBytes(f.size)}</td>
            <td className="px-2 py-2 text-zinc-400">{f.source === 'generation' ? '生成页导入' : '手动上传'}</td>
            <td className="px-2 py-2 text-zinc-500">{formatDate(f.createdAt)}</td>
            <td className="px-2 py-2 text-zinc-500">{formatDate(f.updatedAt)}</td>
            <td className="px-2 py-2">
              <div className="flex gap-1">
                <button type="button" onClick={() => void onDownload(f)} className="rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-500/10">下载</button>
                <button type="button" onClick={() => onViewVersions(f)} className="rounded px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-amber-500/10">变更记录</button>
                <button type="button" onClick={() => onDelete(f.id)} className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10">删除</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FileVersionView({
  file,
  versions,
  onBack,
  onDownload,
}: {
  file: KBFile
  versions: KBFileVersion[]
  onBack: () => void
  onDownload: (f: KBFile) => void | Promise<void>
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-200">← 返回文件列表</button>
        <h2 className="text-sm font-bold text-zinc-200">{file.displayName}</h2>
        <button type="button" onClick={() => void onDownload(file)} className="rounded-lg bg-sky-600/80 px-2 py-1 text-[10px] text-white hover:bg-sky-500">下载当前版本</button>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
        <div><span className="text-zinc-500">原始文件名：</span><span className="text-zinc-200">{file.originalName}</span></div>
        <div><span className="text-zinc-500">文件大小：</span><span className="text-zinc-200">{formatBytes(file.size)}</span></div>
        <div><span className="text-zinc-500">MIME：</span><span className="text-zinc-200">{file.mimeType || '未知'}</span></div>
        <div><span className="text-zinc-500">分类：</span><span className="text-zinc-200">{file.category}</span></div>
        <div><span className="text-zinc-500">存入时间：</span><span className="text-zinc-200">{formatDate(file.createdAt)}</span></div>
        <div><span className="text-zinc-500">最后更新：</span><span className="text-zinc-200">{formatDate(file.updatedAt)}</span></div>
      </div>

      {file.extractedText && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-400">抽取的文本内容（前 2000 字）</h3>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            {file.extractedText.slice(0, 2000)}
            {file.extractedText.length > 2000 ? '\n...' : ''}
          </pre>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium text-zinc-300">变更记录 ({versions.length})</h3>
        {versions.length === 0 ? (
          <div className="text-xs text-zinc-600">暂无变更记录（文件从未被更新过）</div>
        ) : (
          <div className="space-y-2">
            {versions.map(v => (
              <div key={v.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200">{v.changeNote}</span>
                  <span className="text-zinc-500">{formatDate(v.createdAt)}</span>
                </div>
                <div className="mt-1 flex gap-4 text-[10px] text-zinc-500">
                  <span>旧大小: {formatBytes(v.oldSize)}</span>
                  <span>新大小: {formatBytes(v.newSize)}</span>
                  <span className="truncate text-zinc-600" title={`${v.oldHash} → ${v.newHash}`}>
                    Hash: {v.oldHash.slice(0, 8)}… → {v.newHash.slice(0, 8)}…
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

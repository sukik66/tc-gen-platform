import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Priority } from '../types'
import type { LibraryCase as LC } from '../lib/caseLibraryStore'

type SortKey = 'id' | 'priority' | 'caseType' | 'summary' | 'addedAt'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORD: Record<string, number> = { P0: 0, P1: 1, P2: 2 }

function cmpField(a: LC, b: LC, key: SortKey): number {
  switch (key) {
    case 'priority':
      return (PRIORITY_ORD[a.priority] ?? 9) - (PRIORITY_ORD[b.priority] ?? 9)
    case 'addedAt':
      return a.addedAt.localeCompare(b.addedAt)
    case 'caseType':
      return a.caseType.localeCompare(b.caseType)
    case 'summary':
      return a.summary.localeCompare(b.summary)
    default:
      return a.id.localeCompare(b.id)
  }
}

/** 固定次级排序链：入库时间 → 优先级 → 用例类型 */
const TIEBREAKERS: SortKey[] = ['addedAt', 'priority', 'caseType']

function compareCases(a: LC, b: LC, key: SortKey, dir: SortDir): number {
  const primary = cmpField(a, b, key)
  if (primary !== 0) return dir === 'asc' ? primary : -primary
  for (const tk of TIEBREAKERS) {
    if (tk === key) continue
    const c = cmpField(a, b, tk)
    if (c !== 0) return c
  }
  return 0
}
import { CASE_TYPE_OPTIONS } from '../constants'
import { priorityClass } from '../lib/ui-utils'
import { ModuleTree } from '../components/ModuleTree'
import { PageShell } from '../components/PageShell'
import { AppHeader } from '../components/AppHeader'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import {
  type LibraryCase,
  type Module,
  type Project,
  type Suite,
  countCasesByProject,
  createProject,
  getModuleCaseCountsByProject,
  createSuite,
  deleteCase,
  deleteCases,
  deleteProject,
  deleteSuite,
  getAllProjects,
  getCasesByModule,
  getCasesByProject,
  getProjectModules,
  getProjectSuites,
  getSuiteCases,
  putCase,
  searchCasesInProject,
  updateCase,
  updateProject,
} from '../lib/caseLibraryStore'

/* ---------- 小工具 ---------- */

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/* ---------- 编辑弹窗 ---------- */

function CaseEditModal({
  initial,
  modules,
  onSave,
  onCancel,
}: {
  initial: LibraryCase
  modules: Module[]
  onSave: (c: LibraryCase) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<LibraryCase>({ ...initial })
  const set = (k: keyof LibraryCase, v: string) => setDraft((p) => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1a1b2e] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-sm font-semibold text-white">编辑用例</h3>
        <div className="space-y-3 text-xs">
          <label className="block">
            <span className="text-zinc-500">摘要</span>
            <input className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-zinc-500">优先级</span>
              <select className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-500">类型</span>
              <select className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.caseType} onChange={(e) => set('caseType', e.target.value)}>
                {CASE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-500">归属模块</span>
              <select className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.moduleId} onChange={(e) => setDraft((p) => ({ ...p, moduleId: e.target.value }))}>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-zinc-500">描述</span>
            <textarea className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-zinc-500">前置条件（每行一条）</span>
            <textarea className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" rows={2} value={draft.preconditions.join('\n')} onChange={(e) => setDraft((p) => ({ ...p, preconditions: e.target.value.split('\n') }))} />
          </label>
          <label className="block">
            <span className="text-zinc-500">步骤（每行一条）</span>
            <textarea className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" rows={2} value={draft.steps.join('\n')} onChange={(e) => setDraft((p) => ({ ...p, steps: e.target.value.split('\n') }))} />
          </label>
          <label className="block">
            <span className="text-zinc-500">预期结果</span>
            <input className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.expected} onChange={(e) => set('expected', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-zinc-500">标签（逗号分隔）</span>
            <input className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-200 outline-none" value={draft.tags.join(', ')} onChange={(e) => setDraft((p) => ({ ...p, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5" onClick={onCancel}>取消</button>
          <button type="button" className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs text-white hover:bg-violet-500" onClick={() => onSave(draft)}>保存</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 项目目录页 ---------- */

function ProjectListView({
  projects,
  caseCounts,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: {
  projects: Project[]
  caseCounts: Map<string, number>
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onDelete: (id: string) => void
  onRename: (p: Project, newName: string) => void
}) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    onCreate(name)
    setNewName('')
    setShowNew(false)
  }

  const handleRename = (p: Project) => {
    const name = renameVal.trim()
    if (!name || name === p.name) { setRenamingId(null); return }
    onRename(p, name)
    setRenamingId(null)
  }

  return (
    <PageShell>
      <AppHeader
        title="用例库"
        theme="violet"
        maxWidth="max-w-4xl"
        actions={<span className="text-xs text-zinc-500">选择一个项目进入</span>}
      />

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-transparent p-5 transition hover:border-violet-400/50 hover:shadow-lg hover:shadow-violet-900/20"
            >
              {renamingId === p.id ? (
                <input
                  className="w-full rounded bg-black/40 px-2 py-1 text-base font-semibold text-white outline-none"
                  value={renameVal}
                  autoFocus
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => handleRename(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(p)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onSelect(p.id)}
                >
                  <h2 className="text-base font-semibold text-white">{p.name}</h2>
                  {p.description && (
                    <p className="mt-1 text-xs text-zinc-500">{p.description}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{caseCounts.get(p.id) ?? 0} 条用例</span>
                    <span>创建于 {fmtDate(p.createdAt)}</span>
                  </div>
                  <span className="mt-3 inline-flex items-center text-xs font-medium text-violet-300 group-hover:text-violet-200">
                    进入项目 →
                  </span>
                </button>
              )}

              {/* 操作按钮 */}
              <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
                <button
                  type="button"
                  className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                  title="重命名"
                  onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameVal(p.name) }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-red-500/60 hover:bg-red-500/10 hover:text-red-300"
                  title="删除项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    void confirm({
                      title: `删除项目「${p.name}」？`,
                      description: '该项目下所有模块和用例都会被一并删除，此操作不可恢复。',
                      confirmText: '删除',
                      destructive: true,
                    }).then((ok) => {
                      if (ok) onDelete(p.id)
                    })
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {/* 新建项目卡片 */}
          {showNew ? (
            <div className="flex items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5">
              <div className="flex w-full flex-col gap-2">
                <input
                  className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                  placeholder="输入项目名称"
                  value={newName}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') setShowNew(false)
                  }}
                />
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-500" onClick={handleCreate}>创建</button>
                  <button type="button" className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setShowNew(false)}>取消</button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-zinc-500 transition hover:border-violet-500/30 hover:bg-white/[0.04] hover:text-zinc-300"
              onClick={() => setShowNew(true)}
            >
              <span className="text-2xl">＋</span>
              <span className="mt-1 text-xs">新建项目</span>
            </button>
          )}
        </div>
      </main>
      {confirmDialog}
    </PageShell>
  )
}

/* ---------- 主页面 ---------- */

export function CaseLibraryPage() {
  const [page, setPage] = useState<'projects' | 'workspace'>('projects')
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  // 项目
  const [projects, setProjects] = useState<Project[]>([])
  const [caseCounts, setCaseCounts] = useState<Map<string, number>>(new Map())
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  // 模块
  const [modules, setModules] = useState<Module[]>([])
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
  const [moduleRefresh, setModuleRefresh] = useState(0)
  const [moduleCaseCounts, setModuleCaseCounts] = useState<Record<string, number>>({})
  const [projectCaseTotalWs, setProjectCaseTotalWs] = useState(0)

  // 用例集
  const [suites, setSuites] = useState<Suite[]>([])
  const [viewMode, setViewMode] = useState<'module' | 'suite'>('module')
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null)
  const [showNewSuite, setShowNewSuite] = useState(false)
  const [newSuiteName, setNewSuiteName] = useState('')

  // 用例
  const [cases, setCases] = useState<LibraryCase[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState<Priority | ''>('')
  const [filterType, setFilterType] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<LibraryCase | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('addedAt')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sortedCases = useMemo(
    () => [...cases].sort((a, b) => compareCases(a, b, sortKey, sortDir)),
    [cases, sortKey, sortDir],
  )

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  // 加载项目列表 + 用例计数
  const loadProjects = useCallback(async () => {
    const list = await getAllProjects()
    setProjects(list)
    const counts = new Map<string, number>()
    for (const p of list) {
      counts.set(p.id, await countCasesByProject(p.id))
    }
    setCaseCounts(counts)
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])

  // 进入项目
  const enterProject = (id: string) => {
    setCurrentProjectId(id)
    setSelectedModuleId(null)
    setSelectedSuiteId(null)
    setPage('workspace')
  }

  // 加载模块和用例集
  useEffect(() => {
    if (!currentProjectId || page !== 'workspace') { setModules([]); setSuites([]); return }
    void getProjectModules(currentProjectId).then(setModules)
    void getProjectSuites(currentProjectId).then(setSuites)
  }, [currentProjectId, moduleRefresh, page])

  // 各模块用例数（侧栏展示）
  useEffect(() => {
    if (!currentProjectId || page !== 'workspace') {
      setModuleCaseCounts({})
      setProjectCaseTotalWs(0)
      return
    }
    void (async () => {
      try {
        const [counts, total] = await Promise.all([
          getModuleCaseCountsByProject(currentProjectId),
          countCasesByProject(currentProjectId),
        ])
        setModuleCaseCounts(counts)
        setProjectCaseTotalWs(total)
      } catch {
        setModuleCaseCounts({})
        setProjectCaseTotalWs(0)
      }
    })()
  }, [currentProjectId, page, moduleRefresh, cases.length])

  // 加载用例
  const loadCases = useCallback(async () => {
    if (!currentProjectId || page !== 'workspace') { setCases([]); return }
    setLoading(true)
    try {
      let list: LibraryCase[]
      if (viewMode === 'suite' && selectedSuiteId) {
        list = await getSuiteCases(selectedSuiteId)
      } else if (query.trim()) {
        list = await searchCasesInProject(currentProjectId, query)
      } else if (selectedModuleId) {
        list = await getCasesByModule(selectedModuleId)
      } else {
        list = await getCasesByProject(currentProjectId)
      }
      if (filterPriority) list = list.filter((c) => c.priority === filterPriority)
      if (filterType) list = list.filter((c) => c.caseType === filterType)
      setCases(list)
    } finally {
      setLoading(false)
    }
  }, [currentProjectId, selectedModuleId, selectedSuiteId, viewMode, query, filterPriority, filterType, page])

  useEffect(() => { void loadCases() }, [loadCases])

  // 创建项目（header 内联）
  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    const p = await createProject(name)
    setNewProjectName('')
    setShowNewProject(false)
    enterProject(p.id)
    await loadProjects()
  }

  // 创建项目（项目目录页）
  const handleCreateProjectFromList = async (name: string) => {
    await createProject(name)
    await loadProjects()
  }

  // 删除项目（项目目录页）
  const handleDeleteProject = async (id: string) => {
    await deleteProject(id)
    if (currentProjectId === id) {
      setCurrentProjectId(null)
      setPage('projects')
    }
    await loadProjects()
  }

  // 重命名项目
  const handleRenameProject = async (p: Project, newName: string) => {
    await updateProject({ ...p, name: newName })
    await loadProjects()
  }

  // 创建用例集
  const handleCreateSuite = async () => {
    if (!currentProjectId) return
    const name = newSuiteName.trim()
    if (!name) return
    await createSuite(currentProjectId, name)
    setNewSuiteName('')
    setShowNewSuite(false)
    setModuleRefresh((v) => v + 1)
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    const ok = await confirm({
      title: `删除选中的 ${selected.size} 条用例？`,
      description: '此操作不可恢复。',
      confirmText: '批量删除',
      destructive: true,
    })
    if (!ok) return
    await deleteCases([...selected])
    setSelected(new Set())
    void loadCases()
  }

  // 保存编辑
  const handleSaveEdit = async (c: LibraryCase) => {
    await updateCase(c)
    setEditing(null)
    void loadCases()
    setModuleRefresh((v) => v + 1)
  }

  // 手动新建用例
  const handleCreateCase = () => {
    if (!currentProjectId) return
    const now = new Date().toISOString()
    const blank: LibraryCase = {
      id: uid(),
      projectId: currentProjectId,
      moduleId: selectedModuleId || '',
      addedAt: now,
      updatedAt: now,
      source: 'manual',
      tags: [],
      priority: 'P1',
      caseType: '功能测试',
      module: '',
      subModule: '',
      summary: '',
      description: '',
      preconditions: [],
      steps: [],
      expected: '',
      remarks: '',
    }
    setEditing(blank)
  }

  const handleSaveNew = async (c: LibraryCase) => {
    if (!c.summary.trim()) { window.alert('摘要不能为空。'); return }
    await putCase(c)
    setEditing(null)
    void loadCases()
    setModuleRefresh((v) => v + 1)
  }

  /* ========== 项目目录页 ========== */
  if (page === 'projects') {
    return (
      <ProjectListView
        projects={projects}
        caseCounts={caseCounts}
        onSelect={enterProject}
        onCreate={(name) => void handleCreateProjectFromList(name)}
        onDelete={(id) => void handleDeleteProject(id)}
        onRename={(p, n) => void handleRenameProject(p, n)}
      />
    )
  }

  /* ========== 项目工作台（双栏布局） ========== */
  const currentProject = projects.find((p) => p.id === currentProjectId)

  return (
    <div className="flex h-screen flex-col bg-[#0f1018] text-zinc-200">
      {/* Header */}
      <header className="shrink-0 border-b border-white/10 bg-[#14151f] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-zinc-400 hover:border-violet-500/40 hover:text-violet-200"
            onClick={() => { setPage('projects'); void loadProjects() }}
          >
            ← 项目目录
          </button>
          <h1 className="text-lg font-semibold text-white">
            {currentProject?.name ?? '用例库'}
          </h1>

          {/* 项目快捷切换 */}
          <select
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500/40"
            value={currentProjectId ?? ''}
            onChange={(e) => {
              if (e.target.value) enterProject(e.target.value)
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {showNewProject ? (
            <div className="flex items-center gap-1">
              <input
                className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-200 outline-none"
                placeholder="项目名称"
                value={newProjectName}
                autoFocus
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateProject()
                  if (e.key === 'Escape') setShowNewProject(false)
                }}
              />
              <button type="button" className="text-xs text-violet-400 hover:text-violet-300" onClick={() => void handleCreateProject()}>确定</button>
              <button type="button" className="text-xs text-zinc-500" onClick={() => setShowNewProject(false)}>取消</button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded border border-dashed border-white/15 px-2 py-1 text-[10px] text-zinc-500 hover:border-violet-500/30 hover:text-zinc-300"
              onClick={() => setShowNewProject(true)}
            >
              ＋ 新建项目
            </button>
          )}

          <span className="ml-auto text-xs text-zinc-500">
            {loading ? '加载中…' : `${cases.length} 条用例`}
          </span>
        </div>
      </header>

      {/* Body: left nav + right content */}
      <div className="flex min-h-0 flex-1">
        {/* 左侧导航 */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#12131c]">
          {/* 视图切换 tab */}
          <div className="flex border-b border-white/5 text-[10px]">
            <button
              type="button"
              className={['flex-1 py-2', viewMode === 'module' ? 'bg-white/5 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'].join(' ')}
              onClick={() => { setViewMode('module'); setSelectedSuiteId(null) }}
            >
              按模块
            </button>
            <button
              type="button"
              className={['flex-1 py-2', viewMode === 'suite' ? 'bg-white/5 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'].join(' ')}
              onClick={() => { setViewMode('suite'); setSelectedModuleId(null) }}
            >
              按用例集
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {viewMode === 'module' && currentProjectId && (
              <ModuleTree
                projectId={currentProjectId}
                selectedModuleId={selectedModuleId}
                onSelect={setSelectedModuleId}
                refreshKey={moduleRefresh}
                caseCounts={moduleCaseCounts}
                projectCaseTotal={projectCaseTotalWs}
              />
            )}

            {viewMode === 'suite' && (
              <div className="flex flex-col gap-1">
                {suites.map((s) => (
                  <div key={s.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      className={[
                        'flex-1 truncate rounded px-2 py-1.5 text-left text-xs',
                        selectedSuiteId === s.id
                          ? 'bg-violet-500/20 text-violet-100'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                      ].join(' ')}
                      onClick={() => setSelectedSuiteId(s.id)}
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      className="hidden rounded px-1 text-[10px] text-red-500/60 hover:text-red-300 group-hover:block"
                      title="删除用例集"
                      onClick={() => {
                        void confirm({
                          title: `删除用例集「${s.name}」？`,
                          description: '用例本身不会被删除，仅移除该用例集容器。',
                          confirmText: '删除',
                          destructive: true,
                        }).then((ok) => {
                          if (!ok) return
                          void deleteSuite(s.id).then(() => {
                            if (selectedSuiteId === s.id) setSelectedSuiteId(null)
                            setModuleRefresh((v) => v + 1)
                          })
                        })
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {showNewSuite ? (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <input
                      className="flex-1 rounded bg-black/30 px-1.5 py-0.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                      placeholder="用例集名称"
                      value={newSuiteName}
                      autoFocus
                      onChange={(e) => setNewSuiteName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateSuite()
                        if (e.key === 'Escape') setShowNewSuite(false)
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 rounded px-2 py-1 text-left text-[10px] text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
                    onClick={() => { setShowNewSuite(true); setNewSuiteName('') }}
                  >
                    ＋ 新建用例集
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* 筛选栏 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/5 bg-[#12131c] px-4 py-2">
            <input
              type="text"
              placeholder="搜索（摘要、描述、标签…）"
              className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as Priority | '')}
            >
              <option value="">全部优先级</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
            </select>
            <select
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">全部类型</option>
              {CASE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              type="button"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
              onClick={handleCreateCase}
            >
              ＋ 新建用例
            </button>
            {selected.size > 0 && (
              <button
                type="button"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                onClick={() => void handleBatchDelete()}
              >
                删除（{selected.size}）
              </button>
            )}
          </div>

          {/* 用例表格 */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {cases.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
                <p className="text-base">当前视图暂无用例</p>
                <p className="mt-2 text-xs">
                  前往{' '}
                  <Link to="/generation" className="text-violet-400 hover:underline">
                    测试用例生成
                  </Link>{' '}
                  页面，生成后点击「加入用例库」可批量入库，或点击上方「＋新建用例」手动创建。
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[850px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-[#1a1b2e] text-zinc-500">
                    <tr>
                      <th className="border-b border-white/10 px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={sortedCases.length > 0 && selected.size === sortedCases.length}
                          onChange={() => {
                            if (selected.size === sortedCases.length) setSelected(new Set())
                            else setSelected(new Set(sortedCases.map((c) => c.id)))
                          }}
                          className="accent-violet-500"
                        />
                      </th>
                      <th className="border-b border-white/10 px-2 py-2 cursor-pointer select-none hover:text-zinc-300" onClick={() => toggleSort('id')}>ID{sortIndicator('id')}</th>
                      <th className="border-b border-white/10 px-2 py-2 cursor-pointer select-none hover:text-zinc-300" onClick={() => toggleSort('priority')}>优先级{sortIndicator('priority')}</th>
                      <th className="border-b border-white/10 px-2 py-2 cursor-pointer select-none hover:text-zinc-300" onClick={() => toggleSort('caseType')}>类型{sortIndicator('caseType')}</th>
                      <th className="border-b border-white/10 px-2 py-2 cursor-pointer select-none hover:text-zinc-300" onClick={() => toggleSort('summary')}>用例描述{sortIndicator('summary')}</th>
                      <th className="border-b border-white/10 px-2 py-2 cursor-pointer select-none hover:text-zinc-300" onClick={() => toggleSort('addedAt')}>入库{sortIndicator('addedAt')}</th>
                      <th className="border-b border-white/10 px-2 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCases.map((tc) => (
                      <tr key={tc.id} className="group border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selected.has(tc.id)}
                            onChange={() => setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(tc.id)) next.delete(tc.id)
                              else next.add(tc.id)
                              return next
                            })}
                            className="accent-violet-500"
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-zinc-500">{tc.id.slice(0, 8)}</td>
                        <td className="px-2 py-2">
                          <span className={['rounded border px-1.5 py-0.5 text-[10px] font-bold', priorityClass(tc.priority)].join(' ')}>
                            {tc.priority}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-zinc-400">{tc.caseType}</td>
                        <td className="max-w-[320px] px-2 py-2">
                          <button
                            type="button"
                            className="text-left text-zinc-200 hover:text-violet-300"
                            onClick={() => setExpanded(expanded === tc.id ? null : tc.id)}
                          >
                            {tc.summary}
                          </button>
                          {expanded === tc.id && (
                            <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-[11px] text-zinc-400">
                              {tc.description && <div><span className="text-zinc-500">描述：</span>{tc.description}</div>}
                              {tc.preconditions.length > 0 && <div><span className="text-zinc-500">前置：</span>{tc.preconditions.join('；')}</div>}
                              {tc.steps.length > 0 && <div><span className="text-zinc-500">步骤：</span>{tc.steps.map((s, i) => `${i + 1}. ${s}`).join('  ')}</div>}
                              <div><span className="text-zinc-500">预期：</span>{tc.expected}</div>
                              {tc.remarks && <div><span className="text-zinc-500">备注：</span>{tc.remarks}</div>}
                              {tc.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {tc.tags.map((t) => (
                                    <span key={t} className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-zinc-500">{fmtDate(tc.addedAt)}</td>
                        <td className="px-2 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                              onClick={() => setEditing(tc)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-[10px] text-red-500/60 hover:bg-red-500/10 hover:text-red-300"
                              onClick={() => {
                                void confirm({
                                  title: '删除此用例？',
                                  description: '此操作不可恢复。',
                                  confirmText: '删除',
                                  destructive: true,
                                }).then((ok) => {
                                  if (ok) void deleteCase(tc.id).then(() => loadCases())
                                })
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <CaseEditModal
          initial={editing}
          modules={modules}
          onSave={(c) => {
            if (c.addedAt === c.updatedAt && !cases.find((x) => x.id === c.id)) {
              void handleSaveNew(c)
            } else {
              void handleSaveEdit(c)
            }
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {confirmDialog}
    </div>
  )
}

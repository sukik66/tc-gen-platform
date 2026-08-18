/**
 * 「加入用例库」弹窗 —— 选择目标项目 + 模块后一键入库
 *
 * 智能推荐：从待导入用例的 module 字段提取模块名，
 * 与项目已有模块匹配，未匹配的建议新建。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TestCase } from '../types'
import {
  type Module,
  type Project,
  createModule,
  createProject,
  getAllProjects,
  getProjectModules,
  importFromGeneration,
} from '../lib/caseLibraryStore'

interface Props {
  cases: TestCase[]
  onClose: () => void
}

/** 从用例数组中提取去重的模块名 */
function extractCaseModules(cases: TestCase[]): string[] {
  const set = new Set<string>()
  for (const c of cases) {
    const name = c.module.trim()
    if (name) set.add(name)
  }
  return [...set].sort()
}

export function ImportToLibraryModal({ cases, onClose }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [modules, setModules] = useState<Module[]>([])
  const [projectId, setProjectId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewModule, setShowNewModule] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')

  const modulesLoaded = useRef(false)
  const newModuleInputRef = useRef<HTMLInputElement>(null)
  const newProjectInputRef = useRef<HTMLInputElement>(null)

  const caseModuleNames = useMemo(() => extractCaseModules(cases), [cases])

  // 加载项目
  const loadProjects = useCallback(async () => {
    const list = await getAllProjects()
    setProjects(list)
    if (list.length > 0 && !projectId) setProjectId(list[0].id)
  }, [projectId])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // 加载模块
  const loadModules = useCallback(async () => {
    if (!projectId) {
      setModules([])
      return
    }
    const ms = await getProjectModules(projectId)
    setModules(ms)
    if (ms.length > 0) {
      const match = ms.find((m) =>
        caseModuleNames.some((cn) => cn === m.name),
      )
      setModuleId(match ? match.id : ms[0].id)
    } else {
      setModuleId('')
    }
    modulesLoaded.current = true
  }, [projectId, caseModuleNames])

  useEffect(() => {
    modulesLoaded.current = false
    void loadModules()
  }, [loadModules])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 6000)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (showNewModule) queueMicrotask(() => newModuleInputRef.current?.focus())
  }, [showNewModule])

  useEffect(() => {
    if (showNewProject) queueMicrotask(() => newProjectInputRef.current?.focus())
  }, [showNewProject])

  const matchedModules = useMemo(() => {
    const moduleNames = new Set(modules.map((m) => m.name))
    return caseModuleNames.map((name) => ({
      name,
      matched: moduleNames.has(name),
      moduleId: modules.find((m) => m.name === name)?.id ?? null,
    }))
  }, [modules, caseModuleNames])

  const unmatchedNames = matchedModules.filter((m) => !m.matched)

  const handleCreateUnmatched = async () => {
    if (!projectId) return
    for (const item of unmatchedNames) {
      await createModule(projectId, item.name)
    }
    await loadModules()
    setHint('已为缺失名称创建模块，请确认目标模块后点击「导入」完成入库。')
  }

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    try {
      const p = await createProject(name)
      setNewProjectName('')
      setShowNewProject(false)
      setProjectId(p.id)
      const list = await getAllProjects()
      setProjects(list)
      setHint('项目已创建并已选中。请选择模块后点击下方「导入 … 条用例」。')
    } catch {
      /* ignore */
    }
  }

  const handleCreateModule = async () => {
    if (!projectId) return
    const name = newModuleName.trim()
    if (!name) return
    const m = await createModule(projectId, name)
    setNewModuleName('')
    setShowNewModule(false)
    // 直接把新模块合并进列表并选中它。
    // 不调用 loadModules(): 它内部会基于 caseModuleNames 做"智能默认选择"，
    // 会再次 setModuleId 把这里的选中态覆盖回 ms[0]（旧默认模块），导致下拉显示与提示不一致。
    setModules((prev) => [...prev, m])
    setModuleId(m.id)
    setHint('模块已创建并已选中。点击下方绿色「导入 … 条用例」写入用例库（本页不会跳转）。')
  }

  const handleImport = async () => {
    if (!projectId) {
      window.alert('请选择或创建一个项目。')
      return
    }
    if (!moduleId) {
      window.alert('请选择或创建一个模块。')
      return
    }
    setBusy(true)
    try {
      const n = await importFromGeneration(cases, projectId, moduleId)
      window.alert(`已将 ${n} 条用例加入用例库。可关闭本窗口继续在生成页编辑，或前往「用例库」查看。`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="关闭"
        onClick={onClose}
      />
      <form
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1b2e] p-5 shadow-xl"
        onSubmit={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-lib-title"
      >
        <h3 id="import-lib-title" className="mb-3 text-sm font-semibold text-white">
          加入用例库
        </h3>
        <p className="mb-4 text-xs text-zinc-400">
          将当前 {cases.length} 条用例导入至选定的项目和模块中。
        </p>

        {hint && (
          <div className="mb-3 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100/95">
            {hint}
          </div>
        )}

        {/* 项目选择 */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-zinc-500">目标项目</label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500/40"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  setModuleId('')
                  setShowNewProject(false)
                  setShowNewModule(false)
                }}
              >
                {projects.length === 0 && <option value="">暂无项目</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {!showNewProject && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-dashed border-white/20 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:border-violet-500/35 hover:text-violet-200"
                  onClick={() => setShowNewProject(true)}
                >
                  ＋ 新建项目
                </button>
              )}
            </div>
            {showNewProject && (
              <div className="rounded-lg border border-violet-500/30 bg-violet-950/25 p-3">
                <p className="mb-2 text-[11px] font-medium text-violet-200">新建项目</p>
                <input
                  ref={newProjectInputRef}
                  className="mb-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                  placeholder="输入项目名称"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowNewProject(false)
                      setNewProjectName('')
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500"
                    onClick={() => void handleCreateProject()}
                  >
                    创建并选中
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-400 hover:bg-white/5"
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 模块选择 */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-zinc-500">目标模块</label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500/40"
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
              >
                {modules.length === 0 && <option value="">暂无模块 — 请先新建</option>}
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {!showNewModule && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-dashed border-white/20 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:border-violet-500/35 hover:text-violet-200"
                  onClick={() => setShowNewModule(true)}
                >
                  ＋ 新建模块
                </button>
              )}
            </div>
            {showNewModule && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                <p className="mb-2 text-[11px] font-medium text-emerald-200">新建模块</p>
                <input
                  ref={newModuleInputRef}
                  className="mb-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500/50"
                  placeholder="输入模块名称"
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateModule()
                    }
                    if (e.key === 'Escape') {
                      setShowNewModule(false)
                      setNewModuleName('')
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                    onClick={() => void handleCreateModule()}
                  >
                    创建并选中
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-400 hover:bg-white/5"
                    onClick={() => {
                      setShowNewModule(false)
                      setNewModuleName('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {caseModuleNames.length > 0 && modulesLoaded.current && (
          <div className="mb-4 rounded-lg border border-white/5 bg-black/20 p-3">
            <p className="mb-2 text-[11px] font-medium text-zinc-400">
              从用例中识别到 {caseModuleNames.length} 个模块：
            </p>
            <div className="flex flex-wrap gap-1.5">
              {matchedModules.map((item) => (
                <span
                  key={item.name}
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px]',
                    item.matched
                      ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border border-amber-500/30 bg-amber-500/10 text-amber-200',
                  ].join(' ')}
                >
                  {item.matched ? '✓ ' : '⚠ '}
                  {item.name}
                </span>
              ))}
            </div>
            {unmatchedNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-amber-300/70">
                  {unmatchedNames.length} 个模块在当前项目中不存在
                </span>
                <button
                  type="button"
                  className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/25"
                  onClick={() => void handleCreateUnmatched()}
                >
                  一键创建缺失模块
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-emerald-300/70">✓ 所有模块已匹配</p>
            )}
          </div>
        )}

        {caseModuleNames.length === 0 && modulesLoaded.current && modules.length === 0 && (
          <div className="mb-4 rounded-lg border border-white/5 bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">
              用例中未识别到模块信息，且当前项目暂无模块。请先新建一个模块再导入。
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            disabled={busy || !projectId || !moduleId}
            onClick={() => void handleImport()}
          >
            {busy ? '导入中…' : `导入 ${cases.length} 条用例`}
          </button>
        </div>
      </form>
    </div>
  )
}

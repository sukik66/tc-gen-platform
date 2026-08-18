import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ModuleTree } from '../components/ModuleTree'
import {
  type Module,
  type Project,
  getAllProjects,
  getProjectModules,
} from '../lib/caseLibraryStore'
import {
  type ContractVerifyMethod,
  type QualityContractDraft,
  deleteContractDraft,
  listContractDrafts,
  updateContractDraft,
} from '../lib/contractDraftStore'
import { CONTRACT_METHOD_OPTIONS } from '../constants'
import { priorityClass } from '../lib/ui-utils'
import { ContractCard } from '../components/ContractCard'
import { PageShell } from '../components/PageShell'
import { AppHeader } from '../components/AppHeader'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import {
  listContractReviewResults,
  type PersistedContractCodeReviewResult,
} from '../api/codeReview'

export function ContractLibraryPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [modules, setModules] = useState<Module[]>([])
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
  const [contracts, setContracts] = useState<QualityContractDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<QualityContractDraft> | null>(null)
  /**
   * TKT-20260429-014 · 每条契约最新走查结果缓存（id → 结果，无则键不存在）
   * 进入页 & 切换项目/模块后并发拉取。失败的契约静默忽略（不阻断列表渲染）。
   * 已知 N+1：契约 ≥ 10 条会有可见延迟，本轮 MVP 接受（DT-3 留待后续合并端点）。
   */
  const [reviewResults, setReviewResults] = useState<
    Record<string, PersistedContractCodeReviewResult>
  >({})
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const ps = await getAllProjects()
      setProjects(ps)
      setProjectId((cur) => {
        if (ps.length === 0) return ''
        if (!cur || !ps.some((p) => p.id === cur)) return ps[0].id
        return cur
      })
    } catch (e) {
      console.error(e)
      setMsg('加载项目失败，请确认 API 已启动')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (!projectId) return
    void getProjectModules(projectId).then(setModules)
  }, [projectId])

  const reloadContracts = useCallback(async () => {
    if (!projectId) return
    setListLoading(true)
    setMsg(null)
    try {
      const list = await listContractDrafts({
        projectId,
        moduleId: selectedModuleId || undefined,
      })
      setContracts(list)
    } catch (e) {
      console.error(e)
      setMsg('加载契约失败')
    } finally {
      setListLoading(false)
    }
  }, [projectId, selectedModuleId])

  useEffect(() => {
    void reloadContracts()
  }, [reloadContracts])

  /**
   * TKT-20260429-014 · contracts 列表更新后并发拉每条契约的最新一次走查结果。
   * Promise.all 并发但单条失败不影响其他；卸载时通过 cancelled 标记避免 setState 报错。
   */
  useEffect(() => {
    if (contracts.length === 0) {
      setReviewResults({})
      return
    }
    let cancelled = false
    const acc: Record<string, PersistedContractCodeReviewResult> = {}
    void Promise.all(
      contracts.map(async (c) => {
        try {
          const list = await listContractReviewResults(c.id, 1)
          if (list[0]) acc[c.id] = list[0]
        } catch {
          /* 单条失败静默：不阻塞其他契约展示 */
        }
      }),
    ).then(() => {
      if (!cancelled) setReviewResults(acc)
    })
    return () => {
      cancelled = true
    }
  }, [contracts])

  const beginEdit = (c: QualityContractDraft) => {
    setExpandedId(c.id)
    setEditForm({
      moduleLabel: c.moduleLabel,
      rule: c.rule,
      boundaryHint: c.boundaryHint,
      priority: c.priority,
      verifyMethods: [...c.verifyMethods],
      verifyRationale: c.verifyRationale || '',
      status: c.status,
    })
  }

  const cancelEdit = () => {
    setExpandedId(null)
    setEditForm(null)
  }

  const saveEdit = async (id: string) => {
    if (!editForm) return
    const vm: ContractVerifyMethod[] = (editForm.verifyMethods?.length
      ? editForm.verifyMethods
      : ['code_review']) as ContractVerifyMethod[]
    setMsg(null)
    try {
      await updateContractDraft(id, {
        moduleLabel: editForm.moduleLabel?.trim(),
        rule: editForm.rule?.trim(),
        boundaryHint: editForm.boundaryHint?.trim(),
        priority: editForm.priority,
        verifyMethods: vm,
        verifyRationale: editForm.verifyRationale?.trim(),
        status: editForm.status === 'active' ? 'active' : 'draft',
      })
      setMsg('已保存')
      cancelEdit()
      await reloadContracts()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  const setActive = async (id: string) => {
    setMsg(null)
    try {
      await updateContractDraft(id, { status: 'active' })
      await reloadContracts()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败')
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '删除该契约？',
      description: '契约将从草稿/已启用列表中移除，此操作不可恢复。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    await deleteContractDraft(id)
    await reloadContracts()
    if (expandedId === id) cancelEdit()
  }

  const toggleMethod = (m: ContractVerifyMethod) => {
    setEditForm((prev) => {
      if (!prev?.verifyMethods) return prev
      const next = new Set(prev.verifyMethods)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return { ...prev, verifyMethods: Array.from(next) }
    })
  }

  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId])

  return (
    <PageShell>
      <AppHeader
        theme="teal"
        eyebrow="质量契约库"
        title="契约库"
        subtitle={
          <>
            按用例库的<strong className="text-zinc-300">项目 / 模块</strong>查看与编辑契约；状态为草稿 / 已启用。新建与 AI 提取请前往
            <Link to="/contracts" className="ml-1 text-teal-400 underline hover:text-teal-300">
              质量契约工作台
            </Link>
            。
          </>
        }
        actions={
          <>
            <Link
              to="/contracts"
              className="rounded-lg border border-teal-500/40 bg-teal-500/15 px-3 py-1.5 text-sm text-teal-100 hover:bg-teal-500/25"
            >
              质量契约工作台
            </Link>
            <Link
              to="/case-library"
              className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-500/25"
            >
              用例库
            </Link>
          </>
        }
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 lg:flex-row">
        {msg && (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-white/10 bg-[#1a1b2e] px-4 py-2 text-sm text-zinc-200 shadow-lg">
            {msg}
          </div>
        )}

        <aside className="w-full shrink-0 rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:w-72">
          <label className="block text-xs text-zinc-400">
            项目
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                setSelectedModuleId(null)
              }}
              disabled={loading || projects.length === 0}
              className="mt-1 w-full rounded-lg border border-white/15 bg-[#14151f] px-2 py-2 text-sm text-zinc-100"
            >
              {projects.length === 0 && <option value="">（无项目，请先到用例库创建）</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {projectId && (
            <div className="mt-4 max-h-[60vh] overflow-auto">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">模块</p>
              <ModuleTree
                projectId={projectId}
                selectedModuleId={selectedModuleId}
                onSelect={(id) => setSelectedModuleId(id)}
              />
              <button
                type="button"
                className="mt-2 w-full rounded border border-white/10 py-1.5 text-[11px] text-zinc-400 hover:border-teal-500/30 hover:text-teal-200"
                onClick={() => setSelectedModuleId(null)}
              >
                显示本项目全部契约
              </button>
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
            <h2 className="text-sm font-semibold text-white">
              {selectedProject?.name ?? '—'}
              {selectedModuleId
                ? ` · ${modules.find((m) => m.id === selectedModuleId)?.name ?? '模块'}`
                : ' · 全部模块'}
            </h2>
            {listLoading && <span className="text-xs text-zinc-500">加载中…</span>}
          </div>
          {contracts.length === 0 && !listLoading && (
            <p className="mt-6 text-center text-sm text-zinc-500">暂无契约。请到工作台选择同一项目与模块后保存，或使用 AI 提取入库。</p>
          )}
          <ul className="mt-4 space-y-3">
            {contracts.map((c) => (
              <ContractCard
                key={c.id}
                contract={c}
                showStatus
                reviewResult={reviewResults[c.id] ?? null}
                actions={
                  <>
                    {c.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void setActive(c.id)}
                        className="rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                      >
                        启用
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => beginEdit(c)}
                      className="rounded border border-teal-500/40 px-2 py-1 text-[11px] text-teal-200 hover:bg-teal-500/10"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(c.id)}
                      className="rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </>
                }
                footer={
                  <>
                    模块 ID：{c.moduleId} · {new Date(c.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                  </>
                }
                expanded={expandedId === c.id && editForm && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <p className="mb-2 text-xs font-medium text-teal-200">编辑契约</p>
                    <div className="space-y-2 text-xs">
                      <label className="block text-zinc-400">
                        模块/场景名
                        <input
                          className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-zinc-100"
                          value={editForm.moduleLabel || ''}
                          onChange={(e) => setEditForm({ ...editForm, moduleLabel: e.target.value })}
                        />
                      </label>
                      <label className="block text-zinc-400">
                        业务规则
                        <textarea
                          rows={4}
                          className="mt-1 w-full resize-y rounded border border-white/15 bg-black/30 px-2 py-1.5 text-zinc-100"
                          value={editForm.rule || ''}
                          onChange={(e) => setEditForm({ ...editForm, rule: e.target.value })}
                        />
                      </label>
                      <label className="block text-zinc-400">
                        边界提示
                        <textarea
                          rows={2}
                          className="mt-1 w-full resize-y rounded border border-white/15 bg-black/30 px-2 py-1.5 text-zinc-100"
                          value={editForm.boundaryHint || ''}
                          onChange={(e) => setEditForm({ ...editForm, boundaryHint: e.target.value })}
                        />
                      </label>
                      <label className="block text-zinc-400">
                        推荐理由
                        <textarea
                          rows={2}
                          className="mt-1 w-full resize-y rounded border border-white/15 bg-black/30 px-2 py-1.5 text-zinc-100"
                          value={editForm.verifyRationale || ''}
                          onChange={(e) => setEditForm({ ...editForm, verifyRationale: e.target.value })}
                        />
                      </label>
                      <div>
                        <span className="text-zinc-400">优先级</span>
                        <div className="mt-1 flex gap-2">
                          {(['P0', 'P1', 'P2'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setEditForm({ ...editForm, priority: p })}
                              className={[
                                'rounded border px-2 py-1 text-[11px]',
                                editForm.priority === p ? priorityClass(p) : 'border-white/10 text-zinc-500',
                              ].join(' ')}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-zinc-400">验证方式</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {CONTRACT_METHOD_OPTIONS.map((m) => (
                            <label key={m.id} className="flex items-center gap-1 text-zinc-300">
                              <input
                                type="checkbox"
                                checked={editForm.verifyMethods?.includes(m.id)}
                                onChange={() => toggleMethod(m.id)}
                              />
                              {m.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-zinc-300">
                        <input
                          type="checkbox"
                          checked={editForm.status === 'active'}
                          onChange={(e) =>
                            setEditForm({ ...editForm, status: e.target.checked ? 'active' : 'draft' })
                          }
                        />
                        标记为已启用（active）
                      </label>
                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => void saveEdit(c.id)}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-400 hover:border-white/25"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              />
            ))}
          </ul>
        </section>
      </main>
      {confirmDialog}
    </PageShell>
  )
}

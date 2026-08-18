/**
 * 模块树组件 —— 左侧导航的核心部分
 * 支持：多级嵌套、折叠/展开、新增子模块、重命名、删除
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Module } from '../lib/caseLibraryStore'
import {
  createModule,
  deleteModule,
  getProjectModules,
  renameModule,
} from '../lib/caseLibraryStore'

interface Props {
  projectId: string
  selectedModuleId: string | null
  onSelect: (moduleId: string | null) => void
  /** 外部触发刷新（比如导入后） */
  refreshKey?: number
  /** 各模块直接挂载的用例数；侧栏展示含子模块的汇总 */
  caseCounts?: Record<string, number>
  /** 「全部用例」旁展示的项目用例总数 */
  projectCaseTotal?: number
}

interface TreeNode {
  module: Module
  children: TreeNode[]
}

function buildTree(modules: Module[]): TreeNode[] {
  const map = new Map<string | null, Module[]>()
  for (const m of modules) {
    const pid = m.parentId
    if (!map.has(pid)) map.set(pid, [])
    map.get(pid)!.push(m)
  }
  const build = (parentId: string | null): TreeNode[] => {
    const children = map.get(parentId) ?? []
    return children
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ module: m, children: build(m.id) }))
  }
  return build(null)
}

function subtreeTotalsMap(
  nodes: TreeNode[],
  direct: Record<string, number> | undefined,
): Map<string, number> {
  const map = new Map<string, number>()
  if (!direct) return map
  const walk = (node: TreeNode): number => {
    let sum = direct[node.module.id] ?? 0
    for (const ch of node.children) sum += walk(ch)
    map.set(node.module.id, sum)
    return sum
  }
  for (const n of nodes) walk(n)
  return map
}

export function ModuleTree({
  projectId,
  selectedModuleId,
  onSelect,
  refreshKey,
  caseCounts,
  projectCaseTotal,
}: Props) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [adding, setAdding] = useState<string | null>(null) // parentId for new module
  const [addVal, setAddVal] = useState('')

  const load = useCallback(async () => {
    if (!projectId) { setTree([]); return }
    const mods = await getProjectModules(projectId)
    setTree(buildTree(mods))
  }, [projectId])

  useEffect(() => { void load() }, [load, refreshKey])

  const subtreeCounts = useMemo(
    () => subtreeTotalsMap(tree, caseCounts),
    [tree, caseCounts],
  )

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async (parentId: string | null) => {
    const name = addVal.trim()
    if (!name) { setAdding(null); return }
    await createModule(projectId, name, parentId)
    setAdding(null)
    setAddVal('')
    await load()
  }

  const handleRename = async (moduleId: string) => {
    const name = renameVal.trim()
    if (!name) { setRenaming(null); return }
    await renameModule(moduleId, name)
    setRenaming(null)
    setRenameVal('')
    await load()
  }

  const handleDelete = async (moduleId: string) => {
    if (!window.confirm('删除模块将同时删除其下所有子模块和用例，确认？')) return
    await deleteModule(moduleId)
    if (selectedModuleId === moduleId) onSelect(null)
    await load()
  }

  const renderNode = (node: TreeNode, depth: number) => {
    const { module: m, children } = node
    const isCollapsed = collapsed.has(m.id)
    const isSelected = selectedModuleId === m.id
    const hasChildren = children.length > 0

    return (
      <div key={m.id}>
        <div
          className={[
            'group flex items-center gap-1 rounded px-1 py-1 text-xs cursor-pointer',
            isSelected
              ? 'bg-violet-500/20 text-violet-100'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
          ].join(' ')}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => onSelect(m.id)}
        >
          {/* 折叠箭头 */}
          <button
            type="button"
            className="w-4 shrink-0 text-center text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={(e) => { e.stopPropagation(); toggle(m.id) }}
          >
            {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
          </button>

          {renaming === m.id ? (
            <input
              className="flex-1 rounded bg-black/30 px-1 py-0.5 text-xs text-zinc-200 outline-none"
              value={renameVal}
              autoFocus
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => void handleRename(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename(m.id)
                if (e.key === 'Escape') setRenaming(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate">
              {m.name}
              {caseCounts != null && (
                <span className="ml-1 tabular-nums text-[10px] text-zinc-600">
                  ({subtreeCounts.get(m.id) ?? 0})
                </span>
              )}
            </span>
          )}

          {/* 操作按钮 */}
          <span className="hidden shrink-0 gap-0.5 group-hover:flex">
            <button
              type="button"
              title="新增子模块"
              className="rounded px-1 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              onClick={(e) => { e.stopPropagation(); setAdding(m.id); setAddVal('') }}
            >
              ＋
            </button>
            <button
              type="button"
              title="重命名"
              className="rounded px-1 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              onClick={(e) => { e.stopPropagation(); setRenaming(m.id); setRenameVal(m.name) }}
            >
              ✎
            </button>
            <button
              type="button"
              title="删除"
              className="rounded px-1 text-[10px] text-red-500/60 hover:bg-red-500/10 hover:text-red-300"
              onClick={(e) => { e.stopPropagation(); void handleDelete(m.id) }}
            >
              ✕
            </button>
          </span>
        </div>

        {/* 新增子模块输入框 */}
        {adding === m.id && (
          <div className="flex items-center gap-1 px-1 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
            <input
              className="flex-1 rounded bg-black/30 px-1.5 py-0.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              placeholder="模块名称"
              value={addVal}
              autoFocus
              onChange={(e) => setAddVal(e.target.value)}
              onBlur={() => void handleAdd(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd(m.id)
                if (e.key === 'Escape') setAdding(null)
              }}
            />
          </div>
        )}

        {/* 子节点 */}
        {!isCollapsed && children.map((ch) => renderNode(ch, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* 全部用例 */}
      <button
        type="button"
        className={[
          'rounded px-2 py-1.5 text-left text-xs',
          selectedModuleId === null
            ? 'bg-violet-500/20 text-violet-100'
            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
        ].join(' ')}
        onClick={() => onSelect(null)}
      >
        📁 全部用例
        {projectCaseTotal != null && (
          <span className="ml-1 tabular-nums text-[10px] text-zinc-600">
            ({projectCaseTotal})
          </span>
        )}
      </button>

      {tree.map((n) => renderNode(n, 0))}

      {/* 根级新增 */}
      {adding === '__root__' ? (
        <div className="flex items-center gap-1 px-1 py-1">
          <input
            className="flex-1 rounded bg-black/30 px-1.5 py-0.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            placeholder="模块名称"
            value={addVal}
            autoFocus
            onChange={(e) => setAddVal(e.target.value)}
            onBlur={() => void handleAdd(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd(null)
              if (e.key === 'Escape') setAdding(null)
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="mt-1 rounded px-2 py-1 text-left text-[10px] text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
          onClick={() => { setAdding('__root__'); setAddVal('') }}
        >
          ＋ 新增模块
        </button>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchSkillDetail, fetchSkillFile, type SkillDetail, type SkillFileSummary } from '../api/skills'

type TreeNode = { folders: Record<string, TreeNode>; files: SkillFileSummary[] }

function buildTree(files: SkillFileSummary[]) {
  const root: TreeNode = { folders: {}, files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.slice(0, -1).forEach((part) => { node = node.folders[part] ||= { folders: {}, files: [] } })
    node.files.push(file)
  }
  return root
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) return <code key={`${keyPrefix}-code-${index}`} className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[0.9em] text-teal-200">{token.slice(1, -1)}</code>
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) return <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-white">{token.slice(2, -2)}</strong>
    return <span key={`${keyPrefix}-text-${index}`}>{token}</span>
  })
}

function MarkdownPreview({ content }: { content: string }) {
  const nodes: ReactNode[] = []
  let inCode = false
  let codeLines: string[] = []
  content.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        nodes.push(<pre key={`code-${index}`} className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-[#101119] p-4 font-mono text-xs leading-6 text-zinc-300"><code>{codeLines.join('\n')}</code></pre>)
        codeLines = []
      }
      inCode = !inCode
      return
    }
    if (inCode) { codeLines.push(line); return }
    if (!line.trim()) { nodes.push(<div key={`space-${index}`} className="h-3" />); return }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const className = level === 1 ? 'mt-2 text-2xl font-semibold text-white' : level === 2 ? 'mt-7 text-lg font-semibold text-white' : 'mt-5 text-sm font-semibold uppercase tracking-wide text-violet-200'
      const Tag = `h${Math.min(level, 4)}` as ElementType
      nodes.push(<Tag key={`heading-${index}`} className={className}>{inlineMarkdown(heading[2], `heading-${index}`)}</Tag>)
      return
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) { nodes.push(<li key={`bullet-${index}`} className="ml-5 list-disc leading-7 text-zinc-300">{inlineMarkdown(bullet[1], `bullet-${index}`)}</li>); return }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (ordered) { nodes.push(<li key={`ordered-${index}`} className="ml-5 list-decimal leading-7 text-zinc-300">{inlineMarkdown(ordered[1], `ordered-${index}`)}</li>); return }
    if (/^\s*>/.test(line)) { nodes.push(<blockquote key={`quote-${index}`} className="border-l-2 border-violet-400/60 pl-4 leading-7 text-zinc-400">{inlineMarkdown(line.replace(/^\s*>\s?/, ''), `quote-${index}`)}</blockquote>); return }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { nodes.push(<hr key={`hr-${index}`} className="my-5 border-white/10" />); return }
    nodes.push(<p key={`paragraph-${index}`} className="leading-7 text-zinc-300">{inlineMarkdown(line, `paragraph-${index}`)}</p>)
  })
  return <div className="prose-invert max-w-none text-sm">{nodes}</div>
}

function Tree({ node, prefix = '', selectedPath, onSelect }: { node: TreeNode; prefix?: string; selectedPath: string; onSelect: (path: string) => void }) {
  return <div className="space-y-1">
    {Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => <div key={`${prefix}${name}/`} className="ml-2"><div className="flex items-center gap-2 py-1 text-xs font-medium text-zinc-300"><span className="text-zinc-600">⌄</span><span className="text-violet-300">□</span>{name}</div><Tree node={child} prefix={`${prefix}${name}/`} selectedPath={selectedPath} onSelect={onSelect} /></div>)}
    {node.files.sort((a, b) => a.path.localeCompare(b.path)).map((file) => <button key={file.path} type="button" onClick={() => onSelect(file.path)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${selectedPath === file.path ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'}`}><span className="ml-4 text-zinc-600">{file.path.toLowerCase().endsWith('.md') ? '▤' : '□'}</span><span className="truncate">{file.path.split('/').at(-1)}</span></button>)}
  </div>
}

export function SkillDetailPage() {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [activePane, setActivePane] = useState<'source' | 'preview'>('preview')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchSkillDetail(id).then((next) => {
      if (cancelled) return
      setDetail(next)
      const preferred = next.files.find((file) => file.path.toLowerCase().endsWith('skill.md'))?.path || next.files[0]?.path || ''
      setSelectedPath(preferred)
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '无法读取 Skill') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!id || !selectedPath) return
    let cancelled = false
    setContent('')
    fetchSkillFile(id, selectedPath).then((file) => { if (!cancelled) setContent(file.content) }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '无法读取文件') })
    return () => { cancelled = true }
  }, [id, selectedPath])

  const tree = useMemo(() => buildTree(detail?.files || []), [detail?.files])
  const selectedFile = detail?.files.find((file) => file.path === selectedPath)
  const sourceLines = useMemo(() => (content ? content.split(/\r?\n/) : ['']), [content])

  if (loading) return <div className="min-h-screen bg-[#0f1018] p-8 text-sm text-zinc-400">读取 Skill…</div>
  if (!detail) return <div className="min-h-screen bg-[#0f1018] p-8 text-sm text-rose-200">{error || 'Skill 不存在'}</div>

  return <div className="min-h-screen bg-[#0f1018] text-zinc-200">
    <header className="border-b border-white/10 bg-[#151621]">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 lg:px-6"><div className="flex min-w-0 items-center gap-3"><Link to="/skills" className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-violet-400/50 hover:text-violet-200">← Skill 管理</Link><span className="h-7 w-px bg-white/10" /><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold text-white">{detail.name}</h1><span className="rounded bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-200">{detail.hasSkillMd ? 'SKILL.md' : 'Skill'}</span></div><p className="mt-0.5 truncate text-[11px] text-zinc-500">{detail.fileCount} 个文件 · {new Date(detail.updatedAt).toLocaleString()}</p></div></div><Link to="/generation" className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-400">去生成</Link></div>
    </header>
    {error && <div className="mx-auto max-w-[1500px] px-4 pt-4 lg:px-6"><div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</div></div>}
    <main className="mx-auto grid max-w-[1500px] gap-3 p-3 lg:h-[calc(100vh-73px)] lg:min-h-0 lg:grid-cols-[250px_minmax(0,1fr)] lg:overflow-hidden lg:p-4">
      <aside className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-[#171822]"><div className="flex h-11 items-center justify-between border-b border-white/10 px-3"><span className="text-xs font-semibold text-white">Skill 文件</span><span className="text-[10px] text-zinc-500">{detail.fileCount} 个文件</span></div><div className="max-h-[35vh] overflow-y-auto p-2 lg:h-[calc(100%-44px)] lg:max-h-none"> <Tree node={tree} selectedPath={selectedPath} onSelect={(path) => { setSelectedPath(path); setActivePane('preview') }} /></div></aside>
      <section className="grid min-h-0 min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#171822] lg:h-full lg:grid-cols-2"><div className={`${activePane === 'preview' ? 'hidden lg:flex' : 'flex'} min-h-0 min-w-0 flex-col border-r border-white/10`}><div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-4"><span className="truncate text-xs font-medium text-zinc-200">{selectedPath || '未选择文件'}</span><span className="text-[10px] text-zinc-600">原文 · {sourceLines.length} 行</span></div><div className="flex min-h-0 min-w-0 flex-1 overflow-auto bg-[#13141d]" data-testid="skill-source"><div aria-hidden="true" className="sticky left-0 z-10 min-h-max shrink-0 border-r border-white/10 bg-[#171822] px-3 py-5 text-right font-mono text-xs leading-6 text-zinc-600 select-none">{sourceLines.map((_, index) => <div key={index}>{index + 1}</div>)}</div><pre className="m-0 min-w-max whitespace-pre p-5 font-mono text-xs leading-6 text-zinc-300">{content || '读取中…'}</pre></div></div><div className={`${activePane === 'source' ? 'hidden lg:flex' : 'flex'} min-h-0 min-w-0 flex-col`}><div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-4"><div className="flex items-center gap-1 rounded-lg bg-black/20 p-1"><button type="button" onClick={() => setActivePane('source')} className="rounded px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-200 lg:hidden">原文</button><button type="button" onClick={() => setActivePane('preview')} className="rounded bg-violet-500/20 px-2 py-1 text-[10px] text-violet-100">预览</button></div><span className="text-[10px] text-zinc-600">{selectedFile ? `${formatBytes(selectedFile.bytes)}` : ''}</span></div><div className="min-h-0 flex-1 overflow-auto px-6 py-5"><MarkdownPreview content={content} /></div></div></section>
    </main>
  </div>
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

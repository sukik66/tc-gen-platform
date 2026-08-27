import { useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { PageShell } from '../components/PageShell'
import { deleteSkill, uploadSkill, type SkillSummary } from '../api/skills'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type UploadMode = 'folder' | 'file'

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mode, setMode] = useState<UploadMode | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [replaceTarget, setReplaceTarget] = useState<SkillSummary | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/skills`)
      const body = await response.json() as { skills?: SkillSummary[] }
      if (!response.ok) throw new Error('无法读取 Skill 列表')
      setSkills(body.skills || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取 Skill 列表')
    }
  }

  useEffect(() => { void refresh() }, [])

  const selectFiles = (selected: FileList | null, nextMode: UploadMode) => {
    const picked = Array.from(selected || [])
    if (!picked.length) return
    setMode(nextMode)
    setFiles(picked)
    setError('')
    setNotice('')
    if (nextMode === 'file') setName(picked[0].name.replace(/\.md$/i, ''))
    else setName(picked[0].webkitRelativePath?.split('/')[0] || picked[0].name)
  }

  const resetUpload = () => {
    setMode(null)
    setFiles([])
    setName('')
    setReplaceTarget(null)
    setError('')
    setNotice('')
  }

  const performUpload = async (replace = false) => {
    if (!name.trim() || !files.length) return
    setBusy(true)
    setError('')
    try {
      const payloadFiles = await Promise.all(files.map(async (file) => ({
        path: mode === 'folder' ? (file.webkitRelativePath || file.name) : file.name,
        content: await file.text(),
      })))
      const result = await uploadSkill({ name: name.trim(), files: payloadFiles, replace, id: replaceTarget?.id })
      setSkills((prev) => [result, ...prev.filter((item) => item.id !== result.id)])
      setNotice(`Skill「${result.name}」已保存`)
      resetUpload()
    } catch (e) {
      const typed = e as Error & { code?: string; existing?: SkillSummary }
      if (typed.code === 'SKILL_EXISTS' && typed.existing) setReplaceTarget(typed.existing)
      else setError(typed.message || 'Skill 保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (skill: SkillSummary) => {
    if (!window.confirm(`确定删除 Skill「${skill.name}」吗？`)) return
    try {
      await deleteSkill(skill.id)
      setSkills((prev) => prev.filter((item) => item.id !== skill.id))
      setNotice(`Skill「${skill.name}」已删除`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <PageShell>
      <AppHeader
        title="Skill 管理"
        eyebrow="生成规范与方法库"
        subtitle="上传团队 Skill，在用例生成时作为可选的设计约束和方法规范。"
        theme="violet"
        actions={<button type="button" onClick={() => setMode('folder')} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400">+ 上传 Skill</button>}
      />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <input ref={folderInputRef} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => selectFiles(event.target.files, 'folder')} />
        <input ref={fileInputRef} type="file" accept=".md,text/markdown" className="hidden" onChange={(event) => selectFiles(event.target.files, 'file')} />

        {(error || notice) && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}>{error || notice}</div>}

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs text-zinc-500">已保存 Skill</div><div className="mt-2 text-2xl font-semibold text-white">{skills.length}</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs text-zinc-500">包含 SKILL.md</div><div className="mt-2 text-2xl font-semibold text-teal-300">{skills.filter((item) => item.hasSkillMd).length}</div></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs text-zinc-500">使用方式</div><div className="mt-2 text-sm text-zinc-300">在生成页面选择并应用</div></div>
        </section>

        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center"><div className="text-lg font-medium text-white">还没有保存 Skill</div><div className="mt-2 text-sm text-zinc-500">上传单个 SKILL.md 或完整 Skill 文件夹开始建立方法库。</div><button type="button" onClick={() => setMode('folder')} className="mt-5 rounded-lg border border-violet-400/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-400/10">上传第一个 Skill</button></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {skills.map((skill) => <article key={skill.id} className="rounded-2xl border border-white/10 bg-[#171923] p-5 shadow-xl shadow-black/10"><div className="flex items-start justify-between gap-3"><Link to={`/skills/${encodeURIComponent(skill.id)}`} className="min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/60"><h2 className="truncate text-base font-semibold text-white hover:text-violet-200">{skill.name}</h2><p className="mt-1 text-xs text-zinc-500">更新于 {new Date(skill.updatedAt).toLocaleString()}</p></Link><span className={`rounded-full px-2 py-1 text-[10px] ${skill.hasSkillMd ? 'bg-teal-400/10 text-teal-200' : 'bg-amber-400/10 text-amber-200'}`}>{skill.hasSkillMd ? 'SKILL.md' : '无入口文件'}</span></div><div className="mt-5 flex items-center gap-4 text-xs text-zinc-400"><span>{skill.fileCount} 个文件</span><span>{formatBytes(skill.totalBytes)}</span></div><div className="mt-5 flex items-center justify-between"><Link to={`/skills/${encodeURIComponent(skill.id)}`} className="text-xs font-medium text-violet-300 hover:text-violet-200">浏览 Skill →</Link><button type="button" onClick={() => void remove(skill)} className="rounded-lg border border-rose-400/25 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10">删除</button></div></article>)}
          </div>
        )}
      </main>

      {mode && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"><div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#181a24] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold text-white">上传 Skill</h2><p className="mt-1 text-sm text-zinc-500">保留目录结构，保存到本机 Skill 方法库。</p></div><button type="button" onClick={resetUpload} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => folderInputRef.current?.click()} className={`rounded-xl border p-4 text-left ${mode === 'folder' ? 'border-violet-400 bg-violet-400/10' : 'border-white/10 bg-white/[0.02]'}`}><div className="font-medium text-white">上传整个文件夹</div><div className="mt-1 text-xs text-zinc-500">保留所有子目录和文件</div></button><button type="button" onClick={() => fileInputRef.current?.click()} className={`rounded-xl border p-4 text-left ${mode === 'file' ? 'border-violet-400 bg-violet-400/10' : 'border-white/10 bg-white/[0.02]'}`}><div className="font-medium text-white">上传单个 SKILL.md</div><div className="mt-1 text-xs text-zinc-500">适合只有一个入口文件的 Skill</div></button></div>{files.length > 0 && <div className="mt-5 space-y-4"><label className="block text-xs text-zinc-400">Skill 名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400" /></label><div className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">已选择 {files.length} 个文件，总大小 {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</div></div>}{replaceTarget && <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">Skill「{replaceTarget.name}」已存在，继续保存将替换现有版本。<div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void performUpload(true)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black">确认替换</button><button type="button" onClick={() => setReplaceTarget(null)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-300">取消</button></div></div>}{error && <div className="mt-4 text-sm text-rose-300">{error}</div>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={resetUpload} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-300">取消</button><button type="button" disabled={busy || !name.trim() || !files.length || Boolean(replaceTarget)} onClick={() => void performUpload(false)} className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? '保存中…' : '保存 Skill'}</button></div></div></div>}
    </PageShell>
  )
}

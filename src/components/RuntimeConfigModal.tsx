import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchLocalConfig, saveLocalConfig, type LocalConfig, type LocalConfigPayload } from '../api/localConfig'
import {
  deleteCustomProvider,
  discoverCustomProviderModels,
  fetchCustomProviders,
  saveCustomProvider,
  testCustomProvider,
  type CustomProviderConfig,
  type CustomProviderDraft,
} from '../api/llmProviders'
import { deleteRepo, fetchRagHealth, fetchRepos, saveRepo, type RepoConfig } from '../api/vcs'
import type { UseLlmProviderResult } from '../hooks/useLlmProvider'

type ConfigTab = 'repository' | 'model' | 'knowledge'

interface ProviderDraft {
  id: string
  label: string
  configured: boolean
  preview: string
  apiKey: string
  baseUrl: string
  model: string
  models: string
}

interface ConfigDraft {
  llmProvider: string
  apiPort: string
  lightRagUrl: string
  plasticCmPath: string
  methodologyPath: string
  knowledgeProvider: 'lightrag' | 'llm-wiki'
  llmWikiUrl: string
  llmWikiQueryPath: string
  llmWikiHealthPath: string
  llmWikiApiKey: string
  llmWikiApiKeyStatus: { configured: boolean; preview: string }
  providers: ProviderDraft[]
}

interface RuntimeConfigModalProps {
  open: boolean
  onClose: () => void
  llm: UseLlmProviderResult
  onSaved: () => void | Promise<void>
}

const inputClass = 'mt-1 block w-full rounded-md border border-white/10 bg-[#101117] px-3 py-2.5 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-violet-400/55 focus:bg-[#14151d] disabled:cursor-not-allowed disabled:opacity-55'
const secondaryButton = 'rounded-md border border-white/12 px-3 py-2 text-xs text-zinc-300 transition hover:border-violet-400/40 hover:bg-white/[0.04] hover:text-violet-100 disabled:opacity-40'

const emptyRepo = (): RepoConfig => ({ id: '', name: '', type: 'git', path: '', branch: '' })

function emptyCustomProvider(): CustomProviderDraft {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: '',
    enabled: true,
    apiMode: 'openai',
    endpoint: '',
    apiKey: '',
    model: '',
    models: [],
    contextWindow: 131072,
    streaming: true,
    customHeaders: '',
    timeoutMinutes: 30,
    reasoning: 'auto',
  }
}

function toDraft(config: LocalConfig): ConfigDraft {
  return {
    llmProvider: config.llmProvider,
    apiPort: config.apiPort,
    lightRagUrl: config.lightRagUrl,
    plasticCmPath: config.plasticCmPath,
    methodologyPath: config.methodologyPath,
    knowledgeProvider: config.knowledgeProvider,
    llmWikiUrl: config.llmWikiUrl,
    llmWikiQueryPath: config.llmWikiQueryPath,
    llmWikiHealthPath: config.llmWikiHealthPath,
    llmWikiApiKey: '',
    llmWikiApiKeyStatus: config.llmWikiApiKey,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.apiKey.configured,
      preview: provider.apiKey.preview,
      apiKey: '',
      baseUrl: provider.baseUrl,
      model: provider.model,
      models: provider.models,
    })),
  }
}

function toPayload(draft: ConfigDraft): LocalConfigPayload {
  return {
    llmProvider: draft.llmProvider,
    apiPort: draft.apiPort,
    lightRagUrl: draft.lightRagUrl,
    plasticCmPath: draft.plasticCmPath,
    methodologyPath: draft.methodologyPath,
    knowledgeProvider: draft.knowledgeProvider,
    llmWikiUrl: draft.llmWikiUrl,
    llmWikiQueryPath: draft.llmWikiQueryPath,
    llmWikiHealthPath: draft.llmWikiHealthPath,
    llmWikiApiKey: draft.llmWikiApiKey,
    providers: draft.providers.map(({ id, apiKey, baseUrl, model, models }) => ({ id, apiKey, baseUrl, model, models })),
  }
}

function toCustomDraft(provider: CustomProviderConfig): CustomProviderDraft {
  const status = typeof provider.apiKey === 'object' ? provider.apiKey : undefined
  const models = provider.models?.length ? [...provider.models] : provider.model ? [provider.model] : []
  return { ...provider, model: provider.model || models[0] || '', models, apiKey: '', apiKeyStatus: status }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-zinc-600">{hint}</span>}
    </label>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={['relative h-5 w-9 rounded-full border transition', checked ? 'border-violet-400/50 bg-violet-500' : 'border-white/15 bg-zinc-800'].join(' ')}>
      <span className={['absolute top-0.5 size-3.5 rounded-full bg-white transition', checked ? 'left-[18px]' : 'left-0.5'].join(' ')} />
    </button>
  )
}

export function RuntimeConfigModal({ open, onClose, llm, onSaved }: RuntimeConfigModalProps) {
  const [tab, setTab] = useState<ConfigTab>('repository')
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [repos, setRepos] = useState<RepoConfig[]>([])
  const [repoDraft, setRepoDraft] = useState<RepoConfig>(emptyRepo)
  const [activeRepoId, setActiveRepoId] = useState('')
  const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>([])
  const [customDraft, setCustomDraft] = useState<CustomProviderDraft | null>(null)
  const [modelSelection, setModelSelection] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [discoveringModels, setDiscoveringModels] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [manualModelId, setManualModelId] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [knowledgeStatus, setKnowledgeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle')

  const load = async () => {
    const [config, nextRepos, custom] = await Promise.all([fetchLocalConfig(), fetchRepos(), fetchCustomProviders()])
    const nextDraft = toDraft(config)
    setDraft(nextDraft)
    setRepos(nextRepos)
    const firstRepo = nextRepos[0]
    setActiveRepoId(firstRepo?.id ?? '')
    setRepoDraft(firstRepo ? { ...firstRepo } : emptyRepo())
    setCustomProviders(custom)
    const selectedCustom = custom.find((provider) => provider.id === config.llmProvider)
    const selectedCustomDraft = selectedCustom ? toCustomDraft(selectedCustom) : null
    setModelSelection(selectedCustom ? `custom:${selectedCustom.id}` : `builtin:${config.llmProvider}`)
    setCustomDraft(selectedCustomDraft)
    setDiscoveredModels(selectedCustomDraft?.models ?? [])
    setManualModelId('')
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setNotice(null)
    void load().catch((error) => {
      if (!cancelled) setNotice({ tone: 'error', text: error instanceof Error ? error.message : '读取配置失败' })
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, saving])

  const selectedBuiltin = useMemo(() => {
    const id = modelSelection.startsWith('builtin:') ? modelSelection.slice(8) : ''
    return draft?.providers.find((provider) => provider.id === id) ?? null
  }, [draft, modelSelection])

  const visibleModelIds = useMemo(() => {
    const ids = [...discoveredModels, ...(customDraft?.models ?? [])]
    return ids.filter((id, index) => id && ids.indexOf(id) === index)
  }, [customDraft?.models, discoveredModels])

  const chooseModel = (selection: string) => {
    setModelSelection(selection)
    setNotice(null)
    if (selection.startsWith('custom:')) {
      const provider = customProviders.find((item) => item.id === selection.slice(7))
      const next = provider ? toCustomDraft(provider) : null
      setCustomDraft(next)
      setDiscoveredModels(next?.models ?? [])
      setManualModelId('')
    } else {
      setCustomDraft(null)
      setDraft((current) => current ? { ...current, llmProvider: selection.slice(8) } : current)
    }
  }

  const updateBuiltin = (key: keyof ProviderDraft, value: string) => {
    if (!draft || !selectedBuiltin) return
    setDraft({ ...draft, providers: draft.providers.map((provider) => provider.id === selectedBuiltin.id ? { ...provider, [key]: value } : provider) })
  }

  const startNewProvider = () => {
    const next = emptyCustomProvider()
    setCustomDraft(next)
    setModelSelection(`custom:${next.id}`)
    setDiscoveredModels([])
    setManualModelId('')
    setNotice(null)
  }

  const updateCustomModels = (models: string[]) => {
    if (!customDraft) return
    const unique = models.map((model) => model.trim()).filter((model, index, all) => model && all.indexOf(model) === index)
    setCustomDraft({ ...customDraft, models: unique, model: unique[0] || '' })
  }

  const toggleCustomModel = (model: string) => {
    if (!customDraft) return
    updateCustomModels(customDraft.models.includes(model)
      ? customDraft.models.filter((item) => item !== model)
      : [...customDraft.models, model])
  }

  const addManualModels = () => {
    if (!customDraft) return
    const additions = manualModelId.split(/[,，;；\n]+/).map((model) => model.trim()).filter(Boolean)
    if (!additions.length) return
    updateCustomModels([...customDraft.models, ...additions])
    setDiscoveredModels((current) => [...current, ...additions].filter((model, index, all) => all.indexOf(model) === index))
    setManualModelId('')
  }

  const validateCustomProvider = () => {
    if (!customDraft) return
    if (!customDraft.name.trim()) throw new Error('请填写供应商名称。')
    if (!customDraft.endpoint.trim()) throw new Error('请填写供应商 URL。')
    if (!customDraft.apiKey.trim() && !customDraft.apiKeyStatus?.configured) throw new Error('请填写 API Key。')
  }

  const handleDiscoverModels = async () => {
    if (!customDraft) return
    setNotice(null)
    try {
      if (!customDraft.endpoint.trim()) throw new Error('请先填写供应商 URL。')
      if (!customDraft.apiKey.trim() && !customDraft.apiKeyStatus?.configured) throw new Error('请先填写 API Key。')
      setDiscoveringModels(true)
      const models = await discoverCustomProviderModels(customDraft)
      const uniqueModels = models.filter((model, index) => model && models.indexOf(model) === index)
      setDiscoveredModels(uniqueModels)
      setNotice(uniqueModels.length
        ? { tone: 'success', text: `已获取 ${uniqueModels.length} 个模型，请选择需要保存的模型。` }
        : { tone: 'error', text: '接口连接成功，但没有返回可用的模型 ID。' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '获取模型失败' })
    } finally {
      setDiscoveringModels(false)
    }
  }

  const validateRepo = () => {
    if (!repoDraft.id.trim() || !repoDraft.path.trim()) throw new Error('仓库标识和本地路径不能为空。')
    if (!/^[A-Za-z0-9_-]+$/.test(repoDraft.id)) throw new Error('仓库标识仅支持字母、数字、短横线和下划线。')
  }

  const saveCurrentRepo = async () => {
    validateRepo()
    const saved = await saveRepo({ ...repoDraft, id: repoDraft.id.trim(), name: repoDraft.name.trim() || repoDraft.id.trim(), path: repoDraft.path.trim(), branch: repoDraft.branch?.trim() || '' })
    setRepos((current) => current.some((repo) => repo.id === saved.id) ? current.map((repo) => repo.id === saved.id ? saved : repo) : [...current, saved])
    setActiveRepoId(saved.id)
    setRepoDraft(saved)
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setNotice(null)
    try {
      validateCustomProvider()
      const selectedId = modelSelection.replace(/^(builtin|custom):/, '')
      const nextDraft = { ...draft, llmProvider: selectedId }
      await saveLocalConfig(toPayload(nextDraft))
      setDraft(nextDraft)
      if (repoDraft.id.trim() || repoDraft.path.trim()) await saveCurrentRepo()
      if (customDraft) {
        const saved = await saveCustomProvider(customDraft)
        setCustomProviders((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
        setCustomDraft(toCustomDraft(saved))
      }
      llm.setProvider(selectedId)
      await llm.refresh()
      await onSaved()
      setNotice({ tone: 'success', text: '配置已保存并生效。' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存配置失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRepo = async () => {
    if (!activeRepoId || !window.confirm(`删除仓库配置“${repoDraft.name || activeRepoId}”？`)) return
    try {
      await deleteRepo(activeRepoId)
      const next = repos.filter((repo) => repo.id !== activeRepoId)
      setRepos(next)
      const first = next[0]
      setActiveRepoId(first?.id ?? '')
      setRepoDraft(first ? { ...first } : emptyRepo())
      setNotice({ tone: 'success', text: '仓库配置已删除。' })
      await onSaved()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '删除仓库失败' })
    }
  }

  const handleDeleteProvider = async () => {
    if (!customDraft || !window.confirm(`删除 Provider“${customDraft.name}”？`)) return
    try {
      await deleteCustomProvider(customDraft.id)
      const next = customProviders.filter((provider) => provider.id !== customDraft.id)
      setCustomProviders(next)
      chooseModel(`builtin:${draft?.providers[0]?.id || 'openai'}`)
      setNotice({ tone: 'success', text: '自定义 Provider 已删除。' })
      await llm.refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '删除 Provider 失败' })
    }
  }

  const handleTestProvider = async () => {
    if (!customDraft) return
    setTesting(true)
    try {
      const saved = await saveCustomProvider(customDraft)
      setCustomDraft(toCustomDraft(saved))
      const result = await testCustomProvider(saved.id)
      setNotice({ tone: 'success', text: `连接成功 · ${result.model} · ${result.latencyMs} ms` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '连接测试失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleKnowledgeCheck = async () => {
    if (!draft) return
    setKnowledgeStatus('checking')
    const isWiki = draft.knowledgeProvider === 'llm-wiki'
    const result = await fetchRagHealth({
      provider: draft.knowledgeProvider,
      url: isWiki ? draft.llmWikiUrl : draft.lightRagUrl,
      queryPath: isWiki ? draft.llmWikiQueryPath : undefined,
      healthPath: isWiki ? draft.llmWikiHealthPath : undefined,
      apiKey: isWiki ? draft.llmWikiApiKey : undefined,
    })
    setKnowledgeStatus(result.ok ? 'online' : 'offline')
    setNotice(result.ok ? { tone: 'success', text: `${isWiki ? 'llm-wiki' : 'LightRAG'} 连接可用。` } : { tone: 'error', text: result.error || '知识库连接失败。' })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="runtime-config-title" className="flex max-h-[94vh] min-h-[640px] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/12 bg-[#181925] shadow-2xl shadow-black/70">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div><p className="text-[11px] font-medium text-violet-300/75">运行环境</p><h2 id="runtime-config-title" className="mt-1 text-base font-semibold text-white">生成配置</h2></div>
          <button type="button" onClick={onClose} disabled={saving} className="grid size-8 place-items-center rounded-md border border-white/10 text-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200" aria-label="关闭配置弹窗" title="关闭">×</button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-white/10 px-5 pt-3" aria-label="配置分类">
          {([['repository', '代码仓库'], ['model', 'LLM 模型'], ['knowledge', '知识库']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setNotice(null) }} className={['border-b-2 px-3 pb-3 pt-1 text-xs font-medium transition', tab === id ? 'border-violet-400 text-violet-200' : 'border-transparent text-zinc-500 hover:text-zinc-300'].join(' ')}>{label}</button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <p className="py-20 text-center text-sm text-zinc-500">正在读取本地配置…</p>}
          {!loading && !draft && <p className="py-20 text-center text-sm text-rose-300">无法读取配置，请确认 API 服务已启动。</p>}

          {!loading && draft && tab === 'repository' && (
            <div className="grid min-h-full md:grid-cols-[260px_1fr]" data-testid="runtime-repository-tab">
              <aside className="border-b border-white/10 bg-black/10 p-4 md:border-b-0 md:border-r">
                <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-300">仓库配置</span><button type="button" onClick={() => { setActiveRepoId(''); setRepoDraft(emptyRepo()) }} className={secondaryButton}>新增</button></div>
                <div className="space-y-2">
                  {repos.map((repo) => <button key={repo.id} type="button" onClick={() => { setActiveRepoId(repo.id); setRepoDraft({ ...repo }); setNotice(null) }} className={['w-full rounded-md border p-3 text-left transition', activeRepoId === repo.id ? 'border-violet-400/45 bg-violet-400/10' : 'border-white/8 bg-white/[0.02] hover:border-white/18'].join(' ')}><span className="block truncate text-xs font-medium text-zinc-200">{repo.name}</span><span className="mt-1 block truncate text-[10px] text-zinc-600">{repo.path}</span><span className="mt-2 inline-block text-[9px] uppercase text-zinc-500">{repo.type}</span></button>)}
                  {repos.length === 0 && <p className="rounded-md border border-dashed border-white/10 p-4 text-center text-xs text-zinc-600">暂无仓库</p>}
                </div>
              </aside>
              <div className="p-5 sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{activeRepoId ? '编辑仓库' : '新增仓库'}</h3><p className="mt-1 text-xs text-zinc-600">代码关联将从这些本地目录读取源码。</p></div>{activeRepoId && <button type="button" onClick={() => void handleDeleteRepo()} className="rounded-md border border-rose-400/20 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10" data-testid="delete-repo">删除</button>}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="仓库名称"><input value={repoDraft.name} onChange={(event) => setRepoDraft({ ...repoDraft, name: event.target.value })} className={inputClass} placeholder="例如：客户端" /></Field>
                  <Field label="仓库标识" hint="已有仓库的标识不可修改。"><input value={repoDraft.id} onChange={(event) => setRepoDraft({ ...repoDraft, id: event.target.value })} className={inputClass} placeholder="client" disabled={Boolean(activeRepoId)} /></Field>
                  <Field label="版本控制"><select value={repoDraft.type} onChange={(event) => setRepoDraft({ ...repoDraft, type: event.target.value as RepoConfig['type'] })} className={inputClass}><option value="git">Git</option><option value="plastic">Plastic SCM</option></select></Field>
                  <Field label="默认分支" hint="留空时使用仓库当前分支。"><input value={repoDraft.branch || ''} onChange={(event) => setRepoDraft({ ...repoDraft, branch: event.target.value })} className={inputClass} placeholder="main" /></Field>
                  <div className="sm:col-span-2"><Field label="本地仓库路径" hint="填写运行 API 的电脑上可访问的绝对路径。"><input value={repoDraft.path} onChange={(event) => setRepoDraft({ ...repoDraft, path: event.target.value })} className={inputClass} placeholder="F:\\workspace\\project" data-testid="repo-path-input" /></Field></div>
                </div>
              </div>
            </div>
          )}

          {!loading && draft && tab === 'model' && (
            <div className="grid min-h-full md:grid-cols-[280px_1fr]" data-testid="runtime-model-tab">
              <aside className="max-h-52 overflow-y-auto border-b border-white/10 bg-black/10 p-4 md:max-h-none md:overflow-visible md:border-b-0 md:border-r">
                <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-300">Provider</span><button type="button" onClick={startNewProvider} className={secondaryButton} data-testid="add-provider">新增</button></div>
                <p className="mb-2 text-[10px] font-medium uppercase text-zinc-600">内置通道</p>
                <div className="space-y-1">{draft.providers.map((provider) => <button key={provider.id} type="button" onClick={() => chooseModel(`builtin:${provider.id}`)} className={['flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition', modelSelection === `builtin:${provider.id}` ? 'border-violet-400/45 bg-violet-400/10 text-violet-100' : 'border-transparent text-zinc-400 hover:bg-white/[0.04]'].join(' ')}><span className="truncate">{provider.label}</span><span className={['size-1.5 rounded-full', provider.configured ? 'bg-emerald-400' : 'bg-zinc-700'].join(' ')} /></button>)}</div>
                <p className="mb-2 mt-5 text-[10px] font-medium uppercase text-zinc-600">自定义 Provider</p>
                <div className="space-y-1">{customProviders.map((provider) => <button key={provider.id} type="button" onClick={() => chooseModel(`custom:${provider.id}`)} className={['flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition', modelSelection === `custom:${provider.id}` ? 'border-violet-400/45 bg-violet-400/10 text-violet-100' : 'border-transparent text-zinc-400 hover:bg-white/[0.04]'].join(' ')}><span className="truncate">{provider.name}</span><span className={['size-1.5 rounded-full', provider.enabled ? 'bg-emerald-400' : 'bg-zinc-700'].join(' ')} /></button>)}</div>
              </aside>

              <div className="p-5 sm:p-6">
                {selectedBuiltin && <div className="space-y-5"><div><h3 className="text-sm font-semibold text-white">{selectedBuiltin.label}</h3><p className="mt-1 text-xs text-zinc-600">内置 Provider 使用项目 `.env` 管理。</p></div><Field label="API Key" hint={selectedBuiltin.configured ? `当前：${selectedBuiltin.preview}；留空保持已有密钥。` : '尚未配置'}><input type="password" value={selectedBuiltin.apiKey} onChange={(event) => updateBuiltin('apiKey', event.target.value)} className={inputClass} placeholder="输入 API Key" /></Field>{selectedBuiltin.id !== 'gemini' && <Field label="Endpoint"><input value={selectedBuiltin.baseUrl} onChange={(event) => updateBuiltin('baseUrl', event.target.value)} className={inputClass} /></Field>}<div className="grid gap-4 sm:grid-cols-2"><Field label="默认模型"><input value={selectedBuiltin.model} onChange={(event) => updateBuiltin('model', event.target.value)} className={inputClass} /></Field><Field label="可选模型" hint="逗号或空格分隔。"><input value={selectedBuiltin.models} onChange={(event) => updateBuiltin('models', event.target.value)} className={inputClass} /></Field></div></div>}

                {customDraft && <div className="space-y-5" data-testid="custom-provider-editor">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-white">自定义供应商</h3>{customProviders.some((item) => item.id === customDraft.id) && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">已保存</span>}</div>
                      <p className="mt-1 text-xs text-zinc-600">填写连接信息后，可自动读取供应商支持的模型。</p>
                    </div>
                    <Toggle checked={customDraft.enabled} onChange={(enabled) => setCustomDraft({ ...customDraft, enabled })} label="启用供应商" />
                  </div>

                  <Field label="供应商名称 *"><input required value={customDraft.name} onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })} className={inputClass} placeholder="例如：公司模型网关" /></Field>
                  <Field label="供应商 URL *" hint="填写 API 基础地址；获取模型时会自动请求 /models。"><input required type="url" value={customDraft.endpoint} onChange={(event) => setCustomDraft({ ...customDraft, endpoint: event.target.value })} className={inputClass} placeholder="https://api.example.com/v1" /></Field>
                  <Field label="API Key *" hint={customDraft.apiKeyStatus?.configured ? `当前：${customDraft.apiKeyStatus.preview}；留空保持已有密钥。` : undefined}><input required={!customDraft.apiKeyStatus?.configured} type="password" value={customDraft.apiKey} onChange={(event) => setCustomDraft({ ...customDraft, apiKey: event.target.value })} className={inputClass} placeholder={customDraft.apiKeyStatus?.configured ? '留空保持当前密钥' : '输入 API Key'} /></Field>

                  <section className="border-y border-white/8 py-5" aria-labelledby="custom-provider-models-title">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div><h4 id="custom-provider-models-title" className="text-xs font-semibold text-zinc-200">模型 ID <span className="font-normal text-zinc-600">（可选）</span></h4><p className="mt-1 text-[11px] text-zinc-600">可自动获取或手动添加，支持选择多个；首个已选模型作为默认模型。</p></div>
                      <button type="button" onClick={() => void handleDiscoverModels()} disabled={discoveringModels} className={secondaryButton} data-testid="discover-provider-models">{discoveringModels ? '获取中…' : '自动获取模型'}</button>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <input value={manualModelId} onChange={(event) => setManualModelId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManualModels() } }} className={`${inputClass} mt-0`} placeholder="手动输入模型 ID，多个用逗号分隔" aria-label="手动模型 ID" />
                      <button type="button" onClick={addManualModels} disabled={!manualModelId.trim()} className={secondaryButton}>添加</button>
                    </div>

                    {visibleModelIds.length > 0 ? <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500"><span>已选 {customDraft.models.length} / {visibleModelIds.length}</span><div className="flex gap-3"><button type="button" onClick={() => updateCustomModels(visibleModelIds)} className="text-violet-300 hover:text-violet-200">全选</button><button type="button" onClick={() => updateCustomModels([])} className="text-zinc-500 hover:text-zinc-300">清空</button></div></div>
                      <div className="grid max-h-56 gap-1 overflow-y-auto border-t border-white/8 pt-2 sm:grid-cols-2" data-testid="provider-model-list">
                        {visibleModelIds.map((model) => <label key={model} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs text-zinc-300 hover:bg-white/[0.04]"><input type="checkbox" checked={customDraft.models.includes(model)} onChange={() => toggleCustomModel(model)} className="size-3.5 accent-violet-500" /><span className="truncate" title={model}>{model}</span>{customDraft.model === model && <span className="ml-auto shrink-0 text-[9px] text-violet-300">默认</span>}</label>)}
                      </div>
                    </div> : <p className="mt-4 border-t border-dashed border-white/10 pt-4 text-center text-[11px] text-zinc-600">尚未添加模型 ID</p>}
                  </section>

                  <details className="border-b border-white/8 pb-5">
                    <summary className="cursor-pointer select-none text-xs font-medium text-zinc-400 hover:text-zinc-200">高级选项</summary>
                    <div className="mt-5 space-y-5">
                      <Field label="API 模式"><div className="mt-1 inline-flex rounded-md border border-white/10 bg-black/20 p-1">{(['openai', 'anthropic'] as const).map((mode) => <button key={mode} type="button" onClick={() => setCustomDraft({ ...customDraft, apiMode: mode })} className={['rounded px-3 py-1.5 text-xs transition', customDraft.apiMode === mode ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'].join(' ')}>{mode === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'}</button>)}</div></Field>
                      <Field label="上下文窗口" hint={`${Math.round(customDraft.contextWindow / 1024)}K tokens`}><input type="range" min="4096" max="1048576" step="4096" value={customDraft.contextWindow} onChange={(event) => setCustomDraft({ ...customDraft, contextWindow: Number(event.target.value) })} className="mt-3 h-1.5 w-full accent-violet-500" /><div className="mt-1 flex justify-between text-[9px] text-zinc-700"><span>4K</span><span>128K</span><span>256K</span><span>512K</span><span>1M</span></div></Field>
                      <div className="flex items-center justify-between border-y border-white/8 py-3"><div><p className="text-xs font-medium text-zinc-300">启用流式输出</p><p className="mt-1 text-[11px] text-zinc-600">生成内容逐步显示。</p></div><Toggle checked={customDraft.streaming} onChange={(streaming) => setCustomDraft({ ...customDraft, streaming })} label="启用流式输出" /></div>
                      <Field label="自定义请求头" hint="每行一条 Header-Name: value。"><textarea rows={3} value={customDraft.customHeaders} onChange={(event) => setCustomDraft({ ...customDraft, customHeaders: event.target.value })} className={inputClass} placeholder="X-Tenant-ID: team-a" /></Field>
                      <div className="grid gap-4 sm:grid-cols-2"><Field label="请求超时时间（分钟）"><input type="number" min="1" max="120" value={customDraft.timeoutMinutes} onChange={(event) => setCustomDraft({ ...customDraft, timeoutMinutes: Number(event.target.value) })} className={inputClass} /></Field><Field label="Reasoning / thinking"><select value={customDraft.reasoning} onChange={(event) => setCustomDraft({ ...customDraft, reasoning: event.target.value as CustomProviderDraft['reasoning'] })} className={inputClass}><option value="auto">自动</option><option value="on">开启</option><option value="off">关闭</option></select></Field></div>
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => void handleTestProvider()} disabled={testing || !customDraft.model.trim()} className={secondaryButton} data-testid="test-provider">{testing ? '测试中…' : '测试连接'}</button>{customProviders.some((item) => item.id === customDraft.id) && <button type="button" onClick={() => void handleDeleteProvider()} className="rounded-md border border-rose-400/20 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10" data-testid="delete-provider">删除自定义供应商</button>}</div>
                </div>}
              </div>
            </div>
          )}

          {!loading && draft && tab === 'knowledge' && (
            <div className="mx-auto max-w-2xl space-y-6 p-5 sm:p-7" data-testid="runtime-knowledge-tab">
              <div><h3 className="text-sm font-semibold text-white">知识库连接</h3><p className="mt-1 text-xs leading-relaxed text-zinc-600">生成时检索外部知识上下文。llm-wiki 使用本地 HTTP API，只读取，不从本平台写入。</p></div>
              <Field label="连接器"><div className="mt-2 grid grid-cols-2 gap-2">{([['lightrag', 'LightRAG'], ['llm-wiki', '本地 llm-wiki']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => { setDraft({ ...draft, knowledgeProvider: id }); setKnowledgeStatus('idle') }} className={['rounded-md border px-3 py-3 text-left text-xs transition', draft.knowledgeProvider === id ? 'border-teal-400/40 bg-teal-400/10 text-teal-100' : 'border-white/10 text-zinc-500 hover:border-white/20'].join(' ')}>{label}</button>)}</div></Field>
              {draft.knowledgeProvider === 'lightrag' ? <Field label="LightRAG 服务地址"><input value={draft.lightRagUrl} onChange={(event) => setDraft({ ...draft, lightRagUrl: event.target.value })} className={inputClass} placeholder="http://127.0.0.1:6002" /></Field> : <div className="space-y-4"><Field label="llm-wiki 本地地址"><input value={draft.llmWikiUrl} onChange={(event) => setDraft({ ...draft, llmWikiUrl: event.target.value })} className={inputClass} placeholder="http://127.0.0.1:3000" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="查询 API 路径"><input value={draft.llmWikiQueryPath} onChange={(event) => setDraft({ ...draft, llmWikiQueryPath: event.target.value })} className={inputClass} placeholder="/api/search" /></Field><Field label="健康检查路径"><input value={draft.llmWikiHealthPath} onChange={(event) => setDraft({ ...draft, llmWikiHealthPath: event.target.value })} className={inputClass} placeholder="/api/health" /></Field></div><Field label="访问令牌" hint={draft.llmWikiApiKeyStatus.configured ? `当前：${draft.llmWikiApiKeyStatus.preview}；留空保持已有令牌。` : '本地服务无需鉴权时可留空。'}><input type="password" value={draft.llmWikiApiKey} onChange={(event) => setDraft({ ...draft, llmWikiApiKey: event.target.value })} className={inputClass} /></Field></div>}
              <div className="flex items-center gap-3 border-t border-white/8 pt-5"><button type="button" onClick={() => void handleKnowledgeCheck()} disabled={knowledgeStatus === 'checking'} className={secondaryButton} data-testid="test-knowledge">{knowledgeStatus === 'checking' ? '检测中…' : '检测连接'}</button>{knowledgeStatus === 'online' && <span className="text-xs text-emerald-300">服务可用</span>}{knowledgeStatus === 'offline' && <span className="text-xs text-rose-300">连接失败</span>}</div>
              <Field label="测试方法论文件" hint="本地规则文件仍可与外部知识库同时使用。"><input value={draft.methodologyPath} onChange={(event) => setDraft({ ...draft, methodologyPath: event.target.value })} className={inputClass} /></Field>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/15 px-5 py-4"><div className="min-h-5 text-xs" role="status">{notice && <span className={notice.tone === 'error' ? 'text-rose-300' : 'text-emerald-300'}>{notice.text}</span>}</div><div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>取消</button><button type="button" onClick={() => void handleSave()} disabled={saving || loading || !draft} className="rounded-md bg-violet-500 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-40" data-testid="save-runtime-config">{saving ? '保存中…' : '保存配置'}</button></div></footer>
      </section>
    </div>
  )
}

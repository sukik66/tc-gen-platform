import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { PageShell } from '../components/PageShell'
import {
  createLocalConfig,
  fetchLocalConfig,
  saveLocalConfig,
  type LocalConfig,
  type LocalConfigPayload,
} from '../api/localConfig'

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
  providers: ProviderDraft[]
}

function toDraft(config: LocalConfig): ConfigDraft {
  return {
    llmProvider: config.llmProvider,
    apiPort: config.apiPort,
    lightRagUrl: config.lightRagUrl,
    plasticCmPath: config.plasticCmPath,
    methodologyPath: config.methodologyPath,
    providers: config.providers.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.apiKey.configured,
      preview: p.apiKey.preview,
      apiKey: '',
      baseUrl: p.baseUrl,
      model: p.model,
      models: p.models,
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
    providers: draft.providers.map(({ id, apiKey, baseUrl, model, models }) => ({ id, apiKey, baseUrl, model, models })),
  }
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

const inputClass = 'mt-1 block w-full rounded-lg border border-white/10 bg-[#11121a] px-3 py-2 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-teal-400/50 focus:bg-[#151722]'

export function SettingsPage() {
  const [config, setConfig] = useState<LocalConfig | null>(null)
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const next = await fetchLocalConfig()
      setConfig(next)
      setDraft(toDraft(next))
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '本地 API 未连接' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const configuredCount = useMemo(
    () => draft?.providers.filter((p) => p.configured || p.apiKey.trim()).length ?? 0,
    [draft],
  )

  const handleCreate = async () => {
    setBusy(true)
    try {
      const next = await createLocalConfig()
      setConfig(next)
      setDraft(toDraft(next))
      setNotice({ tone: 'success', text: '已创建本地 .env 配置文件，可以开始填写。' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '创建配置失败' })
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const next = await saveLocalConfig(toPayload(draft))
      setConfig(next)
      setDraft(toDraft(next))
      setNotice({ tone: 'success', text: '配置已保存。模型与知识库设置已生效；API 端口变更需重启服务。' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存配置失败' })
    } finally {
      setBusy(false)
    }
  }

  const updateProvider = (id: string, key: keyof ProviderDraft, value: string) => {
    setDraft((current) => current && ({
      ...current,
      providers: current.providers.map((p) => p.id === id ? { ...p, [key]: value } : p),
    }))
  }

  return (
    <PageShell>
      <AppHeader
        title="本地配置"
        eyebrow="运行环境"
        subtitle="配置保存在项目根目录的 .env 文件，不会回传或持久化到浏览器。"
        theme="teal"
        back={{ to: '/', label: '← 功能目录' }}
        maxWidth="max-w-6xl"
        actions={<Link to="/generation" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 transition hover:border-teal-400/40 hover:text-teal-200">返回生成</Link>}
      />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {loading && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">正在读取本地配置…</div>}
        {!loading && !draft && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-5">
            <p className="text-sm text-rose-100">{notice?.text || '无法连接本地 API。'}</p>
            <button type="button" onClick={() => void load()} className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-300 hover:border-white/30">重试</button>
          </div>
        )}

        {!loading && draft && config && (
          <>
            <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-teal-400/20 bg-[linear-gradient(130deg,rgba(20,184,166,.12),rgba(17,18,26,.96)_55%)] p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-300/80">LOCAL RUNTIME</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">让副本拥有自己的运行边界</h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">LLM 密钥只写入本机配置文件。保存后重启 API，页面会自动读取新的通道状态。</p>
                  </div>
                  <span className="rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-xs text-teal-200">{configuredCount} 个通道已配置</span>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-zinc-600">配置文件</p>
                    <p className="mt-1 break-all text-xs text-zinc-300" data-testid="config-path">{config.path}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-zinc-600">方法论文件</p>
                    <p className={['mt-1 break-all text-xs', config.methodologyExists ? 'text-emerald-300' : 'text-amber-300'].join(' ')}>{config.methodologyExists ? '已找到：' : '缺失：'}{config.methodologyPath}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#171823] p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">FILE ACTIONS</p>
                <h2 className="mt-2 text-base font-semibold text-zinc-100">本地文件操作</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{config.exists ? '配置文件已存在，页面保存会更新允许管理的配置项。' : '尚未创建 .env，先创建模板再保存页面配置。'}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {!config.exists && <button type="button" onClick={() => void handleCreate()} disabled={busy} className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-semibold text-[#06211d] transition hover:bg-teal-300 disabled:opacity-50" data-testid="create-config">创建本地 .env</button>}
                  <button type="button" onClick={() => void handleSave()} disabled={busy} className="rounded-lg border border-teal-400/30 px-3 py-2 text-xs font-semibold text-teal-200 transition hover:bg-teal-400/10 disabled:opacity-50" data-testid="save-config">{busy ? '保存中…' : '保存页面配置'}</button>
                </div>
                {notice && <p className={['mt-4 text-xs leading-relaxed', notice.tone === 'error' ? 'text-rose-300' : 'text-emerald-300'].join(' ')} role="status">{notice.text}</p>}
              </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-2xl border border-white/10 bg-[#171823] p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/70">RUNTIME DEFAULTS</p>
                <h2 className="mt-2 text-base font-semibold text-zinc-100">服务与路径</h2>
                <div className="mt-5 space-y-4">
                  <Field label="默认 LLM 通道" hint="页面生成时的默认通道；页面也可以临时切换。">
                    <select value={draft.llmProvider} onChange={(e) => setDraft({ ...draft, llmProvider: e.target.value })} className={inputClass}>
                      {draft.providers.map((p) => <option key={p.id} value={p.id}>{p.label}（{p.id}）</option>)}
                    </select>
                  </Field>
                  <Field label="API 端口" hint="修改后需要重启 API，同时确保 Vite 代理读取同一个 .env。">
                    <input value={draft.apiPort} onChange={(e) => setDraft({ ...draft, apiPort: e.target.value })} className={inputClass} inputMode="numeric" />
                  </Field>
                  <Field label="LightRAG 地址" hint="没有 LightRAG 时可保留默认值；只使用普通生成不会受影响。">
                    <input value={draft.lightRagUrl} onChange={(e) => setDraft({ ...draft, lightRagUrl: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Plastic SCM cm.exe 路径" hint="仅 Plastic 类型仓库需要；Git 仓库不依赖此项。">
                    <input value={draft.plasticCmPath} onChange={(e) => setDraft({ ...draft, plasticCmPath: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="方法论文件路径" hint="支持项目相对路径或绝对路径；默认使用项目内 knowledge/参考 文件。">
                    <input value={draft.methodologyPath} onChange={(e) => setDraft({ ...draft, methodologyPath: e.target.value })} className={inputClass} />
                  </Field>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#171823] p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/70">MODEL CHANNELS</p>
                    <h2 className="mt-2 text-base font-semibold text-zinc-100">模型通道</h2>
                  </div>
                  <p className="text-xs text-zinc-600">密钥留空 = 保持已有值</p>
                </div>
                <div className="mt-5 space-y-3">
                  {draft.providers.map((provider) => (
                    <details key={provider.id} open={provider.id === draft.llmProvider} className="group rounded-xl border border-white/10 bg-black/10 p-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-200">
                        <span className="flex items-center gap-2"><span className={['h-2 w-2 rounded-full', provider.configured ? 'bg-emerald-400' : 'bg-zinc-600'].join(' ')} />{provider.label}<span className="text-xs text-zinc-600">{provider.id}</span></span>
                        <span className="text-xs text-zinc-600 transition group-open:rotate-180">⌄</span>
                      </summary>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="API Key" hint={provider.configured ? `当前：${provider.preview}` : '尚未配置'}>
                          <input type="password" value={provider.apiKey} onChange={(e) => updateProvider(provider.id, 'apiKey', e.target.value)} className={inputClass} placeholder={provider.configured ? '留空保持已有密钥' : '粘贴 API Key'} autoComplete="new-password" />
                        </Field>
                        <Field label="默认模型">
                          <input value={provider.model} onChange={(e) => updateProvider(provider.id, 'model', e.target.value)} className={inputClass} placeholder="例如 gpt-5.4" />
                        </Field>
                        {provider.id !== 'gemini' && <Field label="Base URL">
                          <input value={provider.baseUrl} onChange={(e) => updateProvider(provider.id, 'baseUrl', e.target.value)} className={inputClass} />
                        </Field>}
                        <Field label="可选模型列表" hint="逗号或空格分隔；页面下拉会展示多个模型。">
                          <input value={provider.models} onChange={(e) => updateProvider(provider.id, 'models', e.target.value)} className={inputClass} placeholder="model-a,model-b" />
                        </Field>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </PageShell>
  )
}

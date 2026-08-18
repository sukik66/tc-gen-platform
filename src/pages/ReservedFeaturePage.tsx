import { Navigate, useLocation } from 'react-router-dom'
import { FEATURE_CATALOG } from '../featureCatalog'
import { PageShell } from '../components/PageShell'
import { AppHeader } from '../components/AppHeader'

export function ReservedFeaturePage() {
  const { pathname } = useLocation()
  const item = FEATURE_CATALOG.find((f) => f.path === pathname)

  if (!item) {
    return <Navigate to="/" replace />
  }

  return (
    <PageShell>
      <AppHeader
        title={item.title}
        theme="violet"
        maxWidth="max-w-3xl"
        actions={
          <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 text-[10px] text-zinc-400">
            预留 · 暂停推进
          </span>
        }
      />

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#1a1b2e]/80 p-6">
          <p className="text-sm leading-relaxed text-zinc-400">{item.blurb}</p>
          {item.pausedNote && (
            <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-zinc-500">
              {item.pausedNote}
            </p>
          )}
          <p className="mt-6 text-xs text-zinc-600">
            当前阶段请优先使用「测试用例生成」独立模块；平台能力将按持续集成节奏逐步接入。
          </p>
        </div>
      </main>
    </PageShell>
  )
}

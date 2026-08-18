import { Link } from 'react-router-dom'
import { APP_TIMEZONE } from '../constants'
import { FEATURE_CATALOG } from '../featureCatalog'
import { PageShell } from '../components/PageShell'

export function HomePage() {
  return (
    <PageShell>
      <header className="border-b border-white/10 bg-[#14151f]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-violet-400/90">
              持续集成 · AI 原生测试平台
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">功能目录</h1>
            <p className="mt-1 text-sm text-zinc-500">
              首期聚焦「测试用例生成」；另提供「质量契约（草稿）」实验入口（服务端 JSON 持久化，不影响生成）。时区 {APP_TIMEZONE}（GMT+8）
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            系统运行中
          </span>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-teal-400/40 hover:text-teal-200"
            data-testid="settings-entry"
          >
            <span aria-hidden="true">⚙</span>
            本地配置
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURE_CATALOG.map((f) => {
            const isLive = f.status === 'available'
            return (
              <Link
                key={f.path}
                to={f.path}
                className={[
                  'group relative overflow-hidden rounded-2xl border p-5 transition',
                  isLive
                    ? 'border-violet-500/35 bg-gradient-to-br from-violet-500/10 to-transparent hover:border-violet-400/50 hover:shadow-lg hover:shadow-violet-900/20'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-white">{f.title}</h2>
                  <span
                    className={[
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      isLive
                        ? 'bg-violet-500/25 text-violet-100'
                        : 'bg-zinc-500/20 text-zinc-400',
                    ].join(' ')}
                  >
                    {isLive ? '可用' : '预留'}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{f.blurb}</p>
                <span
                  className={[
                    'mt-4 inline-flex items-center text-xs font-medium',
                    isLive ? 'text-violet-300 group-hover:text-violet-200' : 'text-zinc-500',
                  ].join(' ')}
                >
                  {isLive ? '进入模块 →' : '查看说明 →'}
                </span>
              </Link>
            )
          })}
        </div>
      </main>
    </PageShell>
  )
}

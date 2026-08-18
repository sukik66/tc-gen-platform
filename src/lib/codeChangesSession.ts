import type { CodeContextPayload } from '../api/vcs'

const KEY = 'ai-test-platform:sidebar-code-changes:v2'

export function loadCodeChangesFromSession(): CodeContextPayload | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as CodeContextPayload
    if (!p?.mode || !Array.isArray(p.repos) || p.repos.length === 0) return null
    return p
  } catch {
    return null
  }
}

export function saveCodeChangesToSession(v: CodeContextPayload | null) {
  try {
    if (v == null || !v.repos?.length) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* quota 等忽略 */
  }
}

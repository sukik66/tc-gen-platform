/**
 * Cursor 调试会话 NDJSON 追加（写入仓库根 debug-0083ad.log）
 * 仅开发排障用；勿记录密钥与全文文档。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_DEBUG_LOG = path.resolve(__dirname, '..', 'data', 'debug-0083ad.log')

/** @param {Record<string, unknown>} payload */
export function agentSessionDebugLog(payload) {
  const line =
    JSON.stringify({
      sessionId: '0083ad',
      timestamp: Date.now(),
      ...payload,
    }) + '\n'
  try {
    fs.appendFileSync(AGENT_DEBUG_LOG, line, { encoding: 'utf8' })
  } catch {
    // ignore
  }
}

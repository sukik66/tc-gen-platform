import net from 'node:net'
import dotenv from 'dotenv'

dotenv.config()

const host = process.env.API_HOST || '127.0.0.1'
const port = Number(process.env.API_PORT || 8787)

async function probeApi() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    const body = await response.json().catch(() => null)
    return { occupied: true, response, body }
  } catch {
    return { occupied: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1200, () => finish(false))
  })
}

const probe = await probeApi()
if (probe.occupied) {
  if (probe.response.ok && probe.body?.ok === true) {
    const pidHint = Number.isInteger(probe.body?.pid) ? ` (PID ${probe.body.pid})` : ''
    console.error(
      `[ai-test-platform API] startup failed: an existing project API${pidHint} is already running at http://${host}:${port}. ` +
        'Stop that API first, then run npm run dev so it inherits the current network permissions.',
    )
    process.exit(1)
  }

  console.error(
    `[ai-test-platform API] startup failed: ${host}:${port} is occupied by another HTTP service ` +
      `(HTTP ${probe.response.status}). Stop that service or change API_PORT in .env before running npm run dev.`,
  )
  process.exit(1)
}

if (await isPortOpen()) {
  console.error(
    `[ai-test-platform API] startup failed: ${host}:${port} is occupied by another process. ` +
      'Check the port or change API_PORT in .env before running npm run dev.',
  )
  process.exit(1)
}

await import('../server/index.js')

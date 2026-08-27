import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  discoverCustomProviderModels,
  describeCustomProviderConnectionError,
  getCustomProvider,
  removeCustomProvider,
  resolveCustomProvider,
  saveCustomProvider,
} from '../server/llm/customProviders.js'
import { isKnownLlmProvider, listLlmProviderOptions } from '../server/llm/providers.js'
import { checkHealth, queryContext } from '../server/rag/lightrag.js'

const TEST_PROVIDER_ID = 'custom-runtime-config-test'

test.afterEach(() => {
  removeCustomProvider(TEST_PROVIDER_ID)
})

test('custom provider rejects IDs outside its equivalence class', () => {
  assert.throws(
    () => saveCustomProvider({ id: 'built-in-name', endpoint: 'http://127.0.0.1:11434/v1' }),
    /custom-/,
  )
})

test('custom provider validates the three required fields', () => {
  assert.throws(
    () => saveCustomProvider({ id: TEST_PROVIDER_ID, endpoint: 'http://127.0.0.1:11434/v1', apiKey: 'key' }),
    /供应商名称/,
  )
  assert.throws(
    () => saveCustomProvider({ id: TEST_PROVIDER_ID, name: 'Runtime test', endpoint: 'http://127.0.0.1:11434/v1' }),
    /API Key/,
  )
  assert.throws(
    () => saveCustomProvider({ id: TEST_PROVIDER_ID, name: 'Runtime test', apiKey: 'key' }),
    /供应商 URL/,
  )
})

test('custom provider clamps boundaries and redacts secrets', () => {
  saveCustomProvider({
    id: TEST_PROVIDER_ID,
    name: 'Runtime test',
    endpoint: 'http://127.0.0.1:11434/v1',
    apiKey: 'test-secret-123456',
    model: 'local-model',
    models: ['local-model', 'reasoning-model', 'reasoning-model'],
    contextWindow: 1,
    timeoutMinutes: 999,
    customHeaders: 'X-Tenant-ID: team-a\nMalformed',
  })

  const publicValue = getCustomProvider(TEST_PROVIDER_ID, { includeSecrets: false })
  assert.equal(publicValue.apiKey.configured, true)
  assert.equal(JSON.stringify(publicValue).includes('test-secret-123456'), false)

  const resolved = resolveCustomProvider(TEST_PROVIDER_ID)
  assert.equal(resolved.contextWindow, 4096)
  assert.equal(resolved.timeoutMs, 120 * 60_000)
  assert.deepEqual(resolved.defaultHeaders, { 'X-Tenant-ID': 'team-a' })
  assert.deepEqual(publicValue.models, ['local-model', 'reasoning-model'])
  assert.equal(isKnownLlmProvider(TEST_PROVIDER_ID), true)
  const option = listLlmProviderOptions().providers.find((provider) => provider.id === TEST_PROVIDER_ID)
  assert.deepEqual(option.availableModels, ['local-model', 'reasoning-model'])
  assert.equal(resolveCustomProvider(TEST_PROVIDER_ID, 'reasoning-model').model, 'reasoning-model')
  assert.equal(resolveCustomProvider(TEST_PROVIDER_ID, 'not-allowed').model, 'local-model')
})

test('model discovery reads and deduplicates OpenAI-compatible model IDs', async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/v1/models')
    assert.equal(request.headers.authorization, 'Bearer discovery-key')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'chat-model' }, { id: 'reasoning-model' }, { id: 'chat-model' }, {}] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()

  const models = await discoverCustomProviderModels({
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'discovery-key',
    apiMode: 'openai',
  })
  assert.deepEqual(models, ['chat-model', 'reasoning-model'])
})

test('model discovery surfaces authentication failures', async () => {
  await assert.rejects(
    discoverCustomProviderModels(
      { endpoint: 'https://models.example.test/v1', apiKey: 'bad-key' },
      async () => new Response(JSON.stringify({ error: { message: 'invalid token' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    /invalid token/,
  )
})

test('model discovery explains restricted internal-network access', async () => {
  const cause = Object.assign(new Error('connect EACCES 10.2.101.110:443'), { code: 'EACCES' })
  await assert.rejects(
    discoverCustomProviderModels(
      { endpoint: 'https://models.internal.test/v1', apiKey: 'key' },
      async () => { throw new TypeError('fetch failed', { cause }) },
    ),
    /本机拒绝.*Node.*node\.exe.*内网\/VPN/,
  )
})

test('provider connection errors preserve nested network causes', () => {
  const denied = Object.assign(new Error('connect EACCES 10.2.101.110:443'), { code: 'EACCES' })
  const fetchFailure = new TypeError('fetch failed', { cause: denied })
  const sdkError = new Error('Connection error.', { cause: fetchFailure })
  assert.match(
    describeCustomProviderConnectionError(sdkError, 'https://models.internal.test/v1'),
    /本机拒绝.*Node.*node\.exe.*内网\/VPN/,
  )
})

test('provider connection errors retain upstream HTTP status', () => {
  const upstream = Object.assign(new Error('Unauthorized'), { status: 401 })
  assert.match(
    describeCustomProviderConnectionError(upstream, 'https://models.example.test/v1'),
    /HTTP 401.*Unauthorized/,
  )
})

test('llm-wiki connector handles healthy and searchable local endpoints', async (t) => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/ready') {
      response.end(JSON.stringify({ status: 'ready' }))
      return
    }
    if (request.url === '/search' && request.method === 'POST') {
      response.end(JSON.stringify({ data: { context: 'local wiki context' } }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}`

  const health = await checkHealth({ provider: 'llm-wiki', url, healthPath: '/ready' })
  assert.equal(health.ok, true)
  assert.equal(health.provider, 'llm-wiki')

  const context = await queryContext('payment boundary', {
    provider: 'llm-wiki',
    url,
    queryPath: '/search',
    topK: 10,
  })
  assert.equal(context, 'local wiki context')
})

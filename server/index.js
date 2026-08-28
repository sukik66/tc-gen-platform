import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generateWithGemini, streamWithGemini } from './llm/gemini.js'
import OpenAI from 'openai'
import { generateWithOpenAICompatible, streamWithOpenAICompatible } from './llm/openai.js'
import {
  GEMINI_PROVIDER,
  effectiveMaxCompletionTokens,
  throwIfPromptExceedsSharedContext,
  healthForProvider,
  isKnownLlmProvider,
  listLlmProviderOptions,
  resolveOpenAiCompatible,
} from './llm/providers.js'
import { normalizeCases } from './normalize.js'
import { extractCompleteCaseObjects } from './partial-case-parser.js'
import { tryParseContractsResponse, parseCompleteContractObjectsFromPartialStream } from './normalize-contracts.js'
import { generateContractsWithOpenAICompatible, streamContractsWithOpenAICompatible } from './llm/openai-contracts.js'
import { generateContractsWithGemini } from './llm/gemini-contracts.js'
import { tryParseCodeReviewResponse } from './normalize-code-review.js'
import { runCodeReviewOpenAICompatible } from './llm/openai-code-review.js'
import { runCodeReviewGemini } from './llm/gemini-code-review.js'
import * as contractReviewResults from './contractReviewResults.js'
import { inferCandidateDirs, reloadDomainRules, appendApprovedRule } from './vcs/code-review-agent.js'
import {
  maybeGenerateRuleProposal,
  loadProposals,
  saveProposals,
  bumpStats,
} from './vcs/rule-proposal-generator.js'
import { appendRevisionLog, diffCasesForLog } from './caseRevisionLog.js'
import { describeCustomProviderConnectionError, discoverCustomProviderModels, getCustomProvider, listCustomProviders, removeCustomProvider, saveCustomProvider } from './llm/customProviders.js'
import { getAllRepos, getRepo, upsertRepo, deleteRepo, initDefaultRepos } from './vcs/repos.js'
import * as plastic from './vcs/plastic.js'
import * as git from './vcs/git.js'
import { queryContext, checkHealth as ragHealth } from './rag/lightrag.js'
import { SYSTEM_PROMPT, buildEnhancedJsonTail, getDepthGenerationSpec } from './prompt.js'
import {
  buildEnhancedUserContent,
  buildEnhancedSystemPrompt,
  buildTestPlanMessages,
  buildRequirementLedgerMessages,
  buildTestPointBatchMessages,
} from './prompt-enhanced.js'
import { startScheduler, stopScheduler, runDailyScan, getLastScanResult } from './scheduler/dailyScan.js'
import { gatherCodeContext, smartSearch, scanDirectory, listSubDirs, extractKeywords } from './vcs/code-context.js'
import { runPipeline } from './pipeline.js'
import {
  applyCasesToTestPlan,
  focusTestPlanForGeneration,
  normalizeTestPlan,
  parseTestPlanJson,
  renumberTestPoints,
} from './test-plan-ledger.js'
import { logLlmDebug, safeBaseUrlLabel } from './llm/debug-llm.js'
import { setLastOpenAiCompatibleMeta, getLastOpenAiCompatibleMeta } from './llm/llmLastMeta.js'
import { ensureEnvFile, getLocalConfig, saveLocalConfig } from './localConfig.js'
import { deleteSkill, getSkillDetail, getSkillVersion, listSkillVersions, listSkills, readSkillContext, readSkillFile, readSkillVersionFile, restoreSkillVersion, saveSkill } from './skills.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 调试会话 NDJSON：workspace 根目录 debug-17c700.log */
const __workspaceRoot = path.join(__dirname, '..')
let DEBUG_INGEST_URL = ''
function agentDebugLog(entry) {
  const payload = { sessionId: '17c700', timestamp: Date.now(), ...entry }
  const line = `${JSON.stringify(payload)}\n`
  try {
    fs.appendFileSync(path.join(__workspaceRoot, 'data', 'debug-17c700.log'), line)
  } catch {
    /* ignore disk errors */
  }
  if (!DEBUG_INGEST_URL) return
  fetch(DEBUG_INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '17c700' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}
dotenv.config({ path: path.join(__dirname, '..', '.env') })
DEBUG_INGEST_URL = String(process.env.DEBUG_INGEST_URL || '').trim()

const PORT = Number(process.env.API_PORT || 8787)
const MAX_TOTAL_CHARS = Number(process.env.LLM_MAX_DOC_CHARS || 120_000)
const TEST_PLAN_CLIENT_TIMEOUT_MS = Number(process.env.TEST_PLAN_CLIENT_TIMEOUT_MS) || 240_000
const TEST_PLAN_TP_BATCH_SIZE = Number(process.env.TEST_PLAN_TP_BATCH_SIZE) || 3

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/config', (_req, res) => {
  res.json(getLocalConfig())
})

app.post('/api/config', (_req, res) => {
  try {
    const created = ensureEnvFile()
    res.status(created ? 201 : 200).json({ ...getLocalConfig(), created })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '创建本地配置失败' })
  }
})

app.put('/api/config', (req, res) => {
  try {
    const config = saveLocalConfig(req.body || {})
    res.json({ ...config, restartRequired: true })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '保存本地配置失败' })
  }
})

app.get('/api/health', (req, res) => {
  const q = typeof req.query.provider === 'string' ? req.query.provider.trim().toLowerCase() : ''
  const provider = q && isKnownLlmProvider(q)
    ? q
    : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
  const h = healthForProvider(provider)
  return res.json({ ...h, service: 'ai-test-platform-api', pid: process.pid })
})

app.get('/api/llm-providers', (_req, res) => {
  res.json(listLlmProviderOptions())
})

app.get('/api/skills', (_req, res) => {
  res.json({ skills: listSkills() })
})

app.get('/api/skills/:id', (req, res) => {
  const skill = getSkillDetail(req.params.id)
  res.status(skill ? 200 : 404).json(skill || { error: 'Skill 不存在' })
})

app.get('/api/skills/:id/file', (req, res) => {
  try {
    const file = readSkillFile(req.params.id, req.query.path)
    res.status(file ? 200 : 404).json(file || { error: 'Skill 文件不存在' })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '读取 Skill 文件失败' })
  }
})

app.get('/api/skills/:id/versions', (req, res) => {
  const versions = listSkillVersions(req.params.id)
  res.status(versions ? 200 : 404).json(versions ? { versions } : { error: 'Skill 不存在' })
})

app.get('/api/skills/:id/versions/:version', (req, res) => {
  const version = getSkillVersion(req.params.id, req.params.version)
  res.status(version ? 200 : 404).json(version || { error: 'Skill 版本不存在' })
})

app.get('/api/skills/:id/versions/:version/file', (req, res) => {
  try {
    const file = readSkillVersionFile(req.params.id, req.params.version, req.query.path)
    res.status(file ? 200 : 404).json(file || { error: 'Skill 版本文件不存在' })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '读取 Skill 版本文件失败' })
  }
})

app.post('/api/skills/:id/versions/:version/restore', (req, res) => {
  try {
    const skill = restoreSkillVersion(req.params.id, req.params.version)
    res.status(skill ? 200 : 404).json(skill ? { skill } : { error: 'Skill 版本不存在' })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '恢复 Skill 版本失败' })
  }
})

app.post('/api/skills', (req, res) => {
  try {
    res.status(201).json({ skill: saveSkill(req.body || {}) })
  } catch (e) {
    if (e?.code === 'SKILL_EXISTS') return res.status(409).json({ error: e.message, existing: e.existing })
    res.status(400).json({ error: e instanceof Error ? e.message : 'Skill 保存失败' })
  }
})

app.delete('/api/skills/:id', (req, res) => {
  const removed = deleteSkill(req.params.id)
  res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: 'Skill 不存在' })
})

app.get('/api/custom-providers', (_req, res) => {
  res.json(listCustomProviders())
})

app.post('/api/custom-providers/discover-models', async (req, res) => {
  try {
    const input = req.body || {}
    const existing = input.id ? getCustomProvider(input.id) : null
    const models = await discoverCustomProviderModels({
      ...input,
      apiKey: String(input.apiKey || '').trim() || existing?.apiKey || '',
    })
    res.json({ models })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '获取模型失败' })
  }
})

app.post('/api/custom-providers', (req, res) => {
  try {
    res.json(saveCustomProvider(req.body || {}))
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '保存 Provider 失败' })
  }
})

app.delete('/api/custom-providers/:id', (req, res) => {
  const removed = removeCustomProvider(req.params.id)
  res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: 'Provider 不存在' })
})

app.post('/api/custom-providers/:id/test', async (req, res) => {
  let provider = null
  try {
    provider = getCustomProvider(req.params.id)
    if (!provider) return res.status(404).json({ error: 'Provider 不存在' })
    const resolved = resolveOpenAiCompatible(provider.id)
    if (!resolved.ok) return res.status(400).json({ error: resolved.hint })
    const client = new OpenAI({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      defaultHeaders: resolved.defaultHeaders,
      timeout: Math.min(resolved.timeoutMs || 30_000, 30_000),
    })
    const startedAt = Date.now()
    const result = await client.chat.completions.create({
      model: resolved.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 8,
      stream: false,
    })
    res.json({ ok: true, latencyMs: Date.now() - startedAt, model: resolved.model, reply: result.choices?.[0]?.message?.content || '' })
  } catch (e) {
    const message = provider
      ? describeCustomProviderConnectionError(e, provider.endpoint)
      : (e instanceof Error ? e.message : '连接测试失败')
    res.status(400).json({ error: message })
  }
})

/** 最近一次 OpenAI 兼容调用的排障摘要（无密钥）；生成用例后才有数据 */
app.get('/api/llm-last-meta', (_req, res) => {
  const m = getLastOpenAiCompatibleMeta()
  if (!m) {
    return res.json({
      ok: false,
      message: '尚无记录：请先在本页完成一次「API 生成」或流式生成后再打开本链接。',
    })
  }
  res.json({ ok: true, ...m })
})

app.post('/api/generate-test-plan', async (req, res) => {
  let rawText = ''
  let completion = null
  let approxPromptChars = 0
  const startedAt = Date.now()
  const requestId = `plan-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const abortController = new AbortController()
  let timedOut = false
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, TEST_PLAN_CLIENT_TIMEOUT_MS)
  try {
    const {
      documents, focusText, selectedTypes, depth, timezone,
      llmProvider,
      llmModel,
    } = req.body || {}

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }

    const docs = documents.map(d => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))
    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'

    const bodyPv = typeof llmProvider === 'string' ? llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({ error: gate.hint || `当前通道「${provider}」未就绪` })
    }

    const llmCallJson = async (messages, stage) => {
      approxPromptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
      if (provider === GEMINI_PROVIDER) {
        const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
        if (!key) throw new Error('未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）')
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        const modelName = llmModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash'
        const genAI = new GoogleGenerativeAI(key)
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: messages[0].content,
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        })
        const result = await model.generateContent(messages[1].content)
        rawText = result.response.text()
      } else {
        const r = resolveOpenAiCompatible(provider, llmModel)
        if (!r.ok) throw new Error(r.hint)
        throwIfPromptExceedsSharedContext(provider, r.model, approxPromptChars)
        const maxTokens = effectiveMaxCompletionTokens(provider, r.model, r.maxTokens || 8192, approxPromptChars)
        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({ apiKey: r.apiKey, baseURL: r.baseURL, defaultHeaders: r.defaultHeaders, timeout: r.timeoutMs || TEST_PLAN_CLIENT_TIMEOUT_MS })
        const createPlan = (useJson) => openai.chat.completions.create(
          {
            model: r.model,
            temperature: 0.2,
            max_tokens: maxTokens,
            messages,
            ...(useJson ? { response_format: { type: 'json_object' } } : {}),
          },
          { signal: abortController.signal },
        )
        try {
          completion = await createPlan(true)
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          if (/response_format|json_object|unsupported|not support|400/i.test(em)) completion = await createPlan(false)
          else throw e
        }
        rawText = completion.choices[0]?.message?.content || ''
      }
      const parsed = parseTestPlanJson(rawText)
      if (!parsed) {
        const finish = completion?.choices?.[0]?.finish_reason
        const hint = finish === 'length'
          ? `（疑似输出截断 finish_reason=length，建议增大 max_tokens 或缩短文档）`
          : (finish ? `（finish_reason=${finish}）` : '')
        const preview = String(rawText).slice(0, 200)
        throw new Error(`${stage} JSON 解析失败${hint}，已输出 ${rawText.length} 字符；开头200字：${preview}`)
      }
      return parsed
    }

    const reqMessages = buildRequirementLedgerMessages({
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    })
    const reqPromptChars = reqMessages.reduce((n, m) => n + String(m.content || '').length, 0)
    console.log(`[test-plan] req_start id=${requestId} provider=${provider} model=${llmModel || '(default)'} promptChars=${reqPromptChars}`)
    const reqStartedAt = Date.now()
    const reqParsed = await llmCallJson(reqMessages, 'REQ')
    const reqPlan = normalizeTestPlan({ reqItems: Array.isArray(reqParsed.reqItems) ? reqParsed.reqItems : [] })
    console.log(`[test-plan] req_done id=${requestId} elapsedMs=${Date.now() - reqStartedAt} reqCount=${reqPlan.reqItems.length} outputChars=${rawText.length}`)

    const targetReqItems = reqPlan.reqItems.filter((req) => req.type !== 'module')
    const batches = chunkArray(targetReqItems, Math.max(1, TEST_PLAN_TP_BATCH_SIZE))
    const allTestPoints = []
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const reqIds = batch.map((req) => req.id).join(',')
      const tpMessages = buildTestPointBatchMessages({
        reqItems: reqPlan.reqItems,
        batchReqItems: batch,
        focusText: focusText || '',
        selectedTypes: types,
        depth: dep,
        timezone: timezone || 'Asia/Shanghai',
        batchIndex: i,
        totalBatches: batches.length,
      })
      const tpPromptChars = tpMessages.reduce((n, m) => n + String(m.content || '').length, 0)
      console.log(`[test-plan] tp_batch_start id=${requestId} batch=${i + 1}/${batches.length} reqIds=${reqIds} promptChars=${tpPromptChars}`)
      const batchStartedAt = Date.now()
      try {
        const tpParsed = await llmCallJson(tpMessages, `TP batch ${i + 1}/${batches.length}`)
        const rawBatchPoints = Array.isArray(tpParsed.testPoints) ? tpParsed.testPoints : []
        const batchReqIdSet = new Set(batch.map((req) => req.id))
        const scopedBatchPoints = rawBatchPoints
          .map((tp) => ({
            ...tp,
            sourceReqIds: Array.isArray(tp?.sourceReqIds)
              ? tp.sourceReqIds.map((id) => String(id).toUpperCase()).filter((id) => batchReqIdSet.has(id))
              : [],
          }))
          .filter((tp) => tp.sourceReqIds.length > 0)
        if (scopedBatchPoints.length !== rawBatchPoints.length) {
          console.warn(`[test-plan] tp_batch_scope_filter id=${requestId} batch=${i + 1}/${batches.length} rawTpCount=${rawBatchPoints.length} keptTpCount=${scopedBatchPoints.length}`)
        }
        allTestPoints.push(...scopedBatchPoints)
        console.log(`[test-plan] tp_batch_done id=${requestId} batch=${i + 1}/${batches.length} elapsedMs=${Date.now() - batchStartedAt} tpCount=${scopedBatchPoints.length} totalTpCount=${allTestPoints.length}`)
      } catch (e) {
        console.error(`[test-plan] tp_batch_error id=${requestId} batch=${i + 1}/${batches.length} elapsedMs=${Date.now() - batchStartedAt}`, e)
        throw e
      }
    }

    console.log(`[audit] coverage_start id=${requestId} reqCount=${reqPlan.reqItems.length} tpCount=${allTestPoints.length}`)
    const plan = normalizeTestPlan({
      reqItems: reqPlan.reqItems,
      testPoints: renumberTestPoints(allTestPoints),
    })
    console.log(`[audit] coverage_done id=${requestId} uncoveredReq=${plan.coverage.uncoveredReqIds.length} infoGapReq=${plan.coverage.informationGapReqIds.length} infoGapTp=${plan.coverage.informationGapTestPointIds.length}`)
    console.log(`[test-plan] done id=${requestId} elapsedMs=${Date.now() - startedAt} reqCount=${plan.coverage.reqTotal} tpCount=${plan.coverage.testPointTotal} status=ok`)
    res.json({ ok: true, plan, meta: { provider, promptChars: approxPromptChars, outputChars: rawText.length, staged: true, tpBatchSize: TEST_PLAN_TP_BATCH_SIZE } })
  } catch (e) {
    const status = timedOut ? 504 : 500
    const message = timedOut
      ? `测试计划生成超过 ${Math.round(TEST_PLAN_CLIENT_TIMEOUT_MS / 1000)} 秒，已自动取消；建议缩短文档或换通道重试`
      : (e instanceof Error ? e.message : '生成测试计划失败')
    console.error('[generate-test-plan] error', e, {
      requestId,
      provider: req.body?.llmProvider,
      model: req.body?.llmModel,
      promptChars: typeof approxPromptChars === 'number' ? approxPromptChars : null,
      rawTextChars: typeof rawText === 'string' ? rawText.length : null,
      rawTextPreview: typeof rawText === 'string' ? rawText.slice(0, 500) : null,
      finishReason: completion?.choices?.[0]?.finish_reason ?? null,
      elapsedMs: Date.now() - startedAt,
      timedOut,
    })
    if (!res.headersSent) res.status(status).json({ error: message })
  } finally {
    clearTimeout(timeoutTimer)
  }
})

app.post('/api/generate-test-plan-stream', async (req, res) => {
  const startedAt = Date.now()
  const requestId = `plan-stream-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(':ok\n\n')

  const sendSSE = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  const cleanupAndEnd = () => {
    if (keepAliveId) { clearInterval(keepAliveId); keepAliveId = null }
    try { res.end() } catch {}
  }
  const ac = new AbortController()
  res.on('close', () => ac.abort())
  let keepAliveId = setInterval(() => {
    try { res.write(`: keepalive ${Date.now()}\n\n`) } catch {}
  }, 8_000)

  let fullText = ''
  let lastProgressAt = 0
  try {
    const {
      documents, focusText, selectedTypes, depth, timezone,
      llmProvider,
      llmModel,
    } = req.body || {}

    if (!Array.isArray(documents) || documents.length === 0) {
      sendSSE('error', { error: '缺少 documents 数组' })
      cleanupAndEnd()
      return
    }

    const docs = documents.map(d => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))
    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const bodyPv = typeof llmProvider === 'string' ? llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      sendSSE('error', { error: `不支持的 llmProvider：${bodyPv}` })
      cleanupAndEnd()
      return
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      sendSSE('error', { error: gate.hint || `当前通道「${provider}」未就绪` })
      cleanupAndEnd()
      return
    }

    const messages = buildTestPlanMessages({
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    })
    const approxPromptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
    const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.TEST_PLAN_STREAM_FIRST_TOKEN_TIMEOUT_MS) || 180_000
    const STREAM_CLIENT_TIMEOUT_MS = Number(process.env.TEST_PLAN_STREAM_CLIENT_TIMEOUT_MS) || 600_000

    console.log(`[test-plan-stream] start id=${requestId} provider=${provider} model=${llmModel || '(default)'} promptChars=${approxPromptChars}`)
    sendSSE('meta', { type: 'test_plan_stream', status: 'start', provider, promptChars: approxPromptChars })

    const startTime = Date.now()
    if (provider === GEMINI_PROVIDER) {
      const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
      if (!key) throw new Error('未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）')
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const modelName = llmModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash'
      const genAI = new GoogleGenerativeAI(key)
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: messages[0].content,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      })
      const result = await model.generateContentStream(messages[1].content)
      console.log(`[test-plan-stream] llm_stream_start id=${requestId} promptChars=${approxPromptChars} model=${modelName}`)
      let gotFirstToken = false
      for await (const chunk of result.stream) {
        if (ac.signal.aborted) break
        const delta = chunk.text()
        if (delta && !gotFirstToken) {
          gotFirstToken = true
          console.log(`[test-plan-stream] first_token id=${requestId} elapsed=${((Date.now() - startTime) / 1000).toFixed(1)}s kind=content`)
        }
        if (!delta) continue
        fullText += delta
        sendSSE('delta', { text: delta })
        const now = Date.now()
        if (now - lastProgressAt > 3000) {
          lastProgressAt = now
          sendSSE('progress', { chars: fullText.length, elapsedSec: Math.round((now - startTime) / 1000) })
        }
      }
    } else {
      const r = resolveOpenAiCompatible(provider, llmModel)
      if (!r.ok) throw new Error(r.hint)
      throwIfPromptExceedsSharedContext(provider, r.model, approxPromptChars)
      const maxTokens = effectiveMaxCompletionTokens(provider, r.model, r.maxTokens || 8192, approxPromptChars)
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey: r.apiKey, baseURL: r.baseURL, defaultHeaders: r.defaultHeaders, timeout: r.timeoutMs || STREAM_CLIENT_TIMEOUT_MS })
      const createStream = async (useJson, extraSignal) => openai.chat.completions.create(
        {
          model: r.model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages,
          stream: true,
          ...(useJson ? { response_format: { type: 'json_object' } } : {}),
        },
        { signal: extraSignal ? AbortSignal.any([ac.signal, extraSignal]) : ac.signal },
      )

      const ftAc = new AbortController()
      let stream
      let jsonObjectDowngraded = false
      try {
        stream = await createStream(true, ftAc.signal)
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e)
        if (/response_format|json_object|unsupported|not support|400/i.test(em)) {
          jsonObjectDowngraded = true
          stream = await createStream(false, ftAc.signal)
        } else {
          throw e
        }
      }
      console.log(`[test-plan-stream] llm_stream_start id=${requestId} promptChars=${approxPromptChars} model=${r.model} jsonObject=${!jsonObjectDowngraded}`)
      let gotFirstToken = false
      let lastFinishReason = ''
      let reasoningChars = 0
      let contentChars = 0
      const firstTokenTimer = setTimeout(() => {
        if (!gotFirstToken) {
          console.warn(`[test-plan-stream] first_token_timeout id=${requestId} ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`)
          ftAc.abort()
        }
      }, FIRST_TOKEN_TIMEOUT_MS)
      try {
        for await (const chunk of stream) {
          if (ac.signal.aborted || ftAc.signal.aborted) break
          const choice = chunk.choices[0]
          if (choice?.finish_reason) lastFinishReason = choice.finish_reason
          const reasoning = choice?.delta?.reasoning_content
          const delta = choice?.delta?.content
          if ((reasoning || delta) && !gotFirstToken) {
            gotFirstToken = true
            clearTimeout(firstTokenTimer)
            console.log(`[test-plan-stream] first_token id=${requestId} elapsed=${((Date.now() - startTime) / 1000).toFixed(1)}s kind=${reasoning ? 'reasoning' : 'content'}`)
          }
          if (reasoning) {
            reasoningChars += reasoning.length
            sendSSE('thinking', { text: reasoning, totalChars: reasoningChars })
          }
          if (delta) {
            contentChars += delta.length
            fullText += delta
            sendSSE('delta', { text: delta })
            const now = Date.now()
            if (now - lastProgressAt > 3000) {
              lastProgressAt = now
              sendSSE('progress', { chars: fullText.length, elapsedSec: Math.round((now - startTime) / 1000) })
            }
          }
        }
      } finally {
        clearTimeout(firstTokenTimer)
        console.log(`[test-plan-stream] stream_end id=${requestId} finish_reason=${lastFinishReason || '(none)'} outputChars=${contentChars} reasoningChars=${reasoningChars}`)
      }
      if (ftAc.signal.aborted && !fullText && !ac.signal.aborted) {
        throw new Error(`模型在 ${FIRST_TOKEN_TIMEOUT_MS / 1000} 秒内未返回任何内容，请重试或换通道`)
      }
    }

    if (ac.signal.aborted) { cleanupAndEnd(); return }
    const parsed = parseTestPlanJson(fullText)
    if (!parsed) {
      sendSSE('parse_error', { error: '测试点 JSON 解析失败', raw: fullText.slice(0, 2000) })
      console.warn(`[test-plan-stream] parse_error id=${requestId} outputChars=${fullText.length}`)
      cleanupAndEnd()
      return
    }
    const plan = normalizeTestPlan(parsed)
    console.log(`[test-plan-stream] parse_done id=${requestId} reqCount=${plan.coverage.reqTotal} tpCount=${plan.coverage.testPointTotal} outputChars=${fullText.length}`)
    sendSSE('done', {
      plan,
      meta: { provider, promptChars: approxPromptChars, outputChars: fullText.length, streamed: true },
    })
    const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`[test-plan-stream] done id=${requestId} elapsed=${totalElapsed}s status=ok`)
    cleanupAndEnd()
  } catch (e) {
    if (ac.signal.aborted) { cleanupAndEnd(); return }
    const errMsg = e instanceof Error ? e.message : '生成测试点失败'
    console.error('[test-plan-stream] error', e, {
      requestId,
      outputChars: fullText.length,
      elapsedMs: Date.now() - startedAt,
    })
    sendSSE('error', { error: errMsg, raw: fullText.slice(0, 2000) })
    cleanupAndEnd()
  }
})

app.post('/api/generate-test-cases', async (req, res) => {
  try {
    const { documents, focusText, selectedTypes, depth, timezone } = req.body || {}
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }
    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = documents.map((d) => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪，请在 .env 配置对应密钥或使用其它通道`,
      })
    }

    const genParams = {
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    }

    let rawText
    if (provider === GEMINI_PROVIDER) {
      rawText = await generateWithGemini(genParams)
    } else {
      const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
      if (!r.ok) {
        throw new Error(r.hint)
      }
      rawText = await generateWithOpenAICompatible(
        {
          apiKey: r.apiKey,
          baseURL: r.baseURL,
          model: r.model,
          maxTokens: r.maxTokens,
          providerId: r.id,
          defaultHeaders: r.defaultHeaders,
          timeoutMs: r.timeoutMs,
          streaming: r.streaming,
        },
        genParams,
      )
    }

    const fr = tryParsePartialJSON(rawText)
    if (!fr.cases || fr.cases.length === 0) {
      throw new Error(fr.parseError || '模型未生成任何用例或 JSON 无法解析')
    }
    res.json({ cases: fr.cases })
  } catch (e) {
    console.error('[generate-test-cases]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '生成失败' })
  }
})

/** 从需求文档 AI 提取质量契约（用户层草稿），与用例生成独立 */
app.post('/api/generate-contracts', async (req, res) => {
  try {
    const { documents, focusText, depth, timezone } = req.body || {}
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = documents.map((d) => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪，请在 .env 配置对应密钥或使用其它通道`,
      })
    }

    const genParams = {
      documents: docs,
      focusText: focusText || '',
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    }

    let rawText
    if (provider === GEMINI_PROVIDER) {
      rawText = await generateContractsWithGemini(genParams)
    } else {
      const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
      if (!r.ok) {
        throw new Error(r.hint)
      }
      rawText = await generateContractsWithOpenAICompatible(
        {
          apiKey: r.apiKey,
          baseURL: r.baseURL,
          model: r.model,
          maxTokens: r.maxTokens,
          providerId: r.id,
          defaultHeaders: r.defaultHeaders,
          timeoutMs: r.timeoutMs,
          streaming: r.streaming,
        },
        genParams,
      )
    }

    const fr = tryParseContractsResponse(rawText)
    if (!fr.contracts || fr.contracts.length === 0) {
      throw new Error(fr.parseError || '模型未生成任何契约或 JSON 无法解析')
    }
    res.json({ contracts: fr.contracts })
  } catch (e) {
    console.error('[generate-contracts]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '契约提取失败' })
  }
})

/** 契约流式生成（SSE），心跳保活，首 token 超时后主动报错 */
app.post('/api/generate-contracts-stream', async (req, res) => {
  try {
    const { documents, focusText, depth, timezone } = req.body || {}
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = documents.map((d) => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪，请在 .env 配置对应密钥或使用其它通道`,
      })
    }

    console.log(`[contracts-stream] provider=${provider} docCount=${docs.length}`)

    const genParams = {
      documents: docs,
      focusText: focusText || '',
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    }

    req.socket.setTimeout(0)
    req.socket.setNoDelay(true)
    req.socket.setKeepAlive(true)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(':ok\n\n')

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    // 每 5s 发一次心跳注释，让前端知道连接还活着并同步等待时间
    let elapsedSec = 0
    let gotFirstChunk = false
    const FIRST_TOKEN_TIMEOUT_SEC = Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_SEC) || 90
    const heartbeatId = setInterval(() => {
      try {
        if (ac.signal.aborted) { clearInterval(heartbeatId); return }
        elapsedSec += 5
        res.write(`:heartbeat ${elapsedSec}s\n\n`)
        console.log(`[contracts-stream] heartbeat ${elapsedSec}s gotFirstChunk=${gotFirstChunk}`)
        if (!gotFirstChunk && elapsedSec >= FIRST_TOKEN_TIMEOUT_SEC) {
          clearInterval(heartbeatId)
          ac.abort()
          sendSSE('error', {
            error: `模型超过 ${elapsedSec} 秒未返回任何内容（通道：${provider}）。可能原因：中转代理缓慢/限流；建议切换通道或稍后重试。`,
          })
        }
      } catch (_) { /* setInterval 内不允许异常冒泡 */ }
    }, 5000)

    let fullText = ''
    let lastPreviewCount = -1

    try {
      if (provider === GEMINI_PROVIDER) {
        const rawText = await generateContractsWithGemini(genParams)
        gotFirstChunk = true
        clearInterval(heartbeatId)
        const chunkSize = 500
        for (let i = 0; i < rawText.length && !ac.signal.aborted; i += chunkSize) {
          const part = rawText.slice(i, i + chunkSize)
          fullText += part
          sendSSE('delta', { text: part })
          const partial = parseCompleteContractObjectsFromPartialStream(fullText)
          if (partial.length > lastPreviewCount) {
            lastPreviewCount = partial.length
            sendSSE('preview', { contracts: partial, partial: true })
          }
        }
      } else {
        const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
        if (!r.ok) throw new Error(r.hint)
        const iter = streamContractsWithOpenAICompatible(
          {
            apiKey: r.apiKey,
            baseURL: r.baseURL,
            model: r.model,
            maxTokens: r.maxTokens,
            providerId: r.id,
            defaultHeaders: r.defaultHeaders,
            timeoutMs: r.timeoutMs,
            streaming: r.streaming,
          },
          genParams,
          ac.signal,
        )
        for await (const chunk of iter) {
          if (ac.signal.aborted) break
          // 兼容老式 string chunk（任何未升级的 generator 不会走到这）
          const kind = typeof chunk === 'string' ? 'content' : chunk?.kind
          const text = typeof chunk === 'string' ? chunk : (chunk?.text || '')
          if (!gotFirstChunk) {
            gotFirstChunk = true
            clearInterval(heartbeatId)
            console.log(`[contracts-stream] first chunk received kind=${kind}`)
          }
          if (kind === 'reasoning') {
            // DeepSeek-Reasoner / V4-Pro 等推理模型的思考流：推 SSE 给前端展示但不入 fullText（避免污染 JSON 解析）
            sendSSE('thinking', { text })
            continue
          }
          fullText += text
          sendSSE('delta', { text })
          const partial = parseCompleteContractObjectsFromPartialStream(fullText)
          if (partial.length > lastPreviewCount) {
            lastPreviewCount = partial.length
            sendSSE('preview', { contracts: partial, partial: true })
          }
        }
      }
    } catch (e) {
      clearInterval(heartbeatId)
      if (ac.signal.aborted) return res.end()
      console.error('[contracts-stream] stream error', e)
      sendSSE('error', { error: e instanceof Error ? e.message : '契约流式生成失败' })
      return res.end()
    }
    clearInterval(heartbeatId)

    if (ac.signal.aborted) return res.end()

    if (!fullText.trim()) {
      sendSSE('parse_error', { error: '模型返回为空', raw: '' })
      return res.end()
    }

    const fr = tryParseContractsResponse(fullText)
    if (fr.contracts && fr.contracts.length > 0) {
      sendSSE('done', { contracts: fr.contracts, interrupted: false, partial: false })
    } else {
      sendSSE('parse_error', {
        error: fr.parseError || 'JSON 解析失败',
        raw: fullText.slice(0, 2000),
      })
    }
    res.end()
  } catch (e) {
    console.error('[generate-contracts-stream]', e)
    if (!res.headersSent) {
      res.status(500).json({ error: e instanceof Error ? e.message : '契约流式生成失败' })
    } else {
      res.end()
    }
  }
})

/** 契约 + 代码上下文 → LLM 代码走查（举证式，非形式化证明） */
app.post('/api/contract-code-review', async (req, res) => {
  try {
    const { rule, boundaryHint, codeChanges } = req.body || {}
    // QC-15：req.body.contract 字段不再消费（兼容旧客户端但不传给 reviewParams）
    if (!String(rule || '').trim()) {
      return res.status(400).json({ error: '缺少 rule（业务规则文本）' })
    }
    if (!codeChanges || typeof codeChanges !== 'object') {
      return res.status(400).json({ error: '缺少 codeChanges（与用例生成页相同的代码关联结构）' })
    }

    const { text: codeContextText, stats: codeContextStats } = await gatherCodeContext(codeChanges)
    if (!String(codeContextText).trim()) {
      return res.status(400).json({
        error: '未能收集到代码材料：请勾选仓库并配置智能检索关键词、目录或变更范围',
      })
    }

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪`,
      })
    }

    const reviewParams = {
      rule: String(rule),
      boundaryHint: String(boundaryHint || ''),
      codeContextText,
    }

    // ST-003：moduleLabel 提前提取，供 Gemini 与 OpenAI 分支共用 enrichedParams
    const moduleLabel =
      typeof req.body?.moduleLabel === 'string' ? req.body.moduleLabel.trim() : ''
    const inferred = inferCandidateDirs(moduleLabel, String(rule))
    const agentRepos = []
    const seenRepoIds = new Set()
    if (Array.isArray(codeChanges?.repos)) {
      for (const rc of codeChanges.repos) {
        const rid = rc?.repoId
        if (!rid || seenRepoIds.has(rid)) continue
        const meta = getRepo(rid)
        if (!meta) continue
        seenRepoIds.add(rid)
        agentRepos.push({ repoId: meta.id, repoName: meta.name })
      }
    }
    const extraDirHints = []
    if (Array.isArray(codeChanges?.repos)) {
      for (const rc of codeChanges.repos) {
        if (typeof rc?.directory === 'string' && rc.directory.trim()) {
          extraDirHints.push(rc.directory.trim())
        }
      }
    }
    const enrichedParams = {
      ...reviewParams,
      moduleLabel,
      dirHints: inferred.dirHints,
      fileKeywords: inferred.fileKeywords,
      fallback: inferred.fallback,
      extraDirHints,
      repos: agentRepos,
    }

    let rawText
    if (provider === GEMINI_PROVIDER) {
      // QC-15：Gemini 与 OpenAI-compatible 通道输出格式统一为 { conclusion, evidence, confidence, ... }
      // 注意 Gemini 通道当前不做 tool calling 升级，输出由模型一次性给出
      rawText = await runCodeReviewGemini(enrichedParams)
    } else {
      // OpenAI-compatible 分支：接通 Phase 1 推断 + Phase 2 agent 工具循环（含 grepRepo + Token 双档闸门）
      //
      // 与 gatherCodeContext 的关系：
      // - gatherCodeContext 一次性收集"启动材料" codeContextText（兼容展示口径）
      // - inferCandidateDirs 给 agent 提供 dirHints/fileKeywords/fallback 导航信号
      // - agent 工具按需触发，受 MAX_TOOL_CALLS=16 / MAX_TOTAL_CHARS=80K + 60K/70K 双档闸门保护

      // agentCtx 结构是 ST-002 留给 ST-003 的接口约定：
      //   repoContext.{repos,dirHints,fileKeywords,fallback}：grepRepo 工具校验 dirHint 必填、
      //   AI 提案 Pass 2 触发条件判定 fallback=true 时使用
      const agentCtx = {
        repoContext: {
          repos: agentRepos,
          dirHints: inferred.dirHints,
          fileKeywords: inferred.fileKeywords,
          fallback: inferred.fallback,
        },
      }

      const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
      if (!r.ok) {
        throw new Error(r.hint)
      }
      rawText = await runCodeReviewOpenAICompatible(
        {
          apiKey: r.apiKey,
          baseURL: r.baseURL,
          model: r.model,
          maxTokens: r.maxTokens,
          providerId: r.id,
          defaultHeaders: r.defaultHeaders,
          timeoutMs: r.timeoutMs,
        },
        enrichedParams,
        agentCtx,
      )
    }

    const parsed = tryParseCodeReviewResponse(rawText)
    if (!parsed.ok) {
      throw new Error(parsed.error || '代码走查结果 JSON 无法解析')
    }

    // ST-003 AI.1-AI.5：Pass 2 提案触发（合取条件 fallback=true && conclusion=fail && evidence 非空）
    // 仅 OpenAI-compatible 分支触发：Pass 2 提案需要 conclusion=fail + evidence
    let ruleProposalId = null
    let ruleProposalDraft = null
    if (
      provider !== GEMINI_PROVIDER &&
      parsed.result.conclusion === 'fail' &&
      Array.isArray(parsed.result.evidence) &&
      parsed.result.evidence.length > 0
    ) {
      try {
        const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
        if (r.ok) {
          const pass2Result = await maybeGenerateRuleProposal({
            parsedResult: parsed.result,
            repoContext: {
              fallback: inferred.fallback,
              dirHints: inferred.dirHints,
              fileKeywords: inferred.fileKeywords,
            },
            moduleLabel,
            rule: String(rule),
            contractId: typeof req.body?.contractId === 'string' ? req.body.contractId : undefined,
            taskId: 'TKT-20260429-003',
            pass2LlmOpts: {
              apiKey: r.apiKey,
              baseURL: r.baseURL,
              model: r.model,
              providerId: r.id,
              defaultHeaders: r.defaultHeaders,
              timeoutMs: r.timeoutMs,
              // Pass 2 maxTokens 默认 4096（不强制 8192，避免不必要的 token 浪费；与 Q1 不矛盾：Q1 锚定主走查端点）
            },
          })
          ruleProposalId = pass2Result.proposalId
          ruleProposalDraft = pass2Result.ruleProposalDraft
        }
      } catch (e) {
        // Pass 2 失败不影响主走查结果返回
        console.warn('[contract-code-review][pass-2]', e instanceof Error ? e.message : e)
      }
    }

    res.json({
      ...parsed.result,
      ...(ruleProposalId ? { ruleProposalId, ruleProposalDraft } : {}),
      meta: {
        codeContextChars: codeContextText.length,
        codeContextStats,
      },
    })
  } catch (e) {
    console.error('[contract-code-review]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '代码走查失败' })
  }
})

/* ================================================================
 * ST-003 REST.1-REST.3 · 规则提案 REST API（GET/approve/reject）
 * ================================================================ */

/** GET /api/rule-proposals?status=pending|approved|rejected */
app.get('/api/rule-proposals', (req, res) => {
  try {
    const arr = loadProposals()
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''
    const filtered = status
      ? arr.filter((p) => p && p.status === status)
      : arr
    res.json(filtered)
  } catch (e) {
    console.error('[rule-proposals][list]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '查询提案列表失败' })
  }
})

/** POST /api/rule-proposals/:id/approve — 批准入库 + 写 unity-domain-rules.json + 热加载 domainRules */
app.post('/api/rule-proposals/:id/approve', (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: '缺少 id' })
    const arr = loadProposals()
    const idx = arr.findIndex((p) => p && p.id === id)
    if (idx < 0) return res.status(404).json({ error: `提案 ${id} 不存在` })
    const proposal = arr[idx]
    if (proposal.status !== 'pending') {
      return res.status(409).json({ error: `提案当前状态为 ${proposal.status}，仅 pending 可批准` })
    }
    appendApprovedRule({
      keywords: proposal.keywords,
      hints: proposal.hints,
      fileKeywords: proposal.fileKeywords,
      sourceProposalId: proposal.id,
    })
    arr[idx] = {
      ...proposal,
      status: 'approved',
      updatedAt: new Date().toISOString(),
    }
    saveProposals(arr)
    bumpStats('approved')
    // appendApprovedRule 内部已调 reloadDomainRules，此处显式再调一次确保最新
    reloadDomainRules()
    res.json({ ok: true, proposal: arr[idx] })
  } catch (e) {
    console.error('[rule-proposals][approve]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '批准失败' })
  }
})

/** POST /api/rule-proposals/:id/reject — 驳回 */
app.post('/api/rule-proposals/:id/reject', (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: '缺少 id' })
    const arr = loadProposals()
    const idx = arr.findIndex((p) => p && p.id === id)
    if (idx < 0) return res.status(404).json({ error: `提案 ${id} 不存在` })
    const proposal = arr[idx]
    if (proposal.status !== 'pending') {
      return res.status(409).json({ error: `提案当前状态为 ${proposal.status}，仅 pending 可驳回` })
    }
    arr[idx] = {
      ...proposal,
      status: 'rejected',
      rejectReason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined,
      updatedAt: new Date().toISOString(),
    }
    saveProposals(arr)
    bumpStats('rejected')
    res.json({ ok: true, proposal: arr[idx] })
  } catch (e) {
    console.error('[rule-proposals][reject]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '驳回失败' })
  }
})

/* ---------- SSE 流式端点 ---------- */
/** 自动记录：用户在一次 AI 生成后对用例的编辑差异（无额外表单） */
app.post('/api/case-revision-log', (req, res) => {
  try {
    const { before, after } = req.body || {}
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return res.status(400).json({ error: '需要 JSON 字段 before、after 均为用例数组' })
    }
    const diff = diffCasesForLog(before, after)
    const { added = 0, removed = 0, modified = 0 } = diff.stats || {}
    if (added === 0 && removed === 0 && modified === 0) {
      return res.json({ ok: true, skipped: true })
    }
    const highlights = []
    for (const m of diff.modified.slice(0, 5)) {
      for (const ch of (m.changes || []).slice(0, 2)) {
        highlights.push({ id: m.id, field: ch.field })
      }
    }
    for (const a of diff.added.slice(0, 3)) {
      highlights.push({ id: a.id, field: 'added' })
    }
    for (const r of diff.removed.slice(0, 3)) {
      highlights.push({ id: r.id, field: 'removed' })
    }
    appendRevisionLog({
      ts: new Date().toISOString(),
      trigger: 'auto_diff',
      stats: diff.stats,
      highlights: highlights.slice(0, 14),
    })
    res.json({ ok: true })
  } catch (e) {
    console.error('[case-revision-log]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '记录失败' })
  }
})

app.post('/api/generate-test-cases-stream', async (req, res) => {
  try {
    const { documents, focusText, selectedTypes, depth, timezone } = req.body || {}
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }
    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = documents.map((d) => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪，请在 .env 配置对应密钥或使用其它通道`,
      })
    }

    const genParams = {
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
    }

    req.socket.setTimeout(0)
    req.socket.setNoDelay(true)
    req.socket.setKeepAlive(true)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(':ok\n\n')

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    let fullText = ''
    try {
      let iter
      if (provider === GEMINI_PROVIDER) {
        iter = streamWithGemini(genParams)
      } else {
        const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
        if (!r.ok) throw new Error(r.hint)
        iter = streamWithOpenAICompatible(
          {
            apiKey: r.apiKey,
            baseURL: r.baseURL,
            model: r.model,
            maxTokens: r.maxTokens,
            providerId: r.id,
            defaultHeaders: r.defaultHeaders,
            timeoutMs: r.timeoutMs,
            streaming: r.streaming,
          },
          genParams,
          ac.signal,
        )
      }

      for await (const chunk of iter) {
        if (ac.signal.aborted) break
        fullText += chunk
        sendSSE('delta', { text: chunk })
      }
    } catch (e) {
      if (ac.signal.aborted) return res.end()
      sendSSE('error', { error: e instanceof Error ? e.message : '生成失败' })
      return res.end()
    }

    if (ac.signal.aborted) return res.end()

    if (!fullText.trim()) {
      sendSSE('parse_error', { error: '模型返回为空', raw: '' })
      return res.end()
    }

    const finalResult = tryParsePartialJSON(fullText)
    if (finalResult.cases && finalResult.cases.length > 0) {
      sendSSE('done', {
        cases: finalResult.cases,
        interrupted: finalResult.partial || false,
        interruptReason: finalResult.partial ? '输出被截断，已提取部分用例' : undefined,
        partial: finalResult.partial || false,
      })
    } else {
      sendSSE('parse_error', {
        error: finalResult.parseError || 'JSON 解析失败',
        raw: fullText.slice(0, 2000),
      })
    }
    res.end()
  } catch (e) {
    console.error('[generate-stream]', e)
    if (!res.headersSent) {
      res.status(500).json({ error: e instanceof Error ? e.message : '生成失败' })
    } else {
      res.end()
    }
  }
})

/* ========== 仓库配置 API ========== */

app.get('/api/repos', (_req, res) => {
  res.json(getAllRepos())
})

app.get('/api/repos/:id', (req, res) => {
  const repo = getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: '仓库不存在' })
  res.json(repo)
})

app.post('/api/repos', (req, res) => {
  try {
    const { id, name, type, path: repoPath, branch } = req.body
    if (!id || !repoPath) return res.status(400).json({ error: '缺少 id 或 path' })
    if (type && !['plastic', 'git'].includes(type)) {
      return res.status(400).json({ error: 'type 只能是 plastic 或 git' })
    }
    const entry = upsertRepo({ id, name, type, path: repoPath, branch })
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/repos/:id', (req, res) => {
  deleteRepo(req.params.id)
  res.json({ ok: true })
})

app.post('/api/repos/init-defaults', (_req, res) => {
  const repos = initDefaultRepos()
  res.json(repos)
})

/* ========== VCS 代码变更 API ========== */

app.get('/api/vcs/:repoId/branches', async (req, res) => {
  try {
    const repo = getRepo(req.params.repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })
    const vcs = repo.type === 'plastic' ? plastic : git
    const branches = await vcs.listBranches(repo.path)
    res.json(branches)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/vcs/:repoId/changesets', async (req, res) => {
  try {
    const repo = getRepo(req.params.repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })

    const { branch, since, until, limit } = req.query
    const opts = {}
    if (branch) opts.branch = branch
    if (since) opts.since = since
    if (until) opts.until = until
    if (limit) opts.limit = parseInt(limit, 10)

    if (repo.type === 'plastic') {
      const cs = await plastic.listChangesets(repo.path, opts)
      res.json(cs)
    } else {
      const commits = await git.listCommits(repo.path, opts)
      res.json(commits)
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/vcs/:repoId/changeset/:csId', async (req, res) => {
  try {
    const repo = getRepo(req.params.repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })

    if (repo.type === 'plastic') {
      const detail = await plastic.getChangesetDetail(repo.path, req.params.csId)
      res.json(detail || { error: '未找到' })
    } else {
      const diff = await git.commitDiff(repo.path, req.params.csId)
      res.json({ diff })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/vcs/:repoId/diff', async (req, res) => {
  try {
    const repo = getRepo(req.params.repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })

    const { from, to, since, until, branch } = req.body

    if (repo.type === 'plastic') {
      if (from && to) {
        const files = await plastic.diffChangesets(repo.path, from, to)
        res.json({ files })
      } else if (branch) {
        const files = await plastic.branchDiff(repo.path, branch)
        res.json({ files })
      } else {
        res.status(400).json({ error: '需要 from+to 或 branch' })
      }
    } else {
      if (from && to) {
        const files = await git.diffCommits(repo.path, from, to)
        res.json({ files })
      } else if (since) {
        const content = await git.timeDiffContent(repo.path, since, until)
        res.json({ content })
      } else if (branch) {
        const files = await git.branchDiff(repo.path, branch)
        res.json({ files })
      } else {
        res.status(400).json({ error: '需要 from+to、since 或 branch' })
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/vcs/:repoId/diff-content', async (req, res) => {
  try {
    const repo = getRepo(req.params.repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })

    const { from, to, since, until, branch } = req.body

    let content = ''
    if (repo.type === 'git') {
      if (since) {
        content = await git.timeDiffContent(repo.path, since, until)
      } else if (branch) {
        content = await git.branchDiffContent(repo.path, branch)
      } else if (from && to) {
        const files = await git.diffCommits(repo.path, from, to)
        content = files.map(f => `${f.status}\t${f.path}`).join('\n')
      }
    } else {
      if (from && to) {
        content = await plastic.diffChangesetsContent(repo.path, from, to)
      } else if (branch) {
        content = await plastic.branchDiffContent(repo.path, branch)
      }
    }
    res.json({ content })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ========== 代码上下文 API（三种策略） ========== */

app.post('/api/code-context/extract-keywords', (req, res) => {
  try {
    const { text, fileName } = req.body
    if (!text && !fileName) return res.status(400).json({ error: '缺少 text 或 fileName' })
    const KW_MAX = 120_000
    const t = String(text || '').length > KW_MAX ? String(text).slice(0, KW_MAX) : String(text || '')
    const keywords = extractKeywords(t, fileName)
    res.json({ ok: true, keywords })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/code-context/smart-search', async (req, res) => {
  try {
    const { repoId, keywords } = req.body
    const repo = getRepo(repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })
    if (!Array.isArray(keywords) || keywords.length === 0) return res.status(400).json({ error: '缺少 keywords' })
    const result = await smartSearch(repo.path, keywords, { repoType: repo.type })
    res.json({ ok: true, fileCount: result.files.length, files: result.files })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/code-context/scan-dir', async (req, res) => {
  try {
    const { repoId, directory } = req.body
    const repo = getRepo(repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })
    if (!directory) return res.status(400).json({ error: '缺少 directory' })
    const result = await scanDirectory(repo.path, directory)
    res.json({ ok: true, fileCount: result.files.length, files: result.files })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/code-context/list-dirs', (req, res) => {
  try {
    const { repoId, subDir } = req.body
    const repo = getRepo(repoId)
    if (!repo) return res.status(404).json({ error: '仓库不存在' })
    const dirs = listSubDirs(repo.path, subDir || '')
    res.json({ ok: true, dirs })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ========== LightRAG 知识检索 API ========== */

app.get('/api/rag/health', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.slice(0, 2048) : undefined
  const provider = req.query.provider === 'llm-wiki' ? 'llm-wiki' : req.query.provider === 'lightrag' ? 'lightrag' : undefined
  const queryPath = typeof req.query.queryPath === 'string' ? req.query.queryPath.slice(0, 512) : undefined
  const healthPath = typeof req.query.healthPath === 'string' ? req.query.healthPath.slice(0, 512) : undefined
  const h = await ragHealth({ url, provider, queryPath, healthPath })
  res.json(h)
})

app.post('/api/rag/health-test', async (req, res) => {
  const body = req.body || {}
  const h = await ragHealth({
    provider: body.provider === 'llm-wiki' ? 'llm-wiki' : body.provider === 'lightrag' ? 'lightrag' : undefined,
    url: typeof body.url === 'string' ? body.url.slice(0, 2048) : undefined,
    queryPath: typeof body.queryPath === 'string' ? body.queryPath.slice(0, 512) : undefined,
    healthPath: typeof body.healthPath === 'string' ? body.healthPath.slice(0, 512) : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey.slice(0, 8192) : undefined,
  })
  res.json(h)
})

app.post('/api/rag/query', async (req, res) => {
  try {
    const { query, mode, topK, hlKeywords, llKeywords } = req.body
    if (!query) return res.status(400).json({ error: '缺少 query' })
    const context = await queryContext(query, { mode, topK, hlKeywords, llKeywords })
    res.json({ context })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ========== 增强版流式生成（需求 + 代码变更 + 知识库） ========== */

app.post('/api/generate-enhanced-stream', async (req, res) => {
  try {
    const {
      documents, focusText, selectedTypes, depth, timezone,
      codeChanges,
      ragQuery,
      llmProvider,
      llmModel,
      generationMode,
      existingCases,
      batchTarget,
      reuseTestPlan,
      autoCoverage,
      targetTestPointIds,
      autoRound,
      skillIds,
    } = req.body || {}

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: '缺少 documents 数组' })
    }

    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = documents.map(d => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))
    const lockedTestPlan = reuseTestPlan && typeof reuseTestPlan === 'object'
      ? normalizeTestPlan(reuseTestPlan)
      : null
    const skillsContext = readSkillContext(skillIds)
    const mode = generationMode === 'append' ? 'append' : 'fresh'
    const existingCaseBriefs = Array.isArray(existingCases)
      ? existingCases.slice(-180).map(tc => ({
        id: String(tc?.id || '').slice(0, 40),
        module: String(tc?.module || '').slice(0, 80),
        subModule: String(tc?.subModule || '').slice(0, 80),
        summary: String(tc?.summary || '').slice(0, 220),
        expected: String(tc?.expected || '').slice(0, 260),
        priority: String(tc?.priority || '').slice(0, 20),
        caseType: String(tc?.caseType || '').slice(0, 40),
        sourceReqIds: Array.isArray(tc?.sourceReqIds) ? tc.sourceReqIds.map(String).slice(0, 12) : [],
        testPointIds: Array.isArray(tc?.testPointIds) ? tc.testPointIds.map(String).slice(0, 12) : [],
        designMethod: String(tc?.designMethod || '').slice(0, 40),
      })).filter(tc => tc.summary || tc.expected)
      : []
    const batchMin = Math.min(Math.max(Number(batchTarget?.min) || 30, 10), 100)
    const batchMax = Math.min(Math.max(Number(batchTarget?.max) || 60, batchMin), 120)

    const bodyPv = typeof llmProvider === 'string' ? llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪`,
      })
    }

    /* --- 并行获取：代码上下文 + 知识库上下文 --- */
    const tasks = []

    let codeChangeSummary = ''
    let rawCodeFiles = []
    if (!lockedTestPlan && codeChanges && codeChanges.mode && Array.isArray(codeChanges.repos) && codeChanges.repos.length > 0) {
      tasks.push(
        gatherCodeContext(codeChanges)
          .then((ctx) => {
            codeChangeSummary = ctx.text
            rawCodeFiles = ctx.rawFiles || []
          })
          .catch(e => { console.warn('[code-context]', e.message) })
      )
    }

    let ragContext = ''
    if (!lockedTestPlan && ragQuery?.trim()) {
      tasks.push(
        queryContext(ragQuery, { mode: 'mix', topK: 30 }).then(c => { ragContext = c })
          .catch(e => { console.warn('[rag-query]', e.message) })
      )
    } else if (!lockedTestPlan && docs.length > 0) {
      const autoQuery = docs.map(d => d.name).join(' ') + ' ' + (focusText || '')
      tasks.push(
        queryContext(autoQuery.trim(), { mode: 'mix', topK: 20 }).then(c => { ragContext = c })
          .catch(e => { console.warn('[rag-auto]', e.message) })
      )
    }

    await Promise.allSettled(tasks)
    const pipelineRagContext = [
      ragContext,
      skillsContext ? `## User-selected Skill guidance\n${skillsContext}` : '',
    ].filter(Boolean).join('\n\n')

    /* --- SSE 流式输出（提前开启，pipeline 阶段即可发送进度）--- */
    req.socket.setTimeout(0)
    req.socket.setNoDelay(true)
    req.socket.setKeepAlive(true)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(':ok\n\n')

    const sendSSE = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
    }

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    let keepAliveId = setInterval(() => {
      try { res.write(`: keepalive ${Date.now()}\n\n`) } catch {}
    }, 8_000)

    const cleanupAndEnd = () => {
      if (keepAliveId) { clearInterval(keepAliveId); keepAliveId = null }
      try { res.end() } catch {}
    }

    if (codeChangeSummary) {
      sendSSE('meta', { type: 'code_changes', length: codeChangeSummary.length })
    }
    if (ragContext) {
      sendSSE('meta', { type: 'rag_context', length: ragContext.length })
    }
    if (skillsContext) {
      sendSSE('meta', { type: 'skills_context', count: Array.isArray(skillIds) ? skillIds.length : 0, length: skillsContext.length })
    }

    /* --- Pipeline: 代码预分析 + 需求分析（多步 Agent）--- */
    const usePipeline = req.body?.usePipeline !== false
    let pipelineResult = { codeAnalysisSummary: '', requirementAnalysis: '', testPlan: null, pipelineUsed: false }

    console.log(`[stream] start provider=${provider}, rawCodeFiles=${rawCodeFiles.length}, codeChangeSummary=${codeChangeSummary.length}字符, usePipeline=${usePipeline}`)

    if (lockedTestPlan) {
      pipelineResult = {
        codeAnalysisSummary: '',
        requirementAnalysis: '',
        testPlan: lockedTestPlan,
        pipelineUsed: true,
      }
      sendSSE('meta', { type: 'pipeline', status: 'reused', steps: ['generation', 'coverage_audit'] })
      sendSSE('coverage_plan', { plan: lockedTestPlan })
    } else if (usePipeline && provider !== 'gemini') {
      const pipeT0 = Date.now()
      try {
        const docText = docs.map(d => `## ${d.name}\n${d.text}`).join('\n\n')
        const requirementHint = focusText?.trim() || docs[0]?.name || ''
        const codeFiles = rawCodeFiles

        const pipelineSteps = codeFiles.length > 0
          ? ['code_analysis', 'requirement_analysis', 'coverage_planning', 'generation', 'coverage_audit']
          : ['requirement_analysis', 'coverage_planning', 'generation', 'coverage_audit']
        console.log(`[stream] pipeline_start files=${codeFiles.length}, steps=${pipelineSteps.join('→')}`)
        sendSSE('meta', { type: 'pipeline', status: 'start', steps: pipelineSteps })

        pipelineResult = await runPipeline({
          provider,
          model: llmModel,
          codeFiles,
          documents: docs,
          documentText: docText,
          ragContext: pipelineRagContext,
          requirementHint,
          selectedTypes: types,
          depth: dep,
          timezone: timezone || 'Asia/Shanghai',
          opts: {
            signal: ac.signal,
            onProgress: (info) => sendSSE('pipeline_progress', info),
          },
        })

        const pipeSec = ((Date.now() - pipeT0) / 1000).toFixed(1)
        if (pipelineResult.pipelineUsed) {
          console.log(`[stream] pipeline_done elapsed=${pipeSec}s, codeChars=${pipelineResult.codeAnalysisSummary.length}, reqChars=${pipelineResult.requirementAnalysis.length}`)
          sendSSE('meta', { type: 'pipeline', status: 'done', codeAnalysisChars: pipelineResult.codeAnalysisSummary.length, requirementAnalysisChars: pipelineResult.requirementAnalysis.length })
          if (pipelineResult.testPlan) sendSSE('coverage_plan', { plan: pipelineResult.testPlan })
        } else {
          console.log(`[stream] pipeline_empty elapsed=${pipeSec}s`)
        }
      } catch (e) {
        const pipeSec = ((Date.now() - pipeT0) / 1000).toFixed(1)
        console.warn(`[stream] pipeline_fallback elapsed=${pipeSec}s error=${e.message}`)
        sendSSE('meta', { type: 'pipeline', status: 'fallback', error: e.message })
      }
    }

    const fullTestPlan = pipelineResult.testPlan
    const uncoveredIds = Array.isArray(fullTestPlan?.coverage?.uncoveredTestPointIds)
      ? fullTestPlan.coverage.uncoveredTestPointIds.map(String)
      : []
    const requestedTargetIds = Array.isArray(targetTestPointIds)
      ? targetTestPointIds.map(String).map((id) => id.toUpperCase())
      : []
    const requestedTargetSet = new Set(requestedTargetIds)
    const autoBatchSize = Math.min(24, Math.max(4, Number(process.env.AUTO_COVERAGE_TP_BATCH_SIZE) || 12))
    const activeTargetIds = autoCoverage === true && fullTestPlan
      ? uncoveredIds
        .filter((id) => requestedTargetSet.size === 0 || requestedTargetSet.has(id))
        .slice(0, autoBatchSize)
      : []
    const promptTestPlan = activeTargetIds.length > 0
      ? focusTestPlanForGeneration(fullTestPlan, activeTargetIds)
      : fullTestPlan
    const caseTarget = activeTargetIds.length > 0
      ? {
          min: activeTargetIds.length,
          max: Math.min(24, Math.max(activeTargetIds.length, activeTargetIds.length * 2)),
        }
      : undefined
    const currentAutoRound = Math.max(1, Math.min(100, Number(autoRound) || 1))

    if (activeTargetIds.length > 0) {
      sendSSE('pipeline_progress', {
        step: 'coverage_batch',
        status: 'start',
        round: currentAutoRound,
        targetTestPointIds: activeTargetIds,
        remainingTestPointCount: uncoveredIds.length,
      })
    }

    sendSSE('pipeline_progress', {
      step: 'final_generation',
      status: 'start',
      round: currentAutoRound,
      message: '预分析完成，正在调用模型生成用例…',
    })

    /* --- 构建增强版 Prompt --- */
    const genParams = {
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
      codeChangeSummary: pipelineResult.pipelineUsed ? pipelineResult.codeAnalysisSummary : codeChangeSummary,
      ragContext,
      skillsContext,
      requirementAnalysis: pipelineResult.requirementAnalysis,
      testPlan: promptTestPlan,
      pipelineMode: pipelineResult.pipelineUsed,
      generationMode: existingCaseBriefs.length > 0 ? 'append' : mode,
      existingCases: existingCaseBriefs,
      batchTarget: caseTarget || (mode === 'append' ? { min: batchMin, max: batchMax } : undefined),
      caseTarget,
      targetTestPointIds: activeTargetIds,
    }

    const enhancedUserText = buildEnhancedUserContent(genParams)
    const sysEnhanced = buildEnhancedSystemPrompt(dep, caseTarget)
    const tail = buildEnhancedJsonTail(dep, caseTarget)
    const enhancedTotalPromptChars =
      sysEnhanced.length + enhancedUserText.length + tail.length

    const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.STREAM_FIRST_TOKEN_TIMEOUT_MS) || 180_000
    const STREAM_CLIENT_TIMEOUT_MS = Number(process.env.STREAM_CLIENT_TIMEOUT_MS) || 600_000

    let fullText = ''
    let streamError = null
    /** @type {{ model: string, baseURL: string } | null} */
    let streamCompatMeta = null
    const startTime = Date.now()
    let lastProgressAt = 0
    let openAiRetryPayload = null
    let enhancedRetryAttempted = false
    let enhancedRetryOutputChars = 0
    let ftAborted = false

    try {
      let iter
      if (provider === GEMINI_PROVIDER) {
        iter = streamWithGemini({
          ...genParams,
          _overrideUserContent: enhancedUserText + tail,
          _overrideSystemPrompt: sysEnhanced,
        })
      } else {
        const r = resolveOpenAiCompatible(provider, llmModel)
        if (!r.ok) throw new Error(r.hint)
        streamCompatMeta = { model: r.model, baseURL: safeBaseUrlLabel(r.baseURL) }

        const messages = [
          { role: 'system', content: sysEnhanced },
          { role: 'user', content: enhancedUserText + tail },
        ]
        const enhancedApproxPromptChars = messages.reduce(
          (n, m) => n + String(m.content || '').length,
          0,
        )
        let maxTok = r.maxTokens || 8192
        throwIfPromptExceedsSharedContext(provider, r.model, enhancedApproxPromptChars)
        maxTok = effectiveMaxCompletionTokens(provider, r.model, maxTok, enhancedApproxPromptChars)

        const client = (await import('openai')).default
        const openai = new client({ apiKey: r.apiKey, baseURL: r.baseURL, defaultHeaders: r.defaultHeaders, timeout: r.timeoutMs || STREAM_CLIENT_TIMEOUT_MS })
        openAiRetryPayload = { r, messages, maxTok, approxPromptChars: enhancedApproxPromptChars }
        const createStream = async (useJson, extraSignal) => {
          const body = {
            model: r.model,
            temperature: 0.5,
            max_tokens: maxTok,
            messages,
            stream: r.streaming !== false,
            ...(useJson ? { response_format: { type: 'json_object' } } : {}),
          }
          const sig = extraSignal
            ? AbortSignal.any([ac.signal, extraSignal])
            : ac.signal
          const response = await openai.chat.completions.create(body, { signal: sig })
          if (r.streaming !== false) return response
          return (async function* () {
            yield {
              choices: [{
                delta: { content: response.choices?.[0]?.message?.content || '' },
                finish_reason: response.choices?.[0]?.finish_reason || 'stop',
              }],
            }
          })()
        }

        logLlmDebug('generate-enhanced-stream (OpenAI 兼容) request', {
          baseURL: safeBaseUrlLabel(r.baseURL),
          model: r.model,
          max_tokens: maxTok,
          json_object: true,
          approxPromptChars: enhancedApproxPromptChars,
        })

        const ftAc = new AbortController()

        let stream
        let enhancedJsonDowngraded = false
        try {
          stream = await createStream(true, ftAc.signal)
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          if (/response_format|json_object|unsupported|not support|400/i.test(em)) {
            enhancedJsonDowngraded = true
            logLlmDebug('generate-enhanced-stream json_object rejected, retrying without response_format', {
              error: em,
            })
            stream = await createStream(false, ftAc.signal)
          } else {
            throw e
          }
        }

        console.log(`[stream] llm_stream_start promptChars=${enhancedApproxPromptChars}, model=${r.model}`)

        iter = (async function* () {
          let lastFinishReason = ''
          let yieldedChars = 0
          let reasoningChars = 0
          let gotFirstToken = false
          const firstTokenTimer = setTimeout(() => {
            if (!gotFirstToken) {
              console.warn(`[stream] first_token_timeout ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`)
              ftAborted = true
              ftAc.abort()
            }
          }, FIRST_TOKEN_TIMEOUT_MS)
          try {
            for await (const chunk of stream) {
              if (ac.signal.aborted || ftAc.signal.aborted) break
              const choice = chunk.choices[0]
              if (choice?.finish_reason) lastFinishReason = choice.finish_reason
              /* DeepSeek-Reasoner / V4-Pro 等推理模型先输出 reasoning_content（思考过程），
                 再切到 content（最终答案）。两者出现任一即算「已出首 token」，避免 timer 误杀。 */
              const reasoning = choice?.delta?.reasoning_content
              const delta = choice?.delta?.content
              if ((reasoning || delta) && !gotFirstToken) {
                gotFirstToken = true
                clearTimeout(firstTokenTimer)
                console.log(`[stream] first_token elapsed=${((Date.now() - startTime) / 1000).toFixed(1)}s, kind=${reasoning ? 'reasoning' : 'content'}`)
              }
              if (reasoning) {
                reasoningChars += reasoning.length
                /* thinking 事件不进 fullText，仅推给前端展示进度 */
                sendSSE('thinking', { text: reasoning, totalChars: reasoningChars })
              }
              if (delta) {
                yieldedChars += delta.length
                yield delta
              }
            }
          } finally {
            clearTimeout(firstTokenTimer)
            if (reasoningChars > 0) {
              console.log(`[stream] reasoning_chars=${reasoningChars}`)
            }
            console.log(`[enhanced-stream] finish_reason=${lastFinishReason || '(none)'}, outputChars=${yieldedChars}, reasoningChars=${reasoningChars}, max_tokens=${maxTok}, promptChars=${enhancedApproxPromptChars}, pipeline=${genParams.pipelineMode || false}`)
            logLlmDebug('generate-enhanced-stream (OpenAI 兼容) end', {
              finish_reason: lastFinishReason || '(none)',
              json_object_downgraded: enhancedJsonDowngraded,
              yieldedChars,
            })
            setLastOpenAiCompatibleMeta({
              kind: 'enhanced-stream',
              baseURL: safeBaseUrlLabel(r.baseURL),
              model: r.model,
              max_tokens: maxTok,
              approxPromptChars: enhancedApproxPromptChars,
              json_object_downgraded: enhancedJsonDowngraded,
              finish_reason: lastFinishReason || null,
              outputChars: yieldedChars,
              clientAborted: ac.signal.aborted,
            })
          }
        })()
      }

      for await (const chunk of iter) {
        if (ac.signal.aborted) break
        fullText += chunk
        sendSSE('delta', { text: chunk })

        const now = Date.now()
        if (now - lastProgressAt > 3000) {
          lastProgressAt = now
          const elapsed = ((now - startTime) / 1000).toFixed(0)
          const caseCount = (fullText.match(/"summary"\s*:/g) || []).length
          sendSSE('progress', { chars: fullText.length, estimatedCases: caseCount, elapsedSec: +elapsed })
        }
      }

      if (ftAborted && !fullText && !ac.signal.aborted) {
        streamError = `模型在 ${FIRST_TOKEN_TIMEOUT_MS / 1000} 秒内未返回任何内容，请重试或换通道`
        console.warn(`[stream] first_token_timeout -> streamError set`)
      }

      /* 部分网关在长上下文 + response_format=json_object 下会返回极短空壳；去掉 JSON 模式再拉流一次 */
      if (
        openAiRetryPayload &&
        !streamError &&
        !ac.signal.aborted &&
        provider !== GEMINI_PROVIDER
      ) {
        const probe = tryParsePartialJSON(fullText)
        const len = fullText.trim().length
        const summaryTags = (fullText.match(/"summary"\s*:/g) || []).length
        const needRetry = probe.cases.length === 0 && len < 3000 && (len < 800 || summaryTags < 2)
        if (needRetry) {
          sendSSE('meta', {
            type: 'stream_discard',
            message: '模型首次返回过短或无法解析为有效用例，已自动去掉 JSON 模式重试一次',
          })
          const { r, messages, maxTok, approxPromptChars: retryApproxChars } = openAiRetryPayload
          const O = (await import('openai')).default
          const openai2 = new O({ apiKey: r.apiKey, baseURL: r.baseURL, defaultHeaders: r.defaultHeaders, timeout: r.timeoutMs || STREAM_CLIENT_TIMEOUT_MS })
          logLlmDebug('generate-enhanced-stream retry without json_object', {
            firstPassChars: fullText.length,
            firstPassSummaries: summaryTags,
          })
          const retryFtAc = new AbortController()
          const retrySignal = AbortSignal.any([ac.signal, retryFtAc.signal])
          const retryFtTimer = setTimeout(() => {
            console.warn(`[stream] retry first_token_timeout ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`)
            retryFtAc.abort()
          }, FIRST_TOKEN_TIMEOUT_MS)
          let stream2
          try {
            stream2 = await openai2.chat.completions.create(
              {
                model: r.model,
                temperature: 0.5,
                max_tokens: maxTok,
                messages,
                stream: true,
              },
              { signal: retrySignal },
            )
          } catch (reErr) {
            clearTimeout(retryFtTimer)
            console.warn('[generate-enhanced-stream] short-output retry failed:', reErr)
          }
          if (stream2) {
            fullText = ''
            let lastFinishReason2 = ''
            let yieldedChars2 = 0
            let reasoningChars2 = 0
            let gotRetryFirstToken = false
            try {
              for await (const chunk of stream2) {
                if (ac.signal.aborted || retryFtAc.signal.aborted) break
                const choice = chunk.choices[0]
                if (choice?.finish_reason) lastFinishReason2 = choice.finish_reason
                const reasoning = choice?.delta?.reasoning_content
                const delta = choice?.delta?.content
                if ((reasoning || delta) && !gotRetryFirstToken) {
                  gotRetryFirstToken = true
                  clearTimeout(retryFtTimer)
                }
                if (reasoning) {
                  reasoningChars2 += reasoning.length
                  sendSSE('thinking', { text: reasoning, totalChars: reasoningChars2 })
                }
                if (delta) {
                  yieldedChars2 += delta.length
                  fullText += delta
                  sendSSE('delta', { text: delta })
                  const now = Date.now()
                  if (now - lastProgressAt > 3000) {
                    lastProgressAt = now
                    const elapsed = ((now - startTime) / 1000).toFixed(0)
                    const caseCount = (fullText.match(/"summary"\s*:/g) || []).length
                    sendSSE('progress', { chars: fullText.length, estimatedCases: caseCount, elapsedSec: +elapsed })
                  }
                }
              }
            } finally {
              clearTimeout(retryFtTimer)
            }
            logLlmDebug('generate-enhanced-stream retry end', {
              finish_reason: lastFinishReason2 || '(none)',
              yieldedChars: yieldedChars2,
              reasoningChars: reasoningChars2,
            })
            enhancedRetryAttempted = true
            enhancedRetryOutputChars = yieldedChars2
            setLastOpenAiCompatibleMeta({
              kind: 'enhanced-stream',
              baseURL: safeBaseUrlLabel(r.baseURL),
              model: r.model,
              max_tokens: maxTok,
              approxPromptChars: retryApproxChars,
              json_object_downgraded: true,
              finish_reason: lastFinishReason2 || null,
              outputChars: yieldedChars2,
              clientAborted: ac.signal.aborted,
              retryAfterShortOutput: true,
            })
          }
        }
      }
    } catch (e) {
      if (ac.signal.aborted) { cleanupAndEnd(); return }
      const errMsg = e instanceof Error ? e.message : '生成失败'
      if (/abort/i.test(errMsg) && !fullText) {
        streamError = `模型在 ${FIRST_TOKEN_TIMEOUT_MS / 1000} 秒内未返回任何内容，请重试或换通道`
      } else {
        streamError = errMsg
      }
      const isQuotaError = /insufficient|quota|balance|rate.limit|429|402|billing/i.test(streamError)
      const errLabel = isQuotaError ? '余额不足或请求限流' : streamError
      console.warn('[stream] error:', errLabel)
      agentDebugLog({
        hypothesisId: 'H1',
        location: 'index.js:generate-enhanced-stream:catch',
        message: 'stream_error_set',
        runId: 'interrupt-trace',
        data: {
          provider,
          model: streamCompatMeta?.model ?? null,
          baseURL: streamCompatMeta?.baseURL ?? null,
          errLen: String(streamError).length,
          errPreview: String(streamError).slice(0, 400),
          fullTextLen: fullText.length,
        },
      })
    }

    if (ac.signal.aborted) { cleanupAndEnd(); return }

    const finalResult = tryParsePartialJSON(fullText)
    sendSSE('pipeline_progress', { step: 'coverage_audit', status: 'start' })
    const auditedTestPlan = pipelineResult.testPlan
      ? applyCasesToTestPlan(pipelineResult.testPlan, [...existingCaseBriefs, ...finalResult.cases])
      : null
    if (auditedTestPlan) {
      sendSSE('coverage_plan', { plan: auditedTestPlan })
      sendSSE('pipeline_progress', {
        step: 'coverage_audit',
        status: 'done',
        coverageRate: auditedTestPlan.coverage.coverageRate,
        uncoveredTestPointCount: auditedTestPlan.coverage.uncoveredTestPointIds.length,
      })
    } else {
      sendSSE('pipeline_progress', { step: 'coverage_audit', status: 'skipped' })
    }
    const depthSpec = getDepthGenerationSpec(dep)
    // #region agent log
    {
      let sumStepLen = 0
      let sumExpLen = 0
      for (const tc of finalResult.cases) {
        sumStepLen += (tc.steps || []).join('').length
        sumExpLen += String(tc.expected || '').length
      }
      const n = finalResult.cases.length
      agentDebugLog({
        hypothesisId: 'H_compare',
        location: 'index.js:generate-enhanced-stream',
        message: 'post_parse_metrics',
        runId: 'post-hints',
        data: {
          provider,
          depth: dep,
          minCasesExpected: depthSpec.minCases,
          promptChars: enhancedTotalPromptChars,
          codeSummaryLen: codeChangeSummary?.length ?? 0,
          ragContextLen: ragContext?.length ?? 0,
          rawResponseChars: fullText.length,
          caseCount: n,
          belowMinCases: n > 0 && n < depthSpec.minCases,
          avgStepChars: n ? Math.round(sumStepLen / n) : 0,
          avgExpectedChars: n ? Math.round(sumExpLen / n) : 0,
          parsePartial: finalResult.partial,
          hadParseError: Boolean(finalResult.parseError),
          shortJsonRetry: enhancedRetryAttempted,
          shortRetryOutputChars: enhancedRetryOutputChars,
        },
      })
    }
    // #endregion
    if (finalResult.cases.length > 0) {
      // #region agent log
      agentDebugLog({
        hypothesisId: 'H2',
        location: 'index.js:generate-enhanced-stream:send_done',
        message: 'done_payload',
        runId: 'interrupt-trace',
        data: {
          caseCount: finalResult.cases.length,
          interrupted: Boolean(streamError),
          interruptReasonPreview: streamError ? String(streamError).slice(0, 320) : null,
          belowMinCases: finalResult.cases.length < depthSpec.minCases,
          partialJson: finalResult.partial,
          provider,
          model: streamCompatMeta?.model ?? null,
        },
      })
      // #endregion
      // 条数是否达到 minCases 仅用于服务端日志/模型提示，不作为前端「质量告警」：
      // 用户可多次追加生成，固定下限易误导；前端只消费 partialJson / shortJsonRetry 等客观信号。
      const qualityHints = {
        actualCases: finalResult.cases.length,
        partialJson: finalResult.partial,
        rawChars: fullText.length,
        shortJsonRetry: enhancedRetryAttempted,
        provider,
      }
      sendSSE('done', {
        cases: finalResult.cases,
        interrupted: !!streamError,
        interruptReason: streamError || undefined,
        partial: finalResult.partial,
        qualityHints,
        testPlan: auditedTestPlan,
      })
    } else if (streamError) {
      sendSSE('error', { error: streamError, raw: fullText.slice(0, 2000) })
    } else {
      sendSSE('parse_error', {
        error: finalResult.parseError || 'JSON 解析失败',
        raw: fullText.slice(0, 2000),
      })
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[stream] done outputChars=${fullText.length}, totalElapsed=${totalElapsed}s, error=${streamError ? 'yes' : 'no'}`)

    cleanupAndEnd()
  } catch (e) {
    if (keepAliveId) { clearInterval(keepAliveId); keepAliveId = null }
    console.error('[generate-enhanced-stream]', e)
    if (!res.headersSent) {
      res.status(500).json({ error: e instanceof Error ? e.message : '生成失败' })
    } else {
      try { res.end() } catch {}
    }
  }
})

/* ========== 预览增强 Prompt（不调 LLM，仅返回组装后的完整提示词） ========== */

app.post('/api/preview-enhanced-prompt', async (req, res) => {
  try {
    const {
      documents, focusText, selectedTypes, depth, timezone,
      codeChanges,
      ragQuery,
    } = req.body || {}

    const types = Array.isArray(selectedTypes) ? selectedTypes.map(String) : ['功能测试']
    const dep = ['dev', 'planning', 'qa'].includes(depth) ? depth : 'qa'
    const docs = (documents || []).map(d => ({
      name: String(d.name || '未命名'),
      text: String(d.text || ''),
      role: typeof d.role === 'string' && d.role.trim() ? d.role.trim() : undefined,
    }))

    const tasks = []

    let codeChangeSummary = ''
    if (codeChanges && codeChanges.mode && Array.isArray(codeChanges.repos) && codeChanges.repos.length > 0) {
      tasks.push(
        gatherCodeContext(codeChanges)
          .then((ctx) => { codeChangeSummary = ctx.text })
          .catch(e => { codeChangeSummary = `[获取代码上下文失败: ${e.message}]` })
      )
    }

    let ragContext = ''
    if (ragQuery?.trim()) {
      tasks.push(
        queryContext(ragQuery, { mode: 'mix', topK: 30 }).then(c => { ragContext = c })
          .catch(e => { ragContext = `[RAG 查询失败: ${e.message}]` })
      )
    } else if (docs.length > 0) {
      const autoQuery = docs.map(d => d.name).join(' ') + ' ' + (focusText || '')
      tasks.push(
        queryContext(autoQuery.trim(), { mode: 'mix', topK: 20 }).then(c => { ragContext = c })
          .catch(() => { /* RAG 不可用时静默跳过 */ })
      )
    }

    await Promise.allSettled(tasks)

    const genParams = {
      documents: docs,
      focusText: focusText || '',
      selectedTypes: types,
      depth: dep,
      timezone: timezone || 'Asia/Shanghai',
      maxTotalChars: MAX_TOTAL_CHARS,
      codeChangeSummary,
      ragContext,
    }

    const userContent = buildEnhancedUserContent(genParams)
    const sysEnhanced = buildEnhancedSystemPrompt(dep)
    const tail = buildEnhancedJsonTail(dep)

    res.json({
      systemPrompt: sysEnhanced,
      userPrompt: userContent + tail,
      meta: {
        codeChangeLength: codeChangeSummary.length,
        ragContextLength: ragContext.length,
        documentCount: docs.length,
        totalPromptChars: sysEnhanced.length + userContent.length + tail.length,
      },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ========== JSON 截断修复 ========== */

function chunkArray(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 从首个 { 起按括号深度提取对象，字符串内括号不计入（适配模型前后废话、markdown） */
function extractBalancedJsonObject(s) {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/** 截到 {"cases" 开头的 JSON，减少「好的以下是 JSON」类前缀导致 parse 失败 */
function clipToJsonObjectStart(s) {
  const m = s.match(/\{\s*"cases"\s*:/)
  if (m && m.index != null) return s.slice(m.index)
  const i = s.indexOf('{')
  return i >= 0 ? s.slice(i) : s
}

/** 尾随逗号等轻微非标准 JSON（不改变字符串内的逗号，仅删 `,]` / `,}` 形态） */
function parseJsonLenient(s) {
  if (typeof s !== 'string') return null
  let t = s.trim()
  try {
    return JSON.parse(t)
  } catch {
    try {
      t = t.replace(/,\s*([}\]])/g, '$1')
      return JSON.parse(t)
    } catch {
      return null
    }
  }
}

/** 从首个 [ 起提取平衡数组（字符串内括号忽略） */
function extractBalancedJsonArray(s) {
  const start = s.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function tryParsePartialJSON(text) {
  const result = { cases: [], partial: false, parseError: null }

  let s0 = String(text ?? '').trim()
  s0 = s0.replace(/^\uFEFF/, '')
  s0 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  // A. 根级为数组（部分模型 / 中转直接输出 [{...},...]）
  if (s0.startsWith('[')) {
    const arrStr = extractBalancedJsonArray(s0) || s0
    const parsedArr = parseJsonLenient(arrStr)
    if (parsedArr && Array.isArray(parsedArr)) {
      try {
        result.cases = normalizeCases({ cases: parsedArr })
        if (result.cases.length > 0) return result
      } catch { /* fallthrough */ }
    }
  }

  let normalized = clipToJsonObjectStart(s0)

  // 0. 从流式/网关拼接结果中提取平衡 JSON 子串再解析
  const balanced = extractBalancedJsonObject(normalized)
  if (balanced) {
    const parsed = parseJsonLenient(balanced)
    if (parsed) {
      try {
        result.cases = normalizeCases(parsed)
        if (result.cases.length > 0) return result
      } catch { /* fallthrough */ }
    }
  }

  // 1. 正常解析
  const parsed1 = parseJsonLenient(normalized)
  if (parsed1) {
    try {
      const cases = normalizeCases(parsed1)
      if (cases.length > 0) {
        result.cases = cases
        return result
      }
    } catch { /* fallthrough */ }
  }

  // 2. 尝试去掉 markdown 围栏（若上面未完全去掉）
  let cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  cleaned = clipToJsonObjectStart(cleaned)

  // For a truncated cases array, keep only objects that the model fully closed.
  // The unfinished tail must never be repaired into a seemingly valid test case.
  const completeCases = extractCompleteCaseObjects(cleaned)
  if (completeCases.length > 0) {
    result.cases = normalizeCases({ cases: completeCases })
    result.partial = true
    return result
  }
  if (/"cases"\s*:\s*\[/.test(cleaned)) {
    result.partial = true
    result.parseError = '模型输出在首条用例完成前已被截断，没有可安全保留的完整用例。'
    return result
  }

  // 3. 尝试修复截断的 JSON：补齐括号（优先对平衡子串操作）
  const truncBase = extractBalancedJsonObject(cleaned) || cleaned
  for (const suffix of ['', '}', ']}', '"]}', '"}]}'  , '""]}', '""}]}']) {
    try {
      const parsed = parseJsonLenient(truncBase + suffix)
      if (!parsed) continue
      const cases = normalizeCases(parsed)
      if (cases.length > 0) {
        result.cases = cases
        result.partial = suffix.length > 0
        return result
      }
    } catch { /* try next */ }
  }

  // 4. 逐对象提取：找所有看起来像用例的 JSON 对象
  const objRegex = /\{[^{}]*"summary"\s*:\s*"[^"]*"[^{}]*\}/g
  const matches = cleaned.match(objRegex)
  if (matches && matches.length > 0) {
    const extracted = []
    for (const m of matches) {
      try {
        const obj = parseJsonLenient(m)
        if (obj && obj.summary) extracted.push(obj)
      } catch { /* skip */ }
    }
    if (extracted.length > 0) {
      result.cases = normalizeCases({ cases: extracted })
      result.partial = true
      return result
    }
  }

  // 5. 用嵌套感知提取：匹配大括号平衡的对象
  const caseObjects = []
  let depth = 0, start = -1
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const block = cleaned.slice(start, i + 1)
        try {
          const obj = parseJsonLenient(block)
          if (obj && obj.summary) caseObjects.push(obj)
        } catch { /* skip */ }
        start = -1
      }
    }
  }
  if (caseObjects.length > 0) {
    result.cases = normalizeCases({ cases: caseObjects })
    result.partial = true
    return result
  }

  const n = text.length
  const tailHint =
    n < 200
      ? ' 输出极短时，常见于中转网关在长提示词或 json_object 模式下返回空壳；增强生成已支持自动去掉 JSON 模式重试，若仍失败请暂时关闭「代码变更」或缩小文档后再试。'
      : ' 若模型输出被截断，可调高 max_tokens 或减少需求/代码上下文长度。'
  result.parseError = `JSON 解析失败，已输出 ${n} 个字符但无法提取用例。${tailHint}`
  return result
}

/* ========== 定时扫描 API ========== */

app.post('/api/scan/run', async (_req, res) => {
  try {
    const report = await runDailyScan()
    res.json({ ok: true, totalChanges: report.totalChanges, scanTime: report.scanTime })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/scan/last', (_req, res) => {
  const result = getLastScanResult()
  if (!result) return res.json({ ok: false, message: '暂无扫描结果' })
  res.json({ ok: true, ...result })
})

app.post('/api/scan/scheduler', (req, res) => {
  const { action, cron: cronExpr } = req.body
  if (action === 'start') {
    startScheduler(cronExpr || '0 9 * * *')
    res.json({ ok: true, message: '定时扫描已启动' })
  } else if (action === 'stop') {
    stopScheduler()
    res.json({ ok: true, message: '定时扫描已停止' })
  } else {
    res.status(400).json({ error: '无效 action，需要 start 或 stop' })
  }
})

/* ========== 用例库 REST API（后端文件存储，不再依赖前端 IndexedDB）========== */

import * as caseLib from './caseLibrary.js'
import * as contractLib from './contractLibrary.js'

app.get('/api/case-library/projects', (_req, res) => {
  res.json(caseLib.getAllProjects())
})

app.post('/api/case-library/projects', (req, res) => {
  const { name, description } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: '项目名称不能为空' })
  res.json(caseLib.createProject(name.trim(), description || ''))
})

app.delete('/api/case-library/projects/:id', (req, res) => {
  caseLib.deleteProject(req.params.id)
  res.json({ ok: true })
})

app.get('/api/case-library/projects/:id/modules', (req, res) => {
  res.json(caseLib.getProjectModules(req.params.id))
})

app.post('/api/case-library/modules', (req, res) => {
  const { projectId, name, parentId } = req.body || {}
  if (!projectId || !name?.trim()) return res.status(400).json({ error: '缺少必要参数' })
  res.json(caseLib.createModule(projectId, name.trim(), parentId || null))
})

app.put('/api/case-library/modules/:id', (req, res) => {
  caseLib.updateModule(req.body)
  res.json({ ok: true })
})

app.delete('/api/case-library/modules/:id', (req, res) => {
  caseLib.deleteModule(req.params.id)
  res.json({ ok: true })
})

app.post('/api/case-library/modules/:id/rename', (req, res) => {
  caseLib.renameModule(req.params.id, req.body.name)
  res.json({ ok: true })
})

app.get('/api/case-library/projects/:id/cases', (req, res) => {
  const q = req.query.q
  if (q) {
    res.json(caseLib.searchCasesInProject(req.params.id, q))
  } else {
    res.json(caseLib.getCasesByProject(req.params.id))
  }
})

app.get('/api/case-library/modules/:id/cases', (req, res) => {
  res.json(caseLib.getCasesByModule(req.params.id))
})

app.post('/api/case-library/import', (req, res) => {
  const { cases, projectId, moduleId } = req.body || {}
  if (!projectId || !moduleId || !Array.isArray(cases)) {
    return res.status(400).json({ error: '缺少必要参数' })
  }
  const n = caseLib.importFromGeneration(cases, projectId, moduleId)
  res.json({ imported: n })
})

app.put('/api/case-library/cases/:id', (req, res) => {
  caseLib.updateCase(req.body)
  res.json({ ok: true })
})

app.delete('/api/case-library/cases/:id', (req, res) => {
  caseLib.deleteCase(req.params.id)
  res.json({ ok: true })
})

app.post('/api/case-library/cases/batch-delete', (req, res) => {
  caseLib.deleteCases(req.body.ids || [])
  res.json({ ok: true })
})

app.get('/api/case-library/projects/:id/case-count', (req, res) => {
  res.json({ count: caseLib.countCasesByProject(req.params.id) })
})

app.get('/api/case-library/projects/:id/module-case-counts', (req, res) => {
  res.json({ counts: caseLib.getModuleCaseCountsByProject(req.params.id) })
})

/* ========== 质量契约草稿 REST API ========== */

app.get('/api/quality-contracts/drafts', (req, res) => {
  const filters = {}
  if (req.query.projectId) filters.projectId = req.query.projectId
  if (req.query.moduleId) filters.moduleId = req.query.moduleId
  res.json(contractLib.listDrafts(Object.keys(filters).length ? filters : undefined))
})

app.post('/api/quality-contracts/drafts', (req, res) => {
  try {
    const draft = contractLib.createDraft(req.body || {})
    res.json(draft)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/quality-contracts/drafts/:id', (req, res) => {
  const updated = contractLib.updateDraft(req.params.id, req.body || {})
  if (!updated) return res.status(404).json({ error: '草稿不存在' })
  res.json(updated)
})

app.delete('/api/quality-contracts/drafts/:id', (req, res) => {
  contractLib.deleteDraft(req.params.id)
  res.json({ ok: true })
})

/* ========== TKT-20260429-014 · 单契约走查薄封装（按 contractId） ==========
 * 复用 /api/contract-code-review 的核心链路（gatherCodeContext + inferCandidateDirs +
 * runCodeReview*），区别在于：
 *   - 用 contractId 查 listDrafts() 得到契约，自动取 rule/boundaryHint/moduleLabel
 *   - codeChanges 优先 req.body.codeChanges，否则降级 contract.codeContext，仍空 → 400
 *   - 走查完成后调 contractReviewResults.appendResult 落盘
 *   - 保留 ST-004 Pass 2 提案触发链路（与主端点行为一致）
 */
app.post('/api/quality-contracts/drafts/:id/code-review', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: '缺少契约 id' })

    const drafts = contractLib.listDrafts()
    const contract = drafts.find((d) => d && d.id === id)
    if (!contract) return res.status(404).json({ error: '契约不存在' })

    // BD-5：codeChanges 优先 body，否则降级契约自身 codeContext，仍空 → 400 拒绝
    const codeChanges =
      req.body && typeof req.body === 'object' && req.body.codeChanges
        ? req.body.codeChanges
        : contract.codeContext
    if (!codeChanges || typeof codeChanges !== 'object') {
      return res.status(400).json({
        error: '未提供 codeChanges：请在请求体传入 codeChanges，或先在契约页步骤 ④ 配置代码关联',
      })
    }

    const rule = String(contract.rule || '').trim()
    if (!rule) return res.status(400).json({ error: '该契约的业务规则为空，无法走查' })
    const boundaryHint = String(contract.boundaryHint || '')
    const moduleLabel = String(contract.moduleLabel || '').trim()

    const { text: codeContextText, stats: codeContextStats } = await gatherCodeContext(codeChanges)
    if (!String(codeContextText).trim()) {
      return res.status(400).json({
        error: '未能收集到代码材料：请勾选仓库并配置智能检索关键词、目录或变更范围',
      })
    }

    const bodyPv =
      typeof req.body?.llmProvider === 'string' ? req.body.llmProvider.trim().toLowerCase() : ''
    const provider = bodyPv && isKnownLlmProvider(bodyPv)
      ? bodyPv
      : (process.env.LLM_PROVIDER || 'openai').trim().toLowerCase()
    if (bodyPv && !isKnownLlmProvider(bodyPv)) {
      return res.status(400).json({ error: `不支持的 llmProvider：${bodyPv}` })
    }
    const gate = healthForProvider(provider)
    if (!gate.ok) {
      return res.status(400).json({
        error: gate.hint || `当前通道「${provider}」未就绪`,
      })
    }

    const reviewParams = {
      rule,
      boundaryHint,
      codeContextText,
    }

    const inferred = inferCandidateDirs(moduleLabel, rule)
    const agentRepos = []
    const seenRepoIds = new Set()
    if (Array.isArray(codeChanges?.repos)) {
      for (const rc of codeChanges.repos) {
        const rid = rc?.repoId
        if (!rid || seenRepoIds.has(rid)) continue
        const meta = getRepo(rid)
        if (!meta) continue
        seenRepoIds.add(rid)
        agentRepos.push({ repoId: meta.id, repoName: meta.name })
      }
    }
    const extraDirHints = []
    if (Array.isArray(codeChanges?.repos)) {
      for (const rc of codeChanges.repos) {
        if (typeof rc?.directory === 'string' && rc.directory.trim()) {
          extraDirHints.push(rc.directory.trim())
        }
      }
    }
    const enrichedParams = {
      ...reviewParams,
      moduleLabel,
      dirHints: inferred.dirHints,
      fileKeywords: inferred.fileKeywords,
      fallback: inferred.fallback,
      extraDirHints,
      repos: agentRepos,
    }

    let rawText
    if (provider === GEMINI_PROVIDER) {
      rawText = await runCodeReviewGemini(enrichedParams)
    } else {
      const agentCtx = {
        repoContext: {
          repos: agentRepos,
          dirHints: inferred.dirHints,
          fileKeywords: inferred.fileKeywords,
          fallback: inferred.fallback,
        },
      }
      const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
      if (!r.ok) throw new Error(r.hint)
      rawText = await runCodeReviewOpenAICompatible(
        {
          apiKey: r.apiKey,
          baseURL: r.baseURL,
          model: r.model,
          maxTokens: r.maxTokens,
          providerId: r.id,
          defaultHeaders: r.defaultHeaders,
          timeoutMs: r.timeoutMs,
        },
        enrichedParams,
        agentCtx,
      )
    }

    const parsed = tryParseCodeReviewResponse(rawText)
    if (!parsed.ok) {
      throw new Error(parsed.error || '代码走查结果 JSON 无法解析')
    }

    // ST-004 Pass 2 提案触发（与 /api/contract-code-review 同条件）
    let ruleProposalId = null
    let ruleProposalDraft = null
    if (
      provider !== GEMINI_PROVIDER &&
      parsed.result.conclusion === 'fail' &&
      Array.isArray(parsed.result.evidence) &&
      parsed.result.evidence.length > 0
    ) {
      try {
        const r = resolveOpenAiCompatible(provider, req.body?.llmModel)
        if (r.ok) {
          const pass2Result = await maybeGenerateRuleProposal({
            parsedResult: parsed.result,
            repoContext: {
              fallback: inferred.fallback,
              dirHints: inferred.dirHints,
              fileKeywords: inferred.fileKeywords,
            },
            moduleLabel,
            rule,
            contractId: id,
            taskId: 'TKT-20260429-014',
            pass2LlmOpts: {
              apiKey: r.apiKey,
              baseURL: r.baseURL,
              model: r.model,
              providerId: r.id,
              defaultHeaders: r.defaultHeaders,
              timeoutMs: r.timeoutMs,
            },
          })
          ruleProposalId = pass2Result.proposalId
          ruleProposalDraft = pass2Result.ruleProposalDraft
        }
      } catch (e) {
        console.warn('[contracts/drafts/code-review][pass-2]', e instanceof Error ? e.message : e)
      }
    }

    // 落盘：先 append 再返回（appendResult 内部 FIFO 截断到最近 3 条）
    const saved = contractReviewResults.appendResult(id, parsed.result, { llmProvider: provider })

    res.json({
      ...parsed.result,
      ...(ruleProposalId ? { ruleProposalId, ruleProposalDraft } : {}),
      meta: {
        codeContextChars: codeContextText.length,
        codeContextStats,
      },
      contractId: id,
      runAt: saved.runAt,
      savedAt: saved.runAt,
    })
  } catch (e) {
    console.error('[contracts/drafts/code-review]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '代码走查失败' })
  }
})

/** 查询指定契约的最近 N 条走查历史（默认 3） */
app.get('/api/quality-contracts/drafts/:id/code-review-results', (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: '缺少契约 id' })
    const limit = Number(req.query.limit) || 3
    const list = contractReviewResults.listResultsForContract(id, limit)
    res.json(list)
  } catch (e) {
    console.error('[contracts/drafts/code-review-results]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '读取走查历史失败' })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[ai-test-platform API] http://127.0.0.1:${PORT}`)
  console.log(`  LLM_PROVIDER=${process.env.LLM_PROVIDER || 'openai'}`)

  if (process.env.ENABLE_DAILY_SCAN === 'true') {
    startScheduler(process.env.SCAN_CRON || '0 9 * * *')
  }
})

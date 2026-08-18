/**
 * 多步 Agent 流水线
 *
 * 将原来的"单次 LLM 调用"拆为：
 *   Step 1: 代码预分析（每文件独立 LLM → 结构化结论）
 *   Step 2: 需求分析（文档 + 代码结论 → 结构化需求分解 + 信息不足标注）
 *   Step 3: 用例生成（现有流程，但接收预消化输入）
 *
 * 设计原则（参考 QA 智能测试平台 TOOL_TIMEOUT=300s 的"慢但稳"哲学）：
 * - 各步骤使用现有 OpenAI-compatible 基础设施
 * - Step 1-2 为非流式短输出，Step 3 为流式长输出
 * - 通过 onProgress 回调报告进度（由调用方发 SSE）
 * - 不设整体硬超时；每个 LLM 调用各自有 SDK 超时兜底
 * - 单步失败时返回明确 stub（"信息不足：xxx"），让 pipeline 走完不让整体崩
 * - 用绝对时间阈值（STEP_2_SKIP_AFTER_MS）而非百分比来决定是否跳过 Step 2
 */
import OpenAI from 'openai'
import { resolveOpenAiCompatible } from './llm/providers.js'

const SINGLE_CALL_TIMEOUT_MS = Number(process.env.PIPELINE_SINGLE_CALL_TIMEOUT_MS) || 240_000
const MAX_FILES_TO_ANALYZE = 12
const STEP_2_SKIP_AFTER_MS = Number(process.env.PIPELINE_STEP2_SKIP_AFTER_MS) || 5 * 60 * 1000
const BATCH_CHAR_THRESHOLD = 18_000
const MAX_FILES_PER_BATCH = 5

const HONESTY_SYSTEM = '最高优先级：诚实。未知不说、绝不捏造。所有分析仅基于提供的代码和需求文档。信息不足时明确写出"信息不足：需要XXX说明"，并指出缺失项。不得虚构文件、函数、配置或数据。'

function makeClient(provider, modelOverride) {
  const r = resolveOpenAiCompatible(provider, modelOverride)
  if (!r.ok) throw new Error(r.hint)
  return {
    client: new OpenAI({ apiKey: r.apiKey, baseURL: r.baseURL, timeout: SINGLE_CALL_TIMEOUT_MS }),
    model: r.model,
    maxTokens: Math.min(r.maxTokens || 4096, 4096),
  }
}

/**
 * 非流式 LLM 调用（用于中间步骤，输出较短）
 */
async function llmCall(provider, messages, { maxTokens = 4096, signal, model: modelOverride } = {}) {
  const { client, model, maxTokens: providerMax } = makeClient(provider, modelOverride)
  const tok = Math.min(maxTokens, providerMax)
  const t0 = Date.now()
  const promptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: tok,
      messages,
      ...(signal ? { signal } : {}),
    })
    const output = res.choices?.[0]?.message?.content || ''
    console.log(`[pipeline:llmCall] ${((Date.now() - t0) / 1000).toFixed(1)}s, prompt=${promptChars}字符, output=${output.length}字符`)
    return output
  } catch (e) {
    console.warn(`[pipeline:llmCall] ${((Date.now() - t0) / 1000).toFixed(1)}s FAILED: ${e.message}`)
    throw e
  }
}

// ─── Step 1: 代码预分析 ───────────────────────────────────────

const CODE_ANALYSIS_SYSTEM = `${HONESTY_SYSTEM}
你是资深QA工程师。请对提供的源码文件进行精准分析，输出结构化结论。
只输出事实；不要输出代码块；信息不足时直接标注"信息不足"。`

function buildFileAnalysisPrompt(filePath, fileContent, requirementHint) {
  return [
    { role: 'system', content: CODE_ANALYSIS_SYSTEM },
    {
      role: 'user',
      content: `文件：${filePath}
${requirementHint ? `\n当前需求概要：${requirementHint}\n` : ''}
## 源码内容
${fileContent}

请输出以下结构化分析（中文，列表格式）：
- 文件职责：该文件/类的核心职责，一句话概括
- 需求相关性：与当前需求的哪个步骤/功能相关？不相关则写"与当前需求无直接关联"
- 关键接口：列出主要公开函数/方法名及其作用（最多 8 个）
- 入参校验与异常分支：代码中的参数检查、空值保护、错误处理逻辑
- 边界条件：数值范围、状态约束、时序依赖等
- 配置与依赖：依赖的配置表/事件/定时器/外部模块
- 风险点：1-3 条，基于代码逻辑推断的潜在测试风险
- 信息不足项：该文件中无法仅从代码确定的信息（如配置表结构、外部接口行为等）`,
    },
  ]
}

async function analyzeOneFile(provider, filePath, fileContent, requirementHint, signal, model) {
  try {
    const trimmed = fileContent.length > 30_000
      ? fileContent.slice(0, 30_000) + '\n\n[... 文件过长，已截取前 30000 字符 ...]'
      : fileContent
    const messages = buildFileAnalysisPrompt(filePath, trimmed, requirementHint)
    const analysis = await llmCall(provider, messages, { maxTokens: 2048, signal, model })
    return { file: filePath, analysis, ok: true }
  } catch (e) {
    return {
      file: filePath,
      analysis: `信息不足：该文件分析失败（${e.message}），请结合其他文件与需求文档判断。`,
      ok: false,
    }
  }
}

function selectTopFiles(codeFiles, requirementHint, topN) {
  const kws = (requirementHint || '').split(/[\s,;，；、]+/).filter(w => w.length >= 2)

  const scored = codeFiles
    .filter(f => f.content && !f.content.startsWith('[') && f.content.length > 50)
    .map(f => {
      let score = 0
      const lower = (f.path + '\n' + f.content.slice(0, 2000)).toLowerCase()
      for (const kw of kws) {
        if (lower.includes(kw.toLowerCase())) score += 10
      }
      if (f.content.length > 500 && f.content.length < 20_000) score += 5
      if (/\.(cs|ts|js|py|lua|java|go)$/i.test(f.path)) score += 3
      return { ...f, score }
    })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}

function batchSmallFiles(files) {
  const batches = []
  let currentBatch = []
  let currentChars = 0

  for (const f of files) {
    if ((currentChars + f.content.length > BATCH_CHAR_THRESHOLD || currentBatch.length >= MAX_FILES_PER_BATCH) && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }
    currentBatch.push(f)
    currentChars += f.content.length
  }
  if (currentBatch.length > 0) batches.push(currentBatch)
  return batches
}

const BATCH_ANALYSIS_SYSTEM = `${HONESTY_SYSTEM}
你是资深QA工程师。请对以下多个源码文件进行精准分析，对每个文件分别输出结构化结论。
只输出事实；不要输出代码块；信息不足时直接标注"信息不足"。每个文件的分析控制在 5-8 行。`

async function analyzeBatch(provider, files, requirementHint, signal, model) {
  if (files.length === 1) {
    return [await analyzeOneFile(provider, files[0].path, files[0].content, requirementHint, signal, model)]
  }

  const fileList = files.map(f => {
    const trimmed = f.content.length > 15_000
      ? f.content.slice(0, 15_000) + '\n[... 截断 ...]'
      : f.content
    return `=== ${f.path} ===\n${trimmed}`
  }).join('\n\n')

  const messages = [
    { role: 'system', content: BATCH_ANALYSIS_SYSTEM },
    {
      role: 'user',
      content: `${requirementHint ? `当前需求概要：${requirementHint}\n\n` : ''}以下是 ${files.length} 个源码文件，请对每个文件分别输出简要分析：

${fileList}

对每个文件输出（中文，格式为"## 文件路径"开头）：
- 文件职责（一句话）
- 需求相关性
- 关键接口（最多 5 个函数名及作用）
- 风险点（1-2 条）
- 信息不足项`,
    },
  ]

  try {
    const analysis = await llmCall(provider, messages, { maxTokens: 3000, signal, model })
    return [{ file: files.map(f => f.path).join(', '), analysis, ok: true }]
  } catch (e) {
    return [{
      file: files.map(f => f.path).join(', '),
      analysis: `信息不足：该批次（${files.length} 个文件）分析失败（${e.message}），请结合其他批次与需求文档判断。`,
      ok: false,
    }]
  }
}

export async function preAnalyzeCodeFiles(provider, codeFiles, requirementHint, opts = {}) {
  const { onProgress, signal, concurrency = 3, model } = opts

  if (!codeFiles?.length) {
    return { analyses: [], summaryText: '' }
  }

  const selected = selectTopFiles(codeFiles, requirementHint, MAX_FILES_TO_ANALYZE)
  const skipped = codeFiles.length - selected.length

  onProgress?.({
    step: 'code_analysis',
    status: 'start',
    totalFiles: selected.length,
    skippedFiles: skipped,
    message: skipped > 0 ? `从 ${codeFiles.length} 个文件中选取最相关的 ${selected.length} 个分析` : undefined,
  })

  const batches = batchSmallFiles(selected)
  const analyses = []
  let completed = 0
  const startTime = Date.now()

  const queue = [...batches]

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) break
      const batch = queue.shift()
      if (!batch) break
      const batchLabel = batch.length === 1 ? batch[0].path : `${batch.length} 个文件`
      onProgress?.({
        step: 'code_analysis',
        status: 'analyzing',
        file: batchLabel,
        progress: `${completed + 1}/${batches.length}`,
      })
      const results = await analyzeBatch(provider, batch, requirementHint, signal, model)
      analyses.push(...results)
      completed++
      onProgress?.({
        step: 'code_analysis',
        status: 'file_done',
        file: batchLabel,
        ok: analyses[analyses.length - 1]?.ok ?? false,
        progress: `${completed}/${batches.length}`,
      })
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => worker())
  await Promise.allSettled(workers)

  if (signal?.aborted) {
    onProgress?.({ step: 'code_analysis', status: 'aborted', message: '代码预分析被取消，使用已完成的结果' })
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)
  onProgress?.({
    step: 'code_analysis',
    status: 'done',
    totalFiles: selected.length,
    successCount: analyses.filter(a => a.ok).length,
    elapsedSec,
    skippedFiles: skipped,
  })

  const summaryText = formatAnalysesSummary(analyses)
  return { analyses, summaryText }
}

function formatAnalysesSummary(analyses) {
  if (!analyses.length) return ''
  const parts = ['## 代码预分析结论（由独立分析 Agent 逐文件生成，非原始代码）\n']
  for (const a of analyses) {
    parts.push(`### ${a.file}${a.ok ? '' : '（分析失败）'}\n${a.analysis}\n`)
  }
  return parts.join('\n')
}

// ─── Step 2: 需求分析 ─────────────────────────────────────────

const REQUIREMENT_ANALYSIS_SYSTEM = `${HONESTY_SYSTEM}
你是资深QA专家。请基于需求文档和代码分析结论，产出结构化的需求分析报告。
重点关注：需求完整性、信息缺失项、测试风险。
禁止套用通用模板，必须基于当前需求的实际内容。`

export async function analyzeRequirements(provider, documentText, codeAnalysisSummary, ragContext, opts = {}) {
  const { onProgress, signal, model } = opts

  onProgress?.({ step: 'requirement_analysis', status: 'start' })

  const docTruncated = documentText.length > 60_000
    ? documentText.slice(0, 60_000) + '\n[... 文档过长已截取 ...]'
    : documentText

  const messages = [
    { role: 'system', content: REQUIREMENT_ANALYSIS_SYSTEM },
    {
      role: 'user',
      content: `请基于以下信息产出结构化需求分析报告（简体中文 Markdown）：

## 需求文档
${docTruncated}

${codeAnalysisSummary ? `## 代码分析结论\n${codeAnalysisSummary}\n` : ''}
${ragContext ? `## 知识库参考\n${ragContext}\n` : ''}

输出结构（根据实际内容灵活调整，不要套用固定模板）：
1. **需求概要**：功能目标与业务动机（1-3 句）
2. **功能点拆解**：按步骤/模块列出每个可测试的功能点
3. **业务规则**：从文档中提取的核心业务逻辑和约束条件
4. **状态与流程**：关键状态流转、前后端交互（如有代码分析佐证）
5. **信息不足项**：逐条列出文档中描述不完整或缺失的信息，格式为"信息不足：需要XXX说明"
6. **测试风险**：基于需求和代码分析的高风险点

要求：
- 只描述文档和代码分析中明确提到的内容
- 如果文档对某功能描述不完整，必须在「信息不足项」中列出
- 禁止凭空想象文档未提及的功能`,
    },
  ]

  const reqAc = new AbortController()
  const combinedSig = signal
    ? AbortSignal.any([signal, reqAc.signal])
    : reqAc.signal
  const reqTimer = setTimeout(() => reqAc.abort(), SINGLE_CALL_TIMEOUT_MS)

  try {
    const analysis = await llmCall(provider, messages, { maxTokens: 4096, signal: combinedSig, model })
    clearTimeout(reqTimer)
    onProgress?.({ step: 'requirement_analysis', status: 'done' })
    return { requirementAnalysis: analysis, ok: true }
  } catch (e) {
    clearTimeout(reqTimer)
    onProgress?.({ step: 'requirement_analysis', status: 'error', error: e.message })
    return { requirementAnalysis: '', ok: false }
  }
}

// ─── 流水线编排 ────────────────────────────────────────────────

export async function runPipeline(params) {
  const { provider, model, codeFiles, documentText, ragContext, requirementHint, opts = {} } = params
  const { onProgress, signal } = opts

  const pipelineStart = Date.now()

  let codeAnalysisSummary = ''
  let requirementAnalysis = ''

  if (codeFiles?.length > 0) {
    try {
      const result = await preAnalyzeCodeFiles(provider, codeFiles, requirementHint, {
        onProgress,
        signal,
        concurrency: 3,
        model,
      })
      codeAnalysisSummary = result.summaryText
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn('[pipeline] 代码预分析整体失败，降级为原始代码:', e.message)
      onProgress?.({ step: 'code_analysis', status: 'error', error: e.message })
    }
  }

  if (signal?.aborted) {
    onProgress?.({ step: 'requirement_analysis', status: 'skipped', message: '已被取消，跳过需求分析' })
  } else if (documentText) {
    const elapsed = Date.now() - pipelineStart
    if (elapsed > STEP_2_SKIP_AFTER_MS) {
      console.warn(`[pipeline] 代码预分析已耗时 ${(elapsed / 1000).toFixed(1)}s，超过阈值 ${(STEP_2_SKIP_AFTER_MS / 1000).toFixed(0)}s，跳过需求分析`)
      onProgress?.({
        step: 'requirement_analysis',
        status: 'skipped',
        message: `代码预分析耗时较长（${(elapsed / 1000).toFixed(0)}s），跳过需求分析以节省时间`,
      })
    } else {
      try {
        const result = await analyzeRequirements(provider, documentText, codeAnalysisSummary, ragContext, {
          onProgress,
          signal,
          model,
        })
        if (result.ok) {
          requirementAnalysis = result.requirementAnalysis
        }
      } catch (e) {
        if (signal?.aborted) { /* swallow, use what we have */ }
        else {
          console.warn('[pipeline] 需求分析失败，降级:', e.message)
          onProgress?.({ step: 'requirement_analysis', status: 'error', error: e.message })
        }
      }
    }
  }

  const totalSec = ((Date.now() - pipelineStart) / 1000).toFixed(1)
  console.log(`[pipeline] 完成，总耗时 ${totalSec}s，代码分析=${codeAnalysisSummary.length}字符，需求分析=${requirementAnalysis.length}字符`)

  return {
    codeAnalysisSummary,
    requirementAnalysis,
    pipelineUsed: Boolean(codeAnalysisSummary || requirementAnalysis),
  }
}

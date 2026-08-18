import { GoogleGenerativeAI } from '@google/generative-ai'
import { CODE_REVIEW_SYSTEM_PROMPT, buildCodeReviewUserContent } from '../prompt-code-review.js'

function makeModel() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error('未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）')
  }
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const genAI = new GoogleGenerativeAI(key)
  return { model: genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: CODE_REVIEW_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      // ST-003 GEMINI.1：maxOutputTokens 强下限 8192（与 OpenAI 通道 Q1 决议同步），避免低配默认 max_tokens 截断 schema
      maxOutputTokens: 8192,
      temperature: 0.25,
    },
  }), modelName }
}

/**
 * Gemini 通道（QC-15 后输出格式与 OpenAI-compatible 通道统一）：
 * - 输入：消费与 OpenAI 同源的 enrichedParams（含 dirHints/fileKeywords/repos/fallback/extraDirHints/moduleLabel/codeContextText）
 * - 输出：单层 { conclusion, confidence, reasoning, evidence, gaps, filesRead, toolCallsUsed }
 *   注意 Gemini SDK 的 function-calling 协议差异，本通道暂不做 tool calling 升级，故输出由模型一次性给出。
 *
 * @param {{
 *   rule: string,
 *   boundaryHint?: string,
 *   moduleLabel?: string,
 *   codeContextText?: string,
 *   dirHints?: string[],
 *   fileKeywords?: string[],
 *   repos?: { repoId: string, repoName: string }[],
 *   fallback?: boolean,
 *   extraDirHints?: string[],
 * }} params
 * @returns {Promise<string>}
 */
export async function runCodeReviewGemini(params) {
  const { model } = makeModel()
  const userContent = buildCodeReviewUserContent(params)
  const result = await model.generateContent(userContent)
  return result.response.text()
}

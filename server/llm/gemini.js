import { GoogleGenerativeAI } from '@google/generative-ai'
import { SYSTEM_PROMPT, buildUserContent } from '../prompt.js'

function makeModel() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error('未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）')
  }
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const genAI = new GoogleGenerativeAI(key)
  return { model: genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.35,
    },
  }), modelName }
}

/** 非流式（保持向后兼容） */
export async function generateWithGemini(params) {
  const { model } = makeModel()
  const userText = buildUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  const result = await model.generateContent(userText)
  return result.response.text()
}

/** 流式 — 返回 async iterable，每次 yield 一段 delta 文本 */
export async function* streamWithGemini(params) {
  const { model } = makeModel()
  const userText = buildUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  const result = await model.generateContentStream(userText)
  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) yield text
  }
}

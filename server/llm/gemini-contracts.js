import { GoogleGenerativeAI } from '@google/generative-ai'
import { CONTRACT_SYSTEM_PROMPT, buildContractUserContent } from '../prompt-contract.js'

function makeContractModel() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error('未配置 GEMINI_API_KEY（或 GOOGLE_AI_API_KEY）')
  }
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const genAI = new GoogleGenerativeAI(key)
  return { model: genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: CONTRACT_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  }), modelName }
}

/** @param {{ documents: {name:string,text:string,role?:string}[], focusText?: string, depth?: string, timezone?: string, maxTotalChars?: number }} params */
export async function generateContractsWithGemini(params) {
  const { model } = makeContractModel()
  const userText = buildContractUserContent({
    ...params,
    maxTotalChars: params.maxTotalChars ?? 120_000,
  })
  const tail =
    '\n\n请严格输出 JSON 对象，键为 "contracts"，值为契约数组。不要输出其它文字。'
  const fullUserText = userText + tail
  const result = await model.generateContent(fullUserText)
  return result.response.text()
}

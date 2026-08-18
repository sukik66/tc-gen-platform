/**
 * 生成弹窗文案净化：上游/中继常返回大段营销、演示或难辨真伪的说明，避免用户误以为本平台配置。
 */

/** 本仓库服务端抛出的明确提示（保持原样） */
function isOurServerMessage(s: string): boolean {
  return (
    /请将\s*\.env|KIMI_MODEL|总上下文约|已超过可用空间|估算输入/.test(s) ||
    /条最低要求|JSON 为部分提取|已自动触发过「去掉 JSON 模式」/.test(s) ||
    /生成被中断（|生成未完整结束（/.test(s)
  )
}

/** 含「渠道话术」特征时折叠展示 */
const RELAY_CHAFF_RE =
  /本周期|350[,，]?\s*000|350000|通信故障|模拟器|JSON.{0,24}(分数|较低|简化)|功能演示|多人使用|万卷|剩余\s*[\d.]+\s*次|DeepSeek\s*7B|网关.{0,6}(拦截|异常)|intercepted|负载可能会高/i

/** 典型可操作的 API 短错（尽量保留原文） */
const API_TRUTH_RE = /exceeded model token limit|max_tokens|invalid request|401|403|429|insufficient|quota|billing/i

/**
 * @param raw 弹窗内要展示的完整字符串（generateError 或 interruptMsg）
 */
export function humanizeLlmModalText(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''

  /** 浏览器在 SSE/长连接被对端或代理提前掐断时，ReadableStream.read() 常抛出字面量「terminated」 */
  if (/^terminated$/i.test(s) || /\bterminated\b/i.test(s)) {
    return [
      '连接在读取生成流时被中断（浏览器底层常报告为 terminated）。',
      '常见原因：网关/反向代理超时、网络闪断、刷新或离开页面、开发代理长连接被重置。',
      '建议：再试一次；若反复出现，直连后端端口（绕过代理）或调高超时；仍失败时用「打开上次请求数据」查看是否已有排障摘要。',
    ].join('\n')
  }

  if (isOurServerMessage(s)) return s

  const hasChaff = RELAY_CHAFF_RE.test(s)
  const hasApiTruth = API_TRUTH_RE.test(s)
  const extremelyLong = s.length > 2400

  if (!hasChaff && !extremelyLong) return s
  if (hasApiTruth && !hasChaff) return s

  const snippet = s.slice(0, 280).replace(/\s+/g, ' ').trim()
  return [
    '检测到渠道或模型返回的长段说明（可能含演示/营销表述），已折叠为摘要，请勿逐句当作本平台配置。',
    '',
    '「摘录」' + snippet + (s.length > 280 ? '…' : ''),
    '',
    '建议：在浏览器开发者工具 →「网络」中查看本次请求的完整响应；或减少文档、关闭「代码变更」、更换通道或模型档位后重试。',
  ].join('\n')
}

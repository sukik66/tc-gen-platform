/**
 * 将「新手引导」参考用例 JSON + UI 选项组装为 generate-enhanced-stream 请求体，便于 curl / 排障复现。
 *
 * 用法：
 *   npm run snapshot:novice-tutorial
 *   CODE_CHANGES_JSON=./my-code-changes.json npm run snapshot:novice-tutorial
 *   LLM_PROVIDER=deepseek RAG_QUERY=新手引导 npm run snapshot:novice-tutorial
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'fixtures', 'generation-snapshots')

const casesPathPrimary = path.join(root, 'src', 'fixtures', 'novice-tutorial-cases.json')
const casesPathFallback = path.join(root, '新手用例.json')
const casesPath = fs.existsSync(casesPathPrimary) ? casesPathPrimary : casesPathFallback
if (!fs.existsSync(casesPath)) {
  console.error('[snapshot] 缺少参考用例文件:', casesPathPrimary, '或', casesPathFallback)
  process.exit(1)
}

const casesText = fs.readFileSync(casesPath, 'utf8')

let codeChanges
const ccPath = process.env.CODE_CHANGES_JSON
if (ccPath) {
  const abs = path.isAbsolute(ccPath) ? ccPath : path.join(process.cwd(), ccPath)
  if (!fs.existsSync(abs)) {
    console.error('[snapshot] CODE_CHANGES_JSON 不存在:', abs)
    process.exit(1)
  }
  codeChanges = JSON.parse(fs.readFileSync(abs, 'utf8'))
}

const ragQuery = process.env.RAG_QUERY?.trim() || undefined
const llmProvider = (process.env.LLM_PROVIDER || 'anthropic').trim().toLowerCase()

/** 与侧栏「QA测试（超详细）」及多类型勾选同量级，便于压测 max_tokens / 代理超时 */
const selectedTypes = [
  '功能测试',
  '弱网测试',
  '异常操作',
  '协议安全',
  '客户端性能',
  '服务端性能',
  '兼容适配',
  '容灾容错',
  'UI/UX体验',
  'checklist',
]

const body = {
  documents: [
    {
      name: '参考用例-新手引导套件.json',
      text: casesText,
      role: 'case_ref',
    },
  ],
  focusText: '',
  selectedTypes,
  depth: 'qa',
  timezone: 'Asia/Shanghai',
  llmProvider,
  ...(codeChanges ? { codeChanges } : {}),
  ...(ragQuery ? { ragQuery } : {}),
}

fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'novice-tutorial-stream-request.generated.json')
fs.writeFileSync(outFile, JSON.stringify(body, null, 2), 'utf8')
const n = JSON.stringify(body).length
console.log('[snapshot] 已写入', outFile, '（约', n, '字符）')
console.log('[snapshot] llmProvider=', llmProvider, codeChanges ? '含 codeChanges' : '无 codeChanges', ragQuery ? `ragQuery=${ragQuery}` : '无 ragQuery')

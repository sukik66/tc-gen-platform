import type { PipelineStepDef, TestDepth } from './types'
import type { DocumentRole } from './types'
import type { ContractVerifyMethod } from './lib/contractDraftStore'

/** 产品默认时区（展示用，后续与后端时间戳对齐） */
export const APP_TIMEZONE = 'Asia/Shanghai'

export const CASE_TYPE_OPTIONS = [
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
] as const

/** 多文件进生成时的角色（U-06），顺序以列表从上到为准 */
export const DOCUMENT_ROLE_OPTIONS: {
  id: DocumentRole
  label: string
  short: string
}[] = [
  { id: 'primary', label: '主需求 / 主文档', short: '主需求' },
  { id: 'attachment', label: '附件 / 补充说明', short: '附件' },
  { id: 'related_spec', label: '关联需求 / 关联说明', short: '关联需求' },
  { id: 'case_ref', label: '参考用例 / 历史用例', short: '参考用例' },
  { id: 'version_old', label: '多版本 · 旧版 / 基线', short: '版本·旧' },
  { id: 'version_new', label: '多版本 · 新版 / 当前', short: '版本·新' },
]

export const DEPTH_OPTIONS: {
  id: TestDepth
  title: string
  subtitle: string
}[] = [
  {
    id: 'dev',
    title: '开发自测（标准）',
    subtitle: '覆盖正常路径及常见异常，关注接口逻辑',
  },
  {
    id: 'planning',
    title: '策划验收（轻量）',
    subtitle: '仅覆盖核心业务流程，验证业务闭环',
  },
  {
    id: 'qa',
    title: 'QA测试（超详细）',
    subtitle: '全量覆盖：边界、校验、安全、性能等',
  },
]

/**
 * 质量契约验证方式选项。`hint` 字段供编辑表单的副文案使用，列表展示场景可只读 label。
 * 跨页面共用：QualityContractsPage（手动补充表单）、ContractLibraryPage（编辑/列表展示）。
 */
export const CONTRACT_METHOD_OPTIONS: {
  id: ContractVerifyMethod
  label: string
  hint: string
}[] = [
  { id: 'code_review', label: '代码走查', hint: '读代码确认逻辑' },
  { id: 'api_test', label: '接口测试', hint: '调 API 验数据与边界' },
  { id: 'ui_test', label: 'UI 测试', hint: '页面操作与展示' },
]

export function contractMethodLabel(m: ContractVerifyMethod): string {
  return CONTRACT_METHOD_OPTIONS.find((x) => x.id === m)?.label ?? m
}

/** 参考截图：端到端自动化流水线（与第一期用例生成对齐，可逐步落地） */
export const PIPELINE_STEPS: PipelineStepDef[] = [
  { key: 'input', title: '输入处理', description: '验证文档和任务 ID' },
  { key: 'code', title: '代码准备', description: '拉取 Git 日志与 Diff（可选能力）' },
  { key: 'files', title: '文件分析', description: '并发分析各文件改动 / 文档结构' },
  { key: 'summary', title: '分析汇总', description: '汇总所有文件分析结果' },
  { key: 'kb', title: '知识库检索', description: '检索历史案例与风险识别' },
  { key: 'req', title: '需求综合', description: '整合需求分析' },
  { key: 'cases', title: '测试点生成', description: '生成测试用例（第一期核心）' },
  { key: 'mermaid', title: '流程图生成', description: '生成 Mermaid 流程图（可选）' },
  { key: 'report', title: '报告组装', description: '整合分析结果' },
  { key: 'save', title: '结果保存', description: '保存报告文件' },
]

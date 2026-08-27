export type Priority = 'P0' | 'P1' | 'P2'

export type TestDepth = 'dev' | 'planning' | 'qa'

export type PipelineStatus = 'pending' | 'active' | 'done'

/** 多文件进生成时的角色（U-06），顺序以列表自上而下为准 */
export type DocumentRole =
  | 'primary'
  | 'attachment'
  | 'related_spec'
  | 'case_ref'
  | 'version_old'
  | 'version_new'

export interface UploadedFile {
  id: string
  name: string
  size: number
  mimeType?: string
  /** 解析中 | 成功 | 失败 */
  status: 'parsing' | 'parsed' | 'error'
  /** 抽取的正文（图片经 OCR 后为识别文本） */
  extractedText?: string
  charCount?: number
  parseNote?: string
  errorMessage?: string
  /** 多文档语义角色，默认随上传规则或由用户调整 */
  documentRole?: DocumentRole
}

export interface TestCase {
  id: string
  priority: Priority
  caseType: string
  module: string
  subModule: string
  /** 一句话摘要（简略卡片主文案） */
  summary: string
  description: string
  preconditions: string[]
  steps: string[]
  expected: string
  remarks: string
  sourceReqIds?: string[]
  testPointIds?: string[]
  designMethod?: string
}

export type CoverageStatus = 'uncovered' | 'planned' | 'covered' | 'gap'

export interface RequirementLedgerItem {
  id: string
  type: 'module' | 'feature' | 'branch' | 'gap'
  title: string
  module: string
  parentId: string
  source: {
    documentName: string
    heading: string
    excerpt: string
  }
  testPointIds: string[]
  gaps: string[]
  coverageStatus: CoverageStatus
}

export interface TestPointLedgerItem {
  id: string
  title: string
  sourceReqIds: string[]
  coverageType: string
  designMethod: string
  designBasis: string
  priority: Priority
  isInformationGap: boolean
  agentStage: 'test_point_planning'
  sourceEvidence: string[]
  caseIds: string[]
  gaps: string[]
  coverageStatus: CoverageStatus
}

export interface TestPlanLedger {
  reqItems: RequirementLedgerItem[]
  testPoints: TestPointLedgerItem[]
  coverage: {
    reqTotal: number
    testPointTotal: number
    uncoveredReqIds: string[]
    informationGapReqIds: string[]
    informationGapTestPointIds: string[]
    coveredTestPointIds?: string[]
    uncoveredTestPointIds?: string[]
    coverageRate?: number
  }
}

export interface PipelineStepDef {
  key: string
  title: string
  description: string
}

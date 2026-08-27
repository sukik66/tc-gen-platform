/** 功能目录：首页卡片与预留页文案统一来源，便于持续集成扩展 */

export type CatalogStatus = 'available' | 'paused'

export interface FeatureCatalogItem {
  path: string
  title: string
  blurb: string
  status: CatalogStatus
  /** 预留页补充说明 */
  pausedNote?: string
}

export const FEATURE_CATALOG: FeatureCatalogItem[] = [
  {
    path: '/generation',
    title: '测试用例生成',
    blurb: '上传需求文档，配置类型与深度，生成、编辑与导出用例。',
    status: 'available',
  },
  {
    path: '/skills',
    title: 'Skill 方法库',
    blurb: '管理团队生成规范与方法文件，在用例生成时按需应用。',
    status: 'available',
  },
  {
    path: '/contracts',
    title: '质量契约',
    blurb: '上传需求由 AI 提取契约预览，确认后入库；或手写规则。与用例库共用项目/模块，草稿与已启用态写入服务端 JSON。',
    status: 'paused',
    pausedNote:
      '质量契约功能暂停推进。当前重心转向测试用例生成质量提升，后续规划明确后重启。',
  },
  {
    path: '/case-library',
    title: '用例库',
    blurb: '结构化存储与检索已生成用例，支持搜索、筛选与批量管理。',
    status: 'available',
  },
  {
    path: '/contract-library',
    title: '契约库',
    blurb: '按项目与模块浏览、内联编辑、启用或删除已入库的质量契约。',
    status: 'paused',
    pausedNote:
      '契约库随质量契约功能一同暂停，后续规划明确后重启。',
  },
  {
    path: '/smart-test',
    title: '智能测试',
    blurb: '自动化执行与编排（建设中）。',
    status: 'paused',
    pausedNote:
      '全链路智能测试依赖较多子系统，当前暂停推进。后续上线时将复用「测试用例生成」模块（同一路由组件或共享包），避免重复建设。',
  },
  {
    path: '/knowledge',
    title: '知识库',
    blurb: '测试经验、缺陷模式、需求文档、规范策略沉淀与检索，文件自动去重存入。',
    status: 'paused',
    pausedNote:
      '知识库当前暂闭。原计划用于生成产物追溯需求来源，但实现存在缺陷且输出质量优先级更高，待质量契约与智能测试稳定后再重启时会重写存储逻辑。已入库历史数据已清空。',
  },
  {
    path: '/records',
    title: '测试记录',
    blurb: '执行记录、结果与追溯。',
    status: 'paused',
    pausedNote: '执行引擎与数据模型待定。',
  },
  {
    path: '/reports',
    title: '报告存档',
    blurb: '报告生成与版本归档。',
    status: 'paused',
    pausedNote: '与流水线报告组装步骤对接后开放。',
  },
]

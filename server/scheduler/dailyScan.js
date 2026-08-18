/**
 * 每日代码变更扫描 + 测试覆盖建议
 *
 * 功能：
 * 1. 遍历所有配置的仓库，获取过去 24h 的变更
 * 2. 汇总变更涉及的文件和模块
 * 3. 可选：调用 LLM 生成测试覆盖建议
 * 4. 将扫描报告存入 server/data/scan-reports/
 */
import cron from 'node-cron'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllRepos } from '../vcs/repos.js'
import * as plastic from '../vcs/plastic.js'
import * as git from '../vcs/git.js'
import { queryContext } from '../rag/lightrag.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.join(__dirname, '..', 'data', 'scan-reports')

let lastScanResult = null
let cronJob = null

/**
 * 执行一次扫描
 */
export async function runDailyScan() {
  console.log('[daily-scan] 开始扫描...')
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const sinceStr = since.toISOString().slice(0, 10)
  const repos = getAllRepos()

  const report = {
    scanTime: new Date().toISOString(),
    sinceDate: sinceStr,
    repos: [],
    totalChanges: 0,
    summary: '',
  }

  for (const repo of repos) {
    const repoReport = {
      id: repo.id,
      name: repo.name,
      type: repo.type,
      changesets: [],
      changedFiles: [],
      error: null,
    }

    try {
      if (repo.type === 'plastic') {
        const cs = await plastic.listChangesets(repo.path, { since: sinceStr, limit: 50 })
        repoReport.changesets = cs.map(c => ({
          id: c.id,
          date: c.date,
          owner: c.owner,
          comment: c.comment,
        }))

        for (const c of cs.slice(0, 10)) {
          try {
            const detail = await plastic.getChangesetDetail(repo.path, c.id)
            if (detail?.files) {
              repoReport.changedFiles.push(...detail.files.map(f => ({ cs: c.id, path: f })))
            }
          } catch { /* 跳过 */ }
        }
      } else {
        const commits = await git.listCommits(repo.path, { since: sinceStr, limit: 50 })
        repoReport.changesets = commits.map(c => ({
          id: c.hash,
          date: c.date,
          owner: c.author,
          comment: c.message,
        }))

        if (commits.length >= 2) {
          try {
            const files = await git.diffCommits(repo.path, commits[commits.length - 1].hash, commits[0].hash)
            repoReport.changedFiles = files.map(f => ({ status: f.status, path: f.path }))
          } catch { /* 跳过 */ }
        }
      }
    } catch (e) {
      repoReport.error = e.message
    }

    report.repos.push(repoReport)
    report.totalChanges += repoReport.changesets.length
  }

  /* --- 生成概要 --- */
  const lines = [`# 每日变更扫描报告`, `扫描时间: ${report.scanTime}`, `扫描范围: ${sinceStr} ~ 现在`, '']
  for (const r of report.repos) {
    lines.push(`## ${r.name} (${r.type})`)
    if (r.error) {
      lines.push(`> 错误: ${r.error}`)
      continue
    }
    lines.push(`- 变更集/提交: ${r.changesets.length} 个`)
    if (r.changedFiles.length > 0) {
      lines.push(`- 涉及文件: ${r.changedFiles.length} 个`)
      const uniqueFiles = [...new Set(r.changedFiles.map(f => f.path))]
      uniqueFiles.slice(0, 20).forEach(f => lines.push(`  - ${f}`))
      if (uniqueFiles.length > 20) lines.push(`  - ...还有 ${uniqueFiles.length - 20} 个文件`)
    }
    if (r.changesets.length > 0) {
      lines.push(`- 变更概述:`)
      r.changesets.slice(0, 10).forEach(c => {
        lines.push(`  - [${String(c.id).slice(0, 10)}] ${c.comment}`)
      })
    }
    lines.push('')
  }

  /* --- 尝试 RAG 检索补充风险信息 --- */
  try {
    const allComments = report.repos
      .flatMap(r => r.changesets.map(c => c.comment))
      .filter(Boolean)
      .join('; ')
    if (allComments) {
      const ragCtx = await queryContext(`代码变更风险: ${allComments.slice(0, 500)}`, { mode: 'mix', topK: 10 })
      if (ragCtx?.trim()) {
        lines.push('## 知识库关联风险')
        lines.push(ragCtx.slice(0, 3000))
        lines.push('')
      }
    }
  } catch {
    /* RAG 不可用时跳过 */
  }

  report.summary = lines.join('\n')

  /* --- 保存报告 --- */
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true })
  const fileName = `scan-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(path.join(REPORT_DIR, fileName), JSON.stringify(report, null, 2), 'utf-8')
  const mdFileName = `scan-${new Date().toISOString().slice(0, 10)}.md`
  writeFileSync(path.join(REPORT_DIR, mdFileName), report.summary, 'utf-8')

  lastScanResult = report
  console.log(`[daily-scan] 完成，共 ${report.totalChanges} 个变更，报告已保存至 ${REPORT_DIR}`)
  return report
}

/**
 * 获取最近一次扫描结果
 */
export function getLastScanResult() {
  return lastScanResult
}

/**
 * 启动定时任务（默认每天 09:00 执行）
 */
export function startScheduler(cronExpr = '0 9 * * *') {
  if (cronJob) {
    cronJob.stop()
  }
  cronJob = cron.schedule(cronExpr, () => {
    runDailyScan().catch(e => console.error('[daily-scan] 执行失败:', e.message))
  })
  console.log(`[daily-scan] 定时任务已启动: ${cronExpr}`)
  return cronJob
}

/**
 * 停止定时任务
 */
export function stopScheduler() {
  if (cronJob) {
    cronJob.stop()
    cronJob = null
    console.log('[daily-scan] 定时任务已停止')
  }
}

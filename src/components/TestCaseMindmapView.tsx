import { useEffect, useRef } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { Toolbar } from 'markmap-toolbar'
import type { TestCase } from '../types'
import { buildTestCasesMindmapMarkdown } from '../lib/casesToMindmapMarkdown'

import 'markmap-toolbar/dist/style.css'

const transformer = new Transformer()

export interface TestCaseMindmapViewProps {
  cases: TestCase[]
}

/**
 * XMind 式在线脑图：基于 Markmap（可缩放、拖拽、折叠），便于通览模块→用例→步骤/预期。
 */
export function TestCaseMindmapView({ cases }: TestCaseMindmapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const toolbarHostRef = useRef<HTMLDivElement>(null)
  const mmRef = useRef<Markmap | null>(null)
  const tbRef = useRef<Toolbar | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('markmap-dark')
    return () => {
      document.documentElement.classList.remove('markmap-dark')
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    const host = toolbarHostRef.current
    if (!svg || !host) return

    const mm = Markmap.create(svg, {
      autoFit: true,
      zoom: true,
      pan: true,
      scrollForPan: false,
      initialExpandLevel: 3,
      embedGlobalCSS: true,
    })
    mmRef.current = mm

    const tb = Toolbar.create(mm)
    tbRef.current = tb
    host.appendChild(tb.el)

    return () => {
      tb.el.remove()
      tbRef.current = null
      mm.destroy()
      mmRef.current = null
    }
  }, [])

  useEffect(() => {
    const mm = mmRef.current
    if (!mm) return
    const md = buildTestCasesMindmapMarkdown(cases)
    const { root } = transformer.transform(md)
    void mm.setData(root).then(() => mm.fit())
  }, [cases])

  return (
    <div className="flex min-h-[min(70vh,640px)] flex-col rounded-xl border border-white/10 bg-[#0f1018]">
      <div
        ref={toolbarHostRef}
        className="markmap-toolbar-host flex shrink-0 justify-end border-b border-white/10 px-2 py-1"
      />
      <div className="relative min-h-[480px] flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="markmap-svg h-full w-full touch-none"
          style={{ minHeight: 480 }}
        />
      </div>
    </div>
  )
}

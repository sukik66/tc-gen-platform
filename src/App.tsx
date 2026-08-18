import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { ReservedFeaturePage } from './pages/ReservedFeaturePage'
import { TestCaseGenerationPage } from './pages/TestCaseGenerationPage'
import { CaseLibraryPage } from './pages/CaseLibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { migrateIdbToBackend } from './lib/migrateIdb'

export function App() {
  useEffect(() => { migrateIdbToBackend().catch(console.error) }, [])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/generation" element={<TestCaseGenerationPage />} />
        {/* 质量契约与契约库暂停推进，重心转向测试用例生成质量提升 */}
        <Route path="/contracts" element={<ReservedFeaturePage />} />
        <Route path="/contract-library" element={<ReservedFeaturePage />} />
        <Route path="/case-library" element={<CaseLibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* 知识库暂闭（TKT-20260428-006）：路由复用 ReservedFeaturePage，KnowledgePage 文件保留以备重启 */}
        <Route path="/knowledge" element={<ReservedFeaturePage />} />
        <Route path="/smart-test" element={<ReservedFeaturePage />} />
        <Route path="/records" element={<ReservedFeaturePage />} />
        <Route path="/reports" element={<ReservedFeaturePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

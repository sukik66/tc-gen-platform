import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchLlmProviderList,
  readStoredLlmModel,
  readStoredLlmProvider,
  writeStoredLlmModel,
  writeStoredLlmProvider,
  type LlmProviderOption,
} from '../api/llmProviders'

export interface UseLlmProviderResult {
  /** 所有可用通道（首次加载完成后非空；若 API 未启动则为空数组） */
  providers: LlmProviderOption[]
  /** 当前选中的 provider id（如 deepseek、openai） */
  selectedProvider: string
  /** 当前选中的 model id（空串 = 用 .env 默认 model） */
  selectedModel: string
  /** 服务端默认 provider；用于初始挑选 */
  serverDefaultProvider: string
  /** API 服务状态：null 探测中 / true 已连接 / false 未连接 */
  apiServerUp: boolean | null
  /** 当前选中 provider 的完整对象（含 ready/hint/availableModels 等） */
  current: LlmProviderOption | null
  /** 当前选中通道是否就绪（未就绪即 .env 未配密钥等） */
  isReady: boolean
  /** 切换 provider：自动持久化，并按存储恢复该 provider 上次选中的 model */
  setProvider: (id: string) => void
  /** 切换 model：自动持久化（与 provider 关联） */
  setModel: (model: string) => void
  /** 重新读取服务端通道配置；配置弹窗保存后用于即时刷新。 */
  refresh: () => Promise<void>
}

/**
 * LLM 通道选择 Hook：封装通道列表加载、provider/model 选择、本地持久化。
 *
 * 跨页面共用：测试用例生成、质量契约提取等所有需要选择 LLM 通道的场景。
 * 配套 UI 组件 `LlmProviderSelect`，也可独立消费状态自己渲染。
 */
export function useLlmProvider(): UseLlmProviderResult {
  const [providers, setProviders] = useState<LlmProviderOption[]>([])
  const [selectedProvider, setSelectedProviderState] = useState<string>(() => readStoredLlmProvider() || '')
  const [selectedModel, setSelectedModelState] = useState<string>('')
  const [serverDefaultProvider, setServerDefault] = useState<string>('')
  const [apiServerUp, setApiServerUp] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const data = await fetchLlmProviderList()
      if (!data) {
        setApiServerUp(false)
        setProviders([])
        return
      }
      setApiServerUp(true)
      setProviders(data.providers)
      setServerDefault(data.serverDefaultProvider)

      const ids = new Set(data.providers.map((p) => p.id))
      const stored = readStoredLlmProvider()
      let pick =
        stored && ids.has(stored)
          ? stored
          : ids.has(data.serverDefaultProvider)
            ? data.serverDefaultProvider
            : data.providers.find((p) => p.ready)?.id || data.providers[0]?.id || ''
      if (pick && !ids.has(pick)) pick = data.providers[0]?.id || ''

      setSelectedProviderState(pick)
      if (pick) writeStoredLlmProvider(pick)

      const cur = data.providers.find((p) => p.id === pick)
      const allow = cur?.availableModels ?? []
      const storedModel = readStoredLlmModel(pick) || ''
      const initialModel = allow.includes(storedModel) ? storedModel : (cur?.model ?? '')
      setSelectedModelState(initialModel)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setProvider = useCallback(
    (id: string) => {
      setSelectedProviderState(id)
      writeStoredLlmProvider(id)
      const cur = providers.find((p) => p.id === id)
      const allow = cur?.availableModels ?? []
      const storedModel = readStoredLlmModel(id) || ''
      const initialModel = allow.includes(storedModel) ? storedModel : (cur?.model ?? '')
      setSelectedModelState(initialModel)
    },
    [providers],
  )

  const setModel = useCallback(
    (model: string) => {
      setSelectedModelState(model)
      if (selectedProvider) writeStoredLlmModel(selectedProvider, model)
    },
    [selectedProvider],
  )

  const current = useMemo<LlmProviderOption | null>(
    () => providers.find((p) => p.id === selectedProvider) ?? null,
    [providers, selectedProvider],
  )

  const isReady = Boolean(current?.ready)

  return {
    providers,
    selectedProvider,
    selectedModel,
    serverDefaultProvider,
    apiServerUp,
    current,
    isReady,
    setProvider,
    setModel,
    refresh,
  }
}

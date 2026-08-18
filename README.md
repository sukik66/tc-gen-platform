# AI 原生测试平台（首期：用例自动生成）

本地可运行的 Web + **本地大模型 API**。**默认进入 [`/`](http://localhost:5173/)** 功能目录；**用例生成**在 [`/generation`](http://localhost:5173/generation)。

## 任务清单与上下文

- **[TASKS.md](./TASKS.md)** — 功能与状态。  
- **[CONTEXT.md](./CONTEXT.md)** — 会话与决策摘要。

## 与 SuperAI 主仓库的关系

- **`ai-test-platform` 可独立运行**：不依赖 SuperAI 的 Python Web、看板、MCP 任务系统。仅需本目录 `npm install` 与 Node.js。
- **`npm run dev`** 会在本机启动 **两件事**：`server/index.js`（默认 `127.0.0.1:8787`）+ **Vite**；浏览器访问的是 Vite 端口，请求 `/api/*` 由 Vite **转发到上述本地 API**，不是转发到 SuperAI 其它进程。
- 若你在 **Cursor 复合任务 / 同一终端** 里同时起了多个服务，**停止父任务可能一并结束子进程**——看起来像「关掉看板后测试平台也挂了」。请在 `ai-test-platform` 下 **单独开一个终端** 执行 `npm run dev`，或与看板任务解耦。

## 快速开始（含大模型）

```bash
cd ai-test-platform
npm install
cp .env.example .env
# 编辑 .env：设置 LLM_PROVIDER，并填写对应厂商的 API Key（及模型等）
npm run dev
```

- **`npm run dev`**：并行启动 **本地 API**（默认 `127.0.0.1:8787`）与 **Vite**；前端通过代理访问 `/api/*`。  
- **仅前端**（不调模型）：`npm run dev:vite`（需自行处理 `/api`，一般不推荐）。

浏览器地址以终端为准（如 `http://localhost:5173`）。

### 大模型配置说明（`.env`）

根目录 **[.env.example](./.env.example)** 含全部变量模板。核心规则：

1. 设置 **`LLM_PROVIDER`** 为下表之一（小写）。
2. **只配置当前厂商对应的一组变量**；其它厂商变量可留空。
3. **Gemini** 使用 Google 官方 SDK，变量名为 `GEMINI_API_KEY` / `GEMINI_MODEL`。
4. 其余厂商统一走 **OpenAI 兼容的 Chat Completions**（`openai` npm 包），通过各自的 **Base URL + API Key + Model** 接入。若某网关不支持 `response_format: json_object`，服务端会自动降级为普通补全（依赖提示词约束 JSON）。

| LLM_PROVIDER | 说明 | 必填环境变量（常用） | 默认 Base URL（可用环境变量覆盖） |
|--------------|------|----------------------|-----------------------------------|
| `openai` | OpenAI 或任意兼容网关 | `OPENAI_API_KEY`，可选 `OPENAI_BASE_URL`、`OPENAI_MODEL` | `https://api.openai.com/v1` |
| `gemini` | Google Gemini | `GEMINI_API_KEY`（或 `GOOGLE_AI_API_KEY`），可选 `GEMINI_MODEL` | （SDK，非 Base URL） |
| `qwen` | 阿里通义（DashScope 兼容模式） | `QWEN_API_KEY`，可选 `QWEN_BASE_URL`、`QWEN_MODEL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `ernie` | 百度文心（千帆 OpenAI 兼容） | `ERNIE_API_KEY`，可选 `ERNIE_BASE_URL`、`ERNIE_MODEL` | `https://qianfan.baidubce.com/v2` |
| `doubao` | 字节豆包（火山方舟） | `DOUBAO_API_KEY`、**`DOUBAO_MODEL`（接入点 ID）**，可选 `DOUBAO_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` |
| `glm` | 智谱 GLM | `GLM_API_KEY`，可选 `GLM_BASE_URL`、`GLM_MODEL` | `https://open.bigmodel.cn/api/paas/v4` |
| `minimax` | MiniMax | `MINIMAX_API_KEY`，可选 `MINIMAX_BASE_URL`、`MINIMAX_MODEL` | `https://api.minimax.chat/v1` |
| `kimi` | 月之暗面 Moonshot | `KIMI_API_KEY`，可选 `KIMI_BASE_URL`、`KIMI_MODEL` | `https://api.moonshot.cn/v1` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | `https://api.deepseek.com/v1` |

**说明与注意：**

- 各云厂商的 **域名、模型名、鉴权方式** 可能升级，若调用失败请以**官方控制台文档**为准，并相应修改 `*_BASE_URL` / `*_MODEL`。
- **百度千帆** 若实际使用 AK/SK 换取 Access Token 而非单一 API Key，需按官方流程配置，或使用支持 OpenAI 格式的**中转服务**填到 `OPENAI_*` 并把 `LLM_PROVIDER` 设为 `openai`。
- **火山方舟** 必须配置 **`DOUBAO_MODEL`** 为推理接入点 ID（如 `ep-xxxxx`）。
- 不配密钥时，前端仍可用侧栏 **「Cursor 辅助」**（复制提示词、粘贴 JSON）。
- **用例生成页**（`/generation`）侧栏提供 **「大模型通道」下拉框**：可切换 `llmProvider` 并写入浏览器本地存储；各通道的密钥仍在服务器 `.env` 预先配置，页面仅选择调用哪一路。

**其它通用变量：**

| 变量 | 说明 |
|------|------|
| `API_PORT` | 默认 `8787`（与 `vite.config.ts` 代理一致） |
| `LLM_MAX_DOC_CHARS` | 送入模型的文档总字符上限，默认 `120000` |
| `VITE_API_BASE_URL` | 生产构建：前端访问 API 的根地址（再执行 `npm run build`） |

### 常见问题：页面能开，但提示未连接本地 API

1. 确认使用 **`npm run dev`**（同时起 API + 前端），而不是只运行 **`npm run dev:vite`**。  
2. 查看终端是否打印 **`[ai-test-platform API] http://127.0.0.1:…`**；若 API 行未出现或进程立刻退出，检查端口占用或 `.env`。  
3. 修改 **`API_PORT`** 后需重启 dev；`vite.config.ts` 会从同目录 `.env` 读取该端口并代理 `/api`。

## 技术栈

- 前端：Vite 8 + React 19 + TypeScript + Tailwind v4  
- 文档解析（浏览器）：`mammoth`、`pdfjs-dist`、`xlsx`；图片为 **Tesseract.js** 中英 OCR（串行，首次加载较慢）  
- 多文件：生成页可设 **文档角色**（主需求 / 附件 / 关联需求 / 参考用例 / 版本旧新）并 **调整顺序**，与送入模型的文档块一致  
- API：`express` + `dotenv`；模型：`openai` SDK（多厂商兼容）、`@google/generative-ai`（Gemini）  
- 厂商路由：`server/llm/providers.js`；提示词与 JSON 规范：`server/prompt.js`、`server/normalize.js`

## 默认时区

**`Asia/Shanghai`（GMT+8）**，与需求文档一致。

## 参考资源

需求截图等见仓库 `assets/`；流水线与任务拆解见 `TASKS.md`。

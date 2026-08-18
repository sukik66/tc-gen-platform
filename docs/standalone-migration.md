# 独立维护说明

## 本地配置页

启动 `npm run dev` 后，从功能目录右上角进入「本地配置」或直接访问 `/settings`。页面可以创建或更新项目根目录的 `.env` 文件。

- API Key 只在服务端读取，页面只显示“已配置”和脱敏预览；输入框留空不会覆盖已有密钥。
- 保存后需要重启 API，新的环境变量才会生效。
- 方法论文件默认使用项目内 `knowledge/参考/测试用例设计方法论.md`。
- LightRAG、Plastic SCM 和调试上报地址都是可选项；独立迁移时调试上报默认关闭。

## 迁移后检查

```bash
npm ci
npx tsc --noEmit
npm run build
npm run dev
```

Git 仓库需要系统 `git` 命令；Plastic 仓库需要安装 Plastic SCM，并在配置页填写 `cm.exe` 路径。仓库实际路径保存在 `server/data/repos.json`，迁移到新机器后需要重新配置。

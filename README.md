# SigmaOS

SigmaOS 是一个面向个人 NAS 的 Linux appliance 项目。它提供网页文件浏览、AI 对话、只读预览、审批式文件操作、索引搜索和自动化维护能力。

## 功能

- Web 文件浏览与多类型预览
- AI agent 会话与事件流
- 路径安全校验与只读 NAS 工具
- 审批后执行的文件移动、重命名、归档和恢复
- SQLite 存储、索引器、调度器和 systemd 打包草案

## 开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

本地配置可从 `.env.example` 和 `config.example.toml` 开始。

## 结构

- `apps/web`：React + Vite 前端
- `apps/api`：Fastify API
- `apps/worker`：agent worker
- `apps/indexer`：文件索引器
- `apps/scheduler`：维护与调度任务
- `packages/*`：共享配置、数据库、NAS 工具和 agent 逻辑
- `packaging/*`：Debian、systemd 和 appliance 打包文件

## License

Apache-2.0. See [LICENSE](./LICENSE).

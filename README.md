# Multi AI Chat

一个基于 React + Node.js + PostgreSQL 的多 AI 协作对话平台。

核心能力：

- 同一个问题并发发送给多个 AI 代理。
- 首轮回答完成后，把每个代理的回答作为同伴上下文发回给其他代理，继续迭代。
- 当前界面固定展示 3 个最终回答卡片。
- 前后端分离，Nginx 同源反代 `/api/`，支持 Docker Compose 一键启动。
- 未配置真实 API Key 时自动回退到内置 `mock` 响应。

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- 数据库：PostgreSQL 15
- 部署：Docker Compose + Nginx + Cloudflare Tunnel

## 目录结构

```text
.
├── docker-compose.yml
├── .env.example
├── server
│   ├── Dockerfile
│   ├── package.json
│   └── src
└── web
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    └── src
```

## 本地启动

1. 可选：复制环境文件并配置真实模型。

```bash
cp .env.example .env
```

2. 启动全部服务。

```bash
docker compose up -d --build
```

3. 打开 `http://localhost:8080`。

如果你要让当前项目自己接管 Cloudflare Tunnel，在本地导出 `CLOUDFLARED_TOKEN` 后使用：

```bash
docker compose --profile deploy up -d --build
```

## 真实模型配置

项目默认固定为 `DeepSeek + Gemini + Grok` 三个代理。

如果根目录 `.env` 里 3 个 key 都为空，后端会自动回退到内置 `mock` 响应，便于本地演示。

如果要切换成真实模型，在根目录 `.env` 中设置本地密钥：

```env
DEEPSEEK_API_KEY=your-local-key
GEMINI_API_KEY=your-local-key
XAI_API_KEY=your-local-key

DEEPSEEK_MODEL=deepseek-reasoner
GEMINI_MODEL=gemini-2.5-flash
XAI_MODEL=grok-3
```

说明：

- 真实密钥只放在未跟踪的本地 `.env`，不要写进仓库。
- `GET /api/agents` 不会返回 `apiKey`、`baseUrl`、`systemPrompt` 之类内部配置。
- 如果只配置了部分 key，已配置的代理会正常回答，未配置的卡片会单独报错。
- 前端请求必须始终使用 `/api/...`。
- 真实域名和协议不应写死在前端代码里。
- 若担心缓存，可在前端额外追加 `?t=${Date.now()}`。

如果你要做高级覆盖，仍然可以在 `.env` 中设置 `AI_AGENTS_JSON`，但公开示例只应使用 `apiKeyEnv` 引用本地环境变量，而不是把密钥内联到 JSON 里。

## 主要 API

- `GET /api/health`
- `GET /api/agents`：只返回 `id`、`name`、`provider`、`model`、`accentColor`、`configured`
- `GET /api/conversations`
- `GET /api/conversations/:conversationId`
- `POST /api/conversations`
- `POST /api/conversations/:conversationId/iterate`

请求示例：

```json
{
  "question": "帮我设计一个支持多模型互评的 AI 对话产品"
}
```

迭代示例：

```json
{
  "rounds": 1
}
```

## Git 工作流

仓库已经按你的规范初始化出以下分支结构起点：

- `main`：生产分支，不直接开发
- `develop`：集成分支
- `feature/bootstrap-multi-ai-chat`：当前初始化分支

建议提交信息格式：

```bash
git commit -m "feat(app): bootstrap multi-ai chat platform"
```

## Cloudflare Tunnel 发布

1. 先确认 `docker compose up -d --build` 后，宿主机 `http://localhost:8080` 可访问。
2. 在 Cloudflare Zero Trust 创建 Tunnel，或复用现有 Tunnel。
3. 二选一启动 connector：
   - 宿主机安装并启动 `cloudflared`
   - 或者在本项目里设置 `CLOUDFLARED_TOKEN`，再执行 `docker compose --profile deploy up -d`
4. 在 Public Hostname 中把你的域名映射到：

```text
http://frontend:80
```

链路如下：

```text
User -> Cloudflare Edge -> Cloudflare Tunnel -> frontend:80 -> Docker Nginx -> /api -> backend
```

## 开发说明

- 后端启动时会自动建表。
- PostgreSQL 仅在 Docker 内部网络暴露，不映射宿主机端口。
- Nginx 对 SPA 路由启用 `try_files`，对 `/api/` 响应强制禁用缓存。
- 当前实现重点是多代理协作编排和工程骨架，后续可以继续加用户鉴权、流式输出、模型配置 UI、会话分享等能力。

# Multi AI Chat

一个基于 React + Node.js + PostgreSQL 的多 AI 协作对话平台。

核心能力：

- 同一个问题并发发送给多个 AI 代理。
- 首轮回答完成后，把每个代理的回答作为同伴上下文发回给其他代理，继续迭代。
- 用户可以在前端继续追加迭代轮次。
- 前后端分离，Nginx 同源反代 `/api/`，支持 Docker Compose 一键启动。
- 预置 `mock` 代理，未配置真实 API Key 时也能完整演示流程。

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

项目默认会加载内置 `mock` 代理，所以即使没有 API Key 也能跑通。

如果要切换成真实模型，在根目录 `.env` 中设置 `AI_AGENTS_JSON`。后端支持 OpenAI 兼容接口：

```env
AI_AGENTS_JSON=[{"id":"openai","name":"GPT-4.1 Mini","provider":"openai-compatible","baseUrl":"https://api.openai.com/v1","apiKey":"sk-xxx","model":"gpt-4.1-mini","role":"Generalist","systemPrompt":"擅长给出平衡方案。"},{"id":"deepseek","name":"DeepSeek Chat","provider":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-xxx","model":"deepseek-chat","role":"Challenger","systemPrompt":"擅长发现隐藏风险。"},{"id":"qwen","name":"Qwen Max","provider":"openai-compatible","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","apiKey":"sk-xxx","model":"qwen-max","role":"Synthesizer","systemPrompt":"擅长综合同伴观点。"}]
```

说明：

- 前端请求必须始终使用 `/api/...`。
- 真实域名和协议不应写死在前端代码里。
- 若担心缓存，可在前端额外追加 `?t=${Date.now()}`。

## 主要 API

- `GET /api/health`
- `GET /api/agents`
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

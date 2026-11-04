# Bugboard

超薄多项目报障系统（Next.js 全栈 + SQLite + 本地附件）。内网直接访问；需要公网时在 `Apps/nginx` 网关加反代。

## 快速开始（本地）

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:3000 ，空库会进入首装向导。

```bash
npm test
npm run build
# 生产启动（standalone，局域网）
cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/
DATA_DIR=./data SESSION_SECRET='change-me-to-a-long-random-secret-32+' \
  HOSTNAME=0.0.0.0 PORT=3080 node .next/standalone/server.js
```

## Docker（正式环境）

默认映射 **3080**（监听 `0.0.0.0`，局域网可访问）：

```bash
docker compose up --build -d
```

- 本机：http://127.0.0.1:3080  
- 局域网：http://\<主机局域网IP\>:3080  

数据卷挂载在 `bugboard-data`（容器内 `/data/db` 与 `/data/uploads`）。

环境变量：

| 变量 | 说明 |
|------|------|
| `SESSION_SECRET` | Session 加密密钥（生产必改） |
| `BASE_URL` | 对外访问 URL（建议写成局域网地址） |
| `DATA_DIR` / `DB_PATH` / `UPLOADS_DIR` | 数据路径（Docker 已设好） |

## Cursor Agent（MCP）

```bash
cp .cursor/mcp.json.example .cursor/mcp.json
# 在管理后台创建 cursor-qa（用户级）与 cursor-fixer（管理员级）Key，填入 mcp.json
npm run mcp:smoke   # 验证提报→修复→确认闭环
```

详见 [`docs/mcp-examples.md`](docs/mcp-examples.md)。

## 文档

- PRD：[`docs/superpowers/specs/2026-11-03-bugboard-prd.md`](docs/superpowers/specs/2026-11-03-bugboard-prd.md)
- 产品上下文：[`PRODUCT.md`](PRODUCT.md)
- MCP 示例：[`docs/mcp-examples.md`](docs/mcp-examples.md)

## 与 nginx 的关系

| 仓库 | 职责 |
|------|------|
| `Apps/bugboard` | 本应用（Web / API / MCP / 数据） |
| `Apps/nginx` | 统一对外网关；按需为本服务配置反代与证书 |

# all-Mail

`all-Mail` 是一个面向个人运维与自动化场景的统一邮件管理项目，用于在同一套后台中集中管理 **Outlook / Gmail / QQ** 外部邮箱，以及域名邮箱相关的入口、门户与发送能力。

> 当前仓库重点是：多 provider 邮箱接入、统一管理界面、域名邮箱闭环、独立 Docker 运行环境，以及清晰的个人开源项目边界。
> 项目来源与灵感说明见 `PROVENANCE.md`。

## 产品定位

- **统一管理三类邮箱**：Outlook、Gmail、QQ
- **统一后台接口**：保留 `/admin/*` 管理端接口和 `/api/*` 外部调用接口
- **统一部署方式**：React + Fastify + Prisma + Docker Compose
- **统一安全边界**：敏感凭据走环境变量注入，邮箱敏感字段走服务端加密

## 项目身份

- 当前仓库以 `all-Mail` 作为唯一主产品名称
- README、脚本、后台文案与运维文档默认面向 `all-Mail` 本身
- 历史灵感与演进来源统一收敛在 `PROVENANCE.md`，不在主叙事中展开

## 项目亮点

`all-Mail` 的价值不只是“支持多个邮箱 provider”，而是把 **外部邮箱管理、域名邮箱、门户访问、边缘 ingress 与发送能力** 收敛到同一套控制平面里。

- **不是单一邮箱池脚本，而是统一邮件控制台**：同一套后台同时覆盖 Outlook / Gmail / QQ 外部邮箱，以及域名邮箱、邮箱用户与门户访问。
- **不是把多个来源简单拼接，而是重新产品化整合**：保留历史灵感来源说明，同时把多 provider、OAuth、API Key、域名收件和发送能力统一到 `all-Mail` 自己的叙事和结构里。
- **既面向人工管理，也面向自动化调用**：提供 `/admin/*` 管理端接口和 `/api/*` 自动化接口，兼顾后台运维与验证码/脚本类场景。
- **兼顾部署闭环和运维现实**：主流程使用 React + Fastify + Prisma + Docker Compose，域名邮件入口支持 Cloudflare Worker ingress，方便在个人环境里落地完整链路。
- **对安全边界有明确约束**：敏感配置默认走环境变量注入，邮箱敏感字段走服务端加密，来源说明、贡献规则和安全策略也都单独文档化。

如果把它和常见的“单 provider 邮箱池”项目相比，`all-Mail` 更像一个围绕 **多 provider 邮件接入 + 域名邮箱运营 + 自动化接口** 展开的统一工作台，而不是某个单点能力的脚本集合。

## 当前能力

| Provider | 接入方式 | 收件箱读取 | 垃圾箱读取 | 清空邮箱 |
|---|---|---|---|---|
| Outlook | Microsoft OAuth（支持前端一键连接） | 支持 | 支持 | 支持 |
| Gmail | Google OAuth / App Password（Google OAuth 支持前端一键连接） | 支持 | 支持 | 仅 Google OAuth 支持 |
| QQ | IMAP / SMTP 授权码 | 支持 | 支持 | 不支持 |

## 技术栈

- **前端**：React + Ant Design + Vite
- **后端**：Fastify 5 + TypeScript + Prisma 6
- **数据库**：PostgreSQL
- **缓存**：Redis
- **部署**：Docker + docker compose

## 项目结构

```text
├── server/                 # Fastify + Prisma 后端
│   ├── prisma/             # Schema 与 migration
│   ├── src/config/         # 环境配置
│   ├── src/modules/        # auth / email / dashboard / mail 等模块
│   └── package.json
├── web/                    # React 管理端
│   ├── src/pages/          # dashboard / emails / api-keys / settings 等页面
│   ├── src/constants/      # 产品与 provider 常量
│   └── package.json
├── gmail_oauth/            # Gmail OAuth 自动化脚本
├── oauth-temp/             # Outlook OAuth 辅助脚本
├── docker-compose.yml
├── Dockerfile
└── docs/
```

## 快速开始

### 1. 配置运行参数

生产或共享环境请先通过外部环境变量注入敏感值：

```bash
export JWT_SECRET="replace-with-at-least-32-char-random-secret"
export ENCRYPTION_KEY="replace-with-32-character-secret-key"
export ADMIN_PASSWORD="replace-with-strong-password"
```

建议先复制示例环境文件，再按本机需要调整端口和密钥：

```bash
cp .env.example .env
```

本地开发默认使用根目录 `.env` 中的独立端口：

- `APP_PORT=3002`
- `REDIS_PORT=6380`
- `POSTGRES_PORT=15433`

### 2. 启动 Docker 环境

```bash
docker compose up -d --build
docker compose ps
```

默认访问：

- 管理端：`http://localhost:3002`
- 健康检查：`http://localhost:3002/health`

### 3. 健康检查

```bash
curl http://localhost:3002/health
# {"success":true,"data":{"status":"ok"}}
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| NODE_ENV | 运行环境 | development |
| PORT | 服务端口 | 3000 |
| DATABASE_URL | PostgreSQL 连接串 | - |
| REDIS_URL | Redis 连接串 | - |
| CORS_ORIGIN | 允许跨域来源（逗号分隔） | 开发环境默认放开 |
| JWT_SECRET | JWT 密钥（≥32 字符） | - |
| JWT_EXPIRES_IN | Token 过期时间 | 2h |
| ENCRYPTION_KEY | 敏感字段加密密钥（32 字符） | - |
| ADMIN_USERNAME | 默认管理员用户名 | admin |
| ADMIN_PASSWORD | 默认管理员密码 | - |
| SEND_ENABLED_DOMAINS | 允许开启发件能力的域名列表（逗号分隔） | - |
| ADMIN_LOGIN_MAX_ATTEMPTS | 登录失败最大次数 | 5 |
| ADMIN_LOGIN_LOCK_MINUTES | 登录失败锁定分钟数 | 15 |
| ADMIN_2FA_SECRET | 可选管理员 TOTP Base32 密钥 | - |
| ADMIN_2FA_WINDOW | TOTP 时间窗口 | 1 |
| API_LOG_RETENTION_DAYS | API 日志保留天数 | 30 |
| API_LOG_CLEANUP_INTERVAL_MINUTES | API 日志清理间隔 | 60 |

## 邮件拉取策略（分组级）

邮箱分组支持统一 `fetchStrategy`：

| 策略 | 行为 |
|------|------|
| `GRAPH_FIRST` | 先 Graph，失败后回退 IMAP |
| `IMAP_FIRST` | 先 IMAP，失败后回退 Graph |
| `GRAPH_ONLY` | 仅 Graph |
| `IMAP_ONLY` | 仅 IMAP |

说明：`IMAP_ONLY` 不支持依赖 Graph API 的清空邮箱能力。

## OAuth 与辅助脚本

### 当前推荐接入路径

- **Gmail OAuth**：直接在「邮箱管理」→「添加 Gmail 邮箱」里手工输入 callback URI、导入 `client_secret_*.json`、生成授权链接，然后把链接粘贴到已登录 Google 的浏览器里完成授权。
- **Gmail OAuth 跨浏览器回写**：即使 Google 登录/授权发生在另一浏览器，原来的 all-Mail 页面也会继续轮询授权状态，并在 callback 处理完成后自动提示成功/失败结果。
- **Outlook OAuth**：直接在「邮箱管理」→「添加 Outlook 邮箱」里手工输入 callback URI、Client ID / Client Secret、Tenant、Scopes，生成授权链接，然后把链接粘贴到已登录 Microsoft 的浏览器里完成授权。
- **QQ / Gmail App Password**：继续在管理台手工填写授权码或应用专用密码。

在最新版本中，OAuth 应用配置不再只能依赖 `.env`：

- Gmail 的 callback URI + `client_secret_*.json` 解析已经直接并入「添加 Gmail 邮箱」流程
- Microsoft OAuth 的 callback URI、client ID / secret、tenant 与 scopes 已迁移到「邮箱管理 → 添加 Outlook 邮箱」
- 解析或保存成功后即可直接生成/发起授权，不需要先去单独的配置页再回来

> 只有 Google / Microsoft 自身的登录、二次验证、授权同意页需要人工完成；token 兑换、邮箱创建/更新、首次 INBOX 验证都会自动完成。

### 一键连接前的必要配置

你可以继续使用服务器环境变量，也可以在管理台里保存系统级 OAuth 应用配置：

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:3002/admin/oauth/google/callback

MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_REDIRECT_URI=http://127.0.0.1:3002/admin/oauth/outlook/callback
MICROSOFT_OAUTH_TENANT=consumers
```

同时要在 Google Cloud Console / Microsoft Entra App Registration 中把以上 callback URI 注册进去；否则 provider 会在授权完成后拒绝回跳。

如果你不想手工维护 `.env`，也可以：

1. 打开「邮箱管理」→「添加 Gmail 邮箱」
2. 手工填写 Google callback URI
3. 导入本地 `client_secret_*.json` 文件，或直接粘贴 JSON 内容
4. 点击“保存配置并生成 Google 授权链接”
5. 把输出的授权链接粘贴到已登录 Google 的浏览器中打开

Microsoft 也可以直接在「邮箱管理」→「添加 Outlook 邮箱」里保存 callback URI、client ID / secret、tenant 与 scopes，并立即生成授权链接。

说明：Google 的 `redirect_uri` 必须与 `client_secret_*.json` 里的 `redirect_uris` 以及 Google Console 里注册的值完全一致（包括协议、主机、端口、路径、尾部斜杠）。

### 为什么 Outlook 默认会申请这一组 scopes

当前默认 scopes 为：

```text
offline_access openid profile email
https://graph.microsoft.com/User.Read
https://graph.microsoft.com/Mail.ReadWrite
https://graph.microsoft.com/Mail.Send
https://outlook.office.com/IMAP.AccessAsUser.All
https://graph.microsoft.com/Contacts.Read
https://graph.microsoft.com/Contacts.ReadWrite
https://graph.microsoft.com/Calendars.Read
https://graph.microsoft.com/Calendars.ReadWrite
https://graph.microsoft.com/MailboxSettings.Read
https://graph.microsoft.com/MailboxSettings.ReadWrite
```

这组权限不是为了“多拿权限”，而是为了让 Outlook 账号在 all-Mail 里一次授权后，能稳定覆盖当前已实现能力和短期内明确会用到的扩展能力：

- `offline_access`：允许拿到 refresh token，避免 access token 过期后频繁要求用户重登
- `openid profile email`：用于识别当前 Microsoft 账号身份，并在授权后稳定拿到基础账号信息
- `User.Read`：用于 `/me` 身份探测和账号归属校验
- `Mail.ReadWrite`：用于读取收件箱/已发送/垃圾箱，以及支持清空、标记等 Graph 邮件读写操作
- `Mail.Send`：用于 Outlook 账号直接发信；没有这个 scope 时只能读信，不能发送
- `IMAP.AccessAsUser.All`：用于保留 IMAP 回退能力，和当前 `GRAPH_FIRST / IMAP_FIRST` 拉信策略保持一致
- `Contacts.Read / Contacts.ReadWrite`：为联系人读取、自动补全、同步等后续功能预留，无需再次重授权
- `Calendars.Read / Calendars.ReadWrite`：为日历/会议类扩展预留，避免以后补功能时再要求同一账号重新授权
- `MailboxSettings.Read / MailboxSettings.ReadWrite`：为邮箱设置、自动回复、时区/工作时间等配置类能力预留

如果你只给了部分旧 scopes，常见后果会是：

- 能读信但不能发信（缺 `Mail.Send`）
- Graph 读写能力不完整（缺 `Mail.ReadWrite`）
- Graph / IMAP 双通道策略不一致（缺 `IMAP.AccessAsUser.All`）
- 以后加联系人、日历、邮箱设置能力时被迫重新让用户走一次授权

### Outlook OAuth（`oauth-temp/`）

- 用途：本地调试 / 回退方案；重复执行 Microsoft OAuth 授权、换 token、验证 refresh 流程
- 入口：`python3 oauth-temp/allmail_ms_oauth.py`
- 文档：`oauth-temp/README.md`
- 产出可直接导入 all-Mail 邮箱管理页，或用于排查一键连接配置问题

### Gmail OAuth（`gmail_oauth/`）

- 用途：本地调试 / 回退方案；自动打开 Google 授权页、接收本地回调、换取 refresh token，并可写回 all-Mail 后台
- 入口：`python3 gmail_oauth/gmail_oauth_auto.py`
- 模板：`gmail_oauth/gmail_oauth.env.example`
- 运行产物：`gmail_oauth/runtime/`

推荐流程：

```bash
cd /path/to/all-Mail
cp gmail_oauth/gmail_oauth.env.example gmail_oauth/gmail_oauth.env
python3 gmail_oauth/gmail_oauth_auto.py
```

说明：Google 登录、二次验证、授权同意页仍需要人工完成；脚本只负责自动化浏览器拉起、回调接收和 token 写回。对于正常管理台使用场景，优先使用前端一键连接流程。

## API 概览

### 管理端接口

- `/admin/auth/*`：管理员登录、2FA、密码修改
- `/admin/dashboard/*`：统计、趋势、操作日志
- `/admin/emails/*`：邮箱账户 CRUD、收件箱读取、清空邮箱
- `/admin/email-groups/*`：邮箱分组与拉取策略管理
- `/admin/api-keys/*`：外部 API Key 管理

### 外部接口（`/api/*`）

所有外部接口统一使用 API Key 鉴权，支持 Header / Bearer / Query 三种方式（推荐 Header）：

| 接口 | 说明 |
|------|------|
| `/api/get-email` | 获取一个未使用邮箱 |
| `/api/mail_new` | 获取最新邮件 |
| `/api/mail_text` | 获取邮件文本，适合验证码脚本 |
| `/api/mail_all` | 获取所有邮件 |
| `/api/process-mailbox` | 清空邮箱 |
| `/api/list-emails` | 获取系统内可用邮箱列表 |
| `/api/pool-stats` | 查看邮箱池统计 |
| `/api/reset-pool` | 重置分配记录 |

外部调用示例：

```bash
curl "http://localhost:3002/api/mail_text?email=example@gmail.com&match=\\d{6}" \
  -H "X-API-Key: sk_xxx"
```

## 开发质量检查

```bash
# 前端
cd web
npm run lint
npm run build

# 后端
cd ../server
npm run lint
npm run build
npm run test
```

## 安全要求

- `JWT_SECRET`、`ENCRYPTION_KEY`、`ADMIN_PASSWORD` 必须通过外部环境变量注入
- 不要把生产凭据写死到 `.env`、`docker-compose.yml` 或代码中
- 管理员 2FA 若启用，应同步配置 `ADMIN_2FA_SECRET` 或使用后台界面生成
- 服务端会对前端静态资源生成压缩版本，并按配置自动清理历史 API 日志

## 相关文档

- `MULTI_PROVIDER_CLOSED_LOOP.md`：多 provider 设计闭环与兼容策略
- `PROVENANCE.md`：项目来源、灵感与演进范围说明
- `CONTRIBUTING.md`：贡献流程、品牌边界与提交前检查
- `CODE_OF_CONDUCT.md`：社区协作与行为规范
- `SECURITY.md`：安全问题报告范围与处理建议
- `SUPPORT.md`：提问、报错与支持边界说明
- `CHANGELOG.md`：公开发布后的变更记录
- `docs/external-email-management-guide.md`：外部邮箱管理与 provider 操作说明
- `docs/naming-conventions.md`：all-Mail / all-Mail Cloud / allmail-edge 命名规范
- `CLOUDFLARE-DEPLOY.md`：Cloudflare 近一键部署总入口（推荐先看，含 `ingress:ensure` / `doctor` / `deploy:prod`）
- `cloudflare/workers/allmail-edge/README.md`：Cloudflare Worker 目录说明与本地验证方式
- `oauth-temp/README.md`：Outlook OAuth 辅助脚本说明
- `gmail_oauth/README.md`：Gmail OAuth 自动化说明

## 仓库卫生说明

- 生产或共享环境不要提交 `.env`、token、runtime 输出和本地调试结果
- `oauth-temp/runtime/`、`gmail_oauth/runtime/` 这类目录仅用于本地运维辅助，不属于稳定 API
- `.tmp-*`、迁移结果 JSON、截图和本地操作快照默认视为个人工作区产物，不建议继续纳入公开提交
- 若你准备公开二次修改，请优先补齐自己的 `README`、`LICENSE`、部署说明与来源说明

## License

MIT

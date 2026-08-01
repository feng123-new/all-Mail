# all-Mail 多 Provider 闭环历史记录

> 历史说明：本文记录早期 TypeScript/Prisma 实现阶段的多 Provider 闭环。当前生产实现已迁移到 `core/internal/businessapi/` 下的 Go 业务 API；旧服务目录和 Prisma 运行时已删除。本文中的旧路径仅用于追溯设计来源，不是当前开发入口。

## 已保留的产品能力

- 邮箱模型支持多 Provider：`OUTLOOK / GMAIL / QQ` 及扩展 IMAP/SMTP 家族
- 鉴权模型支持：`MICROSOFT_OAUTH / GOOGLE_OAUTH / APP_PASSWORD`
- Provider facade 与 adapter registry 的行为已迁移到 Go
- Outlook 支持 `Graph + IMAP`
- Gmail 支持 `Gmail API + IMAP`
- QQ 支持 `IMAP + 授权码`
- 外部 API 兼容路由保持稳定：`/mail_new`、`/mail_text`、`/mail_all`、`/process-mailbox`
- 管理端保留 Provider 分区入口与动态表单

## 当前实现位置

- `core/internal/businessapi/` - Go 业务路由、Provider、OAuth、发送与邮箱操作
- `core/internal/schema/` - 嵌入式历史迁移与数据库兼容校验
- `web/src/pages/emails/` - 管理端邮箱页面
- `web/src/constants/providers.ts` - 前端 Provider 元数据

## 历史数据模型变化

`EmailAccount` 在早期迁移中新增：

- `provider`
- `authType`
- `providerConfig`
- `capabilities`

同时将以下字段调整为 Provider-aware：

- `clientId` 允许为空
- `refreshToken` 允许为空
- `password` 用于 QQ 授权码或 App Password

这些数据库变化由 Go schema runner 作为不可变历史继续校验。对历史 Prisma ledger/table 的兼容不表示存在活动 Prisma 工具或服务。

## 兼容策略

- 保留旧 Outlook 导入格式兼容能力
- 统一导入格式：
  - `OUTLOOK----email----clientId----clientSecret----refreshToken`
  - `GMAIL----email----clientId----clientSecret----refreshToken`
  - `QQ----email----authorizationCode`
- 原有 `/api/*` 外部接口保持不变，调用方无需改路由

## Provider 能力边界

| Provider | latest/text/all | junk | clear |
|---|---|---|---|
| Outlook | 支持 | 支持 | 支持 |
| Gmail | 支持 | 支持 | 仅 Google OAuth 支持 |
| QQ | 支持 | 支持 | 不支持 |

## 当前验证入口

```bash
cd core
go test -race ./...
go vet ./...
```

完整仓库验证使用：

```bash
./bin/all-mail check
```

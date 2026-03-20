# all-Mail 多 Provider 闭环设计

## 已落地范围

- 后端邮箱模型升级为多 provider：`OUTLOOK / GMAIL / QQ`
- 鉴权模型升级为：`MICROSOFT_OAUTH / GOOGLE_OAUTH / APP_PASSWORD`
- 新增 provider facade 与 adapter registry
- Outlook 继续支持 `Graph + IMAP`
- Gmail 支持 `Gmail API + IMAP`
- QQ 支持 `IMAP + 授权码`
- 保留统一外部 API：`/mail_new` `/mail_text` `/mail_all` `/process-mailbox`
- Prisma schema 与 SQL migration 已补齐
- 管理端已补齐 provider 分区入口与动态表单说明

## 关键目录

- `server/src/modules/mail/providers/`
  - `outlook.adapter.ts`
  - `gmail.adapter.ts`
  - `qq.adapter.ts`
  - `registry.ts`
  - `shared.ts`
  - `types.ts`
- `server/src/modules/mail/mail.facade.ts`
- `server/src/modules/mail/mail.service.ts`
- `web/src/pages/emails/index.tsx`
- `web/src/constants/providers.ts`

## 数据模型变化

`EmailAccount` 新增：

- `provider`
- `authType`
- `providerConfig`
- `capabilities`

并将以下字段改为 provider-aware：

- `clientId` 允许为空
- `refreshToken` 允许为空
- `password` 用于 QQ 授权码或 App Password

## 兼容策略

- 保留旧 Outlook 导入格式兼容能力
- 新增统一导入格式：
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

## 验证结果

当前闭环已完成的重点验证：

- TypeScript 编译通过
- 前后端 lint 通过
- 服务端测试通过
- Docker 运行健康
- `/admin/dashboard/stats` 与 `/admin/emails/stats` 数据一致
- 浏览器中 dashboard / emails 页面可正常渲染
- Outlook / Gmail / QQ 均已完成最小可用链路验证

## 下一步建议

1. 继续抽离 provider-aware 前端配置，降低页面内硬编码分支
2. 为 dashboard 增加更细的 provider 维度健康信息
3. 继续优化前端 chunk 拆分，降低首次加载体积

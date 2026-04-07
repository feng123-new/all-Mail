# 外部邮箱管理区使用说明

> 适用范围：后台 `邮箱管理` 页面中接入的 Outlook / Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex / Custom IMAP / SMTP 账号。

## 1. 这块和域名邮箱不是一回事

这里管理的是第三方邮箱账号本身，例如 Outlook、Gmail、QQ、Amazon WorkMail 或自定义 IMAP / SMTP 邮箱。它们和 all-Mail 自己维护的域名邮箱池是两套入口。

## 2. 当前支持的能力

在后台 `邮箱管理` 页面中，进入某个邮箱账号后，可以使用：

- 收件箱
- 已发送
- 垃圾箱
- 写邮件
- 邮件详情查看

## 3. Provider 能力概览

### Gmail

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`GOOGLE_OAUTH` 或 `APP_PASSWORD`

### QQ

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`（SMTP / IMAP 授权码）

### 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`

### Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`
- 说明：Amazon WorkMail 通常需要补充区域相关的 IMAP / SMTP 主机；GMX / Mail.com 更常见的 SMTP 端口是 `587` + STARTTLS。

### Custom IMAP / SMTP

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`
- 说明：适合企业自建邮箱、域名邮箱、cPanel、自定义 IMAP / SMTP 服务；需要手工填写 IMAP Host、SMTP Host、端口、TLS 和可选文件夹映射。

### Outlook

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：取决于 OAuth scope 是否包含 `Mail.Send`

如果老账号缺少 `Mail.Send` scope，重新走一次 Outlook OAuth 授权即可。

#### Outlook 默认 scopes 为什么现在改成 Graph-only

all-Mail 当前默认会申请下面这组 **Microsoft Graph** scopes：

```text
offline_access openid profile email
https://graph.microsoft.com/User.Read
https://graph.microsoft.com/Mail.ReadWrite
https://graph.microsoft.com/Mail.Send
https://graph.microsoft.com/Contacts.ReadWrite
https://graph.microsoft.com/Calendars.ReadWrite
https://graph.microsoft.com/MailboxSettings.ReadWrite
```

逐项对应关系如下：

- `offline_access`：保证 refresh token 可用，避免频繁重新登录
- `openid profile email`：授权完成后识别当前账号身份
- `User.Read`：读取 `/me` 基础信息，校验当前 Outlook 账号归属
- `Mail.ReadWrite`：读取和管理邮件内容
- `Mail.Send`：支持直接发信
- `Contacts.ReadWrite`：给联系人同步、自动补全等能力预留
- `Calendars.ReadWrite`：给日历/会议能力预留
- `MailboxSettings.ReadWrite`：给邮箱设置、自动回复、时区等能力预留

`https://outlook.office.com/IMAP.AccessAsUser.All` **不再出现在同一个默认 scope 字符串里**，因为它和 `https://graph.microsoft.com/*` 不属于同一个资源；把两类资源混到一次授权请求里，会触发 Microsoft 的 scope 兼容性错误。

如果你确实要用 Outlook IMAP OAuth，请单独申请：

```text
offline_access openid profile email
https://outlook.office.com/IMAP.AccessAsUser.All
```

不要把这条 IMAP scope 和上面的 Graph scopes 混在同一次授权请求里。

## 4. 后台操作路径

### 查看邮件

路径：后台 → `邮箱管理` → 某条邮箱记录的邮件按钮。

### 发送邮件

如果该账号具备发送能力，会显示 `写邮件` 入口。

### 切换文件夹

当前支持：

- `收件箱`
- `已发送`
- `垃圾箱`

## 5. 常用接口

### 查看某个账号的邮件

```http
GET /admin/emails/:id/mails?mailbox=INBOX
GET /admin/emails/:id/mails?mailbox=SENT
GET /admin/emails/:id/mails?mailbox=Junk
```

### 直接发送

```http
POST /admin/emails/:id/send
```

示例：

```bash
curl -X POST http://127.0.0.1:3002/admin/emails/12/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "fromName": "all-Mail",
    "to": ["recipient@example.com"],
    "subject": "external account send test",
    "text": "This is a direct send test from an external mailbox."
  }'
```

## 6. 发送能力判断

- Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Fastmail / AOL / GMX / Mail.com / Yandex 这类账号通常可以直接完成收发闭环
- Outlook 是否能发，取决于 OAuth 配置和授权范围
- Amazon WorkMail 和 Custom IMAP / SMTP 是否可用，取决于你填写的服务器主机、端口和密码是否正确
- 如果账号不支持发件，界面会保留收件相关能力，但隐藏或禁用发送入口

## 7. 建议

- 所有真实邮箱地址、账号 ID、生产域名都不要写进公开文档
- 验证示例统一使用 `recipient@example.com` 这类占位地址
- 如果你需要记录自己环境里的验证结果，建议保存在私有 runbook，而不是公开仓库

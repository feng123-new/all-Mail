# 外部邮箱管理区使用说明

> 适用范围：后台 `邮箱管理` 页面中接入的 Outlook / Gmail / QQ 账号。

## 1. 这块和域名邮箱不是一回事

这里管理的是第三方邮箱账号本身，例如 Outlook、Gmail、QQ。它们和 all-Mail 自己维护的域名邮箱池是两套入口。

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

### Outlook

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：取决于 OAuth scope 是否包含 `Mail.Send`

如果老账号缺少 `Mail.Send` scope，重新走一次 Outlook OAuth 授权即可。

#### Outlook 默认 scopes 为什么开这么多

all-Mail 当前默认会申请下面这组 Outlook scopes：

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

逐项对应关系如下：

- `offline_access`：保证 refresh token 可用，避免频繁重新登录
- `openid profile email`：授权完成后识别当前账号身份
- `User.Read`：读取 `/me` 基础信息，校验当前 Outlook 账号归属
- `Mail.ReadWrite`：读取和管理邮件内容
- `Mail.Send`：支持直接发信
- `IMAP.AccessAsUser.All`：让 Outlook 账号既能走 Graph，也能在需要时走 IMAP 回退
- `Contacts.Read / Contacts.ReadWrite`：给联系人同步、自动补全等能力预留
- `Calendars.Read / Calendars.ReadWrite`：给日历/会议能力预留
- `MailboxSettings.Read / MailboxSettings.ReadWrite`：给邮箱设置、自动回复、时区等能力预留

设计原因很简单：一次授权尽量覆盖已实现能力和明确会继续扩展的周边能力，减少“功能刚上线，又要让用户补一次授权”的情况。

如果你希望最小化权限，也可以改小 `MICROSOFT_OAUTH_SCOPES`，但要自己接受相应能力被关闭或重新授权的代价。

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

- Gmail / QQ 这类账号通常可以直接完成收发闭环
- Outlook 是否能发，取决于 OAuth 配置和授权范围
- 如果账号不支持发件，界面会保留收件相关能力，但隐藏或禁用发送入口

## 7. 建议

- 所有真实邮箱地址、账号 ID、生产域名都不要写进公开文档
- 验证示例统一使用 `recipient@example.com` 这类占位地址
- 如果你需要记录自己环境里的验证结果，建议保存在私有 runbook，而不是公开仓库

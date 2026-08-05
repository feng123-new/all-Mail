# 外部邮箱管理区使用说明

> 适用范围：后台 `邮箱管理` 页面中接入的 Outlook / Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex / Custom IMAP / SMTP 账号。Mail.com 指 `mail.com` 服务，不是 Mail.ru。

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
- 发送邮件：Gmail App Password 模式支持；OAuth 模式取决于权限档位是否为 `send`、`manage` 或 `full`
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

### Mail.com

- 读取收件箱：支持，但仅限 Mail.com Premium 账号
- 读取已发送：支持，官方文件夹名为 `Sent Items`
- 读取垃圾箱：支持，官方文件夹名为 `Junk email`
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`（这里实际填写 Mail.com 登录密码）
- 使用前必须在 Mail.com 网页端进入 `Email → Settings → POP3 & IMAP`，开启第三方协议访问
- 当前预设：IMAP `imap.mail.com:993` + SSL/TLS；SMTP `smtp.mail.com:587` + STARTTLS
- Mail.com 官方也允许 SMTP `465` + SSL/TLS，但 all-Mail 默认统一使用 `587` + STARTTLS
- 免费 Mail.com 账号不具备 IMAP/SMTP 能力，无法通过 all-Mail 直连

### Amazon WorkMail / Fastmail / AOL / GMX / Yandex

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`
- 说明：Amazon WorkMail 通常需要补充区域相关的 IMAP / SMTP 主机；GMX 更常见的 SMTP 端口是 `587` + STARTTLS。

### Custom IMAP / SMTP

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：支持
- 常见模式：`APP_PASSWORD`
- 说明：适合企业自建邮箱、域名邮箱、cPanel、自定义 IMAP / SMTP 服务；需要手工填写 IMAP Host、SMTP Host、端口、TLS 和可选文件夹映射。

### Outlook

- 读取收件箱：支持
- 读取已发送：支持
- 发送邮件：取决于 OAuth 权限档位是否包含 `Mail.Send`
- 修改或删除邮件：取决于 OAuth 权限档位是否包含 `Mail.ReadWrite`

如果已有账号缺少所需权限，先在 OAuth 配置中选择更高档位，再重新走一次 Outlook OAuth 授权。仅保存新档位不会让旧 refresh token 自动获得新权限。

### OAuth 权限档位

Gmail 和 Outlook 使用同一套四档权限模型，默认始终是最小权限的 `minimal`：

| 档位 | 读取邮件 | 发送邮件 | 修改 / 删除邮件 | 扩展权限 |
| --- | --- | --- | --- | --- |
| `minimal` | 支持 | 不支持 | 不支持 | 无 |
| `send` | 支持 | 支持 | 不支持 | 无 |
| `manage` | 支持 | 支持 | 支持 | 无 |
| `full` | 支持 | 支持 | 支持 | Gmail provider-wide；或 Microsoft 联系人、日历和邮箱设置 |

后台会同时显示：

- 当前保存的权限档位；
- 该档位实际申请的 scopes；
- 读取、发信、管理和扩展能力是否可用；
- 提高档位后必须重新授权的提示。

#### Outlook 为什么只使用 Microsoft Graph scopes

当前默认 `minimal` 档位实际申请：

```text
offline_access openid profile email
https://graph.microsoft.com/User.Read
https://graph.microsoft.com/Mail.Read
```

`send` 增加 `Mail.Send`，`manage` 改为 `Mail.ReadWrite` 并保留 `Mail.Send`，`full` 才额外增加：

```text
https://graph.microsoft.com/Contacts.ReadWrite
https://graph.microsoft.com/Calendars.ReadWrite
https://graph.microsoft.com/MailboxSettings.ReadWrite
```

`https://outlook.office.com/IMAP.AccessAsUser.All` 与 `https://graph.microsoft.com/*` 不属于同一个资源，不能和 Graph scopes 混在同一次授权请求里。若确实需要 Outlook IMAP OAuth，应单独完成 IMAP consent；它不属于后台这四个 Graph 权限档位。

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

- Gmail OAuth 是否能发信取决于所选权限档位；Gmail App Password 与 QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Fastmail / AOL / GMX / Yandex 的 IMAP/SMTP 模式通常可以完成收发闭环
- Mail.com 只有 Premium 账号在网页端开启 POP3/IMAP 后才能完成收发闭环
- Outlook 是否能发，取决于 OAuth 配置和授权范围
- Amazon WorkMail 和 Custom IMAP / SMTP 是否可用，取决于你填写的服务器主机、端口和密码是否正确
- 如果账号不支持发件，界面会保留收件相关能力，但隐藏或禁用发送入口

## 7. 建议

- 所有真实邮箱地址、账号 ID、生产域名都不要写进公开文档
- 验证示例统一使用 `recipient@example.com` 这类占位地址
- 如果你需要记录自己环境里的验证结果，建议保存在私有 runbook，而不是公开仓库

## 8. Provider 验证证据

公开 CI 使用 Mock、协议 fixture 和合成数据库数据，不保存真实第三方邮箱凭据，也不等同于每个 Provider 的实时账号验证。各 Provider 的证据边界、Mail.com Premium 条件和个人部署 canary 步骤见 [`PROVIDER-VALIDATION.md`](./PROVIDER-VALIDATION.md)。

Google client-secret JSON 只在请求内存中解析；服务器文件路径输入被明确禁用。

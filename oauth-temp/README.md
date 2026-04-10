# all-Mail Outlook OAuth Helper

这个目录用于把 Microsoft Outlook / IMAP 的 OAuth 授权流程固化成可重复执行的本地脚本。

> 管理台现已支持 Outlook OAuth 一键连接。这里的脚本主要用于本地调试、回退方案、或排查 Azure / Microsoft Entra OAuth 配置问题，不属于默认 Docker 部署链路。

## 目录说明

- `allmail_ms_oauth.py`：推荐入口，一次运行完成生成授权链接、粘贴回调 URL、换 token、验证 refresh、输出可导入内容
- `ms_oauth_exchange.py`：调试用，只做授权码兑换
- `ms_oauth_verify.py`：调试用，只做 refresh / IMAP 验证
- `config.example.env`：配置模板
- `runtime/`：运行产物（token、验证结果、可导入文本），已被 Git 忽略

## 一次性准备

1. 复制配置模板：

```bash
cd /path/to/all-Mail
cp oauth-temp/config.example.env oauth-temp/config.env
```

2. 编辑 `oauth-temp/config.env`，至少填写：

- `CLIENT_ID`
- `CLIENT_SECRET`
- `REDIRECT_URI`

默认值提供一套可重复的公开示例组合（Graph-only 默认授权）：

- `TENANT=consumers`
- `SCOPES=offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite`
- `SEPARATOR=----`

如果脚本无法从 `id_token` 推断邮箱地址，再补 `ACCOUNT_EMAIL=你的邮箱地址`。

## 一键使用

```bash
cd /path/to/all-Mail
python3 oauth-temp/allmail_ms_oauth.py
```

如果 `config.env` 中已经配置了：

- `ADMIN_BASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `TARGET_EMAIL_ID`（可选）

那么这条命令会在你粘贴回调 URL 后自动完成：

1. 换 token
2. 验证 Graph / IMAP refresh
3. 自动选择“更新现有同邮箱”或“创建新邮箱”
4. 直接调用 all-Mail 拉一次 `INBOX` 做验收

默认安全策略：

- **如果系统里已存在同邮箱** → 更新那条记录
- **如果 `TARGET_EMAIL_ID` 对应的也是同邮箱** → 更新这条 ID
- **如果 `TARGET_EMAIL_ID` 是别的邮箱** → 默认**新建**，不会覆盖老账号
- 只有当你明确设置：

```env
ALLOW_TARGET_ID_REPLACE=true
```

才会允许用新邮箱替换 `TARGET_EMAIL_ID` 指向的旧账号

脚本会：

1. 生成 Microsoft 授权链接并打印出来
2. 让你在浏览器中登录并授权
3. 提示你粘贴浏览器最后跳转的完整回调 URL
4. 自动完成：
   - 授权码兑换 token
   - 为 Graph 邮件、联系人、日历、邮箱设置完成 consent
   - 验证旧逻辑（不带 `client_secret`）为何失败
   - 验证修复后逻辑（带 `client_secret`）是否刷新成功
   - 尝试 IMAP XOAUTH2 登录
5. 在 `oauth-temp/runtime/` 下输出结果文件

## 最重要的输出文件

- `oauth-temp/runtime/latest_import.txt`
  - 可直接粘贴到 all-Mail 的“批量导入邮箱”中
- `oauth-temp/runtime/latest_payload.json`
  - 如果你想在管理台手动创建邮箱，可直接参考这个 JSON
- `oauth-temp/runtime/latest_verify.json`
  - 保存本次 refresh / IMAP 验证结果

## 全自动更新已有邮箱（无需进管理台）

如果你已经在 `config.env` 中配置好了：

- `ADMIN_BASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `TARGET_EMAIL_ID`

那么在 OAuth 成功后，可以直接执行：

```bash
cd /path/to/all-Mail
python3 oauth-temp/allmail_update_email.py --verify
```

它会：

1. 读取 `oauth-temp/runtime/latest_payload.json`
2. 登录 all-Mail 管理接口
3. 更新指定邮箱 ID
4. 可选读回 `secrets=true` 做验证

它现在也遵循和主脚本一样的安全策略：

- 同邮箱优先更新
- 不同邮箱默认新建
- 只有 `ALLOW_TARGET_ID_REPLACE=true` 才会强行替换旧 ID

如果你要更新别的邮箱 ID：

```bash
python3 oauth-temp/allmail_update_email.py --email-id 12 --verify
```

默认目标邮箱也可以写在 `config.env`：

```env
TARGET_EMAIL_ID=5
```

## all-Mail 导入格式（已支持 client secret）

脚本输出的是这个格式：

```text
邮箱----clientId----clientSecret----oauth----refreshToken
```

例如：

```text
example@outlook.com----client-id----client-secret----oauth----refresh-token
```

这个格式现在已经被仓库里的批量导入逻辑识别，不需要再手动拆字段。

## Azure 应用必须满足的条件

- 支持个人 Microsoft 账号
- Redirect URI 与 `config.env` 中的 `REDIRECT_URI` 完全一致
- 使用 `consumers`（或你自行改成 `common`，但两边必须一致）
- Graph scope 默认包含：
  - `https://graph.microsoft.com/User.Read`
  - `https://graph.microsoft.com/Mail.ReadWrite`
  - `https://graph.microsoft.com/Mail.Send`
  - `https://graph.microsoft.com/Contacts.ReadWrite`
  - `https://graph.microsoft.com/Calendars.ReadWrite`
  - `https://graph.microsoft.com/MailboxSettings.ReadWrite`
- 如果你要走 Outlook IMAP OAuth，单独使用：
  - `offline_access`
  - `openid`
  - `profile`
  - `email`
  - `https://outlook.office.com/IMAP.AccessAsUser.All`
- 不要把 `https://outlook.office.com/IMAP.AccessAsUser.All` 和 `https://graph.microsoft.com/*` scopes 混到同一次授权请求里
- 如果是 Web / 机密客户端：
  - 授权码兑换必须带 `client_secret`
  - refresh token 换 access token 也必须带 `client_secret`

## 常见问题

### 1. 浏览器回跳到 localhost 时报 “This site can't be reached”

这是正常的，只要地址栏里已经出现：

```text
http://localhost:8765/callback?code=...&state=...
```

直接把完整 URL 粘贴回脚本即可。

### 2. 为什么旧版 Outlook OAuth 流程会报 `IMAP_TOKEN_FAILED`

因为旧版 refresh 流程只提交：

- `client_id`
- `refresh_token`

对于 Web / 机密客户端，微软会返回 `401 invalid_client`。本仓库已修复为可选带 `client_secret`。

### 3. 为什么现在默认是 Graph-only scopes

all-Mail 默认要解决的是 Outlook 账号的 Graph 读信、清空、发信，以及后续联系人、日历、邮箱设置扩展能力，所以默认会把这几组 **Microsoft Graph** scope 一起申请。

如果授权时只有部分 Graph scope，常见问题会变成：

- 只能读信，不能发信（缺 `Mail.Send`）
- Graph 读取或清空邮箱能力不完整（缺 `Mail.ReadWrite`）
- `/me` 资料探测不完整（缺 `User.Read`）
- Graph 相关扩展能力不完整（缺联系人 / 日历 / MailboxSettings 写权限）

而 `https://outlook.office.com/IMAP.AccessAsUser.All` 属于另一个资源，不能和 `https://graph.microsoft.com/*` scope 放进同一个 OAuth 请求。混用时会触发 Microsoft 的 scope 兼容性错误。

因此脚本默认会一起完成：

- `offline_access`
- `openid`
- `profile`
- `email`
- `https://graph.microsoft.com/User.Read`
- `https://graph.microsoft.com/Mail.ReadWrite`
- `https://graph.microsoft.com/Mail.Send`
- `https://graph.microsoft.com/Contacts.ReadWrite`
- `https://graph.microsoft.com/Calendars.ReadWrite`
- `https://graph.microsoft.com/MailboxSettings.ReadWrite`

对应理由可以直接理解为：

- `offline_access`：拿 refresh token，避免 access token 过期后频繁重新登录
- `openid profile email`：稳定识别当前 Microsoft 账号身份
- `User.Read`：读取 `/me` 基础信息，确认当前授权的是哪一个 Outlook 账号
- `Mail.ReadWrite`：保证邮件读取、列表同步、清空等 Graph 邮件能力完整
- `Mail.Send`：保证 Outlook 账号可直接发信
- `Contacts.ReadWrite / Calendars.ReadWrite / MailboxSettings.ReadWrite`：为联系人、日历、邮箱设置相关扩展预留，减少后续重新授权

如果你要专门调试 IMAP OAuth，请把 `SCOPES=` 改成单独的 IMAP 集合，例如：

```text
offline_access openid profile email https://outlook.office.com/IMAP.AccessAsUser.All
```

如果你想按自己产品的最小权限模型收缩 scope，可以改 `SCOPES=`，但相应功能也会一起收缩。

### 4. 脚本里会保存 token，安全吗？

运行产物保存在 `oauth-temp/runtime/`，且已被 Git 忽略。导入完成后，如果你不想保留本地痕迹，可以手动删除：

```bash
rm -f oauth-temp/runtime/latest_*.json oauth-temp/runtime/latest_*.txt oauth-temp/runtime/last_*.txt
```

### 5. 需要重新生成 client secret 吗？

如果你曾把 `client_secret` 暴露在聊天记录、截图或日志里，建议去 Azure 门户重新生成并替换。

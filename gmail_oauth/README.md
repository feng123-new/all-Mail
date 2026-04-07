# Gmail OAuth Helper

这个目录用于把 Gmail / Google OAuth 授权流程固化成可重复执行的本地自动化脚本。

> 管理台现已支持 Gmail OAuth 一键连接。这里的脚本主要用于本地调试、回退方案、或排查 provider console 配置问题，不属于默认 Docker 部署链路。

## 文件说明

- `gmail_oauth_auto.py`：推荐入口，自动打开 Google 授权页、本地接收回调、换 refresh token、可自动写回 all-Mail 并读取 INBOX 验证
- `gmail_oauth.env.example`：配置模板
- `runtime/`：运行产物（auth URL、token、验证结果、自动更新结果），已被 Git 忽略

## 快速开始

```bash
cd /path/to/all-Mail
cp gmail_oauth/gmail_oauth.env.example gmail_oauth/gmail_oauth.env
python3 gmail_oauth/gmail_oauth_auto.py
```

## 配置方式

优先推荐：

- `GOOGLE_CLIENT_SECRET_JSON=/path/to/client_secret_*.json`

脚本会自动读取：

- `client_id`
- `client_secret`
- `redirect_uri`

也就是 Google 导出 JSON 中：

- `web.client_id` → `GOOGLE_CLIENT_ID`
- `web.client_secret` → `GOOGLE_CLIENT_SECRET`
- `web.redirect_uris[0]` → `REDIRECT_URI`

如果你不想直接引用 JSON，也可以手工填写：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIRECT_URI`（或 `REDIRECT_HOST / REDIRECT_PORT / REDIRECT_PATH`）

## 人工边界

以下步骤仍需人工完成：

- Google 登录
- 二次验证 / 设备验证
- 同意授权页
- 如果浏览器提示本地 `https://localhost` 证书不受信任，需要手工继续一次

其余步骤脚本会自动继续。

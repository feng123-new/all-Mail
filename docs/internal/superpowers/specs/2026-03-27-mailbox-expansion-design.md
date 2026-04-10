# 邮箱扩展与 Custom IMAP/SMTP 设计稿

## 1. 背景与目标

all-Mail 当前已经稳定收敛到 3 个协议家族：

- `oauth_api`
- `imap_smtp`
- `hosted_internal`

这条方向应继续保持不变。外部邮箱扩展不再通过增加新的“协议家族”完成，而是通过：

1. 增加 `provider profile` 预设
2. 强化 `imap_smtp` 家族的通用能力
3. 将长尾企业邮箱、国外邮箱、自建邮箱统一收敛到 `Custom IMAP/SMTP`

本设计稿的目标是：

- 保持 3-family 模型不变
- 在不引入 JMAP / EWS / Proton Bridge 等新复杂面向的前提下，扩大真实邮箱覆盖面
- 优先解决企业邮箱和长尾外部邮箱的可接入性
- 在现有代码结构上最小增量完成扩展

## 2. 当前状态

### 2.1 Docker / 运行环境

当前本地 Docker 运行环境已经完成重建验证：

- `docker compose ps`：`app` / `postgres` / `redis` 均为 healthy
- `GET http://127.0.0.1:3002/health`：返回 `ok`

本轮不需要继续大改 Docker 编排；环境层面已经满足继续扩展邮箱接入的前提。

### 2.2 当前外部邮箱 provider 架构

外部邮箱扩展的核心代码位于：

- 后端 provider 类型与 profile 注册：`server/src/modules/mail/providers/types.ts`
- provider 路由注册：`server/src/modules/mail/providers/registry.ts`
- 通用 IMAP/SMTP adapter：`server/src/modules/mail/providers/imap-smtp.adapter.ts`
- 前端 provider/profile 展示：`web/src/constants/providers.ts`
- 外部邮箱管理 UI：`web/src/pages/emails/index.tsx`
- 创建/更新参数校验：`server/src/modules/email/email.schema.ts`

当前已支持的 provider：

- `OUTLOOK`
- `GMAIL`
- `QQ`
- `NETEASE_163`
- `NETEASE_126`
- `ICLOUD`
- `YAHOO`
- `ZOHO`
- `ALIYUN`

当前已支持的 provider profile：

- `outlook-oauth`
- `gmail-oauth`
- `gmail-app-password`
- `qq-imap-smtp`
- `netease-163-imap-smtp`
- `netease-126-imap-smtp`
- `icloud-imap-smtp`
- `yahoo-imap-smtp`
- `zoho-imap-smtp`
- `aliyun-imap-smtp`

### 2.3 当前架构的关键结论

当前代码并不缺“协议能力”，而是缺“产品入口能力”。

后端已经有较强的通用 IMAP/SMTP 基础：

- `MailProviderConfig` 已支持 `imapHost` / `imapPort` / `imapTls`
- `MailProviderConfig` 已支持 `smtpHost` / `smtpPort` / `smtpSecure`
- `MailProviderConfig` 已支持 `folders`
- `imap-smtp.adapter.ts` 已将一类 provider 统一收敛到共用逻辑
- `shared.ts` 现在已经补入 IMAP `ID` 握手，修复了 188/网易系这一类 post-login 风险

因此，下一阶段最有价值的扩展，不是继续拆新协议，而是把已有通用能力正式产品化。

## 3. 协议与真实邮箱市场判断

### 3.1 不建议新增的新协议家族

以下协议/接入方式存在，但当前不应纳入新的代表协议家族：

- `POP3`：不适合当前按文件夹读取、批量操作、统一收发的目标
- `JMAP`：有现实意义，但覆盖面不足以支撑当前产品优先级
- `EWS / Exchange 旧接口`：偏 legacy，不如优先统一到 Outlook OAuth / IMAP fallback
- `Proton Bridge`：不是远程标准 IMAP/SMTP，而是本地桥接程序

结论：对 all-Mail 当前阶段而言，仍然应该坚持：

- `oauth_api`
- `imap_smtp`
- `hosted_internal`

### 3.2 常见国外邮箱与企业邮箱，实际如何分类

基于当前主流邮箱产品形态，可分为三类：

#### A. OAuth API 型

- Gmail / Google Workspace
- Outlook / Microsoft 365

这类优先使用 `oauth_api`，必要时保留 IMAP 辅助路径。

#### B. 标准 IMAP/SMTP 型

- Amazon WorkMail
- Fastmail
- AOL Mail
- GMX
- Mail.com
- Yandex Mail
- Zoho Workplace / Zoho Mail
- 普通企业邮箱 / 域名邮箱 / cPanel / 自建邮局

这类都应归入 `imap_smtp`，差异主要体现在：

- host / port / TLS 默认值
- 登录方式是普通密码、授权码、App Password，还是管理员开启客户端权限

#### C. 不适合当前直接纳入的桥接型

- Proton Mail（需要 Proton Bridge）

这类不适合在本阶段作为一等公民接入。

## 4. 设计决策

### 决策 1：不新增第 4 个协议家族

原因：

- 大部分真实新增邮箱仍然可落在 `imap_smtp`
- 扩展 provider 不等于扩展 protocol family
- 继续维持 3-family 才能让 UI、能力矩阵、文档、导入模板保持稳定

### 决策 2：优先做 `Custom IMAP/SMTP`

优先级高于继续堆预设 provider。

原因：

- 一次覆盖长尾企业邮箱、自建邮箱、Amazon WorkMail、国外中小 provider
- 复用已有 `MailProviderConfig` 结构，开发成本低于继续堆大量离散 preset
- 能解决“企业邮箱到底是什么协议”的核心问题：绝大多数企业邮箱本质就是标准 IMAP/SMTP

### 决策 3：在 Custom 稳定后，再补 curated presets

补充预设的目的不是改变架构，而是改善 UX：

- 自动填入 host / port / TLS / folders 默认值
- 给出准确的授权码说明
- 降低 operator 手填成本

## 5. 推荐实现顺序

### Phase 1：Custom IMAP/SMTP（优先）

新增一个一等入口：

- 代表协议归类：`imap_smtp`
- provider 语义：`CUSTOM_IMAP_SMTP` 或等价的通用 profile 入口
- 允许用户手动填写：
  - IMAP host
  - IMAP port
  - IMAP TLS
  - SMTP host
  - SMTP port
  - SMTP secure / STARTTLS 语义
  - 登录密码 / 授权码 / App Password
  - 文件夹映射（Inbox / Junk / Sent）

这个入口需要明确限制：

- 不支持 OAuth
- 不引入额外协议
- 只服务于标准 IMAP / SMTP 场景

### Phase 2：在 Custom 基础上新增 curated presets

建议首批补入：

- Amazon WorkMail
- Fastmail
- AOL Mail
- GMX
- Mail.com
- Yandex Mail

其中：

- Amazon WorkMail：典型企业 IMAP/SMTP 场景，优先级高
- Fastmail：国际化场景中常见，且能力稳定
- AOL / GMX / Mail.com / Yandex：作为常见国外通用邮箱补齐

### Phase 3：帮助文案与错误提示升级

按 provider 类型补足帮助信息：

- 普通密码不可用时提示“请改用授权码 / App Password”
- 需要管理员后台开启 IMAP/SMTP 时给予明确说明
- 对网易系保留“可能存在客户端识别 / 会话策略限制”的错误提示增强

## 6. 数据模型与代码结构设计

### 6.1 后端改动方向

需要修改的主文件：

- `server/src/modules/mail/providers/types.ts`
- `server/src/modules/mail/providers/registry.ts`
- `server/src/modules/mail/providers/imap-smtp.adapter.ts`
- `server/src/modules/email/email.schema.ts`
- 如涉及数据库枚举：`server/prisma/schema.prisma` + 对应 migration

建议新增：

- 新的 provider 枚举值：例如 `CUSTOM_IMAP_SMTP`
- 新的 profile：例如 `custom-imap-smtp`
- `providerConfigDefaults` 对于 custom 默认保持空值
- `importToken` 对于 custom 不参与批量导入模板，或使用独立模板

后端行为原则：

- custom 与其它 IMAP/SMTP provider 走同一条 shared IMAP/SMTP 路径
- 差别只在 `providerConfig` 是否为用户自填
- 不要为 custom 单独发明新的 adapter 体系，优先复用通用 delegate

### 6.2 前端改动方向

需要修改的主文件：

- `web/src/constants/providers.ts`
- `web/src/pages/emails/index.tsx`

建议前端表现：

- 在 `IMAP / SMTP` 家族下增加 `Custom IMAP / SMTP`
- 选择 custom 后展开高级配置区
- 高级配置区字段包括：
  - IMAP host / port / TLS
  - SMTP host / port / secure
  - 文件夹映射
  - 凭据说明

表单约束：

- custom 必填 host / port
- preset provider 默认带出 host / port，但允许覆盖
- 对文件夹映射允许空值回退默认逻辑

### 6.3 导入模板策略

现有 provider 依赖固定 `importTemplate`。对于 custom，不建议要求复杂导入模板作为第一步。

建议：

- 首版 custom 先只支持表单创建/编辑
- 导入模板支持留到第二轮
- 避免一开始就把批量导入格式复杂化

## 7. 企业邮箱支持策略

企业邮箱不应继续被当作“要不要再新增一个协议”的问题，而应被当作：

- 是不是标准 IMAP/SMTP
- 是否已有现成 preset
- 如果没有，是否可以通过 custom 接入

常见企业邮箱映射策略：

- Google Workspace → 复用 Gmail 体系
- Microsoft 365 → 复用 Outlook 体系
- Zoho Workplace → 复用 Zoho 体系
- Amazon WorkMail → 建议新增 preset，同时也能被 custom 覆盖
- cPanel / 自建邮局 / 域名邮箱 → 直接使用 custom

## 8. 风险与边界

### 风险 1：Custom 表单复杂度上升

缓解方式：

- 把 custom 限制在 `imap_smtp` 家族内
- 使用折叠式高级配置区
- 提供预设示例而不是扩大主流程分支数量

### 风险 2：用户误把网页登录密码当作客户端密码

缓解方式：

- 为每个 provider 展示更明确的 `secretHelpText`
- 在 custom 模式增加通用提示：
  - 某些服务需要 App Password / 授权码
  - 某些企业邮箱需要管理员开启 IMAP/SMTP

### 风险 3：长尾 provider 无限膨胀

缓解方式：

- 原则上优先做 custom
- curated preset 仅覆盖真正高频的 provider
- 不把每一个可用 IMAP 服务器都变成 first-class provider

### 风险 4：不兼容 bridge / proprietary 模型

边界说明：

- Proton Bridge 一类不纳入当前阶段
- 不新增新的协议家族去容纳本地桥接程序

## 9. 验证要求

实现阶段必须覆盖：

1. schema 校验
2. provider/profile 解析
3. 前端 provider/profile 展示与切换
4. custom 表单参数落库
5. IMAP 收信验证
6. SMTP 发信验证
7. Docker 环境下的闭环验证

建议至少新增：

- `types.ts` / registry 相关测试
- `email.schema.ts` 的 custom 校验测试
- custom preset 到 shared IMAP/SMTP 路径的闭环测试

## 10. 最终建议

推荐方案为：

1. **保持 3-family 模型不变**
2. **先实现 `Custom IMAP/SMTP`**
3. **再补 Amazon WorkMail、Fastmail、AOL、GMX、Mail.com、Yandex 这些高频 preset**
4. **Google Workspace / Microsoft 365 / Zoho Workplace 继续复用现有 Gmail / Outlook / Zoho 体系**

这个顺序可以在最小架构代价下，同时覆盖：

- 常见国外邮箱
- 企业邮箱
- 自建域名邮箱
- 长尾 IMAP/SMTP 服务

并且不会破坏已经稳定下来的协议家族、能力矩阵和 UI 分类体系。

## 11. 当前阶段不做的事

- 不新增第 4 个代表协议家族
- 不引入 JMAP
- 不引入 Proton Bridge / 本地桥接接入
- 不把所有国外邮箱都升级成重量级 first-class provider
- 不在本设计稿阶段修改 git 提交策略（当前仍保持未提交状态）

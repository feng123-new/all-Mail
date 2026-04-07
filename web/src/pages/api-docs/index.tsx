import {
    Alert,
    Anchor,
    Button,
    Card,
    Col,
    Collapse,
    Divider,
    List,
    Row,
    Space,
    Steps,
    Table,
    Tag,
    Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    ApiOutlined,
    CheckCircleOutlined,
    CodeOutlined,
    KeyOutlined,
    MailOutlined,
    SafetyCertificateOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { LOG_ACTION_OPTIONS } from '../../constants/logActions';
import {
    cardBgErrorStyle,
    cardBgMutedStyle,
    cardBgSuccessStyle,
    codeBlockCompactStyle,
    codeBlockStyle,
    fullWidthStyle,
    listItemMarginBottom8Style,
    marginBottom8Style,
    marginBottom16Style,
    marginBottom24Style,
    noMarginStyle,
    noMarginBottomStyle,
    orderedListStyle,
    stickyTop24Style,
    successTextStyle,
    errorTextStyle,
} from '../../styles/common';

const { Title, Text, Paragraph } = Typography;

interface ParamRow {
    name: string;
    type: string;
    required: boolean;
    desc: string;
}

interface ApiSection {
    key: string;
    name: string;
    group: '外部连接器接口' | '域名邮箱接口';
    method: string;
    path: string;
    legacyPaths?: string[];
    audience: string;
    description: string;
    usageHint: string;
    params: ParamRow[];
    example: string;
    successResponse: string;
    errorResponse: string;
}

interface SurfaceDocCard {
    key: string;
    title: string;
    auth: string;
    prefixes: string[];
    audience: string;
    description: string;
    status: string;
}

interface RouteOperation {
    method: string;
    path: string;
    purpose: string;
}

interface RouteFamilyDoc {
    key: string;
    sectionId: string;
    surface: 'admin' | 'portal' | 'ingress';
    title: string;
    auth: string;
    audience: string;
    description: string;
    operations: RouteOperation[];
    requestExample?: string;
    successResponse?: string;
}

interface CallPlaybook {
    key: string;
    title: string;
    audience: string;
    summary: string;
    steps: string[];
    curl: string;
    response: string;
}

const paramColumns: ColumnsType<ParamRow> = [
    { title: '参数名', dataIndex: 'name', key: 'name', render: (text) => <Text code>{text}</Text> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '必填', dataIndex: 'required', key: 'required', render: (required) => (required ? <Tag color="red">是</Tag> : <Tag>否</Tag>) },
    { title: '说明', dataIndex: 'desc', key: 'desc' },
];

const operationColumns: ColumnsType<RouteOperation> = [
    { title: '方法', dataIndex: 'method', key: 'method', width: 120, render: (text) => <Tag color="blue">{text}</Tag> },
    { title: '路径', dataIndex: 'path', key: 'path', render: (text) => <Text code>{text}</Text> },
    { title: '功能说明', dataIndex: 'purpose', key: 'purpose' },
];

const ApiDocsPage = () => {
    const docsStyles = {
        fullWidth: fullWidthStyle,
        marginBottom24: marginBottom24Style,
        titleNoMargin: noMarginStyle,
        orderedList: orderedListStyle,
        listItemGap: listItemMarginBottom8Style,
        codeCardMuted: cardBgMutedStyle,
        codeCardSuccess: cardBgSuccessStyle,
        codeCardError: cardBgErrorStyle,
        stickyTop24: stickyTop24Style,
        successText: successTextStyle,
        errorText: errorTextStyle,
    } as const;
    const baseUrl = window.location.origin;

    const authMethods = [
        {
            method: 'Header（推荐）',
            example: 'X-API-Key: sk_your_api_key',
            description: '适合脚本、后端任务、Postman 和 webhook worker。',
        },
        {
            method: 'Bearer Token',
            example: 'Authorization: Bearer sk_your_api_key',
            description: '当你的请求库天然偏好 Bearer Token 时使用。',
        },
    ];

    const gettingStartedSteps = [
        {
            title: '先创建访问密钥',
            description: '在后台「访问密钥」页面创建一个密钥。它只会在创建时显示一次，请立即保存。',
        },
        {
            title: '先区分两条自动化路径',
            description: '外部 Outlook / Gmail / QQ 连接走 /api/*；all-Mail 自己托管的域名邮箱走 /api/domain-mail/*。',
        },
        {
            title: '先跑统计，再分配，再读文本',
            description: '建议先调 allocation-stats，确认认证和作用域没问题；再分配邮箱资源；最后用 messages/text 提取验证码。',
        },
        {
            title: '旧脚本可迁移，不必一步到位',
            description: '旧的 get-email / mail_text / pool-stats 仍保留为兼容别名，但新的集成请直接使用资源化路径。',
        },
    ];

    const beginnerFaq = [
        {
            question: '我应该先调哪一个接口？',
            answer: '先调统计接口。外部连接建议从 /api/mailboxes/allocation-stats 开始，域名邮箱建议从 /api/domain-mail/mailboxes/allocation-stats 开始。确认认证和作用域正常后，再调 allocate 与 messages/text。',
        },
        {
            question: '外部连接器接口和域名邮箱接口有什么区别？',
            answer: '外部连接器接口面向 Outlook / Gmail / QQ 等外部账号；域名邮箱接口面向 all-Mail 自己维护的域名邮箱、批次和入站消息。两者认证方式一致，但资源模型和字段不同。',
        },
        {
            question: '我只是想拿验证码，怎么最省事？',
            answer: '直接使用 messages/text。它支持返回纯文本，也可以通过 match 参数直接提取验证码。',
        },
        {
            question: '旧脚本还能继续跑吗？',
            answer: '可以。旧的 get-email / mail_new / mail_text / pool-stats 等路径仍作为兼容别名存在，但公开文档已经切换到新的资源化命名。',
        },
    ];

    const commonErrors = [
        {
            code: 'AUTH_REQUIRED',
            reason: '请求没有带访问密钥，或者带法不对。',
            suggestion: '优先使用 Header 的 X-API-Key 方式，并确认密钥仍处于 ACTIVE 状态。',
        },
        {
            code: 'EMAIL_NOT_FOUND / DOMAIN_MAILBOX_NOT_FOUND',
            reason: '目标邮箱不存在，或者当前访问密钥无权访问这个资源。',
            suggestion: '先调 mailboxes 接口确认资源存在，再检查访问范围与分组/域名限制。',
        },
        {
            code: 'NO_UNUSED_EMAIL / NO_UNUSED_DOMAIN_MAILBOX',
            reason: '当前可分配资源已耗尽。',
            suggestion: '先查看 allocation-stats，再决定是补资源还是重置当前访问密钥的分配记录。',
        },
        {
            code: 'DOMAIN_FORBIDDEN',
            reason: '当前访问密钥被限制了域名访问范围。',
            suggestion: '换一个有权限的访问密钥，或者在后台放开允许的域名范围。',
        },
        {
            code: 'Error: No match found',
            reason: 'messages/text 提供的正则没有在邮件文本中匹配到内容。',
            suggestion: '先不传 match 获取原始文本，再根据真实邮件内容调整正则表达式。',
        },
    ];

    const surfaceCards: SurfaceDocCard[] = [
        {
            key: 'public-automation',
            title: '公开自动化 API',
            auth: 'X-API-Key / Bearer',
            prefixes: ['/api/*', '/api/domain-mail/*'],
            audience: '脚本、机器人、验证码轮询、自动化服务',
            description: '这是对外的资源分配 / 读信 / 文本提取接口，也是第三方系统最该优先接的调用面。',
            status: '推荐起点',
        },
        {
            key: 'admin-control-plane',
            title: '管理员控制面 API',
            auth: '管理员 session cookie',
            prefixes: ['/admin/*'],
            audience: '后台页面、内部运维脚本、管理员工具',
            description: '覆盖 API Key、外部邮箱、域名、域名邮箱、门户用户、发信配置、转发任务、统计与日志。',
            status: '完整控制面',
        },
        {
            key: 'mailbox-portal',
            title: '门户用户 API',
            auth: 'mailbox_token Cookie',
            prefixes: ['/mail/api/*'],
            audience: '门户前端、站内邮箱用户、自助收件与发信',
            description: '面向 mailbox user 的登录、会话、收件列表、已发送、站内发信与转发设置。',
            status: '门户专用',
        },
        {
            key: 'ingress',
            title: 'Ingress 接入面',
            auth: '签名校验',
            prefixes: ['/ingress/domain-mail/*'],
            audience: '邮件网关、Worker、转发入口、站内入站链路',
            description: '只暴露内部投递入口，用来把入站邮件写入 all-Mail 的域名消息存储。',
            status: '内部集成',
        },
    ];

    const integrationScenarios = [
        {
            title: '场景 1：外部连接器验证码流程',
            steps: [
                '调用 /api/mailboxes/allocate 分配一个外部邮箱资源。',
                '把返回的 email 用到你的注册、验证或自动化流程里。',
                '等待目标站点发信后，调用 /api/messages/text，并传入 match=\\d{6} 之类的正则。',
                '如需重新释放当前访问密钥的分配记录，可调用 /api/mailboxes/allocation-reset。',
            ],
        },
        {
            title: '场景 2：域名邮箱验证码流程',
            steps: [
                '先调用 /api/domain-mail/mailboxes/allocate 分配一个域名邮箱。',
                '把这个邮箱投给你的业务系统。',
                '邮件进入 all-Mail 后，用 /api/domain-mail/messages/latest 或 /api/domain-mail/messages/text 读取最新邮件。',
                '如果你想看某个批次是否快分配完了，优先调用 /api/domain-mail/mailboxes/allocation-stats。',
            ],
        },
    ];

    const routeFamilies: RouteFamilyDoc[] = [
        {
            key: 'admin-auth',
            sectionId: 'admin-api',
            surface: 'admin',
            title: '管理员认证与 2FA',
            auth: '登录前公开；其他接口需要管理员 session cookie',
            audience: '后台登录页、管理员个人设置、安全运维',
            description: '对应 `server/src/modules/auth/auth.routes.ts`，覆盖登录、登出、当前用户、改密、2FA 状态、启用与禁用。',
            operations: [
                { method: 'POST', path: '/admin/auth/login', purpose: '管理员登录并写入 httpOnly cookie，同时返回当前管理员资料。' },
                { method: 'POST', path: '/admin/auth/logout', purpose: '清理 token cookie。' },
                { method: 'GET', path: '/admin/auth/me', purpose: '读取当前管理员资料与 mustChangePassword 等状态。' },
                { method: 'POST', path: '/admin/auth/change-password', purpose: '管理员主动改密。' },
                { method: 'GET', path: '/admin/auth/2fa/status', purpose: '查看当前 2FA 开启状态。' },
                { method: 'POST', path: '/admin/auth/2fa/setup', purpose: '生成 2FA 绑定二维码与 secret。' },
                { method: 'POST', path: '/admin/auth/2fa/enable', purpose: '校验验证码并启用 2FA。' },
                { method: 'POST', path: '/admin/auth/2fa/disable', purpose: '校验密码/验证码后禁用 2FA。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin9f7497e52ce24065"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "admin": { "id": 1, "username": "admin", "role": "SUPER_ADMIN" }
  }
}`,
        },
        {
            key: 'admin-api-keys',
            sectionId: 'admin-api',
            surface: 'admin',
            title: '访问密钥与分配范围',
            auth: '管理员 JWT',
            audience: 'API Key 管理页、内部运维脚本、分配范围治理',
            description: '对应 `server/src/modules/api-key/apiKey.routes.ts`，覆盖 API Key CRUD、邮箱池 usage/reset、已分配邮箱列表与手工分配。',
            operations: [
                { method: 'GET', path: '/admin/api-keys', purpose: '分页查询访问密钥。' },
                { method: 'POST', path: '/admin/api-keys', purpose: '创建访问密钥并返回仅展示一次的明文 key。' },
                { method: 'GET', path: '/admin/api-keys/:id', purpose: '查看单个访问密钥详情。' },
                { method: 'PUT', path: '/admin/api-keys/:id', purpose: '更新状态、权限、作用域、过期时间等。' },
                { method: 'DELETE', path: '/admin/api-keys/:id', purpose: '删除访问密钥。' },
                { method: 'GET', path: '/admin/api-keys/:id/allocation-stats', purpose: '查看某个 key 的外部邮箱分配统计。' },
                { method: 'POST', path: '/admin/api-keys/:id/allocation-reset', purpose: '重置某个 key 的外部邮箱分配记录。' },
                { method: 'GET', path: '/admin/api-keys/:id/assigned-mailboxes', purpose: '查看这个 key 能访问/已占用的邮箱。' },
                { method: 'PUT', path: '/admin/api-keys/:id/assigned-mailboxes', purpose: '手工调整该 key 绑定的邮箱集合。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/admin/api-keys" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ops-bot","status":"ACTIVE","permissions":{"mail_text":true},"allowedGroupIds":[1]}'`,
            successResponse: `{
  "success": true,
  "data": {
    "id": 8,
    "name": "ops-bot",
    "plainKey": "sk_xxxxx",
    "status": "ACTIVE"
  }
}`,
        },
        {
            key: 'admin-emails-oauth',
            sectionId: 'admin-api',
            surface: 'admin',
            title: '外部邮箱、OAuth 与邮箱分组',
            auth: '管理员 JWT',
            audience: '外部邮箱连接页、OAuth 配置页、分组管理页',
            description: '对应 `email.routes.ts`、`email.oauth.routes.ts`、`group.routes.ts`，覆盖外部邮箱 CRUD、批量检查、批量清空、导入导出、OAuth 配置与邮箱分组。',
            operations: [
                { method: 'GET', path: '/admin/emails', purpose: '分页查询外部邮箱，支持 provider / representativeProtocol / status / groupId。' },
                { method: 'POST', path: '/admin/emails', purpose: '创建外部邮箱记录。' },
                { method: 'PUT', path: '/admin/emails/:id', purpose: '更新邮箱鉴权信息、分组、状态等。' },
                { method: 'POST', path: '/admin/emails/import', purpose: '按 registry token 批量导入邮箱。' },
                { method: 'GET', path: '/admin/emails/export', purpose: '导出邮箱凭据。' },
                { method: 'POST', path: '/admin/emails/reveal-unlock', purpose: '验证管理员 OTP 并签发短时密码查看授权。' },
                { method: 'POST', path: '/admin/emails/:id/reveal-secrets', purpose: '在 OTP 或短时授权通过后，受控查看指定邮箱密钥。' },
                { method: 'POST', path: '/admin/emails/batch-fetch-mails', purpose: '批量拉取收件箱 / 已发送 / 垃圾箱。' },
                { method: 'POST', path: '/admin/emails/batch-clear-mailbox', purpose: '按 capability 判断后批量清空邮箱。' },
                { method: 'GET', path: '/admin/oauth/providers', purpose: '查看 Google / Microsoft OAuth 当前配置状态。' },
                { method: 'PUT', path: '/admin/oauth/configs/:provider', purpose: '保存 provider 级 OAuth client 配置。' },
                { method: 'POST', path: '/admin/oauth/:provider/start', purpose: '生成授权链接并启动 OAuth 流。' },
                { method: 'GET', path: '/admin/oauth/:provider/status', purpose: '轮询授权状态。' },
                { method: 'GET', path: '/admin/email-groups', purpose: '读取外部邮箱分组。' },
                { method: 'POST', path: '/admin/email-groups/:id/assign', purpose: '把邮箱分配到某个分组。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/admin/emails/batch-fetch-mails" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"representativeProtocol":"imap_smtp","status":"ACTIVE","mailboxes":["INBOX","SENT","Junk"]}'`,
            successResponse: `{
  "success": true,
  "data": {
    "targeted": 6,
    "successCount": 5,
    "partialCount": 1,
    "errorCount": 0,
    "results": [{ "id": 2, "email": "example@gmail.com", "status": "success" }]
  }
}`,
        },
        {
            key: 'admin-domain-surface',
            sectionId: 'admin-api',
            surface: 'admin',
            title: '域名、域名邮箱、门户用户、消息与发信',
            auth: '管理员 JWT（管理员管理额外要求 SUPER_ADMIN）',
            audience: '域名控制台、域名邮箱管理、门户用户管理、域名消息与发信页面',
            description: '对应 `domain.routes.ts`、`domainMailbox.routes.ts`、`mailboxUser.routes.ts`、`message.routes.ts`、`send.routes.ts`、`dashboard.routes.ts`、`admin.routes.ts`。',
            operations: [
                { method: 'GET/POST/PATCH/DELETE', path: '/admin/domains*', purpose: '域名 CRUD、DNS verify、catch-all、sending config、aliases 管理。' },
                { method: 'GET/POST/PATCH/DELETE', path: '/admin/domain-mailboxes*', purpose: '域名邮箱 CRUD、批量创建与批量删除。' },
                { method: 'GET/POST/PATCH/DELETE', path: '/admin/mailbox-users*', purpose: '门户用户 CRUD 与批量绑定邮箱成员关系。' },
                { method: 'GET/DELETE', path: '/admin/domain-messages*', purpose: '查看和删除落库的域名入站消息。' },
                { method: 'GET/POST/DELETE', path: '/admin/send/*', purpose: '查看发送配置、发送消息、删除发送记录。' },
                { method: 'GET', path: '/admin/forwarding-jobs*', purpose: '查看 forwarding job 列表、状态和详情诊断。' },
                { method: 'GET/DELETE', path: '/admin/dashboard/*', purpose: '统计、趋势、后台日志。' },
                { method: 'GET/POST/PUT/DELETE', path: '/admin/admins*', purpose: '超级管理员管理管理员账号。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/admin/domains" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"name":"example.com","displayName":"Ops Domain","canReceive":true,"canSend":true}'`,
            successResponse: `{
  "success": true,
  "data": {
    "id": 6,
    "name": "example.com",
    "status": "PENDING",
    "verificationToken": "..."
  }
}`,
        },
        {
            key: 'mailbox-portal-api',
            sectionId: 'portal-api',
            surface: 'portal',
            title: '门户用户会话、收件、已发送与转发',
            auth: 'mailbox_token Cookie',
            audience: 'mail portal 前端、站内邮箱使用者、自助收发信',
            description: '对应 `mailboxPortal.routes.ts`，是 `/mail/*` 页面真正消费的后端接口。',
            operations: [
                { method: 'POST', path: '/mail/api/login', purpose: '门户用户登录并写入 mailbox_token cookie。' },
                { method: 'POST', path: '/mail/api/logout', purpose: '门户登出。' },
                { method: 'GET', path: '/mail/api/session', purpose: '读取当前门户用户与可见邮箱。' },
                { method: 'GET', path: '/mail/api/mailboxes', purpose: '列出门户用户可访问的域名邮箱。' },
                { method: 'GET', path: '/mail/api/messages', purpose: '查看入站消息列表，支持 mailboxId / unreadOnly / 分页。' },
                { method: 'GET', path: '/mail/api/messages/:id', purpose: '查看单封入站消息详情。' },
                { method: 'GET', path: '/mail/api/sent-messages', purpose: '查看已发送消息列表。' },
                { method: 'GET', path: '/mail/api/sent-messages/:id', purpose: '查看单封已发送消息详情。' },
                { method: 'POST', path: '/mail/api/send', purpose: '以门户用户可访问邮箱发信。' },
                { method: 'POST', path: '/mail/api/change-password', purpose: '门户用户修改密码。' },
                { method: 'POST', path: '/mail/api/forwarding', purpose: '更新门户用户的转发设置。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/mail/api/send" \
  -H "Cookie: mailbox_token=<mailbox-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"mailboxId":12,"to":["target@example.com"],"subject":"Portal send","text":"hello from mailbox portal"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "status": "SENT",
    "id": "188",
    "providerMessageId": "re_xxx"
  }
}`,
        },
        {
            key: 'ingress-api',
            sectionId: 'ingress-api',
            surface: 'ingress',
            title: 'Ingress 入站投递',
            auth: 'ingress signature',
            audience: 'Cloudflare Worker、邮件网关、内部投递器',
            description: '对应 `ingress.routes.ts`，只有一个签名保护的 POST 接口，用来把入站邮件写入域名消息系统。',
            operations: [
                { method: 'POST', path: '/ingress/domain-mail/receive', purpose: '接收入站 payload，校验签名后写入 inbound messages。' },
            ],
            requestExample: `curl -X POST "${baseUrl}/ingress/domain-mail/receive" \
  -H "Content-Type: application/json" \
  -H "x-ingress-key-id: ingress-demo" \
  -H "x-ingress-timestamp: 1774540000" \
  -H "x-ingress-signature: sha256=..." \
  -d '{"domain":"example.com","matchedAddress":"code@example.com","finalAddress":"code@example.com","fromAddress":"noreply@example.com","toAddress":"code@example.com","subject":"Your code","textPreview":"123456"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "accepted": true,
    "messageId": "1024",
    "stored": true
  }
}`,
        },
    ];

    const callPlaybooks: CallPlaybook[] = [
        {
            key: 'playbook-admin-oauth-email',
            title: '管理员配置 OAuth 并创建外部邮箱',
            audience: '后台管理员 / 运维',
            summary: '这是外部 Outlook/Gmail OAuth 接入的完整控制面调用链：先存 provider config，再启动授权，再查状态，最后在邮箱列表里看到回写结果。',
            steps: [
                '调用 /admin/oauth/configs/:provider 保存 clientId / redirectUri / scopes / tenant。',
                '调用 /admin/oauth/:provider/start 获取授权链接。',
                '浏览器完成 OAuth 回调后，用 /admin/oauth/:provider/status 轮询结果。',
                '最后调用 /admin/emails 或 /admin/emails/:id 查看落库的邮箱记录与 capability。',
            ],
            curl: `curl -X POST "${baseUrl}/admin/oauth/google/start" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"groupId":1}'`,
            response: `{
  "success": true,
  "data": {
    "state": "oauth-state-xxx",
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
  }
}`,
        },
        {
            key: 'playbook-admin-domain-bootstrap',
            title: '管理员创建域名、验证 DNS、批量创建域名邮箱',
            audience: '后台管理员 / 域名运维',
            summary: '这是 hosted_internal 体系的控制面标准流程：域名 → verify → catch-all / sending config → mailbox batch create → mailbox user。',
            steps: [
                'POST /admin/domains 创建域名。',
                'POST /admin/domains/:id/verify 生成和刷新 DNS 验证信息。',
                'POST /admin/domains/:id/sending-config 保存发信配置。',
                'POST /admin/domain-mailboxes/batch-create 批量创建 mailbox。',
                'POST /admin/mailbox-users/:id/mailboxes/batch-add 绑定门户用户可见邮箱。',
            ],
            curl: `curl -X POST "${baseUrl}/admin/domain-mailboxes/batch-create" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"domainId":6,"count":20,"batchTag":"ops-batch-20260327","provisioningMode":"API_POOL"}'`,
            response: `{
  "success": true,
  "data": {
    "created": 20,
    "batchTag": "ops-batch-20260327"
  }
}`,
        },
        {
            key: 'playbook-portal-user',
            title: '门户用户登录后收件与发信',
            audience: 'mail portal 前端 / 门户用户',
            summary: '门户用户的典型流是：登录 → session → mailboxes → messages / sent-messages → send / forwarding。',
            steps: [
                'POST /mail/api/login 写入 mailbox_token cookie。',
                'GET /mail/api/session 确认当前门户用户身份。',
                'GET /mail/api/mailboxes 获取可用 mailbox。',
                'GET /mail/api/messages?mailboxId=... 查看收件。',
                'POST /mail/api/send 发信，或 POST /mail/api/forwarding 更新转发策略。',
            ],
            curl: `curl -X POST "${baseUrl}/mail/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"wangheng","password":"Portal9f7497e52ce24065"}'`,
            response: `{
  "success": true,
  "data": {
    "mailboxUser": { "id": 3, "username": "wangheng" }
  }
}`,
        },
        {
            key: 'playbook-ingress',
            title: 'Ingress Worker 推送入站邮件',
            audience: 'Worker / 邮件网关 / 内部接收器',
            summary: '这是站内入站链路的调用方式：签名投递到 ingress，再由 ingress service 写入 inbound message。',
            steps: [
                '构造 request body，并按共享 signing secret 生成 canonical signature。',
                'POST /ingress/domain-mail/receive，带上 key id / timestamp / signature 头。',
                '服务端校验成功后把消息路由到 domain mailbox 与 message store。',
            ],
            curl: `curl -X POST "${baseUrl}/ingress/domain-mail/receive" \
  -H "x-ingress-key-id: ingress-demo" \
  -H "x-ingress-timestamp: 1774540000" \
  -H "x-ingress-signature: sha256=..." \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","matchedAddress":"ops@example.com","finalAddress":"ops@example.com","fromAddress":"noreply@example.com","toAddress":"ops@example.com","subject":"Code","textPreview":"123456"}'`,
            response: `{
  "success": true,
  "data": {
    "accepted": true,
    "stored": true
  }
}`,
        },
    ];

    const apiEndpoints: ApiSection[] = [
        {
            key: 'allocate-external-mailbox',
            name: '分配一个外部邮箱资源',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/mailboxes/allocate',
            legacyPaths: ['/api/get-email'],
            audience: '适合先拿一个可用外部邮箱地址的自动化脚本或服务。',
            description: '从 Outlook / Gmail / QQ 外部连接器里分配一个当前访问密钥尚未占用的邮箱资源，可按分组限制来源。',
            usageHint: '这是大多数“先拿邮箱、再等邮件”的入口接口。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '邮箱分组名称。传了以后，只会从这个分组里挑邮箱。' },
            ],
            example: `curl -X POST "${baseUrl}/api/mailboxes/allocate" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "id": 1
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "NO_UNUSED_EMAIL",
    "message": "No unused emails available. Used: 10/10"
  }
}`,
        },
        {
            key: 'external-latest-message',
            name: '读取外部邮箱最新邮件',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/messages/latest',
            legacyPaths: ['/api/mail_new'],
            audience: '适合已经知道邮箱地址，只想拿最新一封邮件时使用。',
            description: '根据指定邮箱地址读取最新一封邮件，返回结构化 JSON。',
            usageHint: '如果你只想看验证码，而不是整封邮件，优先看 messages/text。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。必须是系统里已经存在的邮箱。' },
                { name: 'mailbox', type: 'string', required: false, desc: '邮箱文件夹，默认 inbox。也可传 sent / junk。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址，可选。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址，可选。' },
            ],
            example: `curl -X POST "${baseUrl}/api/messages/latest" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"example@outlook.com"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "count": 1,
    "messages": [
      {
        "id": "AAMk...",
        "subject": "验证码邮件",
        "from": "noreply@example.com",
        "text": "您的验证码是 123456"
      }
    ],
    "method": "graph_api"
  },
  "email": "example@outlook.com"
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
        },
        {
            key: 'external-message-text',
            name: '提取外部邮箱文本 / 验证码',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/messages/text',
            legacyPaths: ['/api/mail_text'],
            audience: '适合自动化脚本、验证码轮询、机器人流程。',
            description: '返回最新一封邮件的纯文本内容；如果传 match，会尝试直接从文本里提取匹配结果。',
            usageHint: '想省事拿 6 位验证码，就传 match=\\d{6}。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'match', type: 'string', required: false, desc: '可选正则表达式，例如 \\d{6}。' },
            ],
            example: `curl "${baseUrl}/api/messages/text?email=example@outlook.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `123456`,
            errorResponse: `Error: No match found`,
        },
        {
            key: 'external-messages',
            name: '读取外部邮箱邮件列表',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/messages',
            legacyPaths: ['/api/mail_all'],
            audience: '适合排查整封历史邮件，而不是只看最新一封时使用。',
            description: '读取指定邮箱当前文件夹中的邮件列表，返回结构化 JSON。',
            usageHint: '通常用于排查“为什么最新邮件没命中”这类问题。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'mailbox', type: 'string', required: false, desc: '默认 inbox。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址。' },
            ],
            example: `curl "${baseUrl}/api/messages?email=example@outlook.com" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "count": 2,
    "messages": [
      { "id": "1", "subject": "邮件1" },
      { "id": "2", "subject": "邮件2" }
    ],
    "method": "imap"
  },
  "email": "example@outlook.com"
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
        },
        {
            key: 'external-clear-mailbox',
            name: '清理外部邮箱当前文件夹',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/mailboxes/clear',
            legacyPaths: ['/api/process-mailbox'],
            audience: '适合你需要清理邮箱历史、避免旧邮件干扰脚本时使用。',
            description: '删除指定邮箱当前文件夹中的邮件，返回删除结果。',
            usageHint: '生产环境谨慎使用，尤其不要直接对 sent 文件夹做清理。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'mailbox', type: 'string', required: false, desc: '默认 inbox。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址。' },
            ],
            example: `curl -X POST "${baseUrl}/api/mailboxes/clear" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"example@outlook.com"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "status": "success",
    "deletedCount": 5,
    "message": "Successfully deleted 5 messages"
  },
  "email": "example@outlook.com"
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
        },
        {
            key: 'external-mailboxes',
            name: '查看当前可访问的外部邮箱列表',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/mailboxes',
            legacyPaths: ['/api/list-emails'],
            audience: '适合运维脚本或调试人员确认访问范围内到底有哪些外部邮箱资源。',
            description: '列出当前访问密钥有权限访问的 ACTIVE 外部邮箱。',
            usageHint: '如果你不知道邮箱是否存在，先调这个接口。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '邮箱分组名称。' },
            ],
            example: `curl "${baseUrl}/api/mailboxes" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "total": 2,
    "emails": [
      { "email": "user1@outlook.com", "provider": "OUTLOOK", "status": "ACTIVE", "group": "default" },
      { "email": "user2@gmail.com", "provider": "GMAIL", "status": "ACTIVE", "group": null }
    ]
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
        },
        {
            key: 'external-allocation-stats',
            name: '查看外部分配统计',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/mailboxes/allocation-stats',
            legacyPaths: ['/api/pool-stats'],
            audience: '适合先判断资源是否够用，再决定是否继续分配。',
            description: '返回当前访问密钥在外部邮箱资源中的 total / used / remaining。',
            usageHint: '这是最适合作为健康探测或预检查的业务接口之一。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '按分组统计。' },
            ],
            example: `curl "${baseUrl}/api/mailboxes/allocation-stats" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "total": 100,
    "used": 3,
    "remaining": 97
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
        },
        {
            key: 'external-allocation-reset',
            name: '重置外部分配记录',
            group: '外部连接器接口',
            method: 'GET / POST',
            path: '/api/mailboxes/allocation-reset',
            legacyPaths: ['/api/reset-pool'],
            audience: '适合测试环境反复复用资源，或脚本演练完之后手动归零。',
            description: '清空当前访问密钥的邮箱分配历史。不会删除邮箱账号本身。',
            usageHint: '这个动作只重置分配记录，不会删资源对象。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '只重置指定分组。' },
            ],
            example: `curl -X POST "${baseUrl}/api/mailboxes/allocation-reset" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "message": "Pool reset successfully"
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
        },
        {
            key: 'allocate-domain-mailbox',
            name: '分配一个域名邮箱资源',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mailboxes/allocate',
            legacyPaths: ['/api/domain-mail/get-mailbox'],
            audience: '适合你已经在 all-Mail 里维护了域名邮箱资源，并且要从 API_POOL 场景里取号。',
            description: '从域名邮箱资源中分配一个当前访问密钥尚未使用的 API_POOL 邮箱，可按 domainId / domain / batchTag 缩小范围。',
            usageHint: '这是域名邮箱场景里的“先拿邮箱地址”入口。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 限定范围。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名称限定范围。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签限定范围。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/mailboxes/allocate" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"ops-batch-20260318"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "id": 12,
    "email": "demo12@example.com",
    "localPart": "demo12",
    "batchTag": "ops-batch-20260318",
    "domainId": 6,
    "domainName": "example.com"
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "NO_UNUSED_DOMAIN_MAILBOX",
    "message": "No unused domain mailboxes available. Used: 10/10"
  }
}`,
        },
        {
            key: 'domain-latest-message',
            name: '读取域名邮箱最新邮件',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/messages/latest',
            legacyPaths: ['/api/domain-mail/mail_new'],
            audience: '适合已经知道域名邮箱地址，只想拿最新一封入站邮件。',
            description: '读取 all-Mail 已落库的 inbound messages 中最新一封邮件。',
            usageHint: '如果你只在乎验证码，还是建议优先看 messages/text。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址，例如 demo12@example.com。' },
                { name: 'limit', type: 'number', required: false, desc: '当前实现里最新邮件接口实际只取 1 封，一般不用传。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/messages/latest" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo12@example.com"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "demo12@example.com",
    "mailboxId": 12,
    "domainId": 6,
    "domainName": "example.com",
    "count": 1,
    "messages": [
      {
        "id": "101",
        "from": "noreply@example.com",
        "to": "demo12@example.com",
        "subject": "验证码邮件",
        "text": "Your code is 123456",
        "html": "",
        "verificationCode": "123456",
        "routeKind": "DIRECT",
        "date": "2026-03-19T12:00:00.000Z"
      }
    ]
  },
  "email": "demo12@example.com"
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_MAILBOX_NOT_FOUND",
    "message": "Domain API mailbox not found"
  }
}`,
        },
        {
            key: 'domain-messages',
            name: '读取域名邮箱邮件列表',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/messages',
            legacyPaths: ['/api/domain-mail/mail_all'],
            audience: '适合排查整批域名邮件历史，而不是只看最新一封。',
            description: '读取某个域名邮箱已落库的入站邮件列表，支持 limit。',
            usageHint: '这是域名邮箱版的消息列表接口。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址。' },
                { name: 'limit', type: 'number', required: false, desc: '最多返回 100 条，默认 20 条。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/messages" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo12@example.com","limit":5}'`,
            successResponse: `{
  "success": true,
  "data": {
    "email": "demo12@example.com",
    "mailboxId": 12,
    "domainId": 6,
    "domainName": "example.com",
    "count": 2,
    "messages": [
      { "id": "101", "subject": "验证码邮件", "text": "Your code is 123456" },
      { "id": "100", "subject": "欢迎邮件", "text": "Welcome" }
    ]
  },
  "email": "demo12@example.com"
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_MAILBOX_NOT_FOUND",
    "message": "Domain API mailbox not found"
  }
}`,
        },
        {
            key: 'domain-message-text',
            name: '提取域名邮箱文本 / 验证码',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/messages/text',
            legacyPaths: ['/api/domain-mail/mail_text'],
            audience: '适合域名邮箱验证码读取和自动化脚本。',
            description: '从最新一封域名邮箱邮件里提取纯文本；支持用 match 正则直接抽取验证码。',
            usageHint: '如果你只要验证码，这是域名邮箱场景里最推荐的接口。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址。' },
                { name: 'match', type: 'string', required: false, desc: '可选正则表达式。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/messages/text?email=demo12@example.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `123456`,
            errorResponse: `Error: No match found`,
        },
        {
            key: 'domain-mailboxes',
            name: '查看当前可访问的域名邮箱列表',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mailboxes',
            legacyPaths: ['/api/domain-mail/list-mailboxes'],
            audience: '适合调试域名邮箱资源、看某个批次还有哪些邮箱能分。',
            description: '列出当前访问密钥可访问的 API_POOL 域名邮箱，并返回是否已被当前访问密钥使用。',
            usageHint: '如果你不确定资源里有哪些邮箱，这个接口最好先跑一遍。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 筛选。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名称筛选。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签筛选。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/mailboxes?domain=example.com" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "total": 2,
    "mailboxes": [
      {
        "id": 12,
        "email": "demo12@example.com",
        "localPart": "demo12",
        "batchTag": "ops-batch-20260318",
        "used": true,
        "domainId": 6,
        "domainName": "example.com"
      }
    ]
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_FORBIDDEN",
    "message": "This API Key cannot access the selected domain"
  }
}`,
        },
        {
            key: 'domain-allocation-stats',
            name: '查看域名邮箱分配统计',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mailboxes/allocation-stats',
            legacyPaths: ['/api/domain-mail/pool-stats'],
            audience: '适合先判断域名邮箱剩余量，再决定要不要继续分配。',
            description: '返回当前访问密钥在域名邮箱资源中的 total / used / remaining。',
            usageHint: '域名邮箱版的健康探测接口。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 统计。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名统计。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次统计。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/mailboxes/allocation-stats?domain=example.com" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `{
  "success": true,
  "data": {
    "total": 50,
    "used": 12,
    "remaining": 38
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
        },
        {
            key: 'domain-allocation-reset',
            name: '重置域名邮箱分配记录',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mailboxes/allocation-reset',
            legacyPaths: ['/api/domain-mail/reset-pool'],
            audience: '适合测试或重复演练场景，需要重新把当前访问密钥的域名邮箱占用归零。',
            description: '删除当前访问密钥对这些域名邮箱的使用记录，不会删除邮箱本身。',
            usageHint: '和外部连接的 allocation-reset 语义一致，只是对象换成域名邮箱资源。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 重置。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名重置。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签重置。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/mailboxes/allocation-reset" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"ops-batch-20260318"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "success": true,
    "deletedCount": 12
  }
}`,
            errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_FORBIDDEN",
    "message": "This API Key cannot access the selected domain"
  }
}`,
        },
    ];

    const groupedApis = [
        {
            key: 'external',
            title: '外部连接器接口（OAuth API / IMAP / SMTP）',
            description: '面向外部邮箱连接器与自动化调用，覆盖 Outlook、Gmail 以及当前 registry 中的 QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱等 IMAP / SMTP profile。',
            items: apiEndpoints.filter((item) => item.group === '外部连接器接口'),
        },
        {
            key: 'domain',
            title: '域名邮箱接口（all-Mail 自管域名邮箱）',
            description: '面向 all-Mail 自己管理的域名邮箱、批次与入站消息，适合统一管理自有域名和消息落库。',
            items: apiEndpoints.filter((item) => item.group === '域名邮箱接口'),
        },
    ];

    const logActionRows = LOG_ACTION_OPTIONS.map((item) => ({
        action: item.value,
        label: item.label,
    }));

    const routeFamilyGroups = [
        {
            key: 'admin',
            sectionId: 'admin-api',
            title: '管理员控制面 API',
            description: '后台页面自己调用的 JWT 保护接口，覆盖认证、邮箱、域名、门户用户、发信、日志与统计。',
            items: routeFamilies.filter((item) => item.surface === 'admin'),
        },
        {
            key: 'portal',
            sectionId: 'portal-api',
            title: '门户用户 API',
            description: 'mail portal 使用的 mailbox session 接口，适合收件、已发送和站内发信场景。',
            items: routeFamilies.filter((item) => item.surface === 'portal'),
        },
        {
            key: 'ingress',
            sectionId: 'ingress-api',
            title: 'Ingress / 内部投递 API',
            description: '站内邮件入站接收面，供 Worker / 网关把原始投递写入 all-Mail。',
            items: routeFamilies.filter((item) => item.surface === 'ingress'),
        },
    ];

    return (
        <div>
            <PageHeader
                title="API 文档"
                subtitle="把 all-Mail 当成统一的邮件自动化控制面来使用：这页现在同时覆盖公开自动化 API、管理员控制面、门户用户 API 和 ingress 投递面，并按真实路由分组展示。"
                extra={
                    <Button type="primary" icon={<ApiOutlined />} href="#quick-start">
                        从这里开始
                    </Button>
                }
            />

            <Row gutter={24} align="top">
                <Col xs={24} xl={18}>
                    <div id="quick-start">
                        <SurfaceCard style={docsStyles.marginBottom24}>
                            <Space orientation="vertical" size={16} style={docsStyles.fullWidth}>
                                <Space>
                                    <Tag color="blue">新命名</Tag>
                                    <Tag color="purple">兼容别名</Tag>
                                    <Tag color="green">真实接口</Tag>
                                    <Tag color="gold">完整功能面</Tag>
                                </Space>
                                <Title level={4} style={docsStyles.titleNoMargin}>先用一句话理解 all-Mail API</Title>
                                <Paragraph style={noMarginBottomStyle}>
                                    如果你把 <Text strong>all-Mail</Text> 当成一个“分配邮箱资源、读取消息、提取验证码、管理分配状态”的服务，
                                    这一页就是它的操作说明书。新的公开主路径采用资源化命名；旧脚本路径仍可迁移，但不再作为主文档入口。除了公开接口，这里也把后台控制面、门户会话和 ingress 投递面一起梳理成可调用手册。
                                </Paragraph>
                                <Alert
                                    type="info"
                                    showIcon
                                    title="最重要的区别：先认清你在调哪一个功能面"
                                    description={
                                        <div>
                                            <p style={marginBottom8Style}>
                                                <Text strong>外部连接器接口：</Text>对应 Outlook / Gmail / QQ 等外部连接器，推荐路径族是 <Text code>/api/mailboxes/*</Text> 与 <Text code>/api/messages/*</Text>。
                                            </p>
                                            <p style={marginBottom8Style}>
                                                <Text strong>域名邮箱接口：</Text>对应 all-Mail 自己管理的域名邮箱与入站消息，推荐路径族是 <Text code>/api/domain-mail/mailboxes/*</Text> 与 <Text code>/api/domain-mail/messages/*</Text>。
                                            </p>
                                            <p style={marginBottom8Style}>
                                                <Text strong>管理员控制面：</Text>后台真实使用的是 <Text code>/admin/*</Text>，包括 OAuth、邮箱、域名、域名邮箱、门户用户、发信与日志。
                                            </p>
                                            <p style={noMarginBottomStyle}>
                                                <Text strong>门户与 ingress：</Text>门户用户调用 <Text code>/mail/api/*</Text>，内部投递接入面是 <Text code>/ingress/domain-mail/receive</Text>。
                                            </p>
                                        </div>
                                    }
                                />
                            </Space>
                        </SurfaceCard>
                    </div>

                    <div id="surface-map">
                        <SurfaceCard title="平台功能面一览" style={docsStyles.marginBottom24}>
                            <Row gutter={[16, 16]}>
                                {surfaceCards.map((surface) => (
                                    <Col xs={24} md={12} key={surface.key}>
                                        <Card size="small" title={surface.title} extra={<Tag color="processing">{surface.status}</Tag>}>
                            <Space orientation="vertical" size={8} style={docsStyles.fullWidth}>
                                                <Text type="secondary">{surface.description}</Text>
                                                <div>
                                                    <Text strong>认证：</Text> {surface.auth}
                                                </div>
                                                <div>
                                                    <Text strong>适合谁：</Text> {surface.audience}
                                                </div>
                                                <Space wrap>
                                                    {surface.prefixes.map((prefix) => (
                                                        <Text key={prefix} code>{prefix}</Text>
                                                    ))}
                                                </Space>
                                            </Space>
                                        </Card>
                                    </Col>
                                ))}
                            </Row>
                        </SurfaceCard>
                    </div>

                    <SurfaceCard title="5 分钟上手" style={docsStyles.marginBottom24}>
                        <Steps direction="vertical" current={-1} items={gettingStartedSteps} />
                    </SurfaceCard>

                    <SurfaceCard title="先把最常见的两个场景跑通" style={docsStyles.marginBottom24}>
                        <Row gutter={[16, 16]}>
                            {integrationScenarios.map((scenario) => (
                                <Col xs={24} lg={12} key={scenario.title}>
                                    <Card size="small" title={scenario.title}>
                                        <ol style={docsStyles.orderedList}>
                                            {scenario.steps.map((step) => (
                                                <li key={step} style={docsStyles.listItemGap}>{step}</li>
                                            ))}
                                        </ol>
                                    </Card>
                                </Col>
                            ))}
                        </Row>
                    </SurfaceCard>

                    <SurfaceCard title="高频功能调用剧本" style={docsStyles.marginBottom24}>
                        <Row gutter={[16, 16]}>
                            {callPlaybooks.map((playbook) => (
                                <Col xs={24} key={playbook.key}>
                                    <Card size="small" title={playbook.title}>
                                        <Space orientation="vertical" size={12} style={docsStyles.fullWidth}>
                                            <Alert type="info" showIcon title={playbook.audience} description={playbook.summary} />
                                            <ol style={docsStyles.orderedList}>
                                                {playbook.steps.map((step) => (
                                                    <li key={step} style={docsStyles.listItemGap}>{step}</li>
                                                ))}
                                            </ol>
                                            <Row gutter={16}>
                                                <Col xs={24} lg={12}>
                                                    <Title level={5}>调用示例</Title>
                                                    <SurfaceCard size="small" style={docsStyles.codeCardMuted}>
                                                        <Text code style={codeBlockStyle}>{playbook.curl}</Text>
                                                    </SurfaceCard>
                                                </Col>
                                                <Col xs={24} lg={12}>
                                                    <Title level={5}>响应示例</Title>
                                                    <SurfaceCard size="small" style={docsStyles.codeCardSuccess}>
                                                        <Text code style={codeBlockStyle}>{playbook.response}</Text>
                                                    </SurfaceCard>
                                                </Col>
                                            </Row>
                                        </Space>
                                    </Card>
                                </Col>
                            ))}
                        </Row>
                    </SurfaceCard>

                    <SurfaceCard title="认证方式" style={docsStyles.marginBottom24}>
                        <Alert
                            type="warning"
                            showIcon
                            icon={<KeyOutlined />}
                                                title="所有外部 API 都需要访问密钥"
                            description="请先到后台的「访问密钥」页面创建密钥。这个密钥只在创建时显示一次，请立即保存到密码管理器或你的部署环境变量里。"
                            style={marginBottom16Style}
                        />
                        <Table
                            rowKey="method"
                            pagination={false}
                            size="small"
                            dataSource={authMethods}
                            columns={[
                                { title: '方式', dataIndex: 'method', key: 'method' },
                                { title: '示例', dataIndex: 'example', key: 'example', render: (text) => <Text code copyable>{text}</Text> },
                                { title: '什么时候用', dataIndex: 'description', key: 'description' },
                            ]}
                        />
                    </SurfaceCard>

                    <SurfaceCard title="公开自动化 API 详解" style={docsStyles.marginBottom24}>
                        <Space orientation="vertical" size={24} style={docsStyles.fullWidth}>
                            {groupedApis.map((group) => (
                                <div key={group.key} id={group.key === 'external' ? 'external-api' : 'domain-api'}>
                                    <Title level={4}>{group.title}</Title>
                                    <Paragraph type="secondary">{group.description}</Paragraph>
                                    <Collapse
                                        items={group.items.map((api) => ({
                                            key: api.key,
                                            label: (
                                                <Space wrap>
                                                    <Tag color="blue">{api.method}</Tag>
                                                    <span>{api.name}</span>
                                                    <Text code>{api.path}</Text>
                                                </Space>
                                            ),
                                            children: (
                                        <Space orientation="vertical" size={16} style={docsStyles.fullWidth}>
                                            <Alert type="info" showIcon title={api.audience} description={api.description} />
                                                    <Alert
                                                        type="success"
                                                        showIcon
                                                        icon={<CheckCircleOutlined />}
                                                title="什么时候最适合调这个接口？"
                                                        description={api.usageHint}
                                                    />
                                                    {api.legacyPaths && api.legacyPaths.length > 0 ? (
                                                        <Alert
                                                            type="warning"
                                                            showIcon
                                                            icon={<WarningOutlined />}
                                                title="兼容别名仍可使用"
                                                            description={
                                                                <Space wrap>
                                                                    {api.legacyPaths.map((legacyPath) => (
                                                                        <Text key={legacyPath} code>{legacyPath}</Text>
                                                                    ))}
                                                                </Space>
                                                            }
                                                        />
                                                    ) : null}

                                                    <div>
                                                        <Title level={5}>请求地址</Title>
                                                        <Paragraph>
                                                            <Text code copyable>{baseUrl}{api.path}</Text>
                                                        </Paragraph>
                                                    </div>

                                                    <div>
                                                        <Title level={5}>请求参数</Title>
                                                        <Table rowKey="name" pagination={false} size="small" columns={paramColumns} dataSource={api.params} />
                                                    </div>

                                                    <div>
                                                        <Title level={5}>curl 调用示例</Title>
                                                        <SurfaceCard size="small" style={docsStyles.codeCardMuted}>
                                                            <Text code style={codeBlockStyle}>{api.example}</Text>
                                                        </SurfaceCard>
                                                    </div>

                                                    <Row gutter={16}>
                                                        <Col xs={24} lg={12}>
                                                            <Title level={5} style={docsStyles.successText}>成功响应示例</Title>
                                                            <SurfaceCard size="small" style={docsStyles.codeCardSuccess}>
                                                                <Text code style={codeBlockCompactStyle}>{api.successResponse}</Text>
                                                            </SurfaceCard>
                                                        </Col>
                                                        <Col xs={24} lg={12}>
                                                            <Title level={5} style={docsStyles.errorText}>失败响应示例</Title>
                                                            <SurfaceCard size="small" style={docsStyles.codeCardError}>
                                                                <Text code style={codeBlockCompactStyle}>{api.errorResponse}</Text>
                                                            </SurfaceCard>
                                                        </Col>
                                                    </Row>
                                                </Space>
                                            ),
                                        }))}
                                    />
                                </div>
                            ))}
                        </Space>
                    </SurfaceCard>

                    <SurfaceCard title="控制面与内部功能面详解" style={docsStyles.marginBottom24}>
                        <Space orientation="vertical" size={24} style={docsStyles.fullWidth}>
                            {routeFamilyGroups.map((group) => (
                                <div key={group.key} id={group.sectionId}>
                                    <Title level={4}>{group.title}</Title>
                                    <Paragraph type="secondary">{group.description}</Paragraph>
                                    <Collapse
                                        items={group.items.map((item) => ({
                                            key: item.key,
                                            label: (
                                                <Space wrap>
                                                    <Tag color={item.surface === 'admin' ? 'blue' : item.surface === 'portal' ? 'purple' : 'gold'}>
                                                        {item.auth}
                                                    </Tag>
                                                    <span>{item.title}</span>
                                                </Space>
                                            ),
                                            children: (
                                        <Space orientation="vertical" size={16} style={docsStyles.fullWidth}>
                                            <Alert type="info" showIcon title={item.audience} description={item.description} />
                                                    <div>
                                                        <Title level={5}>功能调用矩阵</Title>
                                                        <Table rowKey="path" pagination={false} size="small" columns={operationColumns} dataSource={item.operations} />
                                                    </div>
                                                    {item.requestExample ? (
                                                        <div>
                                                            <Title level={5}>请求示例</Title>
                                                            <SurfaceCard size="small" style={docsStyles.codeCardMuted}>
                                                                <Text code style={codeBlockStyle}>{item.requestExample}</Text>
                                                            </SurfaceCard>
                                                        </div>
                                                    ) : null}
                                                    {item.successResponse ? (
                                                        <div>
                                                            <Title level={5}>成功响应示例</Title>
                                                            <SurfaceCard size="small" style={docsStyles.codeCardSuccess}>
                                                                <Text code style={codeBlockStyle}>{item.successResponse}</Text>
                                                            </SurfaceCard>
                                                        </div>
                                                    ) : null}
                                                </Space>
                                            ),
                                        }))}
                                    />
                                </div>
                            ))}
                        </Space>
                    </SurfaceCard>

                    <SurfaceCard title="排错说明" style={docsStyles.marginBottom24}>
                        <List
                            itemLayout="vertical"
                            dataSource={commonErrors}
                            renderItem={(item) => (
                                <List.Item key={item.code}>
                                                    <Space orientation="vertical" size={4} style={docsStyles.fullWidth}>
                                        <Space wrap>
                                            <Tag color="red">{item.code}</Tag>
                                            <Text strong>{item.reason}</Text>
                                        </Space>
                                        <Text type="secondary">建议排查：{item.suggestion}</Text>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    </SurfaceCard>

                    <SurfaceCard title="日志 action 与内部约定" style={docsStyles.marginBottom24}>
                                    <Space orientation="vertical" size={16} style={docsStyles.fullWidth}>
                            <Alert
                                type="warning"
                                showIcon
                                icon={<WarningOutlined />}
                                            title="后台、门户和 ingress 都是真实接口，但它们的目标受众不同"
                                description="公开自动化 API 优先给脚本和第三方系统；/admin/* 更适合后台控制面；/mail/api/* 只适合门户会话；/ingress/* 只适合内部签名投递。"
                            />
                            <Paragraph style={noMarginBottomStyle}>
                                如果你是管理员，可能还会接触到：
                                <Text code> /admin/api-keys </Text>
                                <Text code> /admin/emails </Text>
                                <Text code> /admin/domains </Text>
                                <Text code> /admin/domain-mailboxes </Text>
                                <Text code> /admin/send </Text>
                                以及门户自己的
                                <Text code> /mail/api/* </Text>
                                。这些接口都是真实存在的，但它们属于后台或门户内部能力，不适合作为“新手 API 起点”。
                            </Paragraph>
                            <Table
                                rowKey="action"
                                size="small"
                                pagination={false}
                                dataSource={logActionRows}
                                columns={[
                                    { title: '操作日志 action', dataIndex: 'action', key: 'action', render: (text) => <Text code>{text}</Text> },
                                    { title: '中文含义', dataIndex: 'label', key: 'label' },
                                ]}
                            />
                        </Space>
                    </SurfaceCard>
                </Col>

                <Col xs={24} xl={6}>
                    <SurfaceCard title="快速导航" style={docsStyles.stickyTop24}>
                        <Anchor
                            items={[
                                { key: 'quick-start', href: '#quick-start', title: '先读这一页' },
                                { key: 'surface-map', href: '#surface-map', title: '平台功能面一览' },
                                { key: 'external-api', href: '#external-api', title: '外部连接器接口' },
                                { key: 'domain-api', href: '#domain-api', title: '域名邮箱接口' },
                                { key: 'admin-api', href: '#admin-api', title: '管理员控制面 API' },
                                { key: 'portal-api', href: '#portal-api', title: '门户用户 API' },
                                { key: 'ingress-api', href: '#ingress-api', title: 'Ingress 内部投递' },
                            ]}
                        />
                        <Divider />
                        <Space orientation="vertical" size={12} style={docsStyles.fullWidth}>
                            <Alert
                                type="success"
                                showIcon
                                icon={<ThunderboltOutlined />}
                                        title="最快的测试顺序"
                                description={
                                    <div>
                                        <div>1. 先调 <Text code>/api/mailboxes/allocation-stats</Text></div>
                                        <div>2. 再调 <Text code>/api/mailboxes/allocate</Text></div>
                                        <div>3. 最后调 <Text code>/api/messages/text</Text></div>
                                    </div>
                                }
                            />
                            <Alert
                                type="info"
                                showIcon
                                icon={<MailOutlined />}
                                        title="如果你在用域名邮箱自动化"
                                description="把上面三步换成 /api/domain-mail/mailboxes/allocation-stats → /api/domain-mail/mailboxes/allocate → /api/domain-mail/messages/text。"
                            />
                            <Alert
                                type="warning"
                                showIcon
                                icon={<SafetyCertificateOutlined />}
                                        title="生产环境提醒"
                                description="JWT_SECRET、ENCRYPTION_KEY、ADMIN_PASSWORD 必须通过外部环境变量注入，不要写死进仓库。"
                            />
                            <Alert
                                type="info"
                                showIcon
                                icon={<CodeOutlined />}
                                        title="健康检查"
                                description={<Text code copyable>{`${baseUrl}/health`}</Text>}
                            />
                        </Space>
                    </SurfaceCard>
                </Col>
            </Row>

            <Divider />

            <SurfaceCard title="新手常见问题" style={docsStyles.marginBottom24}>
                <Collapse
                    items={beginnerFaq.map((item) => ({
                        key: item.question,
                        label: item.question,
                        children: <Paragraph style={noMarginBottomStyle}>{item.answer}</Paragraph>,
                    }))}
                />
            </SurfaceCard>
        </div>
    );
};

export default ApiDocsPage;

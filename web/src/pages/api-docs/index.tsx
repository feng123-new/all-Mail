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
import { PageHeader } from '../../components';
import { LOG_ACTION_OPTIONS } from '../../constants/logActions';

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

const paramColumns: ColumnsType<ParamRow> = [
    { title: '参数名', dataIndex: 'name', key: 'name', render: (text) => <Text code>{text}</Text> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '必填', dataIndex: 'required', key: 'required', render: (required) => (required ? <Tag color="red">是</Tag> : <Tag>否</Tag>) },
    { title: '说明', dataIndex: 'desc', key: 'desc' },
];

const ApiDocsPage = () => {
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
        {
            method: 'Query 参数',
            example: '?api_key=sk_your_api_key',
            description: '仍可兼容，但 URL 容易进入代理和日志，不建议作为长期方案。',
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
            title: '外部连接器接口（Outlook / Gmail / QQ）',
            description: '面向外部邮箱连接器与自动化调用，适合验证码脚本、邮箱轮询和自动化注册等场景。',
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

    return (
        <div>
            <PageHeader
                title="API 文档"
                subtitle="把 all-Mail 当成统一的邮件自动化控制面来使用：新的公开路径已经改为资源化命名，旧脚本路径保留为兼容别名。"
                extra={
                    <Button type="primary" icon={<ApiOutlined />} href="#quick-start">
                        从这里开始
                    </Button>
                }
            />

            <Row gutter={24} align="top">
                <Col xs={24} xl={18}>
                    <div id="quick-start">
                        <Card style={{ marginBottom: 24 }}>
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                <Space>
                                    <Tag color="blue">新命名</Tag>
                                    <Tag color="purple">兼容别名</Tag>
                                    <Tag color="green">真实接口</Tag>
                                </Space>
                                <Title level={4} style={{ margin: 0 }}>先用一句话理解 all-Mail API</Title>
                                <Paragraph style={{ marginBottom: 0 }}>
                                    如果你把 <Text strong>all-Mail</Text> 当成一个“分配邮箱资源、读取消息、提取验证码、管理分配状态”的服务，
                                    这一页就是它的操作说明书。新的公开主路径采用资源化命名；旧脚本路径仍可迁移，但不再作为主文档入口。
                                </Paragraph>
                                <Alert
                                    type="info"
                                    showIcon
                                    message="最重要的区别"
                                    description={
                                        <div>
                                            <p style={{ marginBottom: 8 }}>
                                                <Text strong>外部连接器接口：</Text>对应 Outlook / Gmail / QQ 等外部连接器，推荐路径族是 <Text code>/api/mailboxes/*</Text> 与 <Text code>/api/messages/*</Text>。
                                            </p>
                                            <p style={{ marginBottom: 0 }}>
                                                <Text strong>域名邮箱接口：</Text>对应 all-Mail 自己管理的域名邮箱与入站消息，推荐路径族是 <Text code>/api/domain-mail/mailboxes/*</Text> 与 <Text code>/api/domain-mail/messages/*</Text>。
                                            </p>
                                        </div>
                                    }
                                />
                            </Space>
                        </Card>
                    </div>

                    <Card title="5 分钟上手" style={{ marginBottom: 24 }}>
                        <Steps direction="vertical" current={-1} items={gettingStartedSteps} />
                    </Card>

                    <Card title="先把最常见的两个场景跑通" style={{ marginBottom: 24 }}>
                        <Row gutter={[16, 16]}>
                            {integrationScenarios.map((scenario) => (
                                <Col xs={24} lg={12} key={scenario.title}>
                                    <Card size="small" title={scenario.title}>
                                        <ol style={{ margin: 0, paddingLeft: 20 }}>
                                            {scenario.steps.map((step) => (
                                                <li key={step} style={{ marginBottom: 8 }}>{step}</li>
                                            ))}
                                        </ol>
                                    </Card>
                                </Col>
                            ))}
                        </Row>
                    </Card>

                    <Card title="认证方式" style={{ marginBottom: 24 }}>
                        <Alert
                            type="warning"
                            showIcon
                            icon={<KeyOutlined />}
                            message="所有外部 API 都需要访问密钥"
                            description="请先到后台的「访问密钥」页面创建密钥。这个密钥只在创建时显示一次，请立即保存到密码管理器或你的部署环境变量里。"
                            style={{ marginBottom: 16 }}
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
                    </Card>

                    <Card title="接口总览" style={{ marginBottom: 24 }}>
                        <Space direction="vertical" size={24} style={{ width: '100%' }}>
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
                                                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                                    <Alert type="info" showIcon message={api.audience} description={api.description} />
                                                    <Alert
                                                        type="success"
                                                        showIcon
                                                        icon={<CheckCircleOutlined />}
                                                        message="什么时候最适合调这个接口？"
                                                        description={api.usageHint}
                                                    />
                                                    {api.legacyPaths && api.legacyPaths.length > 0 ? (
                                                        <Alert
                                                            type="warning"
                                                            showIcon
                                                            icon={<WarningOutlined />}
                                                            message="兼容别名仍可使用"
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
                                                        <Card size="small" style={{ background: '#fafafa' }}>
                                                            <Text code style={{ whiteSpace: 'pre-wrap' }}>{api.example}</Text>
                                                        </Card>
                                                    </div>

                                                    <Row gutter={16}>
                                                        <Col xs={24} lg={12}>
                                                            <Title level={5} style={{ color: '#389e0d' }}>成功响应示例</Title>
                                                            <Card size="small" style={{ background: '#f6ffed' }}>
                                                                <Text code style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{api.successResponse}</Text>
                                                            </Card>
                                                        </Col>
                                                        <Col xs={24} lg={12}>
                                                            <Title level={5} style={{ color: '#cf1322' }}>失败响应示例</Title>
                                                            <Card size="small" style={{ background: '#fff2f0' }}>
                                                                <Text code style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{api.errorResponse}</Text>
                                                            </Card>
                                                        </Col>
                                                    </Row>
                                                </Space>
                                            ),
                                        }))}
                                    />
                                </div>
                            ))}
                        </Space>
                    </Card>

                    <Card title="排错说明" style={{ marginBottom: 24 }}>
                        <List
                            itemLayout="vertical"
                            dataSource={commonErrors}
                            renderItem={(item) => (
                                <List.Item key={item.code}>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                            <Tag color="red">{item.code}</Tag>
                                            <Text strong>{item.reason}</Text>
                                        </Space>
                                        <Text type="secondary">建议排查：{item.suggestion}</Text>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    </Card>

                    <Card title="高级说明（给运维或管理员）" style={{ marginBottom: 24 }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <Alert
                                type="warning"
                                showIcon
                                icon={<WarningOutlined />}
                                message="这页优先服务自动化 API 调用者，不把后台管理接口当主角"
                                description="像 /admin/* 和 /mail/api/* 这类接口更多是后台页面和门户自身在用，不建议普通集成方直接依赖。"
                            />
                            <Paragraph style={{ marginBottom: 0 }}>
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
                    </Card>
                </Col>

                <Col xs={24} xl={6}>
                    <Card title="快速导航" style={{ position: 'sticky', top: 24 }}>
                        <Anchor
                            items={[
                                { key: 'quick-start', href: '#quick-start', title: '先读这一页' },
                                { key: 'external-api', href: '#external-api', title: '外部连接器接口' },
                                { key: 'domain-api', href: '#domain-api', title: '域名邮箱接口' },
                            ]}
                        />
                        <Divider />
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Alert
                                type="success"
                                showIcon
                                icon={<ThunderboltOutlined />}
                                message="最快的测试顺序"
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
                                message="如果你在用域名邮箱自动化"
                                description="把上面三步换成 /api/domain-mail/mailboxes/allocation-stats → /api/domain-mail/mailboxes/allocate → /api/domain-mail/messages/text。"
                            />
                            <Alert
                                type="warning"
                                showIcon
                                icon={<SafetyCertificateOutlined />}
                                message="生产环境提醒"
                                description="JWT_SECRET、ENCRYPTION_KEY、ADMIN_PASSWORD 必须通过外部环境变量注入，不要写死进仓库。"
                            />
                            <Alert
                                type="info"
                                showIcon
                                icon={<CodeOutlined />}
                                message="健康检查"
                                description={<Text code copyable>{`${baseUrl}/health`}</Text>}
                            />
                        </Space>
                    </Card>
                </Col>
            </Row>

            <Divider />

            <Card title="新手常见问题" style={{ marginBottom: 24 }}>
                <Collapse
                    items={beginnerFaq.map((item) => ({
                        key: item.question,
                        label: item.question,
                        children: <Paragraph style={{ marginBottom: 0 }}>{item.answer}</Paragraph>,
                    }))}
                />
            </Card>
        </div>
    );
};

export default ApiDocsPage;

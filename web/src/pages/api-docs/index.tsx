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
import { LOG_ACTION_OPTIONS } from '../../constants/logActions';
import { PageHeader } from '../../components';

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
    group: '外部邮箱接口' | '域名邮箱接口';
    method: string;
    path: string;
    audience: string;
    description: string;
    usageHint: string;
    params: ParamRow[];
    example: string;
    successResponse: string;
    errorResponse: string;
}

const ApiDocsPage = () => {
    const baseUrl = window.location.origin;

    const authMethods = [
        {
            method: 'Header（推荐）',
            example: 'X-API-Key: sk_your_api_key',
            description: '最清晰、最稳定，适合脚本、后端服务、Postman。',
        },
        {
            method: 'Bearer Token',
            example: 'Authorization: Bearer sk_your_api_key',
            description: '如果你的请求库默认支持 Bearer，这个写法也可以。',
        },
        {
            method: 'Query 参数',
            example: '?api_key=sk_your_api_key',
            description: '能用，但不推荐。URL 往往会被代理、日志、浏览器历史记录下来。',
        },
    ];

    const gettingStartedSteps = [
        {
            title: '先创建 API Key',
            description: '在后台「API Key」页面创建一个密钥。它只会在创建时显示一次，请马上保存。',
        },
        {
            title: '确认你要调用哪条线',
            description: '如果你操作的是 Outlook / Gmail / QQ 这类外部邮箱，就走 /api/*；如果你操作的是 all-Mail 自己管理的域名邮箱，就走 /api/domain-mail/*。',
        },
        {
            title: '先跑一个最小请求',
            description: '新手建议先调用 /api/pool-stats 或 /api/domain-mail/pool-stats，看认证和权限是否正常。',
        },
        {
            title: '再接入脚本业务',
            description: '拿到邮箱后，再接 mail_new / mail_text 之类的读取接口；如果你只是要验证码，优先用 mail_text。',
        },
    ];

    const beginnerFaq = [
        {
            question: '我应该先调哪一个接口？',
            answer: '如果你只是想确认 API Key 可用，先调用 /api/pool-stats；如果你要拿一个新邮箱地址，再调用 /api/get-email。域名邮箱同理，先从 /api/domain-mail/pool-stats 或 /api/domain-mail/get-mailbox 开始。',
        },
        {
            question: '外部邮箱接口和域名邮箱接口有什么区别？',
            answer: '外部邮箱接口面向 Outlook / Gmail / QQ 这类邮箱池；域名邮箱接口面向 all-Mail 自己管理的域名邮箱池。两者认证方式一样，但参数和返回字段会略有不同。',
        },
        {
            question: '我只是想拿验证码，怎么最省事？',
            answer: '直接用 mail_text。它是专门给脚本准备的轻量接口，既可以返回整封邮件纯文本，也可以用正则直接提取验证码。',
        },
        {
            question: '为什么有些接口支持 GET/POST 两种方法？',
            answer: '因为 all-Mail 兼容了一些历史脚本习惯。对于正式集成，建议优先用 POST，并把参数放到 JSON body 里，排查问题更清楚。',
        },
    ];

    const commonErrors = [
        {
            code: 'AUTH_REQUIRED',
            reason: '请求没有带 API Key，或者带法不对。',
            suggestion: '先用 Header 方式传 X-API-Key，再检查密钥是否还处于 ACTIVE 状态。',
        },
        {
            code: 'EMAIL_NOT_FOUND / DOMAIN_MAILBOX_NOT_FOUND',
            reason: '你传入的邮箱地址不存在，或者这个邮箱不在当前 API Key 的可访问范围里。',
            suggestion: '先调用 list-emails / list-mailboxes，确认邮箱真实存在，并且属于你当前密钥有权限的范围。',
        },
        {
            code: 'NO_UNUSED_EMAIL / NO_UNUSED_DOMAIN_MAILBOX',
            reason: '当前池里已经没有可分配的未使用邮箱了。',
            suggestion: '先看 pool-stats，必要时让管理员补池子，或者调用 reset-pool 清掉当前 API Key 的历史占用记录。',
        },
        {
            code: 'DOMAIN_FORBIDDEN',
            reason: '当前 API Key 被限制了域名访问范围。',
            suggestion: '换一个有权限的 API Key，或者让管理员在 API Key 权限里放开该域名。',
        },
        {
            code: 'Error: No match found',
            reason: 'mail_text 提供的正则没有在邮件文本里匹配到内容。',
            suggestion: '先不传 match 看原始文本，再根据真实邮件内容调整正则表达式。',
        },
    ];

    const integrationScenarios = [
        {
            title: '场景 1：我只想拿一个外部邮箱验证码',
            steps: [
                '调用 /api/get-email 分配一个未使用的外部邮箱。',
                '把返回的 email 用到你的注册或验证流程里。',
                '等待目标站点发邮件后，调用 /api/mail_text 并传入 match=\\d{6} 之类的正则。',
                '如果验证码拿完就结束，可以保留现状；如果需要重新复用邮箱池，再调用 /api/reset-pool。',
            ],
        },
        {
            title: '场景 2：我在用 all-Mail 的域名邮箱池',
            steps: [
                '先调用 /api/domain-mail/get-mailbox 分配一个域名邮箱。',
                '把这个邮箱地址投给你的业务系统。',
                '邮件进入 all-Mail 后，用 /api/domain-mail/mail_new 或 /api/domain-mail/mail_text 读取最新邮件。',
                '如果你想看某个批次池子是不是快用完了，用 /api/domain-mail/pool-stats。',
            ],
        },
    ];

    const apiEndpoints: ApiSection[] = [
        {
            key: 'get-email',
            name: '分配一个外部邮箱',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/get-email',
            audience: '适合想先拿到一个可用邮箱地址的脚本或自动化服务。',
            description: '从 Outlook / Gmail / QQ 外部邮箱池里分配一个当前 API Key 还没用过的邮箱。可以按分组限制来源。',
            usageHint: '这是大多数“先拿邮箱、再等邮件”的入口接口。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '邮箱分组名称。传了以后，只会从这个分组里挑邮箱。' },
            ],
            example: `curl -X POST "${baseUrl}/api/get-email" \
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
            key: 'mail-new',
            name: '读取外部邮箱最新邮件',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/mail_new',
            audience: '适合你已经知道邮箱地址，只想拿最新一封邮件时使用。',
            description: '根据指定邮箱地址读取最新一封邮件，返回结构化 JSON。',
            usageHint: '如果你只想看验证码，而不是整封邮件，优先看下面的 mail_text。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。必须是系统里已经存在的邮箱。' },
                { name: 'mailbox', type: 'string', required: false, desc: '邮箱文件夹，默认 inbox。也可传 sent / junk。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址，可选。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址，可选。' },
            ],
            example: `curl -X POST "${baseUrl}/api/mail_new" \
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
            key: 'mail-text',
            name: '脚本专用：提取外部邮箱文本 / 验证码',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/mail_text',
            audience: '适合自动化脚本、验证码轮询、机器人流程。',
            description: '返回最新一封邮件的纯文本内容；如果传 match，会尝试直接从文本里提取匹配结果。',
            usageHint: '想省事拿 6 位验证码，就传 match=\\d{6}。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'match', type: 'string', required: false, desc: '可选正则表达式，例如 \\d{6}。' },
            ],
            example: `curl "${baseUrl}/api/mail_text?email=example@outlook.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `123456`,
            errorResponse: `Error: No match found`,
        },
        {
            key: 'mail-all',
            name: '读取外部邮箱全部邮件',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/mail_all',
            audience: '适合你要调试整封历史邮件，而不是只看最新一封时使用。',
            description: '读取指定邮箱当前文件夹中的邮件列表，返回结构化 JSON。',
            usageHint: '通常用于排查“为什么最新邮件没命中”这类问题。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'mailbox', type: 'string', required: false, desc: '默认 inbox。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址。' },
            ],
            example: `curl "${baseUrl}/api/mail_all?email=example@outlook.com" \
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
            key: 'process-mailbox',
            name: '清空外部邮箱当前文件夹',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/process-mailbox',
            audience: '适合你需要清理邮箱历史、避免旧邮件干扰脚本时使用。',
            description: '删除指定邮箱当前文件夹中的邮件，返回删除结果。',
            usageHint: '生产环境谨慎使用，尤其不要一上来就对 sent 文件夹做清空。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '目标邮箱地址。' },
                { name: 'mailbox', type: 'string', required: false, desc: '默认 inbox。' },
                { name: 'socks5', type: 'string', required: false, desc: 'SOCKS5 代理地址。' },
                { name: 'http', type: 'string', required: false, desc: 'HTTP 代理地址。' },
            ],
            example: `curl -X POST "${baseUrl}/api/process-mailbox" \
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
            key: 'list-emails',
            name: '查看当前可用的外部邮箱列表',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/list-emails',
            audience: '适合运维脚本或调试人员先确认池子里到底有哪些邮箱。',
            description: '列出当前 API Key 有权限访问的 ACTIVE 外部邮箱。',
            usageHint: '如果你不知道邮箱是否存在，先调这个接口。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '邮箱分组名称。' },
            ],
            example: `curl "${baseUrl}/api/list-emails" \
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
            key: 'pool-stats',
            name: '查看外部邮箱池统计',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/pool-stats',
            audience: '适合先判断池子是否够用，再决定是否分配新邮箱。',
            description: '返回当前 API Key 在外部邮箱池中的 total / used / remaining。',
            usageHint: '这是最适合做健康探测的业务接口之一。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '按分组统计。' },
            ],
            example: `curl "${baseUrl}/api/pool-stats" \
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
            key: 'reset-pool',
            name: '重置外部邮箱池分配记录',
            group: '外部邮箱接口',
            method: 'GET / POST',
            path: '/api/reset-pool',
            audience: '适合测试环境反复复用邮箱池，或脚本演练完之后手动归零。',
            description: '清空当前 API Key 的邮箱分配历史。',
            usageHint: '这个动作不会删除邮箱账号，只会清掉“你已经用过哪些邮箱”的记录。',
            params: [
                { name: 'group', type: 'string', required: false, desc: '只重置指定分组。' },
            ],
            example: `curl -X POST "${baseUrl}/api/reset-pool" \
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
            key: 'domain-get-mailbox',
            name: '分配一个域名邮箱',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/get-mailbox',
            audience: '适合你已经在 all-Mail 里维护了域名邮箱池，并且要从 API_POOL 里取号。',
            description: '从域名邮箱池中分配一个当前 API Key 还未使用的 API_POOL 邮箱。可按 domainId / domain / batchTag 缩小范围。',
            usageHint: '这是域名邮箱场景里的“先拿邮箱地址”入口。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 限定范围。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名称限定范围。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签限定范围。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/get-mailbox" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"api-pool-example-20260318"}'`,
            successResponse: `{
  "success": true,
  "data": {
    "id": 12,
    "email": "demo12@example.com",
    "localPart": "demo12",
    "batchTag": "api-pool-example-20260318",
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
            key: 'domain-mail-new',
            name: '读取域名邮箱最新邮件',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mail_new',
            audience: '适合你已经知道域名邮箱地址，只想拿最新一封入站邮件。',
            description: '读取 all-Mail 已经落库的 inbound messages 中最新一封邮件。',
            usageHint: '如果你只在乎验证码，还是建议优先看 mail_text。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址，例如 demo12@example.com。' },
                { name: 'limit', type: 'number', required: false, desc: '当前实现里最新邮件接口实际只取 1 封，一般不用传。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/mail_new" \
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
            key: 'domain-mail-all',
            name: '读取域名邮箱邮件列表',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mail_all',
            audience: '适合你要排查整批域名邮件历史，而不是只看最新一封。',
            description: '读取某个域名邮箱已落库的入站邮件列表，支持 limit。',
            usageHint: '这是域名邮箱版的 mail_all。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址。' },
                { name: 'limit', type: 'number', required: false, desc: '最多返回 100 条，默认 20 条。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/mail_all" \
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
            key: 'domain-mail-text',
            name: '脚本专用：提取域名邮箱文本 / 验证码',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/mail_text',
            audience: '适合域名邮箱验证码读取和自动化脚本。',
            description: '从最新一封域名邮箱邮件里提取纯文本；支持用 match 正则直接抽取验证码。',
            usageHint: '如果你只要验证码，这是域名邮箱场景里最推荐的接口。',
            params: [
                { name: 'email', type: 'string', required: true, desc: '域名邮箱地址。' },
                { name: 'match', type: 'string', required: false, desc: '可选正则表达式。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/mail_text?email=demo12@example.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
            successResponse: `123456`,
            errorResponse: `Error: No match found`,
        },
        {
            key: 'domain-list-mailboxes',
            name: '查看当前可用的域名邮箱列表',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/list-mailboxes',
            audience: '适合调试域名邮箱池、看某个批次还有哪些邮箱能分。',
            description: '列出当前 API Key 可访问的 API_POOL 域名邮箱，并返回是否已被当前 API Key 使用。',
            usageHint: '如果你不确定邮箱池里有哪些邮箱，这个接口最好先跑一遍。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 筛选。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名称筛选。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签筛选。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/list-mailboxes?domain=example.com" \
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
        "batchTag": "api-pool-example-20260318",
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
            key: 'domain-pool-stats',
            name: '查看域名邮箱池统计',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/pool-stats',
            audience: '适合先判断域名邮箱池剩余量，再决定要不要继续分配。',
            description: '返回当前 API Key 在域名邮箱池中的 total / used / remaining。',
            usageHint: '域名邮箱版的健康探测接口。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 统计。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名统计。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次统计。' },
            ],
            example: `curl "${baseUrl}/api/domain-mail/pool-stats?domain=example.com" \
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
            key: 'domain-reset-pool',
            name: '重置域名邮箱池分配记录',
            group: '域名邮箱接口',
            method: 'GET / POST',
            path: '/api/domain-mail/reset-pool',
            audience: '适合测试或重复演练场景，需要重新把当前 API Key 的域名邮箱占用归零。',
            description: '删除当前 API Key 对这些域名邮箱的使用记录。不会删除邮箱本身。',
            usageHint: '和外部邮箱 reset-pool 的语义一致，只是对象换成域名邮箱池。',
            params: [
                { name: 'domainId', type: 'number', required: false, desc: '按域名 ID 重置。' },
                { name: 'domain', type: 'string', required: false, desc: '按域名名重置。' },
                { name: 'batchTag', type: 'string', required: false, desc: '按批次标签重置。' },
            ],
            example: `curl -X POST "${baseUrl}/api/domain-mail/reset-pool" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"api-pool-example-20260318"}'`,
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

    const paramColumns: ColumnsType<ParamRow> = [
        { title: '参数名', dataIndex: 'name', key: 'name', render: (text) => <Text code>{text}</Text> },
        { title: '类型', dataIndex: 'type', key: 'type' },
        { title: '必填', dataIndex: 'required', key: 'required', render: (required) => required ? <Tag color="red">是</Tag> : <Tag>否</Tag> },
        { title: '说明', dataIndex: 'desc', key: 'desc' },
    ];

    const groupedApis = [
        {
            key: 'external',
            title: '外部邮箱接口（Outlook / Gmail / QQ）',
            description: '面向传统邮箱池。适合验证码脚本、邮箱轮询、自动化注册等场景。',
            items: apiEndpoints.filter((item) => item.group === '外部邮箱接口'),
        },
        {
            key: 'domain',
            title: '域名邮箱接口（all-Mail 自管域名邮箱池）',
            description: '面向 all-Mail 自己管理的域名邮箱池。适合统一管理自有域名、批次池和入站邮件。',
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
                subtitle="把 all-Mail 当成一个可调用的邮件能力平台来用：这页不是单纯接口表，而是给新手准备的上手教程。"
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
                                    <Tag color="blue">新手先看</Tag>
                                    <Tag color="purple">可视化教程</Tag>
                                    <Tag color="green">真实接口</Tag>
                                </Space>
                                <Title level={4} style={{ margin: 0 }}>先用一句话理解 all-Mail API</Title>
                                <Paragraph style={{ marginBottom: 0 }}>
                                    如果你把 <Text strong>all-Mail</Text> 当成一个“帮你分配邮箱、读取邮件、提取验证码、重置池子”的服务，
                                    那么这一页就是它的操作说明书。你不需要先理解内部架构，先搞清楚你用的是
                                    <Text strong> 外部邮箱接口 </Text>
                                    还是
                                    <Text strong> 域名邮箱接口 </Text>
                                    就够了。
                                </Paragraph>
                                <Alert
                                    type="info"
                                    showIcon
                                    message="最重要的区别"
                                    description={
                                        <div>
                                            <p style={{ marginBottom: 8 }}>
                                                <Text strong>外部邮箱接口：</Text>对应 Outlook / Gmail / QQ 等外部邮箱池，路径是 <Text code>/api/*</Text>。
                                            </p>
                                            <p style={{ marginBottom: 0 }}>
                                                <Text strong>域名邮箱接口：</Text>对应 all-Mail 自己管理的域名邮箱池，路径是 <Text code>/api/domain-mail/*</Text>。
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
                            message="所有外部 API 都需要 API Key"
                            description="请先到后台的「API Key」页面创建密钥。这个密钥只在创建时显示一次，请立即保存到密码管理器或你的部署环境变量里。"
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
                                                    <Alert
                                                        type="info"
                                                        showIcon
                                                        message={api.audience}
                                                        description={api.description}
                                                    />
                                                    <Alert
                                                        type="success"
                                                        showIcon
                                                        icon={<CheckCircleOutlined />}
                                                        message="什么时候最适合调这个接口？"
                                                        description={api.usageHint}
                                                    />

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
                                message="这页优先服务外部 API 调用者，不把后台管理接口当主角"
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
                                { key: 'external-api', href: '#external-api', title: '外部邮箱接口' },
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
                                        <div>1. 先调 <Text code>/api/pool-stats</Text></div>
                                        <div>2. 再调 <Text code>/api/get-email</Text></div>
                                        <div>3. 最后调 <Text code>/api/mail_text</Text></div>
                                    </div>
                                }
                            />
                            <Alert
                                type="info"
                                showIcon
                                icon={<MailOutlined />}
                                message="如果你在用域名邮箱池"
                                description="把上面三步换成 /api/domain-mail/pool-stats → /api/domain-mail/get-mailbox → /api/domain-mail/mail_text。"
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

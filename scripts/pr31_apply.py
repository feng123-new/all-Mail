#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if new in content:
        return
    if old not in content:
        raise SystemExit(f"expected source fragment missing in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# Earlier workflow staging may already have inserted these fields. Normalize the
# escaped map syntax first, then add a field only when that model still lacks it.
schema_path = "server/prisma/schema.prisma"
schema = read(schema_path).replace(r'@map(\"session_version\")', '@map("session_version")')
admin_start = schema.index("model Admin {")
admin_end = schema.index("\n}\n", admin_start)
admin_block = schema[admin_start:admin_end]
if "sessionVersion" not in admin_block:
    anchor = '  lastLoginIp  String?   @map("last_login_ip") @db.VarChar(45)\n'
    if anchor not in admin_block:
        raise SystemExit("Admin session-version insertion anchor is missing")
    schema = schema[:admin_start] + admin_block.replace(
        anchor,
        anchor + '  sessionVersion Int       @default(1) @map("session_version")\n',
        1,
    ) + schema[admin_end:]

mailbox_start = schema.index("model MailboxUser {")
mailbox_end = schema.index("\n}\n", mailbox_start)
mailbox_block = schema[mailbox_start:mailbox_end]
if "sessionVersion" not in mailbox_block:
    anchor = '  lastLoginIp        String?           @map("last_login_ip") @db.VarChar(45)\n'
    if anchor not in mailbox_block:
        raise SystemExit("MailboxUser session-version insertion anchor is missing")
    schema = schema[:mailbox_start] + mailbox_block.replace(
        anchor,
        anchor + '  sessionVersion     Int               @default(1) @map("session_version")\n',
        1,
    ) + schema[mailbox_end:]
write(schema_path, schema)

replace_once(
    "core/internal/businessapi/store.go",
    "SELECT id, username, role::text, status::text, must_change_password\n",
    "SELECT id, username, role::text, status::text, must_change_password, session_version\n",
)
replace_once(
    "core/internal/businessapi/store.go",
    "\t\t&admin.MustChangePassword,\n\t)",
    "\t\t&admin.MustChangePassword,\n\t\t&admin.SessionVersion,\n\t)",
)

replace_once(
    "core/internal/businessapi/server_test.go",
    "\tif id, err := verifyAdminJWT(valid, testJWTSecret, now); err != nil || id != 7 {\n\t\tt.Fatalf(\"valid JWT = %d, %v\", id, err)\n\t}",
    "\tif claims, err := verifyAdminJWT(valid, testJWTSecret, now); err != nil || claims.AdminID != 7 || claims.SessionVersion != 1 {\n\t\tt.Fatalf(\"valid JWT = %#v, %v\", claims, err)\n\t}",
)
replace_once(
    "core/internal/businessapi/server_test.go",
    "\t\t\"sub\": strconv.FormatInt(subject, 10),\n\t\t\"aud\": audience,\n\t\t\"exp\": expiresAt.Unix(),\n",
    "\t\t\"iss\":            allMailJWTIssuer,\n\t\t\"sub\":            strconv.FormatInt(subject, 10),\n\t\t\"aud\":            audience,\n\t\t\"exp\":            expiresAt.Unix(),\n\t\t\"sessionVersion\": 1,\n",
)

replace_once(
    "server/src/modules/mailbox-user/mailboxPortal.routes.ts",
    "import type { FastifyPluginAsync, FastifyRequest } from 'fastify';\n",
    "import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';\n",
)
replace_once(
    "server/src/modules/mailbox-user/mailboxPortal.routes.ts",
    "import { z } from 'zod';\n",
    "import { z } from 'zod';\nimport { signToken } from '../../lib/jwt.js';\nimport { MAILBOX_JWT_AUDIENCE } from '../../lib/session-version.js';\n",
)
replace_once(
    "server/src/modules/mailbox-user/mailboxPortal.routes.ts",
    "function getMailboxAuthContext(request: FastifyRequest) {\n",
    "async function rotateMailboxSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {\n    const mailboxUser = getMailboxAuthContext(request);\n    const token = await signToken({\n        sub: String(mailboxUser.id),\n        mailboxUserId: mailboxUser.id,\n        username: mailboxUser.username,\n        role: mailboxUser.role,\n        mailboxIds: mailboxUser.mailboxIds,\n    }, { audience: MAILBOX_JWT_AUDIENCE });\n    reply.cookie('mailbox_token', token, mailboxSessionCookieOptions);\n}\n\nfunction getMailboxAuthContext(request: FastifyRequest) {\n",
)
replace_once(
    "server/src/modules/mailbox-user/mailboxPortal.routes.ts",
    "    }, async (request) => {\n        const mailboxUser = getMailboxAuthContext(request);\n        const input = mailboxPortalChangePasswordSchema.parse(request.body);\n        const result = await mailboxUserService.changePassword(mailboxUser.id, input);\n        return { success: true, data: result };\n    });\n\n    fastify.post('/forwarding'",
    "    }, async (request, reply) => {\n        const mailboxUser = getMailboxAuthContext(request);\n        const input = mailboxPortalChangePasswordSchema.parse(request.body);\n        const result = await mailboxUserService.changePassword(mailboxUser.id, input);\n        await rotateMailboxSession(request, reply);\n        return { success: true, data: result };\n    });\n\n    fastify.post('/forwarding'",
)

replace_once(
    "server/src/modules/email/email.oauth.service.ts",
    '"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite";',
    '"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send";',
)

readme_path = "oauth-temp/README.md"
readme = read(readme_path)
broad = "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite"
readme = readme.replace(broad, "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send")
readme = readme.replace(
    "为 Graph 邮件、联系人、日历、邮箱设置完成 consent",
    "为 Graph 身份、邮件读写和发信完成最小权限 consent",
)
readme = readme.replace(
    "all-Mail 默认要解决的是 Outlook 账号的 Graph 读信、清空、发信，以及后续联系人、日历、邮箱设置扩展能力，所以默认会把这几组 **Microsoft Graph** scope 一起申请。",
    "all-Mail 默认只申请 Outlook Graph 身份、邮件读写和发信所需权限。联系人、日历和邮箱设置写权限属于可选扩展，必须由部署者显式加入 `SCOPES`。",
)
readme = readme.replace(
    "- `Contacts.ReadWrite / Calendars.ReadWrite / MailboxSettings.ReadWrite`：为联系人、日历、邮箱设置相关扩展预留，减少后续重新授权\n",
    "- 联系人、日历和邮箱设置写权限：默认不申请，仅在对应功能实际启用时显式追加\n",
)
write(readme_path, readme)

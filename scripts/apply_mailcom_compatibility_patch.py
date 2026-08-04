#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# Frontend provider preset and operator guidance.
providers = "web/src/constants/providers.ts"
replace_once(
    providers,
    "    description: 'Mail.com 使用标准 IMAP / SMTP 接入，适合常见的国外通用邮箱场景。',",
    "    description: 'Mail.com 通过标准 IMAP / SMTP 接入，但官方仅向 Premium 账号开放协议访问。',",
)
replace_once(
    providers,
    "    secretHelpText: '请确认账号支持 IMAP/SMTP 功能后再接入。',",
    "    secretHelpText: '仅 Mail.com Premium 账号可使用 IMAP/SMTP；请先在网页端 Email → Settings → POP3 & IMAP 中开启协议访问，再填写完整邮箱地址和登录密码。',",
)
replace_once(
    providers,
    """    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.mail.com',
      smtpHost: 'smtp.mail.com',
      smtpPort: 587,
      smtpSecure: false,
      folders: { junk: 'Spam' },
    }),""",
    """    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.mail.com',
      smtpHost: 'smtp.mail.com',
      smtpPort: 587,
      smtpSecure: false,
      folders: { junk: 'Junk email', sent: 'Sent Items' },
    }),""",
)
replace_once(
    providers,
    "    description: 'Mail.com 使用标准 IMAP / SMTP 接入，适合通用的国际邮箱场景。',",
    "    description: 'Mail.com 使用标准 IMAP / SMTP 接入；仅 Premium 账号在手动开启协议访问后可用。',",
)
replace_once(
    providers,
    "    classificationNote: 'Mail.com 属于标准 IMAP / SMTP provider，需确认账号支持 IMAP/SMTP。',",
    "    classificationNote: 'Mail.com 属于标准 IMAP / SMTP provider；免费账号不能直连，Premium 账号还必须先在网页设置中开启 POP3/IMAP。',",
)

# Bilingual UI messages.
i18n = "web/src/i18n/catalog/providers.ts"
replace_once(
    i18n,
    "    description: m('provider.mailcom.description', 'Mail.com 使用标准 IMAP / SMTP 接入，适合通用的国际邮箱场景。', 'Mail.com uses standard IMAP / SMTP and fits general international mailbox scenarios.'),",
    "    description: m('provider.mailcom.description', 'Mail.com 使用标准 IMAP / SMTP 接入；仅 Premium 账号在手动开启协议访问后可用。', 'Mail.com uses standard IMAP / SMTP; only Premium accounts can connect after protocol access is enabled manually.'),",
)
replace_once(
    i18n,
    "    classificationNote: m('provider.mailcom.classificationNote', 'Mail.com 属于标准 IMAP / SMTP provider，需确认账号支持 IMAP/SMTP。', 'Mail.com is a standard IMAP / SMTP provider, but the account must support IMAP/SMTP.'),",
    "    classificationNote: m('provider.mailcom.classificationNote', '免费账号不能直连；Premium 账号还必须先在网页设置中开启 POP3/IMAP。', 'Free accounts cannot connect directly; Premium accounts must also enable POP3/IMAP in web settings first.'),",
)
replace_once(
    i18n,
    "    description: m('profile.mailcom.description', 'Mail.com 使用标准 IMAP / SMTP 接入，适合常见的国外通用邮箱场景。', 'Mail.com uses standard IMAP / SMTP and fits common international general-purpose mailbox scenarios.'),",
    "    description: m('profile.mailcom.description', 'Mail.com 通过标准 IMAP / SMTP 接入，但官方仅向 Premium 账号开放协议访问。', 'Mail.com connects through standard IMAP / SMTP, but the provider exposes protocol access only to Premium accounts.'),",
)
replace_once(
    i18n,
    "    secretHelpText: m('profile.mailcom.secretHelpText', '请确认账号支持 IMAP/SMTP 功能后再接入。', 'Confirm that the account supports IMAP/SMTP before connecting.'),",
    "    secretHelpText: m('profile.mailcom.secretHelpText', '仅 Premium 账号可使用 IMAP/SMTP；请先在网页端开启 POP3/IMAP，再填写完整邮箱地址和登录密码。', 'Only Premium accounts can use IMAP/SMTP. Enable POP3/IMAP in web settings first, then enter the full email address and login password.'),",
)

# Keep API-created/imported accounts aligned with the reviewed UI preset and
# Mail.com's current official folder names.
backend = "core/internal/businessapi/mail_provider_types.go"
replace_once(
    backend,
    '\tcase "MAILCOM":\n\t\tconfig.IMAPHost, config.SMTPHost = "imap.mail.com", "smtp.mail.com"',
    '\tcase "MAILCOM":\n'
    '\t\tconfig.IMAPHost, config.SMTPHost = "imap.mail.com", "smtp.mail.com"\n'
    '\t\tconfig.SMTPPort = 587\n'
    '\t\tconfig.SMTPSecure = boolPointer(false)\n'
    '\t\tconfig.Folders["junk"], config.Folders["sent"] = "Junk email", "Sent Items"',
)

# Public operator documentation.
docs = "docs/external-email-management-guide.md"
replace_once(
    docs,
    "> 适用范围：后台 `邮箱管理` 页面中接入的 Outlook / Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex / Custom IMAP / SMTP 账号。",
    "> 适用范围：后台 `邮箱管理` 页面中接入的 Outlook / Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex / Custom IMAP / SMTP 账号。Mail.com 指 `mail.com` 服务，不是 Mail.ru。",
)
replace_once(
    docs,
    "### Amazon WorkMail / Fastmail / AOL / GMX / Mail.com / Yandex\n\n- 读取收件箱：支持\n- 读取已发送：支持\n- 发送邮件：支持\n- 常见模式：`APP_PASSWORD`\n- 说明：Amazon WorkMail 通常需要补充区域相关的 IMAP / SMTP 主机；GMX / Mail.com 更常见的 SMTP 端口是 `587` + STARTTLS。",
    "### Mail.com\n\n- 读取收件箱：支持，但仅限 Mail.com Premium 账号\n- 读取已发送：支持，官方文件夹名为 `Sent Items`\n- 读取垃圾箱：支持，官方文件夹名为 `Junk email`\n- 发送邮件：支持\n- 常见模式：`APP_PASSWORD`（这里实际填写 Mail.com 登录密码）\n- 使用前必须在 Mail.com 网页端进入 `Email → Settings → POP3 & IMAP`，开启第三方协议访问\n- 当前预设：IMAP `imap.mail.com:993` + SSL/TLS；SMTP `smtp.mail.com:587` + STARTTLS\n- Mail.com 官方也允许 SMTP `465` + SSL/TLS，但 all-Mail 默认统一使用 `587` + STARTTLS\n- 免费 Mail.com 账号不具备 IMAP/SMTP 能力，无法通过 all-Mail 直连\n\n### Amazon WorkMail / Fastmail / AOL / GMX / Yandex\n\n- 读取收件箱：支持\n- 读取已发送：支持\n- 发送邮件：支持\n- 常见模式：`APP_PASSWORD`\n- 说明：Amazon WorkMail 通常需要补充区域相关的 IMAP / SMTP 主机；GMX 更常见的 SMTP 端口是 `587` + STARTTLS。",
)
replace_once(
    docs,
    "- Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Fastmail / AOL / GMX / Mail.com / Yandex 这类账号通常可以直接完成收发闭环",
    "- Gmail / QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱 / Fastmail / AOL / GMX / Yandex 这类账号通常可以直接完成收发闭环\n- Mail.com 只有 Premium 账号在网页端开启 POP3/IMAP 后才能完成收发闭环",
)

# Release history must reflect post-v2.1.1 changes.
changelog = "CHANGELOG.md"
replace_once(
    changelog,
    "## [Unreleased]\n\nNo unreleased changes.",
    "## [Unreleased]\n\n### Changed\n\n- Documented that Mail.com direct access requires a Premium account and manual POP3/IMAP activation.\n- Aligned Mail.com API/import defaults with the reviewed frontend preset: IMAP 993 over TLS and SMTP 587 over STARTTLS.\n\n### Fixed\n\n- Corrected Mail.com folder mappings to the provider names `Sent Items` and `Junk email` so sent and junk mailbox views do not depend on generic folder guesses.",
)

# Focused Go regression coverage.
go_test = "core/internal/businessapi/mail_provider_integration_test.go"
insert = '''func TestMailComProviderDefaults(t *testing.T) {
\tconfig := defaultProviderConfig("MAILCOM")
\tif config.IMAPHost != "imap.mail.com" || config.IMAPPort != 993 || config.IMAPTLS == nil || !*config.IMAPTLS {
\t\tt.Fatalf("Mail.com IMAP defaults = %#v", config)
\t}
\tif config.SMTPHost != "smtp.mail.com" || config.SMTPPort != 587 || config.SMTPSecure == nil || *config.SMTPSecure {
\t\tt.Fatalf("Mail.com SMTP defaults = %#v", config)
\t}
\tif config.Folders["sent"] != "Sent Items" || config.Folders["junk"] != "Junk email" {
\t\tt.Fatalf("Mail.com folder defaults = %#v", config.Folders)
\t}
\tprovider, authType, ok := importTokenProfile("MAILCOM_IMAP_SMTP")
\tif !ok || provider != "MAILCOM" || authType != "APP_PASSWORD" {
\t\tt.Fatalf("Mail.com import profile = %q/%q/%v", provider, authType, ok)
\t}
}

'''
replace_once(go_test, "func providerTestServer(transport http.RoundTripper) *Server {", insert + "func providerTestServer(transport http.RoundTripper) *Server {")

# Focused frontend contract.
write(
    "web/src/constants/providers.mailcom.test.ts",
    '''import { describe, expect, it } from "vitest";\nimport { getProviderDefinition, getProviderProfileDefinition } from "./providers";\n\ndescribe("Mail.com provider profile", () => {\n\tit("requires Premium protocol access and uses official server/folder defaults", () => {\n\t\tconst provider = getProviderDefinition("MAILCOM");\n\t\tconst profile = getProviderProfileDefinition("MAILCOM", "APP_PASSWORD");\n\n\t\texpect(provider.classificationNote).toContain("Premium");\n\t\texpect(profile.secretHelpText).toContain("Premium");\n\t\texpect(profile.providerConfigDefaults).toMatchObject({\n\t\t\timapHost: "imap.mail.com",\n\t\t\timapPort: 993,\n\t\t\timapTls: true,\n\t\t\tsmtpHost: "smtp.mail.com",\n\t\t\tsmtpPort: 587,\n\t\t\tsmtpSecure: false,\n\t\t\tfolders: { junk: "Junk email", sent: "Sent Items" },\n\t\t});\n\t});\n});\n''',
)

# Remove the one-shot bootstrap machinery before the generated commit.
(ROOT / "scripts/apply_mailcom_compatibility_patch.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-mailcom-compatibility.yml").unlink(missing_ok=True)

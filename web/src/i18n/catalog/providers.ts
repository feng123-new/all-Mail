import { defineMessage } from '../messages';
import type {
  EmailAuthType,
  EmailProvider,
  HostedInternalProfileKey,
  ProviderProfileKey,
  RepresentativeProtocol,
  SecondaryProtocol,
} from '../../constants/providers';

const m = (key: string, zh: string, en: string) =>
  defineMessage(`providers.${key}`, zh, en);

type ProviderMessage = ReturnType<typeof defineMessage>;

const authTypeLabels: Record<EmailAuthType, ProviderMessage> = {
  MICROSOFT_OAUTH: m('authType.microsoftOAuth', 'Microsoft OAuth', 'Microsoft OAuth'),
  GOOGLE_OAUTH: m('authType.googleOAuth', 'Google OAuth', 'Google OAuth'),
  APP_PASSWORD: m('authType.appPassword', '应用专用密码', 'App password'),
};

const representativeProtocols: Record<
  RepresentativeProtocol,
  {
    label: ProviderMessage;
    description: ProviderMessage;
    connectionLabel: ProviderMessage;
  }
> = {
  oauth_api: {
    label: m('protocol.oauthApi.label', 'OAuth API', 'OAuth API'),
    description: m(
      'protocol.oauthApi.description',
      '以 OAuth 授权 + Provider API 为主路径，适合 Outlook OAuth、Gmail OAuth 等能力更完整的外部邮箱。',
      'Uses OAuth authorization plus provider APIs as the main path, ideal for richer mailbox integrations such as Outlook OAuth and Gmail OAuth.',
    ),
    connectionLabel: m('protocol.oauthApi.connectionLabel', '添加 OAuth API 邮箱', 'Add an OAuth API mailbox'),
  },
  imap_smtp: {
    label: m('protocol.imapSmtp.label', 'IMAP / SMTP', 'IMAP / SMTP'),
    description: m(
      'protocol.imapSmtp.description',
      '以 IMAP 收信 + SMTP 发信为主路径，适合应用专用密码、授权码类的外部邮箱接入。',
      'Uses IMAP for receiving and SMTP for sending, ideal for external mailboxes that rely on app passwords or authorization codes.',
    ),
    connectionLabel: m('protocol.imapSmtp.connectionLabel', '添加 IMAP / SMTP 邮箱', 'Add an IMAP / SMTP mailbox'),
  },
  hosted_internal: {
    label: m('protocol.hostedInternal.label', 'Hosted Internal', 'Hosted Internal'),
    description: m(
      'protocol.hostedInternal.description',
      'all-Mail 自己的站内托管邮箱协议族，独立在域名邮箱 / 门户页面中管理，不从外部邮箱连接入口创建。',
      'The hosted-internal mailbox family managed inside all-Mail. It is maintained on the domain-mailbox and portal pages instead of the external-mailbox entrypoint.',
    ),
    connectionLabel: m('protocol.hostedInternal.connectionLabel', '前往 Hosted Internal 邮箱', 'Go to Hosted Internal mailboxes'),
  },
};

const secondaryProtocols: Record<SecondaryProtocol, ProviderMessage> = {
  graph_api: m('secondary.graphApi', 'Graph API', 'Graph API'),
  gmail_api: m('secondary.gmailApi', 'Gmail API', 'Gmail API'),
  imap: m('secondary.imap', 'IMAP', 'IMAP'),
  smtp: m('secondary.smtp', 'SMTP', 'SMTP'),
};

const providers: Record<
  EmailProvider,
  {
    label: ProviderMessage;
    description: ProviderMessage;
    emailPlaceholder: ProviderMessage;
    addButtonLabel: ProviderMessage;
    classificationNote: ProviderMessage;
  }
> = {
  OUTLOOK: {
    label: m('provider.outlook.label', 'Outlook', 'Outlook'),
    description: m('provider.outlook.description', '适合 Microsoft OAuth 接入。产品层按 OAuth API 主分类展示，默认用 Graph 完成读信、清空与发信。', 'Ideal for Microsoft OAuth. The product presents it under the OAuth API family and uses Graph by default for reading, clearing, and sending mail.'),
    emailPlaceholder: m('provider.outlook.emailPlaceholder', 'example@outlook.com', 'example@outlook.com'),
    addButtonLabel: m('provider.outlook.addButtonLabel', '添加 Outlook', 'Add Outlook'),
    classificationNote: m('provider.outlook.classificationNote', 'Outlook 对用户按 OAuth API（Microsoft Graph）主分类展示；若出现老账号或特定邮箱夹兼容性问题，底层仍可能借助 IMAP。', 'Outlook is presented under the OAuth API family (Microsoft Graph). Older accounts or specific folders may still rely on IMAP for compatibility.'),
  },
  GMAIL: {
    label: m('provider.gmail.label', 'Gmail', 'Gmail'),
    description: m('provider.gmail.description', 'Gmail 同时支持 Google OAuth 与应用专用密码。产品层会按所选鉴权方式切到不同的代表协议分类。', 'Gmail supports both Google OAuth and app passwords. The UI shifts it into different representative protocol groups based on the chosen auth method.'),
    emailPlaceholder: m('provider.gmail.emailPlaceholder', 'example@gmail.com', 'example@gmail.com'),
    addButtonLabel: m('provider.gmail.addButtonLabel', '添加 Gmail', 'Add Gmail'),
    classificationNote: m('provider.gmail.classificationNote', 'Gmail 是最典型的多协议 provider：Google OAuth 按 OAuth API 主分类展示，应用专用密码则改归 IMAP / SMTP。', 'Gmail is the clearest multi-protocol provider: Google OAuth stays under OAuth API, while app passwords move it into IMAP / SMTP.'),
  },
  QQ: {
    label: m('provider.qq.label', 'QQ', 'QQ'),
    description: m('provider.qq.description', '使用 QQ 邮箱 IMAP / SMTP 授权码接入，产品层直接按 IMAP / SMTP 主分类展示。', 'Uses QQ Mail authorization codes over IMAP / SMTP, and is presented directly under the IMAP / SMTP family.'),
    emailPlaceholder: m('provider.qq.emailPlaceholder', 'example@qq.com', 'example@qq.com'),
    addButtonLabel: m('provider.qq.addButtonLabel', '添加 QQ', 'Add QQ'),
    classificationNote: m('provider.qq.classificationNote', 'QQ 本身就是标准的 IMAP / SMTP 授权码接入，没有额外的 OAuth API 主路径。', 'QQ is a standard IMAP / SMTP authorization-code provider and does not have a separate OAuth API path.'),
  },
  NETEASE_163: {
    label: m('provider.netease163.label', '163', '163'),
    description: m('provider.netease163.description', '163 邮箱通过 IMAP / SMTP 客户端授权码接入，适合协议型验证码和收件自动化。', '163 Mail connects through IMAP / SMTP client authorization codes and works well for verification-code and inbox automation.'),
    emailPlaceholder: m('provider.netease163.emailPlaceholder', 'example@163.com', 'example@163.com'),
    addButtonLabel: m('provider.netease163.addButtonLabel', '添加 163', 'Add 163'),
    classificationNote: m('provider.netease163.classificationNote', '163 邮箱属于标准 IMAP / SMTP provider，建议用客户端授权码接入。', '163 Mail is a standard IMAP / SMTP provider and is best connected with a client authorization code.'),
  },
  NETEASE_126: {
    label: m('provider.netease126.label', '126', '126'),
    description: m('provider.netease126.description', '126 邮箱通过 IMAP / SMTP 客户端授权码接入，适合标准邮箱池与验证邮件读取。', '126 Mail connects through IMAP / SMTP client authorization codes and is suitable for standard mailbox pools and verification-mail intake.'),
    emailPlaceholder: m('provider.netease126.emailPlaceholder', 'example@126.com', 'example@126.com'),
    addButtonLabel: m('provider.netease126.addButtonLabel', '添加 126', 'Add 126'),
    classificationNote: m('provider.netease126.classificationNote', '126 邮箱属于标准 IMAP / SMTP provider，接入方式与 163 保持一致。', '126 Mail is a standard IMAP / SMTP provider and follows the same connection pattern as 163.'),
  },
  ICLOUD: {
    label: m('provider.icloud.label', 'iCloud', 'iCloud'),
    description: m('provider.icloud.description', 'iCloud 使用 IMAP / SMTP + App 专用密码接入，适合 Apple 账号侧的标准协议联通。', 'iCloud connects through IMAP / SMTP plus an app-specific password, which fits the standard Apple account flow.'),
    emailPlaceholder: m('provider.icloud.emailPlaceholder', 'example@icloud.com', 'example@icloud.com'),
    addButtonLabel: m('provider.icloud.addButtonLabel', '添加 iCloud', 'Add iCloud'),
    classificationNote: m('provider.icloud.classificationNote', 'iCloud 邮箱属于标准 IMAP / SMTP provider，需要 Apple App 专用密码。', 'iCloud Mail is a standard IMAP / SMTP provider and requires an Apple app-specific password.'),
  },
  YAHOO: {
    label: m('provider.yahoo.label', 'Yahoo', 'Yahoo'),
    description: m('provider.yahoo.description', 'Yahoo 使用 IMAP / SMTP + App Password 接入，适合已有 Yahoo 账号的协议统一管理。', 'Yahoo uses IMAP / SMTP plus an app password, which works well for consolidating existing Yahoo accounts.'),
    emailPlaceholder: m('provider.yahoo.emailPlaceholder', 'example@yahoo.com', 'example@yahoo.com'),
    addButtonLabel: m('provider.yahoo.addButtonLabel', '添加 Yahoo', 'Add Yahoo'),
    classificationNote: m('provider.yahoo.classificationNote', 'Yahoo 邮箱属于标准 IMAP / SMTP provider，推荐使用 App Password。', 'Yahoo Mail is a standard IMAP / SMTP provider and is best used with an app password.'),
  },
  ZOHO: {
    label: m('provider.zoho.label', 'Zoho', 'Zoho'),
    description: m('provider.zoho.description', 'Zoho Mail 使用 IMAP / SMTP 应用密码接入，适合企业邮箱协议化统一接管。', 'Zoho Mail uses IMAP / SMTP app passwords and fits enterprise mailbox standardization.'),
    emailPlaceholder: m('provider.zoho.emailPlaceholder', 'example@zoho.com', 'example@zoho.com'),
    addButtonLabel: m('provider.zoho.addButtonLabel', '添加 Zoho', 'Add Zoho'),
    classificationNote: m('provider.zoho.classificationNote', 'Zoho Mail 属于标准 IMAP / SMTP provider，适合企业邮箱型外部接入。', 'Zoho Mail is a standard IMAP / SMTP provider and fits enterprise-style external mailbox connections.'),
  },
  ALIYUN: {
    label: m('provider.aliyun.label', '阿里邮箱', 'Aliyun Mail'),
    description: m('provider.aliyun.description', '阿里邮箱通过 IMAP / SMTP 客户端专用密码接入，适合企业邮箱场景和多账号协议统一。', 'Aliyun Mail connects through IMAP / SMTP client-specific passwords and fits enterprise mailbox scenarios with multiple accounts.'),
    emailPlaceholder: m('provider.aliyun.emailPlaceholder', 'example@aliyun.com', 'example@aliyun.com'),
    addButtonLabel: m('provider.aliyun.addButtonLabel', '添加阿里邮箱', 'Add Aliyun Mail'),
    classificationNote: m('provider.aliyun.classificationNote', '阿里邮箱属于标准 IMAP / SMTP provider，适合走客户端专用密码或授权码。', 'Aliyun Mail is a standard IMAP / SMTP provider and is best connected with a client-specific password or authorization code.'),
  },
  AMAZON_WORKMAIL: {
    label: m('provider.amazonWorkmail.label', 'Amazon WorkMail', 'Amazon WorkMail'),
    description: m('provider.amazonWorkmail.description', 'Amazon WorkMail 使用标准 IMAP / SMTP 接入，但主机地址通常按 AWS Region 区分。', 'Amazon WorkMail uses standard IMAP / SMTP, but its hosts are usually region-specific within AWS.'),
    emailPlaceholder: m('provider.amazonWorkmail.emailPlaceholder', 'example@yourdomain.com', 'example@yourdomain.com'),
    addButtonLabel: m('provider.amazonWorkmail.addButtonLabel', '添加 Amazon WorkMail', 'Add Amazon WorkMail'),
    classificationNote: m('provider.amazonWorkmail.classificationNote', 'Amazon WorkMail 仍属于 IMAP / SMTP provider，但通常需要手工填写区域相关的 IMAP / SMTP 主机。', 'Amazon WorkMail still belongs to the IMAP / SMTP family, but typically requires manually entering region-specific IMAP / SMTP hosts.'),
  },
  FASTMAIL: {
    label: m('provider.fastmail.label', 'Fastmail', 'Fastmail'),
    description: m('provider.fastmail.description', 'Fastmail 使用标准 IMAP / SMTP 接入，适合国际个人与企业邮箱统一管理。', 'Fastmail uses standard IMAP / SMTP and fits international personal and business mailbox management.'),
    emailPlaceholder: m('provider.fastmail.emailPlaceholder', 'example@fastmail.com', 'example@fastmail.com'),
    addButtonLabel: m('provider.fastmail.addButtonLabel', '添加 Fastmail', 'Add Fastmail'),
    classificationNote: m('provider.fastmail.classificationNote', 'Fastmail 属于标准 IMAP / SMTP provider，可使用密码或 App Password。', 'Fastmail is a standard IMAP / SMTP provider and can use either a password or an app password.'),
  },
  AOL: {
    label: m('provider.aol.label', 'AOL', 'AOL'),
    description: m('provider.aol.description', 'AOL Mail 使用标准 IMAP / SMTP 接入，推荐 App Password。', 'AOL Mail uses standard IMAP / SMTP and is best connected with an app password.'),
    emailPlaceholder: m('provider.aol.emailPlaceholder', 'example@aol.com', 'example@aol.com'),
    addButtonLabel: m('provider.aol.addButtonLabel', '添加 AOL', 'Add AOL'),
    classificationNote: m('provider.aol.classificationNote', 'AOL Mail 属于标准 IMAP / SMTP provider，常见接入方式是 App Password。', 'AOL Mail is a standard IMAP / SMTP provider, and the common connection path is an app password.'),
  },
  GMX: {
    label: m('provider.gmx.label', 'GMX', 'GMX'),
    description: m('provider.gmx.description', 'GMX Mail 使用标准 IMAP / SMTP 接入，适合国外通用邮箱场景。', 'GMX Mail uses standard IMAP / SMTP and fits common international mailbox scenarios.'),
    emailPlaceholder: m('provider.gmx.emailPlaceholder', 'example@gmx.com', 'example@gmx.com'),
    addButtonLabel: m('provider.gmx.addButtonLabel', '添加 GMX', 'Add GMX'),
    classificationNote: m('provider.gmx.classificationNote', 'GMX 属于标准 IMAP / SMTP provider。', 'GMX is a standard IMAP / SMTP provider.'),
  },
  MAILCOM: {
    label: m('provider.mailcom.label', 'Mail.com', 'Mail.com'),
    description: m('provider.mailcom.description', 'Mail.com 使用标准 IMAP / SMTP 接入，适合通用的国际邮箱场景。', 'Mail.com uses standard IMAP / SMTP and fits general international mailbox scenarios.'),
    emailPlaceholder: m('provider.mailcom.emailPlaceholder', 'example@mail.com', 'example@mail.com'),
    addButtonLabel: m('provider.mailcom.addButtonLabel', '添加 Mail.com', 'Add Mail.com'),
    classificationNote: m('provider.mailcom.classificationNote', 'Mail.com 属于标准 IMAP / SMTP provider，需确认账号支持 IMAP/SMTP。', 'Mail.com is a standard IMAP / SMTP provider, but the account must support IMAP/SMTP.'),
  },
  YANDEX: {
    label: m('provider.yandex.label', 'Yandex', 'Yandex'),
    description: m('provider.yandex.description', 'Yandex Mail 使用标准 IMAP / SMTP 接入，适合国际化或区域型邮箱池。', 'Yandex Mail uses standard IMAP / SMTP and fits international or region-specific mailbox pools.'),
    emailPlaceholder: m('provider.yandex.emailPlaceholder', 'example@yandex.com', 'example@yandex.com'),
    addButtonLabel: m('provider.yandex.addButtonLabel', '添加 Yandex', 'Add Yandex'),
    classificationNote: m('provider.yandex.classificationNote', 'Yandex Mail 属于标准 IMAP / SMTP provider；某些区域可使用备用 IMAP 主机。', 'Yandex Mail is a standard IMAP / SMTP provider; some regions may use alternate IMAP hosts.'),
  },
  CUSTOM_IMAP_SMTP: {
    label: m('provider.customImapSmtp.label', 'Custom IMAP / SMTP', 'Custom IMAP / SMTP'),
    description: m('provider.customImapSmtp.description', '适合企业自建邮箱、普通域名邮箱、cPanel、自定义 IMAP / SMTP 服务等长尾场景。', 'Fits long-tail scenarios such as self-hosted enterprise mail, regular domain mailboxes, cPanel, and custom IMAP / SMTP services.'),
    emailPlaceholder: m('provider.customImapSmtp.emailPlaceholder', 'example@yourdomain.com', 'example@yourdomain.com'),
    addButtonLabel: m('provider.customImapSmtp.addButtonLabel', '添加 Custom IMAP / SMTP', 'Add Custom IMAP / SMTP'),
    classificationNote: m('provider.customImapSmtp.classificationNote', 'Custom IMAP / SMTP 仍属于标准 IMAP / SMTP 家族，只是把服务器配置改为手工输入。', 'Custom IMAP / SMTP still belongs to the standard IMAP / SMTP family; it simply switches the server settings to manual input.'),
  },
};

const profiles: Record<
  ProviderProfileKey,
  {
    label: ProviderMessage;
    description: ProviderMessage;
    summaryHint: ProviderMessage;
    secretLabel?: ProviderMessage;
    secretPlaceholder?: ProviderMessage;
    secretHelpText?: ProviderMessage;
    serverConfigHelpText?: ProviderMessage;
  }
> = {
  'outlook-oauth': {
    label: m('profile.outlookOAuth.label', 'Outlook OAuth / Graph', 'Outlook OAuth / Graph'),
    description: m('profile.outlookOAuth.description', '对用户按 Microsoft OAuth / Graph 主分类展示，底层可带 IMAP 辅助读取或 UID 删除回退。', 'Presented to users as Microsoft OAuth / Graph, while IMAP can still assist with reads or UID-delete fallback paths underneath.'),
    summaryHint: m('profile.outlookOAuth.summaryHint', '主分类：OAuth API（Graph）；辅助协议：IMAP', 'Primary family: OAuth API (Graph); secondary protocol: IMAP'),
  },
  'gmail-oauth': {
    label: m('profile.gmailOAuth.label', 'Gmail OAuth / Gmail API', 'Gmail OAuth / Gmail API'),
    description: m('profile.gmailOAuth.description', '对用户按 Google OAuth / Gmail API 主分类展示，底层仍可能使用 IMAP 作为补充路径。', 'Presented to users as Google OAuth / Gmail API, while IMAP may still be used as a supplemental path underneath.'),
    summaryHint: m('profile.gmailOAuth.summaryHint', '主分类：OAuth API（Gmail API）；辅助协议：IMAP', 'Primary family: OAuth API (Gmail API); secondary protocol: IMAP'),
  },
  'gmail-app-password': {
    label: m('profile.gmailAppPassword.label', 'Gmail App Password', 'Gmail App Password'),
    description: m('profile.gmailAppPassword.description', 'Gmail 应用专用密码模式按 IMAP / SMTP 主分类展示，不走 OAuth API。', 'Gmail app-password mode is presented under IMAP / SMTP and does not use the OAuth API path.'),
    summaryHint: m('profile.gmailAppPassword.summaryHint', '主分类：IMAP / SMTP；发送协议：SMTP', 'Primary family: IMAP / SMTP; sending protocol: SMTP'),
    secretLabel: m('profile.gmailAppPassword.secretLabel', 'Gmail 应用专用密码', 'Gmail app password'),
    secretPlaceholder: m('profile.gmailAppPassword.secretPlaceholder', 'Gmail App Password', 'Gmail App Password'),
    secretHelpText: m('profile.gmailAppPassword.secretHelpText', '适用于已开启两步验证后的 Gmail 应用专用密码模式。', 'Use this for Gmail app-password mode after two-step verification is enabled.'),
  },
  'qq-imap-smtp': {
    label: m('profile.qqImapSmtp.label', 'QQ IMAP / SMTP', 'QQ IMAP / SMTP'),
    description: m('profile.qqImapSmtp.description', 'QQ 邮箱按 IMAP / SMTP 授权码模式展示，是最典型的协议型接入。', 'QQ Mail is presented in IMAP / SMTP authorization-code mode and is the clearest protocol-driven integration.'),
    summaryHint: m('profile.qqImapSmtp.summaryHint', '主分类：IMAP / SMTP；发送协议：SMTP', 'Primary family: IMAP / SMTP; sending protocol: SMTP'),
    secretLabel: m('profile.qqImapSmtp.secretLabel', 'QQ 授权码', 'QQ authorization code'),
    secretPlaceholder: m('profile.qqImapSmtp.secretPlaceholder', 'QQ IMAP / SMTP 授权码', 'QQ IMAP / SMTP authorization code'),
    secretHelpText: m('profile.qqImapSmtp.secretHelpText', '请填写 QQ 邮箱后台生成的授权码，不是网页登录密码。', 'Use the authorization code generated in QQ Mail settings, not the web-login password.'),
  },
  'netease-163-imap-smtp': {
    label: m('profile.netease163.label', '163 IMAP / SMTP', '163 IMAP / SMTP'),
    description: m('profile.netease163.description', '163 邮箱按 IMAP / SMTP 客户端授权码模式展示，适合验证码与普通收件自动化。', '163 Mail is presented in IMAP / SMTP client-authorization mode and works well for verification codes and general inbox automation.'),
    summaryHint: m('profile.netease163.summaryHint', '主分类：IMAP / SMTP；服务商：163 邮箱', 'Primary family: IMAP / SMTP; provider: 163 Mail'),
    secretLabel: m('profile.netease163.secretLabel', '163 客户端授权码', '163 client authorization code'),
    secretPlaceholder: m('profile.netease163.secretPlaceholder', '163 客户端授权码', '163 client authorization code'),
    secretHelpText: m('profile.netease163.secretHelpText', '请先在 163 邮箱后台开启 IMAP/SMTP 并生成客户端授权码；这里不能填写网页登录密码。', 'Enable IMAP/SMTP in 163 Mail first and generate a client authorization code; do not enter the web-login password here.'),
  },
  'netease-126-imap-smtp': {
    label: m('profile.netease126.label', '126 IMAP / SMTP', '126 IMAP / SMTP'),
    description: m('profile.netease126.description', '126 邮箱按 IMAP / SMTP 客户端授权码模式展示，接入方式与 163 保持一致。', '126 Mail is presented in IMAP / SMTP client-authorization mode and follows the same integration path as 163 Mail.'),
    summaryHint: m('profile.netease126.summaryHint', '主分类：IMAP / SMTP；服务商：126 邮箱', 'Primary family: IMAP / SMTP; provider: 126 Mail'),
    secretLabel: m('profile.netease126.secretLabel', '126 客户端授权码', '126 client authorization code'),
    secretPlaceholder: m('profile.netease126.secretPlaceholder', '126 客户端授权码', '126 client authorization code'),
    secretHelpText: m('profile.netease126.secretHelpText', '请先在 126 邮箱后台开启 IMAP/SMTP 并生成客户端授权码；这里不能填写网页登录密码。', 'Enable IMAP/SMTP in 126 Mail first and generate a client authorization code; do not enter the web-login password here.'),
  },
  'icloud-imap-smtp': {
    label: m('profile.icloud.label', 'iCloud IMAP / SMTP', 'iCloud IMAP / SMTP'),
    description: m('profile.icloud.description', 'iCloud 邮箱按 IMAP / SMTP App 专用密码模式展示，适合 Apple 生态下的标准接入。', 'iCloud Mail is presented in IMAP / SMTP app-password mode and fits the standard Apple ecosystem flow.'),
    summaryHint: m('profile.icloud.summaryHint', '主分类：IMAP / SMTP；服务商：iCloud', 'Primary family: IMAP / SMTP; provider: iCloud'),
    secretLabel: m('profile.icloud.secretLabel', 'iCloud App 专用密码', 'iCloud app-specific password'),
    secretPlaceholder: m('profile.icloud.secretPlaceholder', 'iCloud App-Specific Password', 'iCloud App-Specific Password'),
    secretHelpText: m('profile.icloud.secretHelpText', '请在 Apple ID 安全设置中生成 App 专用密码后再接入。', 'Generate an app-specific password in Apple ID security settings before connecting.'),
  },
  'yahoo-imap-smtp': {
    label: m('profile.yahoo.label', 'Yahoo IMAP / SMTP', 'Yahoo IMAP / SMTP'),
    description: m('profile.yahoo.description', 'Yahoo 邮箱按 IMAP / SMTP App Password 模式展示，适合已有 Yahoo 账号池接入。', 'Yahoo Mail is presented in IMAP / SMTP app-password mode and fits existing Yahoo account pools.'),
    summaryHint: m('profile.yahoo.summaryHint', '主分类：IMAP / SMTP；服务商：Yahoo', 'Primary family: IMAP / SMTP; provider: Yahoo'),
    secretLabel: m('profile.yahoo.secretLabel', 'Yahoo App Password', 'Yahoo app password'),
    secretPlaceholder: m('profile.yahoo.secretPlaceholder', 'Yahoo App Password', 'Yahoo App Password'),
    secretHelpText: m('profile.yahoo.secretHelpText', '请先在 Yahoo 账号安全设置中生成 App Password。', 'Generate an app password in Yahoo account security settings before connecting.'),
  },
  'zoho-imap-smtp': {
    label: m('profile.zoho.label', 'Zoho IMAP / SMTP', 'Zoho IMAP / SMTP'),
    description: m('profile.zoho.description', 'Zoho Mail 按 IMAP / SMTP 应用密码模式展示，适合企业邮箱类标准接入。', 'Zoho Mail is presented in IMAP / SMTP app-password mode and fits standard enterprise-mailbox integrations.'),
    summaryHint: m('profile.zoho.summaryHint', '主分类：IMAP / SMTP；服务商：Zoho Mail', 'Primary family: IMAP / SMTP; provider: Zoho Mail'),
    secretLabel: m('profile.zoho.secretLabel', 'Zoho 应用密码', 'Zoho app password'),
    secretPlaceholder: m('profile.zoho.secretPlaceholder', 'Zoho App Password', 'Zoho App Password'),
    secretHelpText: m('profile.zoho.secretHelpText', '如果租户启用了 MFA，请使用 Zoho App Password 或客户端授权密码。', 'If the tenant has MFA enabled, use a Zoho app password or client authorization password.'),
  },
  'aliyun-imap-smtp': {
    label: m('profile.aliyun.label', '阿里邮箱 IMAP / SMTP', 'Aliyun Mail IMAP / SMTP'),
    description: m('profile.aliyun.description', '阿里邮箱按 IMAP / SMTP 客户端专用密码模式展示，适合企业邮箱场景的标准协议接入。', 'Aliyun Mail is presented in IMAP / SMTP client-specific-password mode and fits standard enterprise-mailbox integrations.'),
    summaryHint: m('profile.aliyun.summaryHint', '主分类：IMAP / SMTP；服务商：阿里邮箱', 'Primary family: IMAP / SMTP; provider: Aliyun Mail'),
    secretLabel: m('profile.aliyun.secretLabel', '阿里邮箱客户端专用密码', 'Aliyun Mail client-specific password'),
    secretPlaceholder: m('profile.aliyun.secretPlaceholder', '阿里邮箱客户端专用密码 / 授权码', 'Aliyun client-specific password / authorization code'),
    secretHelpText: m('profile.aliyun.secretHelpText', '请确认已在阿里邮箱后台开启客户端收发权限并生成专用密码。', 'Confirm that client access is enabled in Aliyun Mail and generate the dedicated password first.'),
  },
  'amazon-workmail-imap-smtp': {
    label: m('profile.amazonWorkmail.label', 'Amazon WorkMail IMAP / SMTP', 'Amazon WorkMail IMAP / SMTP'),
    description: m('profile.amazonWorkmail.description', 'Amazon WorkMail 属于标准 IMAP / SMTP 企业邮箱，但服务器地址按 AWS Region 区分，通常需要手工确认。', 'Amazon WorkMail is a standard enterprise IMAP / SMTP mailbox, but the server hosts are region-specific in AWS and usually need manual confirmation.'),
    summaryHint: m('profile.amazonWorkmail.summaryHint', '主分类：IMAP / SMTP；服务商：Amazon WorkMail', 'Primary family: IMAP / SMTP; provider: Amazon WorkMail'),
    secretLabel: m('profile.amazonWorkmail.secretLabel', 'Amazon WorkMail 密码', 'Amazon WorkMail password'),
    secretPlaceholder: m('profile.amazonWorkmail.secretPlaceholder', 'Amazon WorkMail Password', 'Amazon WorkMail Password'),
    secretHelpText: m('profile.amazonWorkmail.secretHelpText', '请填写邮箱密码，并在下方服务器配置中填写对应区域的 imap.mail.{region}.awsapps.com / smtp.mail.{region}.awsapps.com。', 'Enter the mailbox password and fill the matching regional hosts (imap.mail.{region}.awsapps.com / smtp.mail.{region}.awsapps.com) in the server settings below.'),
    serverConfigHelpText: m('profile.amazonWorkmail.serverConfigHelpText', 'Amazon WorkMail 没有单一全局主机名，请填写与你的 AWS Region 对应的 IMAP / SMTP 主机地址。', 'Amazon WorkMail does not have one global hostname. Enter the IMAP / SMTP hosts that match your AWS Region.'),
  },
  'fastmail-imap-smtp': {
    label: m('profile.fastmail.label', 'Fastmail IMAP / SMTP', 'Fastmail IMAP / SMTP'),
    description: m('profile.fastmail.description', 'Fastmail 通过标准 IMAP / SMTP 接入，适合国际化个人/企业邮箱统一纳管。', 'Fastmail connects through standard IMAP / SMTP and fits unified management for international personal and business mailboxes.'),
    summaryHint: m('profile.fastmail.summaryHint', '主分类：IMAP / SMTP；服务商：Fastmail', 'Primary family: IMAP / SMTP; provider: Fastmail'),
    secretLabel: m('profile.fastmail.secretLabel', 'Fastmail 密码 / App Password', 'Fastmail password / app password'),
    secretPlaceholder: m('profile.fastmail.secretPlaceholder', 'Fastmail Password or App Password', 'Fastmail Password or App Password'),
    secretHelpText: m('profile.fastmail.secretHelpText', '若账号启用了两步验证，请优先使用 Fastmail App Password。', 'If the account has two-step verification enabled, prefer a Fastmail app password.'),
  },
  'aol-imap-smtp': {
    label: m('profile.aol.label', 'AOL Mail IMAP / SMTP', 'AOL Mail IMAP / SMTP'),
    description: m('profile.aol.description', 'AOL Mail 使用标准 IMAP / SMTP 接入，通常需要 App Password。', 'AOL Mail connects through standard IMAP / SMTP and usually requires an app password.'),
    summaryHint: m('profile.aol.summaryHint', '主分类：IMAP / SMTP；服务商：AOL Mail', 'Primary family: IMAP / SMTP; provider: AOL Mail'),
    secretLabel: m('profile.aol.secretLabel', 'AOL App Password', 'AOL app password'),
    secretPlaceholder: m('profile.aol.secretPlaceholder', 'AOL App Password', 'AOL App Password'),
    secretHelpText: m('profile.aol.secretHelpText', '建议使用 AOL 后台生成的 App Password，而不是网页登录密码。', 'Use an app password generated in AOL settings rather than the web-login password.'),
  },
  'gmx-imap-smtp': {
    label: m('profile.gmx.label', 'GMX IMAP / SMTP', 'GMX IMAP / SMTP'),
    description: m('profile.gmx.description', 'GMX 使用标准 IMAP / SMTP 接入，是常见的国外通用邮箱。', 'GMX uses standard IMAP / SMTP and is a common international general-purpose mailbox.'),
    summaryHint: m('profile.gmx.summaryHint', '主分类：IMAP / SMTP；服务商：GMX', 'Primary family: IMAP / SMTP; provider: GMX'),
    secretLabel: m('profile.gmx.secretLabel', 'GMX 密码', 'GMX password'),
    secretPlaceholder: m('profile.gmx.secretPlaceholder', 'GMX Password', 'GMX Password'),
    secretHelpText: m('profile.gmx.secretHelpText', '请填写 GMX 邮箱密码；如租户策略要求，也可改用应用专用密码。', 'Enter the GMX mailbox password. If tenant policy requires it, you can switch to an app password instead.'),
  },
  'mailcom-imap-smtp': {
    label: m('profile.mailcom.label', 'Mail.com IMAP / SMTP', 'Mail.com IMAP / SMTP'),
    description: m('profile.mailcom.description', 'Mail.com 使用标准 IMAP / SMTP 接入，适合常见的国外通用邮箱场景。', 'Mail.com uses standard IMAP / SMTP and fits common international general-purpose mailbox scenarios.'),
    summaryHint: m('profile.mailcom.summaryHint', '主分类：IMAP / SMTP；服务商：Mail.com', 'Primary family: IMAP / SMTP; provider: Mail.com'),
    secretLabel: m('profile.mailcom.secretLabel', 'Mail.com 密码', 'Mail.com password'),
    secretPlaceholder: m('profile.mailcom.secretPlaceholder', 'Mail.com Password', 'Mail.com Password'),
    secretHelpText: m('profile.mailcom.secretHelpText', '请确认账号支持 IMAP/SMTP 功能后再接入。', 'Confirm that the account supports IMAP/SMTP before connecting.'),
  },
  'yandex-imap-smtp': {
    label: m('profile.yandex.label', 'Yandex IMAP / SMTP', 'Yandex IMAP / SMTP'),
    description: m('profile.yandex.description', 'Yandex Mail 使用标准 IMAP / SMTP 接入，适合国际化或区域性邮箱池场景。', 'Yandex Mail uses standard IMAP / SMTP and fits international or region-specific mailbox-pool scenarios.'),
    summaryHint: m('profile.yandex.summaryHint', '主分类：IMAP / SMTP；服务商：Yandex Mail', 'Primary family: IMAP / SMTP; provider: Yandex Mail'),
    secretLabel: m('profile.yandex.secretLabel', 'Yandex 密码 / App Password', 'Yandex password / app password'),
    secretPlaceholder: m('profile.yandex.secretPlaceholder', 'Yandex Password or App Password', 'Yandex Password or App Password'),
    secretHelpText: m('profile.yandex.secretHelpText', '请优先使用 Yandex 后台允许的应用密码；在特定区域可改用 imap.ya.ru 作为 IMAP 主机。', 'Prefer an app password allowed by Yandex; in some regions you can also use imap.ya.ru as the IMAP host.'),
  },
  'custom-imap-smtp': {
    label: m('profile.customImapSmtp.label', 'Custom IMAP / SMTP', 'Custom IMAP / SMTP'),
    description: m('profile.customImapSmtp.description', '用于接入企业自建邮箱、普通域名邮箱、cPanel、自定义 IMAP / SMTP 服务等长尾场景。', 'Used for long-tail scenarios such as self-hosted enterprise mail, ordinary domain mailboxes, cPanel, and custom IMAP / SMTP services.'),
    summaryHint: m('profile.customImapSmtp.summaryHint', '主分类：IMAP / SMTP；服务商：自定义服务器', 'Primary family: IMAP / SMTP; provider: Custom server'),
    secretLabel: m('profile.customImapSmtp.secretLabel', '登录密码 / 授权码', 'Login password / authorization code'),
    secretPlaceholder: m('profile.customImapSmtp.secretPlaceholder', 'Password / App Password / Authorization Code', 'Password / App Password / Authorization Code'),
    secretHelpText: m('profile.customImapSmtp.secretHelpText', '请填写支持 IMAP / SMTP 的登录凭据；如果服务商启用了两步验证，通常需要使用 App Password 或授权码。', 'Enter login credentials that support IMAP / SMTP. If the provider uses two-step verification, you typically need an app password or authorization code.'),
    serverConfigHelpText: m('profile.customImapSmtp.serverConfigHelpText', '自定义模式需要你填写 IMAP / SMTP 主机、端口、TLS 设置以及可选文件夹映射。', 'Custom mode requires manual IMAP / SMTP hosts, ports, TLS settings, and optional folder mappings.'),
  },
};

const hostedProfiles: Record<
  HostedInternalProfileKey,
  {
    label: ProviderMessage;
    description: ProviderMessage;
    summaryHint: ProviderMessage;
    classificationNote: ProviderMessage;
  }
> = {
  'hosted-internal-manual': {
    label: m('hosted.manual.label', 'Hosted Internal / Manual', 'Hosted Internal / Manual'),
    description: m('hosted.manual.description', '站内托管邮箱的人工维护 profile，适合门户运营、人工绑定负责人和日常收发协同。', 'The manually managed hosted-internal profile, suitable for portal operations, owner assignment, and day-to-day mailbox coordination.'),
    summaryHint: m('hosted.manual.summaryHint', '主分类：Hosted Internal；profile：MANUAL', 'Primary family: Hosted Internal; profile: MANUAL'),
    classificationNote: m('hosted.manual.classificationNote', '该邮箱走 all-Mail 自己的域名收件、门户访问和站内发信链路，不再按 OAuth API 或 IMAP / SMTP 归类。', 'This mailbox uses all-Mail’s own domain-receive, portal-access, and hosted-sending flow instead of being grouped under OAuth API or IMAP / SMTP.'),
  },
  'hosted-internal-api-pool': {
    label: m('hosted.apiPool.label', 'Hosted Internal / API Pool', 'Hosted Internal / API Pool'),
    description: m('hosted.apiPool.description', '站内托管邮箱的 API 池 profile，适合批量分配、脚本取号和验证码/收件自动化。', 'The hosted-internal API-pool profile, suitable for batch allocation, scripted pickup, and verification-code / inbox automation.'),
    summaryHint: m('hosted.apiPool.summaryHint', '主分类：Hosted Internal；profile：API_POOL', 'Primary family: Hosted Internal; profile: API_POOL'),
    classificationNote: m('hosted.apiPool.classificationNote', '该邮箱仍属于 Hosted Internal，只是供给方式切到 API_POOL，便于域名池分配和程序化领取。', 'This mailbox still belongs to Hosted Internal; only the supply mode switches to API_POOL for pooled allocation and programmatic pickup.'),
  },
};

export const providerI18n = {
  authTypeLabels,
  representativeProtocols,
  secondaryProtocols,
  providers,
  profiles,
  hostedProfiles,
} as const;

export const getAuthTypeLabelMessage = (authType: EmailAuthType) =>
  providerI18n.authTypeLabels[authType];

export const getRepresentativeProtocolLabelMessage = (
  protocol: RepresentativeProtocol,
) => providerI18n.representativeProtocols[protocol].label;

export const getRepresentativeProtocolDescriptionMessage = (
  protocol: RepresentativeProtocol,
) => providerI18n.representativeProtocols[protocol].description;

export const getRepresentativeProtocolConnectionLabelMessage = (
  protocol: RepresentativeProtocol,
) => providerI18n.representativeProtocols[protocol].connectionLabel;

export const getSecondaryProtocolLabelMessage = (protocol: SecondaryProtocol) =>
  providerI18n.secondaryProtocols[protocol];

export const getProviderLabelMessage = (provider: EmailProvider) =>
  providerI18n.providers[provider].label;

export const getProviderDescriptionMessage = (provider: EmailProvider) =>
  providerI18n.providers[provider].description;

export const getProviderEmailPlaceholderMessage = (provider: EmailProvider) =>
  providerI18n.providers[provider].emailPlaceholder;

export const getProviderAddButtonLabelMessage = (provider: EmailProvider) =>
  providerI18n.providers[provider].addButtonLabel;

export const getProviderClassificationNoteMessage = (provider: EmailProvider) =>
  providerI18n.providers[provider].classificationNote;

export const getProviderProfileLabelMessage = (profile: ProviderProfileKey) =>
  providerI18n.profiles[profile].label;

export const getProviderProfileDescriptionMessage = (profile: ProviderProfileKey) =>
  providerI18n.profiles[profile].description;

export const getProviderProfileSummaryHintMessage = (profile: ProviderProfileKey) =>
  providerI18n.profiles[profile].summaryHint;

export const getProviderProfileSecretLabelMessage = (profile: ProviderProfileKey) =>
  providerI18n.profiles[profile].secretLabel;

export const getProviderProfileSecretPlaceholderMessage = (
  profile: ProviderProfileKey,
) => providerI18n.profiles[profile].secretPlaceholder;

export const getProviderProfileSecretHelpTextMessage = (
  profile: ProviderProfileKey,
) => providerI18n.profiles[profile].secretHelpText;

export const getProviderProfileServerConfigHelpTextMessage = (
  profile: ProviderProfileKey,
) => providerI18n.profiles[profile].serverConfigHelpText;

export const getHostedInternalProfileLabelMessage = (
  profile: HostedInternalProfileKey,
) => providerI18n.hostedProfiles[profile].label;

export const getHostedInternalProfileDescriptionMessage = (
  profile: HostedInternalProfileKey,
) => providerI18n.hostedProfiles[profile].description;

export const getHostedInternalProfileSummaryHintMessage = (
  profile: HostedInternalProfileKey,
) => providerI18n.hostedProfiles[profile].summaryHint;

export const getHostedInternalProfileClassificationNoteMessage = (
  profile: HostedInternalProfileKey,
) => providerI18n.hostedProfiles[profile].classificationNote;

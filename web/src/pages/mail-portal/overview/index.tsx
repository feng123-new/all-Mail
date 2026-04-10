import { useEffect, useMemo, useState, type FC } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Col, Empty, Row, Space, Spin, Tag, Typography } from 'antd';
import { InboxOutlined, MailOutlined, SendOutlined, SettingOutlined, ArrowRightOutlined, CopyOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, SurfaceCard } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { useI18n } from '../../../i18n';
import { getRepresentativeProtocolLabelMessage } from '../../../i18n/catalog/providers';
import { defineMessage, type TranslationInput } from '../../../i18n/messages';
import { useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { requestData } from '../../../utils/request';
import {
    centeredPadding48Style,
    fontSize12Style,
    fullWidthStyle,
    noMarginBottomStyle,
    noMarginStyle,
} from '../../../styles/common';
import { shellPalette } from '../../../theme';
import {
    getHostedInternalProfileByProvisioningMode,
    getHostedInternalProfileDefinition,
    getRepresentativeProtocolTagColor,
    type HostedInternalCapabilitySummary,
    type HostedInternalProfileKey,
    type RepresentativeProtocol,
} from '../../../constants/providers';

const { Title, Text, Paragraph } = Typography;

const portalOverviewI18n = {
    eyebrow: defineMessage('portalOverview.eyebrow', '邮箱门户', 'Mailbox portal'),
    title: defineMessage('portalOverview.title', '欢迎回来，{username}', 'Welcome back, {username}'),
    subtitle: defineMessage('portalOverview.subtitle', '先看未读和邮箱资源，再决定进入工作区还是设置中心。', 'Review unread mail and mailbox resources first, then decide whether to open the inbox workspace or Settings.'),
    openWorkspace: defineMessage('portalOverview.openWorkspace', '进入工作区', 'Open workspace'),
    compose: defineMessage('portalOverview.compose', '写邮件', 'Compose'),
    settings: defineMessage('portalOverview.settings', '设置中心', 'Settings center'),
    passwordAlertTitle: defineMessage('portalOverview.passwordAlertTitle', '检测到当前门户账号仍处于首次密码状态', 'This portal account is still using the initial password'),
    passwordAlertDescription: defineMessage('portalOverview.passwordAlertDescription', '建议先进入设置中心更新密码，再继续收发和配置转发。', 'Update the password in Settings before continuing with inbox work or forwarding setup.'),
    proofTitle: defineMessage('portalOverview.proofTitle', 'Proof scenario · unread demo', 'Proof scenario · unread demo'),
    proofDescription: defineMessage('portalOverview.proofDescription', '此模式仅用于本地证据采集：注入带验证码动作的未读邮件样例，并压测压缩后的门户工作区节奏。', 'This mode is only for local proof capture: it injects unread messages with verification-code actions and exercises the compressed portal workspace rhythm.'),
    accessibleMailboxes: defineMessage('portalOverview.stats.accessibleMailboxes', '可访问邮箱', 'Accessible mailboxes'),
    unreadMessages: defineMessage('portalOverview.stats.unreadMessages', '未读邮件', 'Unread messages'),
    sendEnabledMailboxes: defineMessage('portalOverview.stats.sendEnabledMailboxes', '可发件邮箱', 'Send-enabled mailboxes'),
    forwardingEnabled: defineMessage('portalOverview.stats.forwardingEnabled', '已启用转发', 'Forwarding enabled'),
    mailboxUserFallback: defineMessage('portalOverview.mailboxUserFallback', '邮箱用户', 'Mailbox user'),
    sendReady: defineMessage('portalOverview.status.sendReady', '发件已就绪', 'Ready to send'),
    sendingPending: defineMessage('portalOverview.status.sendingPending', '待配置发件', 'Sending pending setup'),
    inboxOnly: defineMessage('portalOverview.status.inboxOnly', '仅收件', 'Inbox only'),
    apiMailboxPool: defineMessage('portalOverview.provisioning.apiPool', 'API 邮箱池', 'API mailbox pool'),
    manualManaged: defineMessage('portalOverview.provisioning.manual', '手动维护', 'Manually managed'),
    recentUnreadTitle: defineMessage('portalOverview.recentUnreadTitle', '最近未读邮件', 'Recent unread mail'),
    recentUnreadSubtitle: defineMessage('portalOverview.recentUnreadSubtitle', '只保留最近需要处理的入站消息。', 'Only keep the most actionable inbound messages here.'),
    noUnread: defineMessage('portalOverview.noUnread', '当前没有未读邮件', 'No unread mail right now'),
    copyCode: defineMessage('portalOverview.copyCode', '复制验证码', 'Copy code'),
    noSubject: defineMessage('portalOverview.noSubject', '(无主题)', '(No subject)'),
    verificationCode: defineMessage('portalOverview.verificationCode', '验证码：{code}', 'Code: {code}'),
    read: defineMessage('portalOverview.read', '已读', 'Read'),
    unread: defineMessage('portalOverview.unread', '未读', 'Unread'),
    fromMailbox: defineMessage('portalOverview.fromMailbox', '来自 {from} · 送达 {mailbox}', 'From {from} · Delivered to {mailbox}'),
    noPreview: defineMessage('portalOverview.noPreview', '无预览', 'No preview'),
    mailboxOverviewTitle: defineMessage('portalOverview.mailboxOverviewTitle', '邮箱资源速览', 'Mailbox resource overview'),
    mailboxOverviewSubtitle: defineMessage('portalOverview.mailboxOverviewSubtitle', '先确认哪些邮箱能发件、哪些仅收件，以及哪些已经启用转发。', 'Confirm which mailboxes can send, which are inbox-only, and which already have forwarding enabled.'),
    noAccessibleMailboxes: defineMessage('portalOverview.noAccessibleMailboxes', '当前没有可访问邮箱', 'No accessible mailboxes right now'),
    highlightedMailboxes: defineMessage('portalOverview.highlightedMailboxes', '优先展示最值得处理的 {count} 个邮箱', 'Showing the {count} most actionable mailboxes first'),
    mailboxSummary: defineMessage('portalOverview.mailboxSummary', '共 {total} 个邮箱，其中 {sendEnabled} 个可发件，{forwardingEnabled} 个启用转发。剩余邮箱收拢到工作区与设置中心继续查看。', '{total} mailboxes total, with {sendEnabled} ready to send and {forwardingEnabled} using forwarding. Open the workspace or Settings for the rest.'),
    domainMode: defineMessage('portalOverview.domainMode', '域名：{domain} · {mode}', 'Domain: {domain} · {mode}'),
    catchAllTarget: defineMessage('portalOverview.catchAllTarget', 'Catch-all 目标', 'Catch-all target'),
    moreMailboxes: defineMessage('portalOverview.moreMailboxes', '还有 {count} 个邮箱，可在工作区或设置中心查看全部。', '{count} more mailboxes are available in the workspace or Settings.'),
    fetchPortalSessionFailed: defineMessage('portalOverview.fetchPortalSessionFailed', '获取门户会话失败', 'Failed to load the portal session'),
    fetchMailboxListFailed: defineMessage('portalOverview.fetchMailboxListFailed', '获取邮箱列表失败', 'Failed to load the mailbox list'),
    fetchUnreadFailed: defineMessage('portalOverview.fetchUnreadFailed', '获取未读邮件失败', 'Failed to load unread mail'),
} as const;

interface SessionPayload {
    authenticated: boolean;
    mailboxUser: {
        id: number;
        username: string;
        email?: string | null;
        status: string;
        mustChangePassword?: boolean;
        lastLoginAt?: string | null;
        mailboxIds?: number[];
    };
}

interface MailboxItem {
    id: number;
    address: string;
    displayName?: string | null;
    provisioningMode?: 'MANUAL' | 'API_POOL';
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    canLogin?: boolean;
    isCatchAllTarget?: boolean;
    providerProfile?: HostedInternalProfileKey;
    representativeProtocol?: RepresentativeProtocol;
    profileSummaryHint?: string;
    capabilitySummary?: HostedInternalCapabilitySummary;
    sendReady?: boolean;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
}

function getSendStatus(mailbox: MailboxItem, t: (source: TranslationInput, params?: Record<string, number | string>) => string) {
	if (mailbox.sendReady) {
		return { color: 'success' as const, label: t(portalOverviewI18n.sendReady) };
	}
	if (mailbox.domain?.canSend) {
		return { color: 'warning' as const, label: t(portalOverviewI18n.sendingPending) };
	}
	return { color: 'default' as const, label: t(portalOverviewI18n.inboxOnly) };
}

function getProvisioningModeLabel(mode: 'MANUAL' | 'API_POOL' | undefined, t: (source: TranslationInput) => string) {
    if (mode === 'API_POOL') {
        return t(portalOverviewI18n.apiMailboxPool);
    }

    return t(portalOverviewI18n.manualManaged);
}

interface MessageItem {
    id: string;
    fromAddress: string;
    subject?: string | null;
    textPreview?: string | null;
    verificationCode?: string | null;
    receivedAt: string;
    mailbox?: { id: number; address: string } | null;
    isRead: boolean;
}

const PORTAL_OVERVIEW_PROOF_MODE = 'unread-demo';

const PORTAL_OVERVIEW_PROOF_MAILBOXES: MailboxItem[] = [
    {
        id: 1,
        address: 'alerts@example.com',
        provisioningMode: 'API_POOL',
        forwardMode: 'COPY',
        sendReady: true,
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    },
    {
        id: 2,
        address: 'verify@example.com',
        provisioningMode: 'API_POOL',
        forwardMode: 'DISABLED',
        sendReady: false,
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    },
    {
        id: 3,
        address: 'ops@example.com',
        provisioningMode: 'API_POOL',
        forwardMode: 'MOVE',
        sendReady: true,
        isCatchAllTarget: true,
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    },
    {
        id: 4,
        address: 'billing@example.com',
        provisioningMode: 'MANUAL',
        forwardMode: 'COPY',
        sendReady: false,
        domain: { id: 1, name: 'example.com', canSend: false, canReceive: true },
    },
    {
        id: 5,
        address: 'support@example.com',
        provisioningMode: 'API_POOL',
        forwardMode: 'DISABLED',
        sendReady: true,
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    },
];

const PORTAL_OVERVIEW_PROOF_MESSAGES: MessageItem[] = [
    {
        id: 'demo-001',
        fromAddress: 'Amazon <no-reply@amazon.com>',
        subject: 'Amazon Security Code',
        textPreview: 'Your Amazon verification code is 482761. Enter this within 10 minutes to continue.',
        verificationCode: '482761',
        receivedAt: '2026-04-05T08:18:00.000Z',
        mailbox: { id: 2, address: 'verify@example.com' },
        isRead: false,
    },
    {
        id: 'demo-002',
        fromAddress: 'GitHub <noreply@github.com>',
        subject: 'New sign-in to GitHub',
        textPreview: 'A new sign-in was detected from Singapore. Review the event if this was not you.',
        receivedAt: '2026-04-05T08:05:00.000Z',
        mailbox: { id: 1, address: 'alerts@example.com' },
        isRead: false,
    },
    {
        id: 'demo-003',
        fromAddress: 'Stripe <support@stripe.com>',
        subject: 'Payout delayed for review',
        textPreview: 'Your latest payout is pending manual review. Check the payout dashboard for the next action.',
        receivedAt: '2026-04-05T07:46:00.000Z',
        mailbox: { id: 4, address: 'billing@example.com' },
        isRead: false,
    },
];

function isLocalProofHost() {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
}

const overviewStyles = {
    fullWidth: fullWidthStyle,
    titleNoMargin: noMarginStyle,
    mutedHint: fontSize12Style,
    loadingBox: centeredPadding48Style,
    flexBetween: { justifyContent: 'space-between', width: '100%', alignItems: 'center' },
    marginTop16: { marginTop: 16 },
    mailboxCard: {
        borderRadius: 16,
        padding: '12px 0',
        background: 'transparent',
        borderBottom: `1px solid ${shellPalette.border}`,
    },
    inventorySummary: {
        display: 'grid',
        gap: 4,
        padding: '0 0 10px',
        borderBottom: `1px solid ${shellPalette.border}`,
    },
} as const;

const MailPortalOverviewPage: FC = () => {
    const { t } = useI18n();
    const [searchParams] = useSearchParams();
    const mailboxStoreUser = useMailboxAuthStore((state) => state.mailboxUser);
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [recentUnread, setRecentUnread] = useState<MessageItem[]>([]);
    const [unreadTotal, setUnreadTotal] = useState(0);
    const proofScenario = isLocalProofHost() ? searchParams.get('proof')?.trim() || '' : '';
    const isUnreadProof = proofScenario === PORTAL_OVERVIEW_PROOF_MODE;
    const proofSession = isUnreadProof ? {
        authenticated: true,
        mailboxUser: {
            id: mailboxStoreUser?.id || 1,
            username: mailboxStoreUser?.username || 'portal-user',
            email: mailboxStoreUser?.email || null,
            status: 'ACTIVE',
            mustChangePassword: Boolean(mailboxStoreUser?.mustChangePassword),
            mailboxIds: mailboxStoreUser?.mailboxIds || PORTAL_OVERVIEW_PROOF_MAILBOXES.map((item) => item.id),
        },
    } satisfies SessionPayload : null;

    useEffect(() => {
        if (isUnreadProof) {
            return undefined;
        }

        let disposed = false;

        const load = async () => {
            setLoading(true);
            const [sessionResult, mailboxResult, unreadResult] = await Promise.all([
                requestData<SessionPayload>(() => portalAccountContract.getSession(), t(portalOverviewI18n.fetchPortalSessionFailed), { silent: true }),
                requestData<MailboxItem[]>(() => portalAccountContract.getMailboxes(), t(portalOverviewI18n.fetchMailboxListFailed), { silent: true }),
                requestData<{ list: MessageItem[]; total: number }>(() => portalAccountContract.getMessages({ unreadOnly: true, page: 1, pageSize: 6 }), t(portalOverviewI18n.fetchUnreadFailed), { silent: true }),
            ]);

            if (disposed) {
                return;
            }

            if (sessionResult) {
                setSession(sessionResult);
                useMailboxAuthStore.setState((state) => ({
                    mailboxUser: state.mailboxUser
                        ? { ...state.mailboxUser, ...sessionResult.mailboxUser }
                        : state.mailboxUser,
                }));
            }
            if (mailboxResult) {
                setMailboxes(mailboxResult);
            }
            if (unreadResult) {
                setRecentUnread(unreadResult.list || []);
                setUnreadTotal(unreadResult.total || 0);
            }

            setLoading(false);
        };

        void load();
        return () => {
            disposed = true;
        };
    }, [isUnreadProof, t]);

    const displayLoading = isUnreadProof ? false : loading;
    const displaySession = isUnreadProof ? proofSession : session;
    const displayMailboxes = isUnreadProof ? PORTAL_OVERVIEW_PROOF_MAILBOXES : mailboxes;
    const displayRecentUnread = isUnreadProof ? PORTAL_OVERVIEW_PROOF_MESSAGES : recentUnread;
    const displayUnreadTotal = isUnreadProof ? PORTAL_OVERVIEW_PROOF_MESSAGES.length : unreadTotal;

    const sendEnabledCount = useMemo(() => displayMailboxes.filter((item) => item.domain?.canSend).length, [displayMailboxes]);
    const forwardingEnabledCount = useMemo(() => displayMailboxes.filter((item) => item.forwardMode && item.forwardMode !== 'DISABLED').length, [displayMailboxes]);

    const mailboxHighlights = displayMailboxes.slice(0, 4);

    const handleCopyCode = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch (error) {
            console.warn('Failed to copy verification code from portal overview:', error);
        }
    };

    return (
        <Space orientation="vertical" size={20} style={overviewStyles.fullWidth}>
            <PageHeader
                eyebrow={t(portalOverviewI18n.eyebrow)}
                title={t(portalOverviewI18n.title, { username: displaySession?.mailboxUser.username || t(portalOverviewI18n.mailboxUserFallback) })}
                subtitle={t(portalOverviewI18n.subtitle)}
                extra={
                    <Space wrap>
                        <Link to="/mail/inbox"><Button type="primary" icon={<InboxOutlined />}>{t(portalOverviewI18n.openWorkspace)}</Button></Link>
                        <Link to="/mail/inbox?compose=1"><Button type="text" icon={<SendOutlined />}>{t(portalOverviewI18n.compose)}</Button></Link>
                        <Link to="/mail/settings"><Button type="text" icon={<SettingOutlined />}>{t(portalOverviewI18n.settings)}</Button></Link>
                    </Space>
                }
            />

            {displaySession?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    title={t(portalOverviewI18n.passwordAlertTitle)}
                    description={t(portalOverviewI18n.passwordAlertDescription)}
                    />
                ) : null}

            {isUnreadProof ? (
                <Alert
                    type="info"
                    showIcon
                    banner
                    title={t(portalOverviewI18n.proofTitle)}
                    description={t(portalOverviewI18n.proofDescription)}
                />
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}><StatCard title={t(portalOverviewI18n.accessibleMailboxes)} value={displayMailboxes.length} icon={<MailOutlined />} iconBgColor={shellPalette.primary} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title={t(portalOverviewI18n.unreadMessages)} value={displayUnreadTotal} icon={<InboxOutlined />} iconBgColor={shellPalette.accent} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title={t(portalOverviewI18n.sendEnabledMailboxes)} value={sendEnabledCount} icon={<SendOutlined />} iconBgColor={shellPalette.warning} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title={t(portalOverviewI18n.forwardingEnabled)} value={forwardingEnabledCount} icon={<ArrowRightOutlined />} iconBgColor={shellPalette.primary} loading={displayLoading} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={15}>
                    <SurfaceCard>
                        <Space orientation="vertical" size={16} style={overviewStyles.fullWidth}>
                            <div>
                                <Title level={4} style={overviewStyles.titleNoMargin}>{t(portalOverviewI18n.recentUnreadTitle)}</Title>
                                <Text type="secondary">{t(portalOverviewI18n.recentUnreadSubtitle)}</Text>
                            </div>
                            {displayLoading ? (
                                <div style={overviewStyles.loadingBox}><Spin /></div>
                            ) : displayRecentUnread.length === 0 ? (
                                <Empty description={t(portalOverviewI18n.noUnread)} />
                            ) : (
                                <Space orientation="vertical" size={12} style={overviewStyles.fullWidth}>
                                    {displayRecentUnread.map((item) => (
                                        <div key={item.id}>
                                            <Space orientation="vertical" size={8} style={overviewStyles.fullWidth}>
                                                <Space wrap style={overviewStyles.fullWidth}>
                                                    <Text strong>{item.subject || t(portalOverviewI18n.noSubject)}</Text>
                                                    {item.verificationCode ? <Tag color="magenta">{t(portalOverviewI18n.verificationCode, { code: item.verificationCode })}</Tag> : null}
                                                    <Tag color={item.isRead ? 'default' : 'blue'}>{item.isRead ? t(portalOverviewI18n.read) : t(portalOverviewI18n.unread)}</Tag>
                                                    {item.verificationCode ? (
                                                        <Button type="link" icon={<CopyOutlined />} onClick={() => void handleCopyCode(item.verificationCode || '')}>{t(portalOverviewI18n.copyCode)}</Button>
                                                    ) : null}
                                                </Space>
                                                <Space orientation="vertical" size={4} style={overviewStyles.fullWidth}>
                                                    <Text type="secondary">{t(portalOverviewI18n.fromMailbox, { from: item.fromAddress, mailbox: item.mailbox?.address || '-' })}</Text>
                                                    <Text type="secondary">{new Date(item.receivedAt).toLocaleString()}</Text>
                                                    <Paragraph ellipsis={{ rows: 2, expandable: false }} style={noMarginBottomStyle}>
                                                        {item.textPreview || t(portalOverviewI18n.noPreview)}
                                                    </Paragraph>
                                                </Space>
                                            </Space>
                                        </div>
                                    ))}
                                </Space>
                            )}
                        </Space>
                    </SurfaceCard>
                </Col>

                <Col xs={24} xl={9}>
                    <SurfaceCard tone="muted">
                        <Space orientation="vertical" size={16} style={overviewStyles.fullWidth}>
                            <div>
                                <Title level={4} style={overviewStyles.titleNoMargin}>{t(portalOverviewI18n.mailboxOverviewTitle)}</Title>
                                <Text type="secondary">{t(portalOverviewI18n.mailboxOverviewSubtitle)}</Text>
                            </div>
                            {displayLoading ? (
                                <div style={overviewStyles.loadingBox}><Spin /></div>
                            ) : mailboxHighlights.length === 0 ? (
                                <Empty description={t(portalOverviewI18n.noAccessibleMailboxes)} />
                            ) : (
                                <Space orientation="vertical" size={12} style={overviewStyles.fullWidth}>
                                      <div style={overviewStyles.inventorySummary}>
                                          <Text strong style={{ color: shellPalette.ink }}>{t(portalOverviewI18n.highlightedMailboxes, { count: mailboxHighlights.length })}</Text>
                                          <Text type="secondary">{t(portalOverviewI18n.mailboxSummary, { total: displayMailboxes.length, sendEnabled: sendEnabledCount, forwardingEnabled: forwardingEnabledCount })}</Text>
                                      </div>
                                    {mailboxHighlights.map((item) => (
                                        (() => {
                                            const profileDefinition = item.providerProfile
                                                ? getHostedInternalProfileDefinition(item.providerProfile)
                                                : getHostedInternalProfileByProvisioningMode(item.provisioningMode || 'MANUAL');
                                            const representativeProtocol = item.representativeProtocol || profileDefinition.representativeProtocol;
                                            return (
                                        <div
                                            key={item.id}
                                            style={overviewStyles.mailboxCard}
                                        >
                                                <Space orientation="vertical" size={8} style={overviewStyles.fullWidth}>
                                                    <div>
                                                        <Text strong>{item.address}</Text>
                                                        <div><Text type="secondary">{t(portalOverviewI18n.domainMode, { domain: item.domain?.name || '-', mode: getProvisioningModeLabel(profileDefinition.provisioningMode, t) })}</Text></div>
                                                    </div>
                                                    <Space wrap>
                                                        <Tag color={getRepresentativeProtocolTagColor(representativeProtocol)}>
                                                            {t(getRepresentativeProtocolLabelMessage(representativeProtocol))}
                                                        </Tag>
										<Tag color={getSendStatus(item, t).color}>{getSendStatus(item, t).label}</Tag>
                                                        {item.forwardMode && item.forwardMode !== 'DISABLED' ? <Tag color="purple">{t(portalOverviewI18n.forwardingEnabled)}</Tag> : null}
                                                        {item.isCatchAllTarget ? <Tag color="gold">{t(portalOverviewI18n.catchAllTarget)}</Tag> : null}
                                                    </Space>
                                            </Space>
                                        </div>
                                            );
                                        })()
                                    ))}
                                    {displayMailboxes.length > mailboxHighlights.length ? (
                                        <Text type="secondary">{t(portalOverviewI18n.moreMailboxes, { count: displayMailboxes.length - mailboxHighlights.length })}</Text>
                                    ) : null}
                                </Space>
                            )}
                        </Space>
                    </SurfaceCard>
                </Col>
            </Row>
        </Space>
    );
};

export default MailPortalOverviewPage;

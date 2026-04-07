import { useEffect, useMemo, useState, type FC } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Col, Empty, List, Row, Space, Spin, Tag, Typography } from 'antd';
import { InboxOutlined, MailOutlined, SendOutlined, SettingOutlined, ArrowRightOutlined, CopyOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, SurfaceCard } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
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
    getRepresentativeProtocolLabel,
    getRepresentativeProtocolTagColor,
    type HostedInternalCapabilitySummary,
    type HostedInternalProfileKey,
    type RepresentativeProtocol,
} from '../../../constants/providers';

const { Title, Text, Paragraph } = Typography;

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

function getSendStatus(mailbox: MailboxItem) {
	if (mailbox.sendReady) {
		return { color: 'success' as const, label: '发件已就绪' };
	}
	if (mailbox.domain?.canSend) {
		return { color: 'warning' as const, label: '待配置发件' };
	}
	return { color: 'default' as const, label: '仅收件' };
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
                requestData<SessionPayload>(() => portalAccountContract.getSession(), '获取门户会话失败', { silent: true }),
                requestData<MailboxItem[]>(() => portalAccountContract.getMailboxes(), '获取邮箱列表失败', { silent: true }),
                requestData<{ list: MessageItem[]; total: number }>(() => portalAccountContract.getMessages({ unreadOnly: true, page: 1, pageSize: 6 }), '获取未读邮件失败', { silent: true }),
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
    }, [isUnreadProof]);

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
                eyebrow="Mailbox portal"
                title={`欢迎回来，${displaySession?.mailboxUser.username || '邮箱用户'}`}
                subtitle="先看未读和邮箱资源，再决定进入工作区还是设置中心。"
                extra={
                    <Space wrap>
                        <Link to="/mail/inbox"><Button type="primary" icon={<InboxOutlined />}>进入工作区</Button></Link>
                        <Link to="/mail/inbox?compose=1"><Button type="text" icon={<SendOutlined />}>写邮件</Button></Link>
                        <Link to="/mail/settings"><Button type="text" icon={<SettingOutlined />}>设置中心</Button></Link>
                    </Space>
                }
            />

            {displaySession?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    title="检测到当前门户账号仍处于首次密码状态"
                    description="建议先进入设置中心更新密码，再继续收发和配置转发。"
                    />
                ) : null}

            {isUnreadProof ? (
                <Alert
                    type="info"
                    showIcon
                    banner
                    title="Proof scenario · unread demo"
                    description="此模式仅用于本地证据采集：注入带验证码动作的未读邮件样例，并压测压缩后的门户工作区节奏。"
                />
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}><StatCard title="可访问邮箱" value={displayMailboxes.length} icon={<MailOutlined />} iconBgColor={shellPalette.primary} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title="未读邮件" value={displayUnreadTotal} icon={<InboxOutlined />} iconBgColor={shellPalette.accent} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title="可发件邮箱" value={sendEnabledCount} icon={<SendOutlined />} iconBgColor={shellPalette.warning} loading={displayLoading} /></Col>
                <Col xs={12} md={6}><StatCard title="已启用转发" value={forwardingEnabledCount} icon={<ArrowRightOutlined />} iconBgColor={shellPalette.primary} loading={displayLoading} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={15}>
                    <SurfaceCard>
                        <Space orientation="vertical" size={16} style={overviewStyles.fullWidth}>
                            <div>
                                <Title level={4} style={overviewStyles.titleNoMargin}>最近未读邮件</Title>
                                <Text type="secondary">只保留最近需要处理的入站消息。</Text>
                            </div>
                            {displayLoading ? (
                                <div style={overviewStyles.loadingBox}><Spin /></div>
                            ) : displayRecentUnread.length === 0 ? (
                                <Empty description="当前没有未读邮件" />
                            ) : (
                                <List
                                    dataSource={displayRecentUnread}
                                    renderItem={(item) => (
                                        <List.Item
                                            key={item.id}
                                            actions={item.verificationCode ? [
                                                <Button key="copy-code" type="link" icon={<CopyOutlined />} onClick={() => void handleCopyCode(item.verificationCode || '')}>复制验证码</Button>,
                                            ] : undefined}
                                        >
                                            <List.Item.Meta
                                                title={
                                                    <Space wrap>
                                                        <Text strong>{item.subject || '(无主题)'}</Text>
                                                        {item.verificationCode ? <Tag color="magenta">验证码 {item.verificationCode}</Tag> : null}
                                                        <Tag color={item.isRead ? 'default' : 'blue'}>{item.isRead ? '已读' : '未读'}</Tag>
                                                    </Space>
                                                }
                                                description={
                                                    <Space orientation="vertical" size={4} style={overviewStyles.fullWidth}>
                                                        <Text type="secondary">来自 {item.fromAddress} · 送达 {item.mailbox?.address || '-'}</Text>
                                                        <Text type="secondary">{new Date(item.receivedAt).toLocaleString()}</Text>
                                                        <Paragraph ellipsis={{ rows: 2, expandable: false }} style={noMarginBottomStyle}>
                                                            {item.textPreview || '无预览'}
                                                        </Paragraph>
                                                    </Space>
                                                }
                                            />
                                        </List.Item>
                                    )}
                                />
                            )}
                        </Space>
                    </SurfaceCard>
                </Col>

                <Col xs={24} xl={9}>
                    <SurfaceCard tone="muted">
                        <Space orientation="vertical" size={16} style={overviewStyles.fullWidth}>
                            <div>
                                <Title level={4} style={overviewStyles.titleNoMargin}>邮箱资源速览</Title>
                                <Text type="secondary">先确认哪些邮箱能发件、哪些仅收件，以及哪些已经启用转发。</Text>
                            </div>
                            {displayLoading ? (
                                <div style={overviewStyles.loadingBox}><Spin /></div>
                            ) : mailboxHighlights.length === 0 ? (
                                <Empty description="当前没有可访问邮箱" />
                            ) : (
                                <Space orientation="vertical" size={12} style={overviewStyles.fullWidth}>
                                     <div style={overviewStyles.inventorySummary}>
                                         <Text strong style={{ color: shellPalette.ink }}>优先展示最值得处理的 4 个邮箱</Text>
                                         <Text type="secondary">共 {displayMailboxes.length} 个邮箱，其中 {sendEnabledCount} 个可发件，{forwardingEnabledCount} 个启用转发。剩余邮箱收拢到工作区与设置中心继续查看。</Text>
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
                                                        <div><Text type="secondary">域名：{item.domain?.name || '-'} · {profileDefinition.provisioningMode}</Text></div>
                                                    </div>
                                                    <Space wrap>
                                                        <Tag color={getRepresentativeProtocolTagColor(representativeProtocol)}>
                                                            {getRepresentativeProtocolLabel(representativeProtocol)}
                                                        </Tag>
											<Tag color={getSendStatus(item).color}>{getSendStatus(item).label}</Tag>
                                                        {item.forwardMode && item.forwardMode !== 'DISABLED' ? <Tag color="purple">已启用转发</Tag> : null}
                                                        {item.isCatchAllTarget ? <Tag color="gold">Catch-all 目标</Tag> : null}
                                                    </Space>
                                            </Space>
                                        </div>
                                            );
                                        })()
                                    ))}
                                    {displayMailboxes.length > mailboxHighlights.length ? (
                                        <Text type="secondary">还有 {displayMailboxes.length - mailboxHighlights.length} 个邮箱，可在工作区或设置中心查看全部。</Text>
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

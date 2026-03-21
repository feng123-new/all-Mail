import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, List, Row, Space, Spin, Tag, Typography } from 'antd';
import { InboxOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, SettingOutlined, ArrowRightOutlined, CopyOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../../../api';
import { requestData } from '../../../utils/request';
import { StatCard } from '../../../components';

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
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    canLogin?: boolean;
    isCatchAllTarget?: boolean;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
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

const MailPortalOverviewPage: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [recentUnread, setRecentUnread] = useState<MessageItem[]>([]);
    const [unreadTotal, setUnreadTotal] = useState(0);

    useEffect(() => {
        let disposed = false;

        const load = async () => {
            setLoading(true);
            const [sessionResult, mailboxResult, unreadResult] = await Promise.all([
                requestData<SessionPayload>(() => mailboxPortalApi.getSession(), '获取门户会话失败', { silent: true }),
                requestData<MailboxItem[]>(() => mailboxPortalApi.getMailboxes(), '获取邮箱列表失败', { silent: true }),
                requestData<{ list: MessageItem[]; total: number }>(() => mailboxPortalApi.getMessages({ unreadOnly: true, page: 1, pageSize: 6 }), '获取未读邮件失败', { silent: true }),
            ]);

            if (disposed) {
                return;
            }

            if (sessionResult) {
                setSession(sessionResult);
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
    }, []);

    const sendEnabledCount = useMemo(() => mailboxes.filter((item) => item.domain?.canSend).length, [mailboxes]);
    const forwardingEnabledCount = useMemo(() => mailboxes.filter((item) => item.forwardMode && item.forwardMode !== 'DISABLED').length, [mailboxes]);
    const receiveOnlyCount = useMemo(() => mailboxes.filter((item) => !item.domain?.canSend).length, [mailboxes]);

    const mailboxHighlights = mailboxes.slice(0, 6);

    const handleCopyCode = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch (error) {
            console.warn('Failed to copy verification code from portal overview:', error);
        }
    };

    return (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <Card
                bordered={false}
                style={{
                    borderRadius: 24,
                    background: 'radial-gradient(circle at top left, rgba(88, 101, 242, 0.18), transparent 38%), linear-gradient(135deg, #ffffff 0%, #eef4ff 58%, #f8fbff 100%)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                }}
                styles={{ body: { padding: 28 } }}
            >
                <Row gutter={[24, 24]} align="middle">
                    <Col xs={24} xl={15}>
                        <Space direction="vertical" size={14} style={{ width: '100%' }}>
                            <Space wrap>
                                <Tag color="blue">Portal Workspace</Tag>
                                <Tag color="cyan">Mailboxes {mailboxes.length}</Tag>
                                {session?.mailboxUser.mustChangePassword ? <Tag color="warning">建议先更新密码</Tag> : <Tag color="success">账户状态正常</Tag>}
                            </Space>
                            <div>
                                <Title level={2} style={{ margin: 0 }}>欢迎回来，{session?.mailboxUser.username || '邮箱用户'}</Title>
                                <Paragraph style={{ margin: '10px 0 0', color: '#475569', maxWidth: 720 }}>
                                    这里先看你当前可访问的邮箱资源、未读消息和转发状态，再决定进入收/发件工作区还是设置中心。
                                </Paragraph>
                            </div>
                            <Space wrap>
                                <Link to="/mail/inbox"><Button type="primary" icon={<InboxOutlined />}>进入收/发件工作区</Button></Link>
                                <Link to="/mail/inbox?compose=1"><Button icon={<SendOutlined />}>写邮件</Button></Link>
                                <Link to="/mail/settings"><Button icon={<SettingOutlined />}>打开设置中心</Button></Link>
                            </Space>
                        </Space>
                    </Col>
                    <Col xs={24} xl={9}>
                        <Card
                            bordered={false}
                            style={{ borderRadius: 22, background: 'rgba(15, 23, 42, 0.96)', color: '#fff' }}
                            styles={{ body: { padding: 24 } }}
                        >
                            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                <Space>
                                    <SafetyCertificateOutlined style={{ color: '#fde68a' }} />
                                    <Text style={{ color: 'rgba(255,255,255,0.72)' }}>门户账号状态</Text>
                                </Space>
                                <div>
                                    <div style={{ fontSize: 28, fontWeight: 800 }}>{session?.mailboxUser.status || 'ACTIVE'}</div>
                                    <Text style={{ color: 'rgba(255,255,255,0.72)' }}>
                                        上次登录：{session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : '首次登录或暂无记录'}
                                    </Text>
                                </div>
                                <div style={{ display: 'grid', gap: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text style={{ color: 'rgba(255,255,255,0.72)' }}>可访问邮箱</Text><Text style={{ color: '#fff' }}>{mailboxes.length}</Text></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text style={{ color: 'rgba(255,255,255,0.72)' }}>未读消息</Text><Text style={{ color: '#fff' }}>{unreadTotal}</Text></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text style={{ color: 'rgba(255,255,255,0.72)' }}>转发已开启</Text><Text style={{ color: '#fff' }}>{forwardingEnabledCount}</Text></div>
                                </div>
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </Card>

            {session?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    message="检测到当前门户账号仍处于首次密码状态"
                    description="建议先进入设置中心更新密码，再继续收发和配置转发。"
                />
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}><StatCard title="可访问邮箱" value={mailboxes.length} icon={<MailOutlined />} iconBgColor="#5865f2" loading={loading} /></Col>
                <Col xs={12} md={6}><StatCard title="未读邮件" value={unreadTotal} icon={<InboxOutlined />} iconBgColor="#0f766e" loading={loading} /></Col>
                <Col xs={12} md={6}><StatCard title="可发件邮箱" value={sendEnabledCount} icon={<SendOutlined />} iconBgColor="#d97706" loading={loading} /></Col>
                <Col xs={12} md={6}><StatCard title="转发已开启" value={forwardingEnabledCount} icon={<ArrowRightOutlined />} iconBgColor="#7c3aed" loading={loading} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={15}>
                    <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 24 } }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>最近未读邮件</Title>
                                <Text type="secondary">优先展示仍未处理的最新入站消息，方便快速看验证码和路由。</Text>
                            </div>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
                            ) : recentUnread.length === 0 ? (
                                <Empty description="当前没有未读邮件" />
                            ) : (
                                <List
                                    dataSource={recentUnread}
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
                                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                        <Text type="secondary">来自 {item.fromAddress} · 送达 {item.mailbox?.address || '-'}</Text>
                                                        <Text type="secondary">{new Date(item.receivedAt).toLocaleString()}</Text>
                                                        <Paragraph ellipsis={{ rows: 2, expandable: false }} style={{ marginBottom: 0 }}>
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
                    </Card>
                </Col>

                <Col xs={24} xl={9}>
                    <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 24 } }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>邮箱资源速览</Title>
                                <Text type="secondary">先看哪些邮箱能发件、哪些启用了转发、哪些只是收件域。</Text>
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>如果你主要是收验证码，优先关注“仅收件”邮箱；如果要主动发信，再挑“可发件”邮箱进入工作区。</Text>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
                            ) : mailboxHighlights.length === 0 ? (
                                <Empty description="当前没有可访问邮箱" />
                            ) : (
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    {mailboxHighlights.map((item) => (
                                        <div
                                            key={item.id}
                                            style={{
                                                borderRadius: 18,
                                                padding: 16,
                                                background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                                                border: '1px solid rgba(148, 163, 184, 0.16)',
                                            }}
                                        >
                                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                <div>
                                                    <Text strong>{item.address}</Text>
                                                    <div><Text type="secondary">域名：{item.domain?.name || '-'}</Text></div>
                                                </div>
                                                <Space wrap>
                                                    <Tag color={item.domain?.canSend ? 'success' : 'default'}>{item.domain?.canSend ? '可发件' : '仅收件'}</Tag>
                                                    <Tag color={item.forwardMode && item.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
                                                        {item.forwardMode && item.forwardMode !== 'DISABLED' ? `转发 ${item.forwardMode}` : '未转发'}
                                                    </Tag>
                                                    {item.isCatchAllTarget ? <Tag color="gold">Catch-all 目标</Tag> : null}
                                                </Space>
                                            </Space>
                                        </div>
                                    ))}
                                    {mailboxes.length > mailboxHighlights.length ? (
                                        <Text type="secondary">还有 {mailboxes.length - mailboxHighlights.length} 个邮箱，可在收/发件工作区或设置中心查看全部。</Text>
                                    ) : null}
                                </Space>
                            )}
                        </Space>
                    </Card>

                    <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)', marginTop: 16 }} styles={{ body: { padding: 24 } }}>
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Title level={5} style={{ margin: 0 }}>操作建议</Title>
                            <Text type="secondary">当前你有 {sendEnabledCount} 个可发件邮箱，{receiveOnlyCount} 个收件专用邮箱。</Text>
                            <Text type="secondary">如果要做验证码处理，优先进入收/发件工作区；如果要改转发或密码，直接去设置中心。</Text>
                        </Space>
                    </Card>
                </Col>
            </Row>
        </Space>
    );
};

export default MailPortalOverviewPage;

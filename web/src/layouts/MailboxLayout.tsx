import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Typography, Space, Dropdown, Avatar, Button, Tag, Card } from 'antd';
import type { MenuProps } from 'antd';
import { AppstoreOutlined, InboxOutlined, SettingOutlined, LogoutOutlined, MailOutlined, ThunderboltOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../api';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const menuItems: MenuProps['items'] = [
    { key: '/mail/overview', icon: <AppstoreOutlined />, label: <Link to="/mail/overview">门户工作台</Link> },
    { key: '/mail/inbox', icon: <InboxOutlined />, label: <Link to="/mail/inbox">收/发件工作区</Link> },
    { key: '/mail/settings', icon: <SettingOutlined />, label: <Link to="/mail/settings">设置中心</Link> },
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
    '/mail/overview': { title: '门户工作台', subtitle: '查看邮箱资源、最近未读、转发状态和下一步动作。' },
    '/mail/inbox': { title: '收/发件工作区', subtitle: '按邮箱查看收件、发件和验证码，必要时直接发信。' },
    '/mail/settings': { title: '设置中心', subtitle: '管理密码、安全提醒和邮箱转发策略。' },
};

const MailboxLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { mailboxUser, clearAuth } = useMailboxAuthStore();

    const assignedMailboxCount = mailboxUser?.mailboxIds?.length || 0;
    const currentPage = pageTitles[location.pathname] || pageTitles['/mail/overview'];

    const handleLogout = async () => {
        try {
            await mailboxPortalApi.logout();
        } catch (error) {
            console.warn('Mailbox portal logout request failed:', error);
        }
        clearAuth();
        navigate('/mail/login');
    };

    const userMenuItems: MenuProps['items'] = [
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: '退出登录',
            onClick: handleLogout,
            danger: true,
        },
    ];

    return (
        <Layout style={{ minHeight: '100vh', background: '#eef4fb' }}>
            <Sider
                theme="dark"
                width={260}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'linear-gradient(180deg, #0f172a 0%, #111827 52%, #1e293b 100%)',
                    borderRight: '1px solid rgba(148, 163, 184, 0.18)',
                    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
                }}
            >
                <div style={{ padding: 24, borderBottom: '1px solid rgba(148, 163, 184, 0.16)' }}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Space align="center">
                            <div
                                style={{
                                    width: 42,
                                    height: 42,
                                    borderRadius: 14,
                                    background: 'linear-gradient(135deg, #5865f2 0%, #2dd4bf 100%)',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 20,
                                    boxShadow: '0 12px 28px rgba(88, 101, 242, 0.25)',
                                }}
                            >
                                <MailOutlined />
                            </div>
                            <div>
                                <Title level={4} style={{ margin: 0, color: '#f8fafc' }}>Mailbox Portal</Title>
                                <Text style={{ color: 'rgba(255,255,255,0.72)' }}>你的域名邮箱工作台</Text>
                            </div>
                        </Space>

                        <Card
                            bordered={false}
                            style={{ background: 'rgba(15, 23, 42, 0.55)' }}
                            styles={{ body: { padding: 16 } }}
                        >
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                <Space wrap>
                                    <Tag color="blue">{assignedMailboxCount} 个邮箱</Tag>
                                    {mailboxUser?.mustChangePassword ? <Tag color="warning">需改密码</Tag> : <Tag color="success">安全状态正常</Tag>}
                                </Space>
                                <div>
                                    <Text style={{ color: 'rgba(255,255,255,0.64)' }}>当前门户用户</Text>
                                    <div style={{ color: '#fff', fontWeight: 700, marginTop: 4 }}>{mailboxUser?.username || 'Mailbox User'}</div>
                                    {mailboxUser?.email ? <Text style={{ color: 'rgba(255,255,255,0.72)' }}>{mailboxUser.email}</Text> : null}
                                </div>
                            </Space>
                        </Card>
                    </Space>
                </div>

                <Menu
                    mode="inline"
                    selectedKeys={[location.pathname]}
                    items={menuItems}
                    theme="dark"
                    style={{ marginTop: 12, borderRight: 0, background: 'transparent' }}
                />

                <div style={{ padding: 20, marginTop: 'auto' }}>
                    <Card
                        bordered={false}
                        style={{ background: 'rgba(255,255,255,0.06)' }}
                        styles={{ body: { padding: 16 } }}
                    >
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Space>
                                <ThunderboltOutlined style={{ color: '#2dd4bf' }} />
                                <Text strong style={{ color: '#f8fafc' }}>门户提示</Text>
                            </Space>
                            <Text style={{ color: 'rgba(255,255,255,0.72)' }}>优先从“门户工作台”判断未读和可发件邮箱，再进入收/发件工作区处理邮件。</Text>
                            {mailboxUser?.mustChangePassword ? (
                                <Space>
                                    <SafetyCertificateOutlined style={{ color: '#fbbf24' }} />
                                    <Text style={{ color: '#fde68a' }}>检测到首次密码状态，建议先去设置中心更新密码。</Text>
                                </Space>
                            ) : null}
                        </Space>
                    </Card>
                </div>
            </Sider>

            <Layout>
                <Header
                    style={{
                        background: 'rgba(255,255,255,0.86)',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 28px',
                        height: 72,
                        lineHeight: '72px',
                        backdropFilter: 'blur(12px)',
                    }}
                >
                    <div>
                        <Title level={4} style={{ margin: 0 }}>{currentPage.title}</Title>
                        <Text type="secondary">{currentPage.subtitle}</Text>
                    </div>

                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                        <Button type="text" style={{ height: 'auto', paddingInline: 12 }}>
                            <Space>
                                <Avatar size="small" style={{ background: 'linear-gradient(135deg, #5865f2 0%, #0ea5e9 100%)' }}>
                                    {(mailboxUser?.username || 'M').slice(0, 1).toUpperCase()}
                                </Avatar>
                                <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                                    <div>{mailboxUser?.username || 'Mailbox User'}</div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{assignedMailboxCount} 个可访问邮箱</Text>
                                </div>
                            </Space>
                        </Button>
                    </Dropdown>
                </Header>

                <Content style={{ padding: 24 }}>
                    <div
                        style={{
                            minHeight: 'calc(100vh - 120px)',
                            borderRadius: 28,
                            background: 'rgba(255,255,255,0.9)',
                            border: '1px solid rgba(148, 163, 184, 0.12)',
                            boxShadow: '0 28px 56px rgba(15, 23, 42, 0.08)',
                            padding: 28,
                        }}
                    >
                        <Outlet />
                    </div>
                </Content>
            </Layout>
        </Layout>
    );
};

export default MailboxLayout;

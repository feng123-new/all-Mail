import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Typography, Space, Dropdown, Avatar, Button } from 'antd';
import type { MenuProps } from 'antd';
import { InboxOutlined, SettingOutlined, LogoutOutlined, MailOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../api';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems: MenuProps['items'] = [
    { key: '/mail/inbox', icon: <InboxOutlined />, label: <Link to="/mail/inbox">收/发件箱</Link> },
    { key: '/mail/settings', icon: <SettingOutlined />, label: <Link to="/mail/settings">邮箱设置</Link> },
];

const MailboxLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { mailboxUser, clearAuth } = useMailboxAuthStore();

    const handleLogout = async () => {
        try {
            await mailboxPortalApi.logout();
        } catch {
            // ignore logout network errors
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
        <Layout style={{ minHeight: '100vh' }}>
            <Sider theme="light" width={220} style={{ borderRight: '1px solid #f0f0f0' }}>
                <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
                    <Space>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#722ed1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                            <MailOutlined />
                        </div>
                        <Text strong>Domain Mail</Text>
                    </Space>
                </div>
                <Menu mode="inline" selectedKeys={[location.pathname]} items={menuItems} style={{ marginTop: 8, borderRight: 0 }} />
            </Sider>
            <Layout>
                <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
                    <div>
                        <Text strong>邮箱门户</Text>
                    </div>
                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                        <Button type="text">
                            <Space>
                                <Avatar size="small" style={{ background: '#722ed1' }}>
                                    {(mailboxUser?.username || 'M').slice(0, 1).toUpperCase()}
                                </Avatar>
                                <span>{mailboxUser?.username || 'Mailbox User'}</span>
                            </Space>
                        </Button>
                    </Dropdown>
                </Header>
                <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
};

export default MailboxLayout;

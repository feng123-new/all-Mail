import { useState, type FC } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
    Layout,
    Menu,
    Avatar,
    Dropdown,
    theme,
    Typography,
    Space,
    Breadcrumb,
    Button,
} from 'antd';
import type { MenuProps } from 'antd';
import {
    DashboardOutlined,
    UserOutlined,
    TeamOutlined,
    KeyOutlined,
    MailOutlined,
    CloudServerOutlined,
    InboxOutlined,
    MessageOutlined,
    SendOutlined,
    SettingOutlined,
    LogoutOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    FileTextOutlined,
    HistoryOutlined,
} from '@ant-design/icons';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api';
import { isSuperAdmin } from '../utils/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuConfig = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '控制台概览', title: '控制台概览' },
    { key: '/emails', icon: <MailOutlined />, label: '外部邮箱连接', title: '外部邮箱连接' },
    { key: '/domains', icon: <CloudServerOutlined />, label: '域名', title: '域名' },
    { key: '/domain-mailboxes', icon: <InboxOutlined />, label: '域名邮箱', title: '域名邮箱' },
    { key: '/mailbox-users', icon: <TeamOutlined />, label: '门户用户', title: '门户用户' },
    { key: '/domain-messages', icon: <MessageOutlined />, label: '域名消息', title: '域名消息' },
    { key: '/sending-configs', icon: <SendOutlined />, label: '发信配置', title: '发信配置' },
    { key: '/api-keys', icon: <KeyOutlined />, label: '访问密钥', title: '访问密钥与资源范围' },
    { key: '/api-docs', icon: <FileTextOutlined />, label: 'API 文档', title: 'API 文档' },
    { key: '/operation-logs', icon: <HistoryOutlined />, label: '操作日志', title: '操作日志' },
    { key: '/admins', icon: <UserOutlined />, label: '管理员', title: '管理员管理', superAdmin: true },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置', title: '系统设置' },
];

const MainLayout: FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { admin, clearAuth } = useAuthStore();
    const { token } = theme.useToken();

    const hasSuperAdminPermission = isSuperAdmin(admin?.role);
    const displayName = admin?.username?.trim() || 'Admin';
    const avatarText = displayName.charAt(0).toUpperCase();
    const menuItems: MenuProps['items'] = menuConfig
        .filter((item) => !item.superAdmin || hasSuperAdminPermission)
        .map((item) => ({
            key: item.key,
            icon: item.icon,
            label: <Link to={item.key}>{item.label}</Link>,
        }));

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch {
            // ignore
        }
        clearAuth();
        navigate('/login');
    };

    const userMenuItems: MenuProps['items'] = [
        {
            key: 'profile',
            icon: <UserOutlined />,
            label: '个人设置',
            onClick: () => navigate('/settings'),
        },
        { type: 'divider' },
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: '退出登录',
            danger: true,
            onClick: handleLogout,
        },
    ];

    const currentMenu = menuConfig.find((item) => location.pathname.startsWith(item.key));
    const pageTitle = currentMenu?.title || '控制台';

    const selectedKeys = menuConfig
        .filter((item) => location.pathname.startsWith(item.key))
        .map((item) => item.key);

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider
                trigger={null}
                collapsible
                collapsed={collapsed}
                theme="dark"
                width={208}
                style={{
                    overflow: 'auto',
                    height: '100vh',
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    background: 'linear-gradient(180deg, #0f172a 0%, #111827 52%, #1e293b 100%)',
                    borderRight: '1px solid rgba(148, 163, 184, 0.18)',
                    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
                }}
            >
                <div
                    style={{
                        height: 64,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
                    }}
                >
                    <Space>
                        <div
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 10,
                                background: 'linear-gradient(135deg, #5865f2 0%, #2dd4bf 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontWeight: 700,
                                boxShadow: '0 10px 24px rgba(88, 101, 242, 0.28)',
                            }}
                        >
                            {APP_SHORT_NAME}
                        </div>
                        {!collapsed && (
                            <Text strong style={{ fontSize: 16, color: '#f8fafc', letterSpacing: 0.3 }}>{APP_NAME}</Text>
                        )}
                    </Space>
                </div>
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={selectedKeys}
                    items={menuItems}
                    style={{ borderRight: 0, marginTop: 12, background: 'transparent' }}
                />
            </Sider>

            <Layout style={{ marginLeft: collapsed ? 80 : 208, transition: 'margin-left 0.2s ease' }}>
                <Header
                    style={{
                        padding: '0 24px',
                        background: 'rgba(255, 255, 255, 0.86)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                        height: 56,
                        lineHeight: '56px',
                        backdropFilter: 'blur(12px)',
                    }}
                >
                    <Space>
                        <Button
                            type="text"
                            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
                            onClick={() => setCollapsed(!collapsed)}
                            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            style={{ fontSize: 16, color: '#475569' }}
                        />
                        <Breadcrumb
                            items={[
                                { title: '控制台' },
                                { title: pageTitle },
                            ]}
                            style={{ marginLeft: 16 }}
                        />
                    </Space>

                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                        <Space style={{ cursor: 'pointer' }}>
                            <Avatar size="small" style={{ background: 'linear-gradient(135deg, #5865f2 0%, #0ea5e9 100%)' }}>
                                {avatarText}
                            </Avatar>
                            <Text>{displayName}</Text>
                        </Space>
                    </Dropdown>
                </Header>

                <Content
                    style={{
                        margin: 24,
                        padding: 24,
                        background: 'rgba(255, 255, 255, 0.92)',
                        borderRadius: token.borderRadiusLG,
                        minHeight: 'calc(100vh - 56px - 48px)',
                        boxShadow: '0 24px 48px rgba(15, 23, 42, 0.06)',
                    }}
                >
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
};

export default MainLayout;

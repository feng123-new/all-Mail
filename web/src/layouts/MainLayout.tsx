import {
    CloudServerOutlined,
    DashboardOutlined,
    FileTextOutlined,
    HistoryOutlined,
    InboxOutlined,
    KeyOutlined,
    LogoutOutlined,
    MailOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    MessageOutlined,
    SendOutlined,
    SettingOutlined,
    SwapOutlined,
    TeamOutlined,
    UserOutlined,
} from '@ant-design/icons';
import {
    Avatar,
    Button,
    Dropdown,
    Layout,
    Menu,
    type MenuProps,
    Space,
    Tag,
    Typography,
} from 'antd';
import { type FC, useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api';
import { LanguageToggle, PageSurface } from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
import { mainLayoutI18n } from '../i18n/catalog/shell';
import { useI18n } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import {
    contentFrameStyle,
    createBrandMarkStyle,
    fixedSidebarStyle,
    shellHeaderContextStyle,
    shellHeaderLabelStyle,
    shellHeaderStyle,
    shellLayoutStyle,
    shellUserTriggerStyle,
} from '../styles/common';
import { shellMetrics, shellMotion, shellPalette } from '../theme';
import { isSuperAdmin } from '../utils/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuConfig = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: mainLayoutI18n.dashboard.label, title: mainLayoutI18n.dashboard.title, subtitle: mainLayoutI18n.dashboard.subtitle },
    { key: '/emails', icon: <MailOutlined />, label: mainLayoutI18n.emails.label, title: mainLayoutI18n.emails.title, subtitle: mainLayoutI18n.emails.subtitle },
    { key: '/domains', icon: <CloudServerOutlined />, label: mainLayoutI18n.domains.label, title: mainLayoutI18n.domains.title, subtitle: mainLayoutI18n.domains.subtitle },
    { key: '/domain-mailboxes', icon: <InboxOutlined />, label: mainLayoutI18n.domainMailboxes.label, title: mainLayoutI18n.domainMailboxes.title, subtitle: mainLayoutI18n.domainMailboxes.subtitle },
    { key: '/mailbox-users', icon: <TeamOutlined />, label: mainLayoutI18n.mailboxUsers.label, title: mainLayoutI18n.mailboxUsers.title, subtitle: mainLayoutI18n.mailboxUsers.subtitle },
    { key: '/domain-messages', icon: <MessageOutlined />, label: mainLayoutI18n.domainMessages.label, title: mainLayoutI18n.domainMessages.title, subtitle: mainLayoutI18n.domainMessages.subtitle },
    { key: '/forwarding-jobs', icon: <SwapOutlined />, label: mainLayoutI18n.forwardingJobs.label, title: mainLayoutI18n.forwardingJobs.title, subtitle: mainLayoutI18n.forwardingJobs.subtitle },
    { key: '/sending-configs', icon: <SendOutlined />, label: mainLayoutI18n.sendingConfigs.label, title: mainLayoutI18n.sendingConfigs.title, subtitle: mainLayoutI18n.sendingConfigs.subtitle },
    { key: '/api-keys', icon: <KeyOutlined />, label: mainLayoutI18n.apiKeys.label, title: mainLayoutI18n.apiKeys.title, subtitle: mainLayoutI18n.apiKeys.subtitle },
    { key: '/api-docs', icon: <FileTextOutlined />, label: mainLayoutI18n.apiDocs.label, title: mainLayoutI18n.apiDocs.title, subtitle: mainLayoutI18n.apiDocs.subtitle },
    { key: '/operation-logs', icon: <HistoryOutlined />, label: mainLayoutI18n.operationLogs.label, title: mainLayoutI18n.operationLogs.title, subtitle: mainLayoutI18n.operationLogs.subtitle },
    { key: '/admins', icon: <UserOutlined />, label: mainLayoutI18n.admins.label, title: mainLayoutI18n.admins.title, subtitle: mainLayoutI18n.admins.subtitle, superAdmin: true },
    { key: '/settings', icon: <SettingOutlined />, label: mainLayoutI18n.settings.label, title: mainLayoutI18n.settings.title, subtitle: mainLayoutI18n.settings.subtitle },
];

const MainLayout: FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const { admin, clearAuth } = useAuthStore();
    const mustChangePassword = Boolean(admin?.mustChangePassword);

    const hasSuperAdminPermission = isSuperAdmin(admin?.role);
    const displayName = admin?.username?.trim() || t(mainLayoutI18n.admin);
    const avatarText = displayName.charAt(0).toUpperCase();
    const menuItems: MenuProps['items'] = menuConfig
        .filter((item) => !item.superAdmin || hasSuperAdminPermission)
        .map((item) => ({
            key: item.key,
            icon: item.icon,
            disabled: mustChangePassword && item.key !== '/settings',
            label: <Link to={item.key}>{t(item.label)}</Link>,
        }));

    const handleLogout = useCallback(async () => {
        try {
            await authApi.logout();
        } catch {
            // ignore
        }
        clearAuth();
        navigate('/login');
    }, [clearAuth, navigate]);

    const userMenuItems: MenuProps['items'] = useMemo(() => [
        {
            key: 'profile',
            icon: <UserOutlined />,
            label: t(mainLayoutI18n.profile),
            onClick: () => navigate('/settings'),
        },
        { type: 'divider' as const },
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: t(mainLayoutI18n.logout),
            danger: true,
            onClick: handleLogout,
        },
    ], [handleLogout, navigate, t]);

    const selectedKeys = menuConfig
        .filter((item) => location.pathname.startsWith(item.key))
        .map((item) => item.key);
    return (
        <Layout style={shellLayoutStyle}>
            <Sider
                trigger={null}
                collapsible
                collapsed={collapsed}
                theme="light"
                width={shellMetrics.adminSidebarWidth}
                style={{
                    ...fixedSidebarStyle,
                    width: collapsed ? shellMetrics.adminSidebarCollapsedWidth : shellMetrics.adminSidebarWidth,
                }}
            >
                <div
                    style={{
                        height: 72,
                        paddingInline: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
                    }}
                >
                    <Space size={12}>
                        <div style={createBrandMarkStyle({ size: 32, radius: 10, fontSize: 14 })}>
                            {APP_SHORT_NAME}
                        </div>
                        {!collapsed && (
                            <Space orientation="vertical" size={0}>
                                <Text strong style={{ fontSize: 16, color: shellPalette.sidebarText, letterSpacing: 0.2 }}>{APP_NAME}</Text>
                                <Text style={{ fontSize: 12, color: shellPalette.sidebarMuted }}>{t(mainLayoutI18n.controlPlane)}</Text>
                            </Space>
                        )}
                    </Space>
                </div>

                <div style={{ padding: collapsed ? '12px 8px 20px' : '14px 10px 20px' }}>
                    {!collapsed ? (
                        <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: shellPalette.muted, paddingInline: 10, marginBottom: 8 }}>
                            {t(mainLayoutI18n.navigation)}
                        </Text>
                    ) : null}
                    <Menu
                        theme="light"
                        mode="inline"
                        selectedKeys={selectedKeys}
                        items={menuItems}
                        style={{ borderRight: 0, background: 'transparent' }}
                    />
                </div>
            </Sider>

                <Layout style={{ marginLeft: collapsed ? shellMetrics.adminSidebarCollapsedWidth : shellMetrics.adminSidebarWidth, transition: `margin-left ${shellMotion.standard}`, background: 'transparent' }}>
                <Header
                    style={shellHeaderStyle}
                >
                    <Space size={12} align="center">
                        <Button
                            type="text"
                            aria-label={collapsed ? t(mainLayoutI18n.expandSidebar) : t(mainLayoutI18n.collapseSidebar)}
                            onClick={() => setCollapsed(!collapsed)}
                            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            style={{ fontSize: 16, color: shellPalette.inkSoft }}
                        />
                        <div style={shellHeaderContextStyle}>
                            <div style={shellHeaderLabelStyle}>{t(mainLayoutI18n.adminWorkspace)}</div>
                        </div>
                    </Space>

                    <Space size={12}>
                        <LanguageToggle />
                        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                            <Space style={shellUserTriggerStyle}>
                                <Avatar size="small" style={{ background: shellPalette.primary }}>
                                    {avatarText}
                                </Avatar>
                                <div style={{ lineHeight: 1.15 }}>
                                    <div style={{ color: shellPalette.ink }}>{displayName}</div>
                                    <Text style={{ fontSize: 12, color: shellPalette.muted }}>{hasSuperAdminPermission ? t(mainLayoutI18n.superAdmin) : t(mainLayoutI18n.admin)}</Text>
                                </div>
                                {mustChangePassword ? <Tag color="warning" style={{ marginInlineStart: 0 }}>{t(mainLayoutI18n.passwordResetRequired)}</Tag> : null}
                            </Space>
                        </Dropdown>
                    </Space>
                </Header>

                <Content
                    style={{
                        ...contentFrameStyle,
                        minHeight: `calc(100vh - ${shellMetrics.headerHeight}px)`,
                        background: 'transparent',
                    }}
                >
                    <PageSurface>
                        <Outlet />
                    </PageSurface>
                </Content>
            </Layout>
        </Layout>
    );
};

export default MainLayout;

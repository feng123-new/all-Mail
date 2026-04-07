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
import { type FC, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api';
import { PageSurface } from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
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
    { key: '/dashboard', icon: <DashboardOutlined />, label: '控制台概览', title: '控制台概览', subtitle: '总览连接健康度、域名邮箱运行态和自动化热度。' },
    { key: '/emails', icon: <MailOutlined />, label: '外部邮箱连接', title: '外部邮箱连接', subtitle: '管理 OAuth、IMAP / SMTP 与外部邮箱接入能力。' },
    { key: '/domains', icon: <CloudServerOutlined />, label: '域名', title: '域名', subtitle: '查看域名收发状态、验证进度与基础配置。' },
    { key: '/domain-mailboxes', icon: <InboxOutlined />, label: '域名邮箱', title: '域名邮箱', subtitle: '集中管理门户邮箱、批次与分配状态。' },
    { key: '/mailbox-users', icon: <TeamOutlined />, label: '门户用户', title: '门户用户', subtitle: '管理门户访问人、邮箱归属和登录状态。' },
    { key: '/domain-messages', icon: <MessageOutlined />, label: '域名消息', title: '域名消息', subtitle: '追踪入站消息、路由结果与可见性。' },
    { key: '/forwarding-jobs', icon: <SwapOutlined />, label: '转发任务', title: '转发任务', subtitle: '查看 forwarding job 状态、失败原因和下一次重试时间。' },
    { key: '/sending-configs', icon: <SendOutlined />, label: '发信配置', title: '发信配置', subtitle: '配置域名发信能力、默认 From 和发送路径。' },
    { key: '/api-keys', icon: <KeyOutlined />, label: '访问密钥', title: '访问密钥与资源范围', subtitle: '约束自动化调用范围、速率和资源边界。' },
    { key: '/api-docs', icon: <FileTextOutlined />, label: 'API 文档', title: 'API 文档', subtitle: '面向脚本、服务和集成方的调用入口。' },
    { key: '/operation-logs', icon: <HistoryOutlined />, label: '操作日志', title: '操作日志', subtitle: '审计关键动作、调用轨迹与异常处理。' },
    { key: '/admins', icon: <UserOutlined />, label: '管理员', title: '管理员管理', subtitle: '管理后台管理员权限与安全策略。', superAdmin: true },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置', title: '系统设置', subtitle: '维护全局配置、安全与平台默认行为。' },
];

const MainLayout: FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { admin, clearAuth } = useAuthStore();
    const mustChangePassword = Boolean(admin?.mustChangePassword);

    const hasSuperAdminPermission = isSuperAdmin(admin?.role);
    const displayName = admin?.username?.trim() || 'Admin';
    const avatarText = displayName.charAt(0).toUpperCase();
    const menuItems: MenuProps['items'] = menuConfig
        .filter((item) => !item.superAdmin || hasSuperAdminPermission)
        .map((item) => ({
            key: item.key,
            icon: item.icon,
            disabled: mustChangePassword && item.key !== '/settings',
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
                                <Text style={{ fontSize: 12, color: shellPalette.sidebarMuted }}>control plane</Text>
                            </Space>
                        )}
                    </Space>
                </div>

                <div style={{ padding: collapsed ? '12px 8px 20px' : '14px 10px 20px' }}>
                    {!collapsed ? (
                        <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: shellPalette.muted, paddingInline: 10, marginBottom: 8 }}>
                            Navigation
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
                            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
                            onClick={() => setCollapsed(!collapsed)}
                            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            style={{ fontSize: 16, color: shellPalette.inkSoft }}
                        />
                        <div style={shellHeaderContextStyle}>
                            <div style={shellHeaderLabelStyle}>Admin workspace</div>
                        </div>
                    </Space>

                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                        <Space style={shellUserTriggerStyle}>
                            <Avatar size="small" style={{ background: shellPalette.primary }}>
                                {avatarText}
                            </Avatar>
                            <div style={{ lineHeight: 1.15 }}>
                                <div style={{ color: shellPalette.ink }}>{displayName}</div>
                                <Text style={{ fontSize: 12, color: shellPalette.muted }}>{hasSuperAdminPermission ? 'Super admin' : 'Admin'}</Text>
                            </div>
                            {mustChangePassword ? <Tag color="warning" style={{ marginInlineStart: 0 }}>需先改密</Tag> : null}
                        </Space>
                    </Dropdown>
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

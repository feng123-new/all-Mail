import { useCallback, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Typography, Space, Dropdown, Avatar, Button } from 'antd';
import type { MenuProps } from 'antd';
import { AppstoreOutlined, InboxOutlined, SettingOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../api';
import { LanguageToggle, PageSurface } from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
import { mailboxLayoutI18n } from '../i18n/catalog/shell';
import { useI18n } from '../i18n';
import { shellMetrics, shellPalette } from '../theme';
import {
    contentFrameStyle,
    createBrandMarkStyle,
    floatingSidebarStyle,
    shellHeaderContextStyle,
    shellHeaderLabelStyle,
    shellHeaderMetaStyle,
    shellHeaderStyle,
    shellLayoutStyle,
    sidebarPanelStyle,
    translucentSidebarPanelStyle,
} from '../styles/common';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const menuItems: Array<{ key: string; icon: ReactNode; label: typeof mailboxLayoutI18n.overview }> = [
    { key: '/mail/overview', icon: <AppstoreOutlined />, label: mailboxLayoutI18n.overview },
    { key: '/mail/inbox', icon: <InboxOutlined />, label: mailboxLayoutI18n.inbox },
    { key: '/mail/settings', icon: <SettingOutlined />, label: mailboxLayoutI18n.settings },
];

const routeMeta = {
    '/mail/overview': mailboxLayoutI18n.overview,
    '/mail/inbox': mailboxLayoutI18n.inbox,
    '/mail/settings': mailboxLayoutI18n.settings,
} as const;

const MailboxLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const { mailboxUser, clearAuth } = useMailboxAuthStore();

    const assignedMailboxCount = mailboxUser?.mailboxIds?.length || 0;
    const mustChangePassword = Boolean(mailboxUser?.mustChangePassword);
    const activeMeta = t(routeMeta[location.pathname as keyof typeof routeMeta] || mailboxLayoutI18n.mailboxPortal);
    const menuItemsWithState: MenuProps['items'] = menuItems.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: <Link to={item.key}>{t(item.label)}</Link>,
        disabled: mustChangePassword && item?.key !== '/mail/settings',
    }));

    const handleLogout = useCallback(async () => {
        try {
            await mailboxPortalApi.logout();
        } catch (error) {
            console.warn('Mailbox portal logout request failed:', error);
        }
        clearAuth();
        navigate('/mail/login');
    }, [clearAuth, navigate]);

    const userMenuItems: MenuProps['items'] = [
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: t(mailboxLayoutI18n.signOut),
            onClick: handleLogout,
            danger: true,
        },
    ];

    return (
        <Layout style={shellLayoutStyle}>
            <Sider
                theme="light"
                width={shellMetrics.portalSidebarWidth}
                style={floatingSidebarStyle}
            >
                <div style={{ padding: 20, borderBottom: `1px solid ${shellPalette.border}` }}>
                    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                        <Space align="center">
                            <div style={createBrandMarkStyle({ size: 38, radius: 12, fontSize: 18 })}>
                                {APP_SHORT_NAME}
                            </div>
                            <div>
                                 <Title level={4} style={{ margin: 0, color: shellPalette.sidebarText }}>{APP_NAME}</Title>
                                <Text style={{ color: shellPalette.sidebarMuted }}>{t(mailboxLayoutI18n.mailboxWorkspace)}</Text>
                            </div>
                        </Space>

                        <div style={sidebarPanelStyle}>
                            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                                <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.3, textTransform: 'uppercase', color: shellPalette.muted }}>{t(mailboxLayoutI18n.mailboxAccess)}</Text>
                                <Text strong style={{ color: shellPalette.ink }}>{t(mailboxLayoutI18n.accessibleMailboxCount, { count: assignedMailboxCount })}</Text>
                                <Text style={{ color: shellPalette.inkSoft }}>{mailboxUser?.mustChangePassword ? t(mailboxLayoutI18n.passwordUpdateRequired) : t(mailboxLayoutI18n.securityHealthy)}</Text>
                            </Space>
                        </div>
                    </Space>
                </div>

                <div style={{ padding: '14px 10px 20px' }}>
                    <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: shellPalette.muted, paddingInline: 10, marginBottom: 8 }}>
                        {t(mailboxLayoutI18n.workspace)}
                    </Text>
                    <Menu
                        mode="inline"
                        selectedKeys={[location.pathname]}
                        items={menuItemsWithState}
                        theme="light"
                        style={{ borderRight: 0, background: 'transparent' }}
                    />
                </div>

                {mailboxUser?.mustChangePassword ? (
                    <div style={{ padding: 20, marginTop: 'auto' }}>
                        <div style={translucentSidebarPanelStyle}>
                            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                                <Space>
                                     <SafetyCertificateOutlined style={{ color: shellPalette.warning }} />
                                    <Text strong style={{ color: shellPalette.ink }}>{t(mailboxLayoutI18n.updatePasswordFirst)}</Text>
                                </Space>
                                <Text style={{ color: shellPalette.inkSoft }}>{t(mailboxLayoutI18n.updatePasswordHint)}</Text>
                            </Space>
                        </div>
                    </div>
                ) : null}
            </Sider>

            <Layout>
                <Header
                    style={shellHeaderStyle}
                >
                    <div style={shellHeaderContextStyle}>
                        <Text style={shellHeaderLabelStyle}>{t(mailboxLayoutI18n.mailboxPortal)}</Text>
                        <Text type="secondary" style={shellHeaderMetaStyle}>{activeMeta}</Text>
                    </div>

                    <Space size={12}>
                        <LanguageToggle />
                        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                            <Button type="text" style={{ height: 'auto', padding: 0, borderRadius: 14 }}>
                                <Space>
                                    <Avatar size="small" style={{ background: shellPalette.primary }}>
                                        {(mailboxUser?.username || 'M').slice(0, 1).toUpperCase()}
                                    </Avatar>
                                    <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                                        <div>{mailboxUser?.username || t(mailboxLayoutI18n.mailboxUser)}</div>
                                        <Text type="secondary" style={{ fontSize: 12 }}>{t(mailboxLayoutI18n.accessibleMailboxCount, { count: assignedMailboxCount })}</Text>
                                    </div>
                                </Space>
                            </Button>
                        </Dropdown>
                    </Space>
                </Header>

                <Content style={{ ...contentFrameStyle, minHeight: `calc(100vh - ${shellMetrics.headerHeight}px)`, background: 'transparent' }}>
                    <PageSurface maxWidth={shellMetrics.portalContentMaxWidth}>
                        <Outlet />
                    </PageSurface>
                </Content>
            </Layout>
        </Layout>
    );
};

export default MailboxLayout;

import { useCallback, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Typography, Space, Dropdown, Avatar, Button } from 'antd';
import type { MenuProps } from 'antd';
import { AppstoreOutlined, InboxOutlined, SettingOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../api';
import { LanguageToggle, PageSurface } from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
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

const menuItems: Array<{ key: string; icon: ReactNode; label: string }> = [
    { key: '/mail/overview', icon: <AppstoreOutlined />, label: '门户工作台' },
    { key: '/mail/inbox', icon: <InboxOutlined />, label: '收/发件工作区' },
    { key: '/mail/settings', icon: <SettingOutlined />, label: '设置中心' },
];

const routeMeta: Record<string, string> = {
    '/mail/overview': '门户工作台',
    '/mail/inbox': '收 / 发件工作区',
    '/mail/settings': '设置中心',
};

const MailboxLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const { mailboxUser, clearAuth } = useMailboxAuthStore();

    const assignedMailboxCount = mailboxUser?.mailboxIds?.length || 0;
    const mustChangePassword = Boolean(mailboxUser?.mustChangePassword);
    const activeMeta = t(routeMeta[location.pathname] || '邮箱门户');
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
            label: t('退出登录'),
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
                                <Text style={{ color: shellPalette.sidebarMuted }}>{t('mailbox workspace')}</Text>
                            </div>
                        </Space>

                        <div style={sidebarPanelStyle}>
                            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                                <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.3, textTransform: 'uppercase', color: shellPalette.muted }}>{t('Mailbox access')}</Text>
                                <Text strong style={{ color: shellPalette.ink }}>{t(`${assignedMailboxCount} 个可访问邮箱`)}</Text>
                                <Text style={{ color: shellPalette.inkSoft }}>{mailboxUser?.mustChangePassword ? t('当前账号需要先更新密码') : t('当前账号安全状态正常')}</Text>
                            </Space>
                        </div>
                    </Space>
                </div>

                <div style={{ padding: '14px 10px 20px' }}>
                    <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: shellPalette.muted, paddingInline: 10, marginBottom: 8 }}>
                        {t('Workspace')}
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
                                    <Text strong style={{ color: shellPalette.ink }}>{t('需要先更新密码')}</Text>
                                </Space>
                                <Text style={{ color: shellPalette.inkSoft }}>{t('当前账号仍处于首次密码状态，建议先去设置中心更新密码。')}</Text>
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
                        <Text style={shellHeaderLabelStyle}>{t('邮箱门户')}</Text>
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
                                        <div>{mailboxUser?.username || t('Mailbox User')}</div>
                                        <Text type="secondary" style={{ fontSize: 12 }}>{t(`${assignedMailboxCount} 个可访问邮箱`)}</Text>
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

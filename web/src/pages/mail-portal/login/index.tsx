import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Form, Input, message } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { AuthSplitLayout } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { useI18n } from '../../../i18n';
import { defineMessage } from '../../../i18n/messages';
import { type MailboxUser, useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { noMarginBottomStyle } from '../../../styles/common';
import { getErrorMessage } from '../../../utils/error';

const PORTAL_LOGIN_PREFILL_PREFIX = 'all-mail:portal-login:';

const mailPortalLoginI18n = {
    mailboxPortalTag: defineMessage('mailPortalLogin.tag.mailboxPortal', '邮箱门户', 'Mailbox portal'),
    userWorkspaceTag: defineMessage('mailPortalLogin.tag.userWorkspace', '用户工作区', 'User workspace'),
    title: defineMessage('mailPortalLogin.title', '邮箱门户', 'Mailbox portal'),
    subtitle: defineMessage('mailPortalLogin.subtitle', '给邮箱用户一个稳定、清晰的入口：先确认未读与可访问邮箱，再进入收 / 发件工作区处理具体任务。', 'Give mailbox users a clear, stable entry point: confirm unread mail and accessible mailboxes first, then move into the inbox workspace for detail work.'),
    featureMailboxTitle: defineMessage('mailPortalLogin.feature.mailboxTitle', '邮箱资源集中查看', 'Mailbox resources at a glance'),
    featureMailboxDescription: defineMessage('mailPortalLogin.feature.mailboxDescription', '把可访问邮箱、未读状态和主要工作入口收进同一屏。', 'Keep accessible mailboxes, unread state, and the main work entry points in one screen.'),
    featureWorkflowTitle: defineMessage('mailPortalLogin.feature.workflowTitle', '收发件共用一个工作面', 'One workspace for inbox and sending'),
    featureWorkflowDescription: defineMessage('mailPortalLogin.feature.workflowDescription', '查看收件、历史发件，并在允许发件时直接开始写信。', 'Review inbox and sent history, then start writing immediately when sending is enabled.'),
    featureSecurityTitle: defineMessage('mailPortalLogin.feature.securityTitle', '安全状态集中处理', 'Security state in one place'),
    featureSecurityDescription: defineMessage('mailPortalLogin.feature.securityDescription', '首次密码提醒、转发策略和门户会话都在设置中心统一维护。', 'First-password reminders, forwarding policy, and portal session state are all maintained in Settings.'),
    notice: defineMessage('mailPortalLogin.notice', '门户用户名支持预填。如果你从管理员后台或用户通知里带了用户名参数进来，登录页会自动帮你填好用户名。', 'Portal usernames support prefill. If you arrive from the admin console or a user notice with a username parameter, the login page fills it automatically.'),
    formTitle: defineMessage('mailPortalLogin.formTitle', '登录邮箱门户', 'Sign in to the mailbox portal'),
    formDescription: defineMessage('mailPortalLogin.formDescription', '默认使用门户用户名 + 密码登录；登录后会直接进入工作台。', 'Use portal username + password by default. After sign-in you go straight to the workspace.'),
    footer: defineMessage('mailPortalLogin.footer', '如果门户账号仍处于首次密码状态，登录后会在工作台和设置中心看到明确提醒。', 'If the portal account is still using the first password, the workspace and Settings will show a clear reminder after sign-in.'),
    usernameLabel: defineMessage('mailPortalLogin.usernameLabel', '门户用户名', 'Portal username'),
    usernameRequired: defineMessage('mailPortalLogin.usernameRequired', '请输入门户用户名', 'Enter the portal username'),
    passwordLabel: defineMessage('mailPortalLogin.passwordLabel', '密码', 'Password'),
    passwordRequired: defineMessage('mailPortalLogin.passwordRequired', '请输入密码', 'Enter a password'),
    formUnavailable: defineMessage('mailPortalLogin.formUnavailable', '当前无法进入邮箱门户', 'Unable to enter the mailbox portal right now'),
    enterWorkspace: defineMessage('mailPortalLogin.enterWorkspace', '进入门户工作台', 'Enter the portal workspace'),
    loginSuccess: defineMessage('mailPortalLogin.loginSuccess', '邮箱门户登录成功', 'Mailbox portal sign-in succeeded'),
    invalidCredentials: defineMessage('mailPortalLogin.invalidCredentials', '门户用户名或密码错误，请检查后重试。', 'The portal username or password is incorrect. Check it and try again.'),
    loginFailed: defineMessage('mailPortalLogin.loginFailed', '邮箱门户登录失败', 'Mailbox portal sign-in failed'),
} as const;

interface PortalLoginPrefillPayload {
    password?: string;
    expiresAt?: number;
}

const MailPortalLoginPage = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setAuth } = useMailboxAuthStore();
    const [loading, setLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [form] = Form.useForm<{ username: string; password: string }>();

    const portalUsername = useMemo(() => searchParams.get('username')?.trim() || '', [searchParams]);

    useEffect(() => {
        const nextValues: { username: string; password?: string } = { username: portalUsername };
        if (portalUsername) {
            const storageKey = `${PORTAL_LOGIN_PREFILL_PREFIX}${portalUsername}`;
            const saved = window.localStorage.getItem(storageKey);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved) as PortalLoginPrefillPayload;
                    if (parsed.expiresAt && parsed.expiresAt > Date.now() && parsed.password) {
                        nextValues.password = parsed.password;
                    } else {
                        window.localStorage.removeItem(storageKey);
                    }
                } catch {
                    window.localStorage.removeItem(storageKey);
                }
            }
        }
        form.setFieldsValue({ username: nextValues.username, password: nextValues.password || '' });
    }, [form, portalUsername]);

    const handleSubmit = async (values: { username: string; password: string }) => {
        setLoading(true);
        try {
            setFormError(null);
            const response = await portalAccountContract.login(values.username, values.password);
            if (response.code === 200) {
                const payload = response.data as { mailboxUser: MailboxUser };
                window.localStorage.removeItem(`${PORTAL_LOGIN_PREFILL_PREFIX}${values.username.trim()}`);
                setAuth(payload.mailboxUser);
                message.success(t(mailPortalLoginI18n.loginSuccess));
                navigate(payload.mailboxUser.mustChangePassword ? '/mail/settings' : '/mail/overview');
            }
        } catch (error) {
            const errCode = String((error as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_CREDENTIALS') {
                setFormError(t(mailPortalLoginI18n.invalidCredentials));
            } else {
                setFormError(getErrorMessage(error, t(mailPortalLoginI18n.loginFailed)));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthSplitLayout
            tags={[
                { key: 'mailbox-portal', color: 'blue', label: t(mailPortalLoginI18n.mailboxPortalTag) },
                { key: 'user-workspace', color: 'cyan', label: t(mailPortalLoginI18n.userWorkspaceTag) },
            ]}
            title={t(mailPortalLoginI18n.title)}
            subtitle={t(mailPortalLoginI18n.subtitle)}
            features={[
                { key: 'mailbox', icon: <MailOutlined />, title: t(mailPortalLoginI18n.featureMailboxTitle), description: t(mailPortalLoginI18n.featureMailboxDescription) },
                { key: 'workflow', icon: <SendOutlined />, title: t(mailPortalLoginI18n.featureWorkflowTitle), description: t(mailPortalLoginI18n.featureWorkflowDescription) },
                { key: 'security', icon: <SafetyCertificateOutlined />, title: t(mailPortalLoginI18n.featureSecurityTitle), description: t(mailPortalLoginI18n.featureSecurityDescription) },
            ]}
            notice={t(mailPortalLoginI18n.notice)}
            formTitle={t(mailPortalLoginI18n.formTitle)}
            formDescription={t(mailPortalLoginI18n.formDescription)}
            footer={t(mailPortalLoginI18n.footer)}
        >
            <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off" onValuesChange={() => { if (formError) setFormError(null); }}>
                <Form.Item label={t(mailPortalLoginI18n.usernameLabel)} name="username" rules={[{ required: true, message: t(mailPortalLoginI18n.usernameRequired) }]}> 
                    <Input prefix={<UserOutlined />} placeholder={t(mailPortalLoginI18n.usernameLabel)} autoComplete="username" size="large" />
                </Form.Item>
                <Form.Item label={t(mailPortalLoginI18n.passwordLabel)} name="password" rules={[{ required: true, message: t(mailPortalLoginI18n.passwordRequired) }]}> 
                    <Input.Password prefix={<LockOutlined />} placeholder={t(mailPortalLoginI18n.passwordLabel)} autoComplete="current-password" size="large" />
                </Form.Item>
                {formError ? (
                    <Alert
                        type="error"
                        showIcon
                        title={t(mailPortalLoginI18n.formUnavailable)}
                        description={formError}
                        style={{ marginBottom: 16 }}
                    />
                ) : null}
                <Form.Item style={noMarginBottomStyle}>
                    <Button type="primary" htmlType="submit" loading={loading} block size="large">
                        {t(mailPortalLoginI18n.enterWorkspace)}
                    </Button>
                </Form.Item>
            </Form>
        </AuthSplitLayout>
    );
};

export default MailPortalLoginPage;

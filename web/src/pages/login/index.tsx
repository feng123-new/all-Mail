import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Modal, Space, Typography, message } from 'antd';
import { ApiOutlined, CloudServerOutlined, LockOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { AuthSplitLayout } from '../../components';
import { portalAccountContract } from '../../contracts/portal/account';
import { authContract } from '../../contracts/shared/auth';
import { APP_CONSOLE_SUBTITLE, APP_NAME } from '../../constants/product';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { useAuthStore } from '../../stores/authStore';
import { useMailboxAuthStore } from '../../stores/mailboxAuthStore';
import { fullWidthStyle, marginBottom16Style, noMarginBottomStyle } from '../../styles/common';
import { getErrorMessage } from '../../utils/error';
import type { Admin } from '../../stores/authStore';
import type { MailboxUser } from '../../stores/mailboxAuthStore';

const { Text } = Typography;

const loginPageI18n = {
    adminConsoleTag: defineMessage('loginPage.adminConsoleTag', '管理员控制台', 'Admin Console'),
    secureAccessTag: defineMessage('loginPage.secureAccessTag', '安全访问', 'Secure access'),
    subtitle: defineMessage('loginPage.subtitle', `${APP_CONSOLE_SUBTITLE}。把外部邮箱连接、域名邮箱、门户用户与自动化入口收进同一个控制面，先看运行态，再进入对象页处理。`, 'Bring external mailbox connections, domain mailboxes, portal users, and automation entry points into one control plane: read the runtime posture first, then move into the detail pages.'),
    featureResourceTitle: defineMessage('loginPage.featureResourceTitle', '统一管理邮件资源', 'Manage mail resources together'),
    featureResourceDescription: defineMessage('loginPage.featureResourceDescription', '把连接、域名邮箱、门户用户和运行态放进同一个管理界面。', 'Bring connections, domain mailboxes, portal users, and runtime posture into one management view.'),
    featureAutomationTitle: defineMessage('loginPage.featureAutomationTitle', '自动化入口可控', 'Automation entry points stay controlled'),
    featureAutomationDescription: defineMessage('loginPage.featureAutomationDescription', '访问密钥、调用记录和资源边界在控制台里统一收口。', 'Keep API keys, request logs, and resource boundaries in one console.'),
    featureMailflowTitle: defineMessage('loginPage.featureMailflowTitle', '收发链路闭环', 'Mailflow stays end to end'),
    featureMailflowDescription: defineMessage('loginPage.featureMailflowDescription', '从接入到收件、发件和转发都保持在同一工作流里。', 'Keep onboarding, inbox, sending, and forwarding inside one workflow.'),
    notice: defineMessage('loginPage.notice', '同一入口会自动兼容邮箱门户用户；如果管理员认证失败，系统会自动尝试门户登录。', 'The same entry point also supports mailbox-portal users. If admin auth fails, the system will automatically try portal login.'),
    formTitle: defineMessage('loginPage.formTitle', '登录管理控制台', 'Sign in to the admin console'),
    formDescription: defineMessage('loginPage.formDescription', '优先走管理员认证；如果当前账号属于门户用户，系统会自动切换到门户工作台。', 'Admin auth runs first. If this account belongs to the portal, the system switches to the portal workspace automatically.'),
    footer: defineMessage('loginPage.footer', '适用于管理员与运营人员，也兼容需要临时进入门户工作台的邮箱用户。', 'For admins and operators, with portal compatibility for mailbox users who need temporary access.'),
    usernameLabel: defineMessage('loginPage.usernameLabel', '用户名或邮箱', 'Username or email'),
    usernameRequired: defineMessage('loginPage.usernameRequired', '请输入用户名或邮箱', 'Enter a username or email'),
    passwordLabel: defineMessage('loginPage.passwordLabel', '密码', 'Password'),
    passwordRequired: defineMessage('loginPage.passwordRequired', '请输入密码', 'Enter a password'),
    otpPromptTitle: defineMessage('loginPage.otpPromptTitle', '如果账号启用了 2FA，下一步会要求输入 6 位验证码', 'If 2FA is enabled for this account, the next step asks for a 6-digit verification code'),
    loginUnavailable: defineMessage('loginPage.loginUnavailable', '当前无法完成登录', 'Unable to complete sign-in right now'),
    enterConsole: defineMessage('loginPage.enterConsole', '进入管理控制台', 'Enter the admin console'),
    initialPasswordWarning: defineMessage('loginPage.initialPasswordWarning', '这是首次初始化生成的临时密码，请先完成改密再继续使用系统', 'This is the initial temporary password. Change it before continuing to use the system.'),
    loginSuccess: defineMessage('loginPage.loginSuccess', '登录成功', 'Signed in'),
    portalLoginSuccess: defineMessage('loginPage.portalLoginSuccess', '邮箱门户登录成功', 'Mailbox portal sign-in succeeded'),
    otpRequiredInfo: defineMessage('loginPage.otpRequiredInfo', '该账号已启用二次验证，请输入 6 位验证码', 'This account uses two-factor verification. Enter the 6-digit code.'),
    adminAndPortalFailed: defineMessage('loginPage.adminAndPortalFailed', '管理员与门户认证都未通过，请检查用户名和密码后重试。', 'Both admin and portal authentication failed. Check the username and password and try again.'),
    portalMismatch: defineMessage('loginPage.portalMismatch', '管理员认证失败，且未能匹配到可用的门户账号。', 'Admin authentication failed, and no matching portal account was found.'),
    loginFailed: defineMessage('loginPage.loginFailed', '登录失败', 'Sign-in failed'),
    otpRequired: defineMessage('loginPage.otpRequired', '请输入 6 位验证码', 'Enter a 6-digit verification code'),
    otpInvalid: defineMessage('loginPage.otpInvalid', '验证码错误，请重试', 'The verification code is invalid. Try again.'),
    otpFailed: defineMessage('loginPage.otpFailed', '验证失败', 'Verification failed'),
    otpModalTitle: defineMessage('loginPage.otpModalTitle', '二次验证', 'Two-factor verification'),
    otpModalConfirm: defineMessage('loginPage.otpModalConfirm', '验证并登录', 'Verify and sign in'),
    otpModalCancel: defineMessage('loginPage.otpModalCancel', '取消', 'Cancel'),
    otpModalDescription: defineMessage('loginPage.otpModalDescription', '请输入验证器中的 6 位动态码', 'Enter the 6-digit code from your authenticator app'),
    otpPlaceholder: defineMessage('loginPage.otpPlaceholder', '6 位验证码', '6-digit verification code'),
} as const;

interface LoginForm {
    username: string;
    password: string;
}

const LoginPage: FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { setAuth: setAdminAuth, clearAuth: clearAdminAuth } = useAuthStore();
    const { setAuth: setMailboxAuth, clearAuth: clearMailboxAuth } = useMailboxAuthStore();
    const [loading, setLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [otpModalVisible, setOtpModalVisible] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);

    const finishLogin = (result: { admin: Admin }) => {
        clearMailboxAuth();
        setFormError(null);
        setAdminAuth(result.admin);
        if (result.admin.mustChangePassword) {
            message.warning(t(loginPageI18n.initialPasswordWarning));
            navigate('/settings');
            return;
        }
        message.success(t(loginPageI18n.loginSuccess));
        navigate('/');
    };

    const finishMailboxLogin = (result: { mailboxUser: MailboxUser }) => {
        clearAdminAuth();
        setFormError(null);
        setMailboxAuth(result.mailboxUser);
        message.success(t(loginPageI18n.portalLoginSuccess));
        navigate(result.mailboxUser.mustChangePassword ? '/mail/settings' : '/mail/overview');
    };

    const handleSubmit = async (values: LoginForm) => {
        setLoading(true);
        setFormError(null);
        try {
            const response = await authContract.login(values.username, values.password);
            if (response.code === 200) {
                finishLogin(response.data);
            }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                setPendingCredentials({ username: values.username, password: values.password });
                setOtpCode('');
                setOtpModalVisible(true);
                message.info(t(loginPageI18n.otpRequiredInfo));
            } else if (errCode === 'INVALID_CREDENTIALS') {
                try {
                    const portalResponse = await portalAccountContract.login(values.username, values.password);
                    if (portalResponse.code === 200) {
                        finishMailboxLogin(portalResponse.data);
                    }
                } catch (portalErr) {
                    const portalErrCode = String((portalErr as { code?: unknown })?.code || '').toUpperCase();
                    if (portalErrCode === 'INVALID_CREDENTIALS') {
                        setFormError(t(loginPageI18n.adminAndPortalFailed));
                    } else {
                        setFormError(getErrorMessage(portalErr, t(loginPageI18n.portalMismatch)));
                    }
                }
            } else {
                setFormError(getErrorMessage(err, t(loginPageI18n.loginFailed)));
            }
        } finally {
            setLoading(false);
        }
    };

    const handleOtpConfirm = async () => {
        if (!pendingCredentials) {
            return;
        }
        const otp = otpCode.trim();
        if (!/^\d{6}$/.test(otp)) {
            message.error(t(loginPageI18n.otpRequired));
            return;
        }

        setOtpLoading(true);
        try {
            const response = await authContract.login(pendingCredentials.username, pendingCredentials.password, otp);
            if (response.code === 200) {
                setOtpModalVisible(false);
                setPendingCredentials(null);
                setOtpCode('');
                finishLogin(response.data);
            }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                message.error(t(loginPageI18n.otpInvalid));
            } else {
                message.error(getErrorMessage(err, t(loginPageI18n.otpFailed)));
            }
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <>
            <AuthSplitLayout
                tags={[
                    { key: 'admin-console', color: 'blue', label: t(loginPageI18n.adminConsoleTag) },
                    { key: 'secure-access', color: 'cyan', label: t(loginPageI18n.secureAccessTag) },
                ]}
                title={APP_NAME}
                subtitle={t(loginPageI18n.subtitle)}
                features={[
                    { key: 'resources', icon: <CloudServerOutlined />, title: t(loginPageI18n.featureResourceTitle), description: t(loginPageI18n.featureResourceDescription) },
                    { key: 'automation', icon: <ApiOutlined />, title: t(loginPageI18n.featureAutomationTitle), description: t(loginPageI18n.featureAutomationDescription) },
                    { key: 'mailflow', icon: <SendOutlined />, title: t(loginPageI18n.featureMailflowTitle), description: t(loginPageI18n.featureMailflowDescription) },
                ]}
                notice={t(loginPageI18n.notice)}
                formTitle={t(loginPageI18n.formTitle)}
                formDescription={t(loginPageI18n.formDescription)}
                footer={t(loginPageI18n.footer)}
            >
                <Form name="login" onFinish={handleSubmit} size="large" autoComplete="off" onValuesChange={() => { if (formError) setFormError(null); }}>
                    <Form.Item name="username" label={t(loginPageI18n.usernameLabel)} rules={[{ required: true, message: t(loginPageI18n.usernameRequired) }]}>
                        <Input prefix={<UserOutlined />} placeholder={t(loginPageI18n.usernameLabel)} autoComplete="username" />
                    </Form.Item>

                    <Form.Item name="password" label={t(loginPageI18n.passwordLabel)} rules={[{ required: true, message: t(loginPageI18n.passwordRequired) }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder={t(loginPageI18n.passwordLabel)} autoComplete="current-password" />
                    </Form.Item>

                    <Alert
                        type="warning"
                        showIcon
                        icon={<SafetyCertificateOutlined />}
                        title={t(loginPageI18n.otpPromptTitle)}
                        style={marginBottom16Style}
                    />

                    {formError ? (
                        <Alert
                            type="error"
                            showIcon
                            title={t(loginPageI18n.loginUnavailable)}
                            description={formError}
                            style={marginBottom16Style}
                        />
                    ) : null}

                    <Form.Item style={noMarginBottomStyle}>
                        <Button type="primary" htmlType="submit" loading={loading} block size="large">
                            {t(loginPageI18n.enterConsole)}
                        </Button>
                    </Form.Item>
                </Form>
            </AuthSplitLayout>

            <Modal
                title={t(loginPageI18n.otpModalTitle)}
                open={otpModalVisible}
                onOk={handleOtpConfirm}
                onCancel={() => {
                    setOtpModalVisible(false);
                    setPendingCredentials(null);
                    setOtpCode('');
                }}
                okText={t(loginPageI18n.otpModalConfirm)}
                cancelText={t(loginPageI18n.otpModalCancel)}
                confirmLoading={otpLoading}
                destroyOnHidden
            >
                <Space orientation="vertical" style={fullWidthStyle}>
                    <Text type="secondary">{t(loginPageI18n.otpModalDescription)}</Text>
                    <Input
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        prefix={<SafetyCertificateOutlined />}
                        maxLength={6}
                        placeholder={t(loginPageI18n.otpPlaceholder)}
                    />
                </Space>
            </Modal>
        </>
    );
};

export default LoginPage;

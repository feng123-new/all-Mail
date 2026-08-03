import { LockOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, message, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthSplitLayout } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { useI18n } from '../../../i18n';
import { defineMessage } from '../../../i18n/messages';
import { type MailboxUser, useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { fullWidthStyle, noMarginBottomStyle } from '../../../styles/common';
import { getErrorMessage } from '../../../utils/error';
import { clearLegacyPortalCredentialPrefills } from '../../../utils/portalCredentialStorage';

const { Text } = Typography;

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
    notice: defineMessage('mailPortalLogin.notice', '门户用户名支持预填。如果你从管理员后台或用户通知里带了用户名参数进来，登录页会自动帮你填好用户名；密码始终需要自行输入。', 'Portal usernames support prefill. If you arrive from the admin console or a user notice with a username parameter, the login page fills it automatically; passwords must always be entered by the user.'),
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
    otpRequiredInfo: defineMessage('mailPortalLogin.otpRequiredInfo', '该账号已启用二次验证，请输入 6 位验证码', 'This account uses two-factor verification. Enter the 6-digit code.'),
    otpRequired: defineMessage('mailPortalLogin.otpRequired', '请输入 6 位验证码', 'Enter a 6-digit verification code.'),
    otpInvalid: defineMessage('mailPortalLogin.otpInvalid', '验证码错误，请重试', 'The verification code is invalid. Try again.'),
    otpFailed: defineMessage('mailPortalLogin.otpFailed', '验证失败', 'Verification failed'),
    otpModalTitle: defineMessage('mailPortalLogin.otpModalTitle', '二次验证', 'Two-factor verification'),
    otpModalConfirm: defineMessage('mailPortalLogin.otpModalConfirm', '验证并登录', 'Verify and sign in'),
    otpModalCancel: defineMessage('mailPortalLogin.otpModalCancel', '取消', 'Cancel'),
    otpModalDescription: defineMessage('mailPortalLogin.otpModalDescription', '请输入验证器中的 6 位动态码', 'Enter the 6-digit code from your authenticator app.'),
    otpInputLabel: defineMessage('mailPortalLogin.otpInputLabel', '验证码', 'Verification code'),
    otpPlaceholder: defineMessage('mailPortalLogin.otpPlaceholder', '6 位验证码', '6-digit verification code'),
} as const;

const MailPortalLoginPage = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setAuth } = useMailboxAuthStore();
    const [loading, setLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [otpModalVisible, setOtpModalVisible] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);
    const [form] = Form.useForm<{ username: string; password: string }>();

    const portalUsername = useMemo(() => searchParams.get('username')?.trim() || '', [searchParams]);

    useEffect(() => {
        clearLegacyPortalCredentialPrefills();
        form.setFieldsValue({ username: portalUsername, password: '' });
    }, [form, portalUsername]);

    const finishLogin = (mailboxUser: MailboxUser) => {
        setFormError(null);
        setAuth(mailboxUser);
        message.success(t(mailPortalLoginI18n.loginSuccess));
        navigate(mailboxUser.mustChangePassword ? '/mail/settings' : '/mail/inbox');
    };

    const handleSubmit = async (values: { username: string; password: string }) => {
        setLoading(true);
        try {
            setFormError(null);
            const response = await portalAccountContract.login(values.username, values.password);
            if (response.code === 200) {
                const payload = response.data as { mailboxUser: MailboxUser };
                finishLogin(payload.mailboxUser);
            }
        } catch (error) {
            const errCode = String((error as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'OTP_REQUIRED' || errCode === 'INVALID_OTP') {
                setPendingCredentials({ username: values.username, password: values.password });
                setOtpCode('');
                setOtpModalVisible(true);
                message.info(t(mailPortalLoginI18n.otpRequiredInfo));
            } else if (errCode === 'INVALID_CREDENTIALS') {
                setFormError(t(mailPortalLoginI18n.invalidCredentials));
            } else {
                setFormError(getErrorMessage(error, t(mailPortalLoginI18n.loginFailed)));
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
            message.error(t(mailPortalLoginI18n.otpRequired));
            return;
        }

        setOtpLoading(true);
        try {
            const response = await portalAccountContract.login(pendingCredentials.username, pendingCredentials.password, otp);
            if (response.code === 200) {
                const payload = response.data as { mailboxUser: MailboxUser };
                setOtpModalVisible(false);
                setPendingCredentials(null);
                setOtpCode('');
                finishLogin(payload.mailboxUser);
            }
        } catch (error) {
            const errCode = String((error as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                message.error(t(mailPortalLoginI18n.otpInvalid));
            } else {
                message.error(getErrorMessage(error, t(mailPortalLoginI18n.otpFailed)));
            }
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <>
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

            <Modal
                title={t(mailPortalLoginI18n.otpModalTitle)}
                open={otpModalVisible}
                onOk={handleOtpConfirm}
                onCancel={() => {
                    setOtpModalVisible(false);
                    setPendingCredentials(null);
                    setOtpCode('');
                }}
                okText={t(mailPortalLoginI18n.otpModalConfirm)}
                cancelText={t(mailPortalLoginI18n.otpModalCancel)}
                confirmLoading={otpLoading}
                destroyOnHidden
            >
                <Space orientation="vertical" style={fullWidthStyle}>
                    <Text type="secondary">{t(mailPortalLoginI18n.otpModalDescription)}</Text>
                    <Input
                        aria-label={t(mailPortalLoginI18n.otpInputLabel)}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder={t(mailPortalLoginI18n.otpPlaceholder)}
                        prefix={<SafetyCertificateOutlined />}
                        value={otpCode}
                    />
                </Space>
            </Modal>
        </>
    );
};

export default MailPortalLoginPage;

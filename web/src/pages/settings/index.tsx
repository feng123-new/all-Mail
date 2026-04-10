import { useCallback, useEffect, useState, type FC } from 'react';
import { Alert, Button, Form, Input, QRCode, Space, Tag, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { authContract } from '../../contracts/shared/auth';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { useAuthStore } from '../../stores/authStore';
import {
    centeredTextStyle,
    displayBlockMarginBottom8Style,
    fontSize16Style,
    fullWidthStyle,
    gridGap16Style,
    marginBottom16Style,
    marginTop8Style,
    maxWidth400Style,
    neutralCodePanelStyle,
    noMarginBottomStyle,
    wordBreakBreakAllStyle,
} from '../../styles/common';
import { getAdminRoleLabel } from '../../utils/auth';
import { requestData } from '../../utils/request';

const { Text } = Typography;

const settingsPageI18n = {
    fetchTwoFactorStatusFailed: defineMessage('settings.fetchTwoFactorStatusFailed', '获取二次验证状态失败', 'Failed to load two-factor status'),
    passwordMismatch: defineMessage('settings.passwordMismatch', '两次输入的密码不一致', 'The two passwords do not match'),
    changePasswordFailed: defineMessage('settings.changePasswordFailed', '密码修改失败', 'Failed to change the password'),
    initialPasswordUpdated: defineMessage('settings.initialPasswordUpdated', '初始密码已更新，系统已解锁全部功能', 'Initial password updated. The rest of the system is now unlocked.'),
    passwordChanged: defineMessage('settings.passwordChanged', '密码修改成功', 'Password changed successfully'),
    generateTwoFactorFailed: defineMessage('settings.generateTwoFactorFailed', '生成二次验证密钥失败', 'Failed to generate the two-factor secret'),
    scanThenEnterOtp: defineMessage('settings.scanThenEnterOtp', '请在验证器中添加密钥后输入 6 位验证码完成启用', 'Add the secret to your authenticator app, then enter the 6-digit code to finish enabling 2FA.'),
    enterSixDigitCode: defineMessage('settings.enterSixDigitCode', '请输入 6 位验证码', 'Enter the 6-digit verification code'),
    enableTwoFactorFailed: defineMessage('settings.enableTwoFactorFailed', '启用二次验证失败', 'Failed to enable two-factor authentication'),
    twoFactorEnabled: defineMessage('settings.twoFactorEnabled', '双重验证已启用', 'Two-factor authentication enabled'),
    disableTwoFactorFailed: defineMessage('settings.disableTwoFactorFailed', '禁用双重验证失败', 'Failed to disable two-factor authentication'),
    twoFactorDisabled: defineMessage('settings.twoFactorDisabled', '双重验证已禁用', 'Two-factor authentication disabled'),
    initialPasswordTitle: defineMessage('settings.initialPasswordTitle', '当前管理员仍在使用首次初始化的临时密码', 'The current admin is still using the initial temporary password'),
    initialPasswordDescription: defineMessage('settings.initialPasswordDescription', '在设置新密码之前，系统会阻止访问控制台其他页面以及受保护的管理接口。先完成这一步，再继续配置邮箱、域名和 API 密钥。', 'Before a new password is set, the system blocks the rest of the console and protected admin APIs. Finish this step first, then continue with mailboxes, domains, and API keys.'),
    currentPassword: defineMessage('settings.currentPassword', '当前密码', 'Current password'),
    currentPasswordRequired: defineMessage('settings.currentPasswordRequired', '请输入当前密码', 'Enter the current password'),
    newPassword: defineMessage('settings.newPassword', '新密码', 'New password'),
    newPasswordRequired: defineMessage('settings.newPasswordRequired', '请输入新密码', 'Enter a new password'),
    passwordMinLength: defineMessage('settings.passwordMinLength', '密码至少 8 个字符', 'Password must be at least 8 characters'),
    confirmNewPassword: defineMessage('settings.confirmNewPassword', '确认新密码', 'Confirm new password'),
    confirmNewPasswordRequired: defineMessage('settings.confirmNewPasswordRequired', '请确认新密码', 'Confirm the new password'),
    unlockSystem: defineMessage('settings.unlockSystem', '设置新密码并解锁系统', 'Set a new password and unlock the system'),
    loading: defineMessage('settings.loading', '加载中...', 'Loading...'),
    currentStatus: defineMessage('settings.currentStatus', '当前状态：', 'Current status: '),
    enabled: defineMessage('settings.enabled', '已启用', 'Enabled'),
    disabled: defineMessage('settings.disabled', '未启用', 'Disabled'),
    pendingVerification: defineMessage('settings.pendingVerification', '待验证', 'Pending verification'),
    envManagedTitle: defineMessage('settings.envManagedTitle', '当前账号使用环境变量双重验证（ADMIN_2FA_SECRET），暂不支持在界面中直接管理。', 'This account uses environment-managed 2FA (ADMIN_2FA_SECRET), which cannot be edited from the UI.'),
    generateBindingSecret: defineMessage('settings.generateBindingSecret', '生成绑定密钥', 'Generate binding secret'),
    bindingInfo: defineMessage('settings.bindingInfo', '绑定信息', 'Binding information'),
    scanToBind: defineMessage('settings.scanToBind', '扫码绑定（推荐）', 'Scan to bind (recommended)'),
    manualSecret: defineMessage('settings.manualSecret', '手动密钥（可复制）', 'Manual secret (copyable)'),
    otpauthLink: defineMessage('settings.otpauthLink', 'otpauth 链接（可复制）', 'otpauth link (copyable)'),
    enterAuthenticatorOtp: defineMessage('settings.enterAuthenticatorOtp', '输入验证器中的 6 位验证码', 'Enter the 6-digit code from the authenticator app'),
    enableTwoFactor: defineMessage('settings.enableTwoFactor', '启用双重验证', 'Enable two-factor authentication'),
    disableTwoFactor: defineMessage('settings.disableTwoFactor', '禁用双重验证', 'Disable two-factor authentication'),
    verificationCode: defineMessage('settings.verificationCode', '验证码', 'Verification code'),
    enterVerificationCode: defineMessage('settings.enterVerificationCode', '请输入验证码', 'Enter the verification code'),
    providerOauthDescription: defineMessage('settings.providerOauthDescription', '谷歌授权请到“外部邮箱连接 → 添加 Gmail 邮箱”；微软授权请到“外部邮箱连接 → 添加 Outlook 邮箱”。现在在对应服务商的添加弹窗里就可以手工填写回调地址、客户端 ID / Secret、Scopes，并直接生成授权链接完成认证。', 'For Google auth go to “External mailboxes → Add Gmail mailbox”; for Microsoft auth go to “External mailboxes → Add Outlook mailbox”. The provider modal now lets you enter callback URL, client ID / secret, scopes, and generate the authorization URL directly.'),
    externalApiUsage: defineMessage('settings.externalApiUsage', '外部 API 调用方式', 'External API usage'),
    apiUsageHeaderTitle: defineMessage('settings.apiUsageHeaderTitle', '# 通过 Header 传递访问密钥', '# Pass the API key via a header'),
    apiUsageQueryDeprecatedTitle: defineMessage('settings.apiUsageQueryDeprecatedTitle', '# 不再支持 Query 参数传递访问密钥', '# Query-parameter API keys are no longer supported'),
    apiUsageQueryDeprecatedBody: defineMessage('settings.apiUsageQueryDeprecatedBody', '请改用 Header：curl -H "X-API-Key: your_api_key" https://your-domain.com/api/messages?email=xxx@outlook.com', 'Use a header instead: curl -H "X-API-Key: your_api_key" https://your-domain.com/api/messages?email=xxx@outlook.com'),
} as const;

interface TwoFactorStatus {
    enabled: boolean;
    pending: boolean;
    legacyEnv: boolean;
}

const settingsStyles = {
    fullWidth: fullWidthStyle,
    profileGrid: gridGap16Style,
    valueText: fontSize16Style,
    passwordForm: maxWidth400Style,
    centeredText: centeredTextStyle,
    marginTop8: marginTop8Style,
    marginBottom16: marginBottom16Style,
    codePanel: neutralCodePanelStyle,
    codePanelWithMargin: { ...neutralCodePanelStyle, ...marginBottom16Style },
    codeLabel: displayBlockMarginBottom8Style,
    codeBreakAll: wordBreakBreakAllStyle,
    noMarginBottom: noMarginBottomStyle,
} as const;

const SettingsPage: FC = () => {
    const { t } = useI18n();
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [twoFactorLoading, setTwoFactorLoading] = useState(false);
    const [twoFactorStatusLoading, setTwoFactorStatusLoading] = useState(true);
    const [twoFactorStatus, setTwoFactorStatus] = useState<TwoFactorStatus>({
        enabled: false,
        pending: false,
        legacyEnv: false,
    });
    const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
    const [enableOtp, setEnableOtp] = useState('');
    const [form] = Form.useForm();
    const [disable2FaForm] = Form.useForm();
    const { admin, setAuth } = useAuthStore();
    const mustChangePassword = Boolean(admin?.mustChangePassword);
    const effectiveTwoFactorStatus = mustChangePassword
        ? { enabled: false, pending: false, legacyEnv: false }
        : twoFactorStatus;
    const showTwoFactorStatusLoading = mustChangePassword ? false : twoFactorStatusLoading;
    const visibleSetupData = mustChangePassword ? null : setupData;

    const syncStoreTwoFactor = useCallback((enabled: boolean) => {
        if (!admin) {
            return;
        }
        setAuth({ ...admin, twoFactorEnabled: enabled });
    }, [admin, setAuth]);

    const loadTwoFactorStatus = async (silent: boolean = false) => {
        if (mustChangePassword) {
            return;
        }

        const result = await requestData<TwoFactorStatus>(
            () => authContract.getTwoFactorStatus(),
            t(settingsPageI18n.fetchTwoFactorStatusFailed),
            { silent }
        );
        if (result) {
            setTwoFactorStatus(result);
            if (!result.pending) {
                setSetupData(null);
            }
            syncStoreTwoFactor(result.enabled);
        }
        setTwoFactorStatusLoading(false);
    };

    useEffect(() => {
        let cancelled = false;

        if (mustChangePassword) {
            return () => {
                cancelled = true;
            };
        }

        const init = async () => {
            const result = await requestData<TwoFactorStatus>(
                () => authContract.getTwoFactorStatus(),
                t(settingsPageI18n.fetchTwoFactorStatusFailed),
                { silent: true }
            );
            if (!cancelled && result) {
                setTwoFactorStatus(result);
                if (!result.pending) {
                    setSetupData(null);
                }
                syncStoreTwoFactor(result.enabled);
            }
            if (!cancelled) {
                setTwoFactorStatusLoading(false);
            }
        };

        void init();
        return () => {
            cancelled = true;
        };
    }, [mustChangePassword, syncStoreTwoFactor, t]);

    const handleChangePassword = async (values: {
        oldPassword: string;
        newPassword: string;
        confirmPassword: string;
    }) => {
        if (values.newPassword !== values.confirmPassword) {
            message.error(t(settingsPageI18n.passwordMismatch));
            return;
        }

        setPasswordLoading(true);
        const result = await requestData<{ message?: string }>(
            () => authContract.changePassword(values.oldPassword, values.newPassword),
            t(settingsPageI18n.changePasswordFailed)
        );
        if (result) {
            if (admin) {
                setAuth({
                    ...admin,
                    mustChangePassword: false,
                });
            }
            message.success(mustChangePassword ? t(settingsPageI18n.initialPasswordUpdated) : t(settingsPageI18n.passwordChanged));
            form.resetFields();
        }
        setPasswordLoading(false);
    };

    const handleSetup2Fa = async () => {
        setTwoFactorLoading(true);
        const result = await requestData<{ secret: string; otpauthUrl: string }>(
            () => authContract.setupTwoFactor(),
            t(settingsPageI18n.generateTwoFactorFailed)
        );
        if (result) {
            setSetupData(result);
            setTwoFactorStatus((prev) => ({ ...prev, pending: true, enabled: false, legacyEnv: false }));
            message.info(t(settingsPageI18n.scanThenEnterOtp));
        }
        setTwoFactorLoading(false);
    };

    const handleEnable2Fa = async () => {
        const otp = enableOtp.trim();
        if (!/^\d{6}$/.test(otp)) {
            message.error(t(settingsPageI18n.enterSixDigitCode));
            return;
        }

        setTwoFactorLoading(true);
        const result = await requestData<{ enabled: boolean }>(
            () => authContract.enableTwoFactor(otp),
            t(settingsPageI18n.enableTwoFactorFailed)
        );
        if (result) {
            message.success(t(settingsPageI18n.twoFactorEnabled));
            setEnableOtp('');
            setSetupData(null);
            await loadTwoFactorStatus();
        }
        setTwoFactorLoading(false);
    };

    const handleDisable2Fa = async (values: { password: string; otp: string }) => {
        setTwoFactorLoading(true);
        const result = await requestData<{ enabled: boolean }>(
            () => authContract.disableTwoFactor(values.password, values.otp),
            t(settingsPageI18n.disableTwoFactorFailed)
        );
        if (result) {
            message.success(t(settingsPageI18n.twoFactorDisabled));
            disable2FaForm.resetFields();
            await loadTwoFactorStatus();
        }
        setTwoFactorLoading(false);
    };

        return (
        <div>
            <PageHeader
                title={t(adminI18n.settings.title)}
                subtitle={t(adminI18n.settings.subtitle)}
            />

            <Space orientation="vertical" size="large" style={settingsStyles.fullWidth}>
                <SurfaceCard title={t(adminI18n.settings.profile)} tone="muted">
                    <div style={settingsStyles.profileGrid}>
                        <div>
                            <Text type="secondary">{t(adminI18n.admins.username)}</Text>
                            <div style={settingsStyles.valueText}>{admin?.username}</div>
                        </div>
                        <div>
                            <Text type="secondary">{t(adminI18n.admins.role)}</Text>
                            <div style={settingsStyles.valueText}>
                                {t(getAdminRoleLabel(admin?.role))}
                            </div>
                        </div>
                    </div>
                </SurfaceCard>

                {mustChangePassword ? (
                    <Alert
                        type="warning"
                        showIcon
                        title={t(settingsPageI18n.initialPasswordTitle)}
                        description={t(settingsPageI18n.initialPasswordDescription)}
                    />
                ) : null}

                <SurfaceCard title={mustChangePassword ? t(adminI18n.settings.setNewPassword) : t(adminI18n.settings.changePassword)}>
                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleChangePassword}
                        style={settingsStyles.passwordForm}
                    >
                        <Form.Item
                            name="oldPassword"
                            label={t(settingsPageI18n.currentPassword)}
                            rules={[{ required: true, message: t(settingsPageI18n.currentPasswordRequired) }]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder={t(settingsPageI18n.currentPassword)} />
                        </Form.Item>

                        <Form.Item
                            name="newPassword"
                            label={t(settingsPageI18n.newPassword)}
                            rules={[
                                { required: true, message: t(settingsPageI18n.newPasswordRequired) },
                                { min: 8, message: t(settingsPageI18n.passwordMinLength) },
                            ]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder={t(settingsPageI18n.newPassword)} />
                        </Form.Item>

                        <Form.Item
                            name="confirmPassword"
                            label={t(settingsPageI18n.confirmNewPassword)}
                            rules={[
                                { required: true, message: t(settingsPageI18n.confirmNewPasswordRequired) },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('newPassword') === value) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(new Error(t(settingsPageI18n.passwordMismatch)));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder={t(settingsPageI18n.confirmNewPassword)} />
                        </Form.Item>
                        
                        <Form.Item>
                            <Button type="primary" htmlType="submit" loading={passwordLoading}>
                                {mustChangePassword ? t(settingsPageI18n.unlockSystem) : t(adminI18n.settings.changePassword)}
                            </Button>
                        </Form.Item>
                    </Form>
                </SurfaceCard>

                {!mustChangePassword ? (
                    <SurfaceCard title={t(adminI18n.settings.twoFactor)} tone="muted">
					{showTwoFactorStatusLoading ? (
						<Text type="secondary">{t(settingsPageI18n.loading)}</Text>
					) : (
                        <Space orientation="vertical" size="middle" style={settingsStyles.fullWidth}>
                            <div>
                                <Text type="secondary">{t(settingsPageI18n.currentStatus)}</Text>{' '}
                                {effectiveTwoFactorStatus.enabled ? <Tag color="success">{t(settingsPageI18n.enabled)}</Tag> : <Tag>{t(settingsPageI18n.disabled)}</Tag>}
                                {effectiveTwoFactorStatus.pending && !effectiveTwoFactorStatus.enabled ? <Tag color="processing">{t(settingsPageI18n.pendingVerification)}</Tag> : null}
                            </div>

                            {effectiveTwoFactorStatus.legacyEnv ? (
                                <Alert
                                    type="warning"
                                    showIcon
                                    title={t(settingsPageI18n.envManagedTitle)}
                                />
                            ) : null}

                            {!effectiveTwoFactorStatus.enabled ? (
                                <Button
                                    type="primary"
                                    icon={<SafetyCertificateOutlined />}
                                    onClick={handleSetup2Fa}
                                    loading={twoFactorLoading}
                                >
                                    {t(settingsPageI18n.generateBindingSecret)}
                                </Button>
                            ) : null}

                            {visibleSetupData ? (
                                <SurfaceCard size="small" title={t(settingsPageI18n.bindingInfo)} tone="muted">
                                    <Space orientation="vertical" style={settingsStyles.fullWidth}>
                                        <div style={settingsStyles.centeredText}>
                                            <Text type="secondary">{t(settingsPageI18n.scanToBind)}</Text>
                                            <div style={settingsStyles.marginTop8}>
                                                <QRCode value={visibleSetupData.otpauthUrl} size={180} />
                                            </div>
                                        </div>
                                        <div>
                                            <Text type="secondary">{t(settingsPageI18n.manualSecret)}</Text>
                                            <div><Text copyable>{visibleSetupData.secret}</Text></div>
                                        </div>
                                        <div>
                                            <Text type="secondary">{t(settingsPageI18n.otpauthLink)}</Text>
                                            <div><Text copyable>{visibleSetupData.otpauthUrl}</Text></div>
                                        </div>
                                        <Input
                                            value={enableOtp}
                                            onChange={(e) => setEnableOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder={t(settingsPageI18n.enterAuthenticatorOtp)}
                                            maxLength={6}
                                            prefix={<SafetyCertificateOutlined />}
                                        />
                                        <Button type="primary" onClick={handleEnable2Fa} loading={twoFactorLoading}>
                                            {t(settingsPageI18n.enableTwoFactor)}
                                        </Button>
                                    </Space>
                                </SurfaceCard>
                            ) : null}

                            {effectiveTwoFactorStatus.enabled ? (
                                <SurfaceCard size="small" title={t(settingsPageI18n.disableTwoFactor)} tone="muted">
                                    <Form form={disable2FaForm} layout="vertical" onFinish={handleDisable2Fa}>
                                        <Form.Item
                                            name="password"
                                            label={t(settingsPageI18n.currentPassword)}
                                            rules={[{ required: true, message: t(settingsPageI18n.currentPasswordRequired) }]}
                                        >
                                            <Input.Password prefix={<LockOutlined />} placeholder={t(settingsPageI18n.currentPassword)} />
                                        </Form.Item>
                                        <Form.Item
                                            name="otp"
                                            label={t(settingsPageI18n.verificationCode)}
                                            rules={[
                                                { required: true, message: t(settingsPageI18n.enterVerificationCode) },
                                                { pattern: /^\d{6}$/, message: t(settingsPageI18n.enterSixDigitCode) },
                                            ]}
                                        >
                                            <Input
                                                maxLength={6}
                                                prefix={<SafetyCertificateOutlined />}
                                                placeholder={t(settingsPageI18n.enterSixDigitCode)}
                                            />
                                        </Form.Item>
                                        <Form.Item style={settingsStyles.noMarginBottom}>
                                            <Button danger htmlType="submit" loading={twoFactorLoading}>
                                                {t(settingsPageI18n.disableTwoFactor)}
                                            </Button>
                                        </Form.Item>
                                    </Form>
                                </SurfaceCard>
                            ) : null}
                        </Space>
                    )}
                    </SurfaceCard>
                ) : null}

                {!mustChangePassword ? (
                    <SurfaceCard title={t(adminI18n.settings.providerOauth)}>
                        <Alert
                            type="info"
                            showIcon
                            title={t(adminI18n.settings.providerOauthMoved)}
                            description={t(settingsPageI18n.providerOauthDescription)}
                        />
                    </SurfaceCard>
                ) : null}

                {!mustChangePassword ? (
                    <SurfaceCard title={t(adminI18n.settings.apiUsage)} tone="muted">
                        <div style={settingsStyles.marginBottom16}>
                            <Text strong>{t(settingsPageI18n.externalApiUsage)}</Text>
                        </div>

                        <div style={settingsStyles.codePanelWithMargin}>
                            <Text code style={settingsStyles.codeLabel}>
                                {t(settingsPageI18n.apiUsageHeaderTitle)}
                            </Text>
                            <Text code style={settingsStyles.codeBreakAll}>
                                curl -H "X-API-Key: your_api_key" https://your-domain.com/api/messages
                            </Text>
                        </div>

                        <div style={settingsStyles.codePanel}>
                            <Text code style={settingsStyles.codeLabel}>
                                {t(settingsPageI18n.apiUsageQueryDeprecatedTitle)}
                            </Text>
                            <Text code style={settingsStyles.codeBreakAll}>
                                {t(settingsPageI18n.apiUsageQueryDeprecatedBody)}
                            </Text>
                        </div>
                    </SurfaceCard>
                ) : null}
            </Space>
        </div>
    );
};

export default SettingsPage;

import { useCallback, useEffect, useState, type FC } from 'react';
import { Alert, Button, Form, Input, QRCode, Space, Tag, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { authContract } from '../../contracts/shared/auth';
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
            '获取二次验证状态失败',
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
                '获取二次验证状态失败',
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
    }, [mustChangePassword, syncStoreTwoFactor]);

    const handleChangePassword = async (values: {
        oldPassword: string;
        newPassword: string;
        confirmPassword: string;
    }) => {
        if (values.newPassword !== values.confirmPassword) {
            message.error('两次输入的密码不一致');
            return;
        }

        setPasswordLoading(true);
        const result = await requestData<{ message?: string }>(
            () => authContract.changePassword(values.oldPassword, values.newPassword),
            '密码修改失败'
        );
        if (result) {
            if (admin) {
                setAuth({
                    ...admin,
                    mustChangePassword: false,
                });
            }
            message.success(mustChangePassword ? '初始密码已更新，系统已解锁全部功能' : '密码修改成功');
            form.resetFields();
        }
        setPasswordLoading(false);
    };

    const handleSetup2Fa = async () => {
        setTwoFactorLoading(true);
        const result = await requestData<{ secret: string; otpauthUrl: string }>(
            () => authContract.setupTwoFactor(),
            '生成二次验证密钥失败'
        );
        if (result) {
            setSetupData(result);
            setTwoFactorStatus((prev) => ({ ...prev, pending: true, enabled: false, legacyEnv: false }));
            message.info('请在验证器中添加密钥后输入 6 位验证码完成启用');
        }
        setTwoFactorLoading(false);
    };

    const handleEnable2Fa = async () => {
        const otp = enableOtp.trim();
        if (!/^\d{6}$/.test(otp)) {
            message.error('请输入 6 位验证码');
            return;
        }

        setTwoFactorLoading(true);
        const result = await requestData<{ enabled: boolean }>(
            () => authContract.enableTwoFactor(otp),
            '启用二次验证失败'
        );
        if (result) {
            message.success('二次验证已启用');
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
            '禁用二次验证失败'
        );
        if (result) {
            message.success('二次验证已禁用');
            disable2FaForm.resetFields();
            await loadTwoFactorStatus();
        }
        setTwoFactorLoading(false);
    };

        return (
        <div>
            <PageHeader
                title="设置"
                subtitle="统一管理管理员密码、2FA 与平台接入提示，先把账号安全稳住，再继续其他控制面操作。"
            />

            <Space orientation="vertical" size="large" style={settingsStyles.fullWidth}>
                <SurfaceCard title="个人信息" tone="muted">
                    <div style={settingsStyles.profileGrid}>
                        <div>
                            <Text type="secondary">用户名</Text>
                            <div style={settingsStyles.valueText}>{admin?.username}</div>
                        </div>
                        <div>
                            <Text type="secondary">角色</Text>
                            <div style={settingsStyles.valueText}>
                                {getAdminRoleLabel(admin?.role)}
                            </div>
                        </div>
                    </div>
                </SurfaceCard>

                {mustChangePassword ? (
                    <Alert
                        type="warning"
                        showIcon
                        title="当前管理员仍在使用首次初始化的临时密码"
                        description="在设置新密码之前，系统会阻止访问控制台其他页面以及受保护的管理接口。先完成这一步，再继续配置邮箱、域名和 API 密钥。"
                    />
                ) : null}

                <SurfaceCard title={mustChangePassword ? '设置新的管理员密码' : '修改密码'}>
                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleChangePassword}
                        style={settingsStyles.passwordForm}
                    >
                        <Form.Item
                            name="oldPassword"
                            label="当前密码"
                            rules={[{ required: true, message: '请输入当前密码' }]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder="当前密码" />
                        </Form.Item>

                        <Form.Item
                            name="newPassword"
                            label="新密码"
                            rules={[
                                { required: true, message: '请输入新密码' },
                                { min: 8, message: '密码至少 8 个字符' },
                            ]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder="新密码" />
                        </Form.Item>

                        <Form.Item
                            name="confirmPassword"
                            label="确认新密码"
                            rules={[
                                { required: true, message: '请确认新密码' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('newPassword') === value) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(new Error('两次输入的密码不一致'));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
                        </Form.Item>
                        
                        <Form.Item>
                            <Button type="primary" htmlType="submit" loading={passwordLoading}>
                                {mustChangePassword ? '设置新密码并解锁系统' : '修改密码'}
                            </Button>
                        </Form.Item>
                    </Form>
                </SurfaceCard>

                {!mustChangePassword ? (
                    <SurfaceCard title="二次验证（2FA）" tone="muted">
                    {showTwoFactorStatusLoading ? (
                        <Text type="secondary">加载中...</Text>
                    ) : (
                        <Space orientation="vertical" size="middle" style={settingsStyles.fullWidth}>
                            <div>
                                <Text type="secondary">当前状态：</Text>{' '}
                                {effectiveTwoFactorStatus.enabled ? <Tag color="success">已启用</Tag> : <Tag>未启用</Tag>}
                                {effectiveTwoFactorStatus.pending && !effectiveTwoFactorStatus.enabled ? <Tag color="processing">待验证</Tag> : null}
                            </div>

                            {effectiveTwoFactorStatus.legacyEnv ? (
                                <Alert
                                    type="warning"
                                    showIcon
                                    title="当前账号使用环境变量 2FA（ADMIN_2FA_SECRET），暂不支持在界面中直接管理。"
                                />
                            ) : null}

                            {!effectiveTwoFactorStatus.enabled ? (
                                <Button
                                    type="primary"
                                    icon={<SafetyCertificateOutlined />}
                                    onClick={handleSetup2Fa}
                                    loading={twoFactorLoading}
                                >
                                    生成绑定密钥
                                </Button>
                            ) : null}

                            {visibleSetupData ? (
                                <SurfaceCard size="small" title="绑定信息" tone="muted">
                                    <Space orientation="vertical" style={settingsStyles.fullWidth}>
                                        <div style={settingsStyles.centeredText}>
                                            <Text type="secondary">扫码绑定（推荐）</Text>
                                            <div style={settingsStyles.marginTop8}>
                                                <QRCode value={visibleSetupData.otpauthUrl} size={180} />
                                            </div>
                                        </div>
                                        <div>
                                            <Text type="secondary">手动密钥（可复制）</Text>
                                            <div><Text copyable>{visibleSetupData.secret}</Text></div>
                                        </div>
                                        <div>
                                            <Text type="secondary">otpauth 链接（可复制）</Text>
                                            <div><Text copyable>{visibleSetupData.otpauthUrl}</Text></div>
                                        </div>
                                        <Input
                                            value={enableOtp}
                                            onChange={(e) => setEnableOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="输入验证器中的 6 位验证码"
                                            maxLength={6}
                                            prefix={<SafetyCertificateOutlined />}
                                        />
                                        <Button type="primary" onClick={handleEnable2Fa} loading={twoFactorLoading}>
                                            启用二次验证
                                        </Button>
                                    </Space>
                                </SurfaceCard>
                            ) : null}

                            {effectiveTwoFactorStatus.enabled ? (
                                <SurfaceCard size="small" title="禁用二次验证" tone="muted">
                                    <Form form={disable2FaForm} layout="vertical" onFinish={handleDisable2Fa}>
                                        <Form.Item
                                            name="password"
                                            label="当前密码"
                                            rules={[{ required: true, message: '请输入当前密码' }]}
                                        >
                                            <Input.Password prefix={<LockOutlined />} placeholder="当前密码" />
                                        </Form.Item>
                                        <Form.Item
                                            name="otp"
                                            label="验证码"
                                            rules={[
                                                { required: true, message: '请输入验证码' },
                                                { pattern: /^\d{6}$/, message: '请输入 6 位验证码' },
                                            ]}
                                        >
                                            <Input
                                                maxLength={6}
                                                prefix={<SafetyCertificateOutlined />}
                                                placeholder="6 位验证码"
                                            />
                                        </Form.Item>
                                        <Form.Item style={settingsStyles.noMarginBottom}>
                                            <Button danger htmlType="submit" loading={twoFactorLoading}>
                                                禁用二次验证
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
                    <SurfaceCard title="Provider OAuth 配置">
                        <Alert
                            type="info"
                            showIcon
                            title="Provider OAuth 配置已迁移到外部邮箱连接的各 Provider 添加入口"
                            description="Google OAuth 请到“外部邮箱连接 → 添加 Gmail 邮箱”；Microsoft OAuth 请到“外部邮箱连接 → 添加 Outlook 邮箱”。现在在对应 Provider 的添加弹窗里就可以手工填写回调地址、Client ID / Secret、Scopes，并直接生成授权链接完成认证。"
                        />
                    </SurfaceCard>
                ) : null}

                {!mustChangePassword ? (
                    <SurfaceCard title="API 使用说明" tone="muted">
                        <div style={settingsStyles.marginBottom16}>
                            <Text strong>外部 API 调用方式</Text>
                        </div>

                        <div style={settingsStyles.codePanelWithMargin}>
                            <Text code style={settingsStyles.codeLabel}>
                                # 通过 Header 传递访问密钥
                            </Text>
                            <Text code style={settingsStyles.codeBreakAll}>
                                curl -H "X-API-Key: your_api_key" https://your-domain.com/api/messages
                            </Text>
                        </div>

                        <div style={settingsStyles.codePanel}>
                            <Text code style={settingsStyles.codeLabel}>
                                # 不再支持 Query 参数传递访问密钥
                            </Text>
                            <Text code style={settingsStyles.codeBreakAll}>
                                请改用 Header：curl -H "X-API-Key: your_api_key" https://your-domain.com/api/messages?email=xxx@outlook.com
                            </Text>
                        </div>
                    </SurfaceCard>
                ) : null}
            </Space>
        </div>
    );
};

export default SettingsPage;

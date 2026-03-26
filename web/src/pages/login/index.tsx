import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { ApiOutlined, CloudServerOutlined, LockOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { authApi, mailboxPortalApi } from '../../api';
import { APP_CONSOLE_SUBTITLE, APP_NAME } from '../../constants/product';
import { useAuthStore } from '../../stores/authStore';
import { useMailboxAuthStore } from '../../stores/mailboxAuthStore';
import { getErrorMessage } from '../../utils/error';

const { Title, Text, Paragraph } = Typography;

interface LoginForm {
    username: string;
    password: string;
}

const LoginPage: FC = () => {
    const navigate = useNavigate();
    const { setAuth: setAdminAuth, clearAuth: clearAdminAuth } = useAuthStore();
    const { setAuth: setMailboxAuth, clearAuth: clearMailboxAuth } = useMailboxAuthStore();
    const [loading, setLoading] = useState(false);
    const [otpModalVisible, setOtpModalVisible] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);

    const finishLogin = (result: { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; mustChangePassword?: boolean; twoFactorEnabled?: boolean } }) => {
        clearMailboxAuth();
        setAdminAuth(result.token, result.admin);
        if (result.admin.mustChangePassword) {
            message.warning('这是首次初始化生成的临时密码，请先完成改密再继续使用系统');
            navigate('/settings');
            return;
        }
        message.success('登录成功');
        navigate('/');
    };

    const finishMailboxLogin = (result: { token: string; mailboxUser: { id: number; username: string; email?: string | null; mustChangePassword?: boolean; mailboxIds?: number[] } }) => {
        clearAdminAuth();
        setMailboxAuth(result.token, result.mailboxUser);
        message.success('邮箱门户登录成功');
        navigate('/mail/overview');
    };

    const handleSubmit = async (values: LoginForm) => {
        setLoading(true);
        try {
                const response = await authApi.login(values.username, values.password);
                if (response.code === 200) {
                    finishLogin(response.data as { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; mustChangePassword?: boolean; twoFactorEnabled?: boolean } });
                }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                setPendingCredentials({ username: values.username, password: values.password });
                setOtpCode('');
                setOtpModalVisible(true);
                message.info('该账号已启用二次验证，请输入 6 位验证码');
            } else if (errCode === 'INVALID_CREDENTIALS') {
                try {
                    const portalResponse = await mailboxPortalApi.login(values.username, values.password);
                    if (portalResponse.code === 200) {
                        finishMailboxLogin(portalResponse.data as { token: string; mailboxUser: { id: number; username: string; email?: string | null; mustChangePassword?: boolean; mailboxIds?: number[] } });
                    }
                } catch (portalErr) {
                    message.error(getErrorMessage(portalErr, '登录失败'));
                }
            } else {
                message.error(getErrorMessage(err, '登录失败'));
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
            message.error('请输入 6 位验证码');
            return;
        }

        setOtpLoading(true);
        try {
            const response = await authApi.login(pendingCredentials.username, pendingCredentials.password, otp);
            if (response.code === 200) {
                setOtpModalVisible(false);
                setPendingCredentials(null);
                setOtpCode('');
                finishLogin(response.data as { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; mustChangePassword?: boolean; twoFactorEnabled?: boolean } });
            }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                message.error('验证码错误，请重试');
            } else {
                message.error(getErrorMessage(err, '验证失败'));
            }
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: 'radial-gradient(circle at top left, rgba(88, 101, 242, 0.24), transparent 32%), linear-gradient(135deg, #e9eefb 0%, #f5f8fd 48%, #eef6fb 100%)',
            }}
        >
            <div style={{ width: 'min(1140px, 100%)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.18fr) minmax(360px, 430px)', gap: 24 }}>
                <Card
                    bordered={false}
                    style={{ borderRadius: 28, boxShadow: '0 28px 56px rgba(15, 23, 42, 0.10)' }}
                    styles={{ body: { padding: 36 } }}
                >
                    <Space direction="vertical" size={20} style={{ width: '100%' }}>
                        <Space wrap>
                            <Tag color="blue">Admin Console</Tag>
                            <Tag color="cyan">Control Plane</Tag>
                            <Tag color="purple">Mail Operations</Tag>
                        </Space>

                        <div>
                            <Title level={1} style={{ margin: 0, fontSize: 34 }}>{APP_NAME}</Title>
                            <Paragraph style={{ margin: '12px 0 0', color: '#475569', fontSize: 16, maxWidth: 680 }}>
                                {APP_CONSOLE_SUBTITLE}。从这里进入管理员控制台，统一处理外部邮箱连接、域名邮箱、门户用户、自动化访问密钥和邮件运行状态。
                            </Paragraph>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                            {[
                                { icon: <CloudServerOutlined />, title: '统一邮件控制面', desc: '把外部邮箱、域名邮箱、门户用户和消息流放进同一个运营视角。' },
                                { icon: <ApiOutlined />, title: '自动化接口可观测', desc: '查看访问密钥、最近自动化活动、Provider 分布和系统信号。' },
                                { icon: <SendOutlined />, title: '收发与入口闭环', desc: '入口、收件、发件、转发和门户体验都可以在这一套系统里完成。' },
                            ].map((item) => (
                                <div
                                    key={item.title}
                                    style={{
                                        borderRadius: 22,
                                        padding: 18,
                                        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                                        border: '1px solid rgba(148, 163, 184, 0.18)',
                                    }}
                                >
                                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                        <div
                                            style={{
                                                width: 42,
                                                height: 42,
                                                borderRadius: 14,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 18,
                                                color: '#5865f2',
                                                background: 'rgba(88, 101, 242, 0.12)',
                                            }}
                                        >
                                            {item.icon}
                                        </div>
                                        <div>
                                            <Text strong>{item.title}</Text>
                                            <div style={{ marginTop: 6 }}>
                                                <Text type="secondary">{item.desc}</Text>
                                            </div>
                                        </div>
                                    </Space>
                                </div>
                            ))}
                        </div>

                        <Alert
                            type="info"
                            showIcon
                            message="同一入口会自动兼容邮箱门户用户"
                            description="如果管理员认证失败，系统会自动尝试邮箱门户登录。因此你可以统一使用这个登录入口，而不需要先判断自己属于哪一类账号。"
                        />
                    </Space>
                </Card>

                <Card
                    bordered={false}
                    style={{ borderRadius: 28, boxShadow: '0 28px 56px rgba(15, 23, 42, 0.10)' }}
                    styles={{ body: { padding: 32 } }}
                >
                    <Space direction="vertical" size={20} style={{ width: '100%' }}>
                        <div style={{ textAlign: 'center' }}>
                            <Title level={3} style={{ marginBottom: 8 }}>登录管理控制台</Title>
                            <Text type="secondary">优先尝试管理员认证；若当前账号属于邮箱门户用户，会自动切到门户工作台。</Text>
                        </div>

                        <Form name="login" onFinish={handleSubmit} size="large" autoComplete="off">
                            <Form.Item name="username" label="用户名或邮箱" rules={[{ required: true, message: '请输入用户名或邮箱' }]}>
                                <Input prefix={<UserOutlined />} placeholder="用户名或邮箱" autoComplete="username" />
                            </Form.Item>

                            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                                <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
                            </Form.Item>

                            <Alert
                                type="warning"
                                showIcon
                                icon={<SafetyCertificateOutlined />}
                                message="如果账号启用了 2FA，下一步会要求输入 6 位验证码"
                                style={{ marginBottom: 16 }}
                            />

                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button type="primary" htmlType="submit" loading={loading} block size="large">
                                    进入管理控制台
                                </Button>
                            </Form.Item>
                        </Form>

                        <div style={{ paddingTop: 4 }}>
                            <Text type="secondary">适用于管理员、运营人员和需要临时进入门户工作台的邮箱用户入口。</Text>
                        </div>
                    </Space>
                </Card>
            </div>

            <Modal
                title="二次验证"
                open={otpModalVisible}
                onOk={handleOtpConfirm}
                onCancel={() => {
                    setOtpModalVisible(false);
                    setPendingCredentials(null);
                    setOtpCode('');
                }}
                okText="验证并登录"
                cancelText="取消"
                confirmLoading={otpLoading}
                destroyOnClose
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Text type="secondary">请输入验证器中的 6 位动态码</Text>
                    <Input
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        prefix={<SafetyCertificateOutlined />}
                        maxLength={6}
                        placeholder="6 位验证码"
                    />
                </Space>
            </Modal>
        </div>
    );
};

export default LoginPage;

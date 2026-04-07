import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Modal, Space, Typography, message } from 'antd';
import { ApiOutlined, CloudServerOutlined, LockOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { AuthSplitLayout } from '../../components';
import { portalAccountContract } from '../../contracts/portal/account';
import { authContract } from '../../contracts/shared/auth';
import { APP_CONSOLE_SUBTITLE, APP_NAME } from '../../constants/product';
import { useAuthStore } from '../../stores/authStore';
import { useMailboxAuthStore } from '../../stores/mailboxAuthStore';
import { fullWidthStyle, marginBottom16Style, noMarginBottomStyle } from '../../styles/common';
import { getErrorMessage } from '../../utils/error';
import type { Admin } from '../../stores/authStore';
import type { MailboxUser } from '../../stores/mailboxAuthStore';

const { Text } = Typography;

interface LoginForm {
    username: string;
    password: string;
}

const LoginPage: FC = () => {
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
            message.warning('这是首次初始化生成的临时密码，请先完成改密再继续使用系统');
            navigate('/settings');
            return;
        }
        message.success('登录成功');
        navigate('/');
    };

    const finishMailboxLogin = (result: { mailboxUser: MailboxUser }) => {
        clearAdminAuth();
        setFormError(null);
        setMailboxAuth(result.mailboxUser);
        message.success('邮箱门户登录成功');
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
                message.info('该账号已启用二次验证，请输入 6 位验证码');
            } else if (errCode === 'INVALID_CREDENTIALS') {
                try {
                    const portalResponse = await portalAccountContract.login(values.username, values.password);
                    if (portalResponse.code === 200) {
                        finishMailboxLogin(portalResponse.data);
                    }
                } catch (portalErr) {
                    const portalErrCode = String((portalErr as { code?: unknown })?.code || '').toUpperCase();
                    if (portalErrCode === 'INVALID_CREDENTIALS') {
                        setFormError('管理员与门户认证都未通过，请检查用户名和密码后重试。');
                    } else {
                        setFormError(getErrorMessage(portalErr, '管理员认证失败，且未能匹配到可用的门户账号。'));
                    }
                }
            } else {
                setFormError(getErrorMessage(err, '登录失败'));
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
                message.error('验证码错误，请重试');
            } else {
                message.error(getErrorMessage(err, '验证失败'));
            }
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <>
            <AuthSplitLayout
                tags={[
                    { color: 'blue', label: 'Admin Console' },
                    { color: 'cyan', label: 'Secure Access' },
                ]}
                title={APP_NAME}
                subtitle={`${APP_CONSOLE_SUBTITLE}。把外部邮箱连接、域名邮箱、门户用户与自动化入口收进同一个控制面，先看运行态，再进入对象页处理。`}
                features={[
                    { icon: <CloudServerOutlined />, title: '统一管理邮件资源', description: '把连接、域名邮箱、门户用户和运行态放进同一个管理界面。' },
                    { icon: <ApiOutlined />, title: '自动化入口可控', description: '访问密钥、调用记录和资源边界在控制台里统一收口。' },
                    { icon: <SendOutlined />, title: '收发链路闭环', description: '从接入到收件、发件和转发都保持在同一工作流里。' },
                ]}
                notice="同一入口会自动兼容邮箱门户用户；如果管理员认证失败，系统会自动尝试门户登录。"
                formTitle="登录管理控制台"
                formDescription="优先走管理员认证；如果当前账号属于门户用户，系统会自动切换到门户工作台。"
                footer={<Text type="secondary">适用于管理员与运营人员，也兼容需要临时进入门户工作台的邮箱用户。</Text>}
            >
                <Form name="login" onFinish={handleSubmit} size="large" autoComplete="off" onValuesChange={() => { if (formError) setFormError(null); }}>
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
                        title="如果账号启用了 2FA，下一步会要求输入 6 位验证码"
                        style={marginBottom16Style}
                    />

                    {formError ? (
                        <Alert
                            type="error"
                            showIcon
                            title="当前无法完成登录"
                            description={formError}
                            style={marginBottom16Style}
                        />
                    ) : null}

                    <Form.Item style={noMarginBottomStyle}>
                        <Button type="primary" htmlType="submit" loading={loading} block size="large">
                            进入管理控制台
                        </Button>
                    </Form.Item>
                </Form>
            </AuthSplitLayout>

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
                destroyOnHidden
            >
                <Space orientation="vertical" style={fullWidthStyle}>
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
        </>
    );
};

export default LoginPage;

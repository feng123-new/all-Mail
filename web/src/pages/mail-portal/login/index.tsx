import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Form, Input, Typography, message } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { AuthSplitLayout } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { type MailboxUser, useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { noMarginBottomStyle } from '../../../styles/common';
import { getErrorMessage } from '../../../utils/error';

const { Text } = Typography;
const PORTAL_LOGIN_PREFILL_PREFIX = 'all-mail:portal-login:';

interface PortalLoginPrefillPayload {
    password?: string;
    expiresAt?: number;
}

const MailPortalLoginPage = () => {
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
                message.success('邮箱门户登录成功');
                navigate(payload.mailboxUser.mustChangePassword ? '/mail/settings' : '/mail/overview');
            }
        } catch (error) {
            const errCode = String((error as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_CREDENTIALS') {
                setFormError('门户用户名或密码错误，请检查后重试。');
            } else {
                setFormError(getErrorMessage(error, '邮箱门户登录失败'));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthSplitLayout
            tags={[
                { color: 'blue', label: 'Mailbox Portal' },
                { color: 'cyan', label: 'User Workspace' },
            ]}
            title="邮箱门户"
            subtitle="给邮箱用户一个稳定、清晰的入口：先确认未读与可访问邮箱，再进入收 / 发件工作区处理具体任务。"
            features={[
                { icon: <MailOutlined />, title: '邮箱资源集中查看', description: '把可访问邮箱、未读状态和主要工作入口收进同一屏。' },
                { icon: <SendOutlined />, title: '收发件共用一个工作面', description: '查看收件、历史发件，并在允许发件时直接开始写信。' },
                { icon: <SafetyCertificateOutlined />, title: '安全状态集中处理', description: '首次密码提醒、转发策略和门户会话都在设置中心统一维护。' },
            ]}
            notice="门户用户名支持预填。如果你从管理员后台或用户通知里带了用户名参数进来，登录页会自动帮你填好用户名。"
            formTitle="登录邮箱门户"
            formDescription="默认使用门户用户名 + 密码登录；登录后会直接进入工作台。"
            footer={<Text type="secondary">如果门户账号仍处于首次密码状态，登录后会在工作台和设置中心看到明确提醒。</Text>}
        >
            <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off" onValuesChange={() => { if (formError) setFormError(null); }}>
                <Form.Item label="门户用户名" name="username" rules={[{ required: true, message: '请输入门户用户名' }]}> 
                    <Input prefix={<UserOutlined />} placeholder="门户用户名" autoComplete="username" size="large" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}> 
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" size="large" />
                </Form.Item>
                {formError ? (
                    <Alert
                        type="error"
                        showIcon
                        title="当前无法进入邮箱门户"
                        description={formError}
                        style={{ marginBottom: 16 }}
                    />
                ) : null}
                <Form.Item style={noMarginBottomStyle}>
                    <Button type="primary" htmlType="submit" loading={loading} block size="large">
                        进入门户工作台
                    </Button>
                </Form.Item>
            </Form>
        </AuthSplitLayout>
    );
};

export default MailPortalLoginPage;

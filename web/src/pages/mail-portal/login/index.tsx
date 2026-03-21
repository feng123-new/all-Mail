import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../../../api';
import { useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { getErrorMessage } from '../../../utils/error';

const { Title, Text, Paragraph } = Typography;
const PORTAL_LOGIN_PREFILL_PREFIX = 'all-mail:portal-login:';

interface PortalLoginPrefillPayload {
    password?: string;
    expiresAt?: number;
}

const MailPortalLoginPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setAuth } = useMailboxAuthStore();
    const [loading, setLoading] = useState(false);
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
            const response = await mailboxPortalApi.login(values.username, values.password);
            if (response.code === 200) {
                const payload = response.data as {
                    token: string;
                    mailboxUser: { id: number; username: string; email?: string | null; mustChangePassword?: boolean; mailboxIds?: number[] };
                };
                window.localStorage.removeItem(`${PORTAL_LOGIN_PREFILL_PREFIX}${values.username.trim()}`);
                setAuth(payload.token, payload.mailboxUser);
                message.success('邮箱门户登录成功');
                navigate('/mail/overview');
            }
        } catch (error) {
            message.error(getErrorMessage(error, '邮箱门户登录失败'));
        } finally {
            setLoading(false);
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
            <div style={{ width: 'min(1100px, 100%)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(360px, 420px)', gap: 24 }}>
                <Card
                    bordered={false}
                    style={{ borderRadius: 28, boxShadow: '0 28px 56px rgba(15, 23, 42, 0.10)' }}
                    styles={{ body: { padding: 36 } }}
                >
                    <Space direction="vertical" size={18} style={{ width: '100%' }}>
                        <Space wrap>
                            <Tag color="blue">Mailbox Portal</Tag>
                            <Tag color="cyan">Domain Mailboxes</Tag>
                            <Tag color="purple">Operator Friendly</Tag>
                        </Space>
                        <div>
                            <Title level={1} style={{ margin: 0, fontSize: 34 }}>邮箱门户</Title>
                            <Paragraph style={{ margin: '12px 0 0', color: '#475569', fontSize: 16, maxWidth: 620 }}>
                                给邮箱用户一个更像工作台的入口：先快速看自己能访问哪些邮箱，再进入收/发件、验证码提取、转发设置和密码维护。
                            </Paragraph>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                            {[
                                { icon: <MailOutlined />, title: '统一邮箱视角', desc: '把可访问邮箱、未读状态和收件域一屏看清。' },
                                { icon: <SendOutlined />, title: '有发件能力时直接写信', desc: '同一门户里查看收件、历史发件和即时发信。' },
                                { icon: <SafetyCertificateOutlined />, title: '安全动作可见', desc: '首次密码状态、转发策略和门户会话都能集中处理。' },
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
                            message="门户用户名支持预填"
                            description="如果你从管理员后台或用户通知里带了用户名参数进来，登录页会自动帮你填好用户名。"
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
                            <Title level={3} style={{ marginBottom: 8 }}>登录邮箱门户</Title>
                            <Text type="secondary">默认使用门户用户名 + 密码登录，登录后进入新的门户工作台。</Text>
                        </div>

                        <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
                            <Form.Item label="门户用户名" name="username" rules={[{ required: true, message: '请输入门户用户名' }]}>
                                <Input prefix={<UserOutlined />} placeholder="门户用户名" autoComplete="username" size="large" />
                            </Form.Item>
                            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                                <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" size="large" />
                            </Form.Item>
                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button type="primary" htmlType="submit" loading={loading} block size="large">
                                    进入门户工作台
                                </Button>
                            </Form.Item>
                        </Form>

                        <div style={{ paddingTop: 4 }}>
                            <Text type="secondary">如果你的门户账号被要求首次改密，登录后会在工作台和设置中心看到明显提醒。</Text>
                        </div>
                    </Space>
                </Card>
            </div>
        </div>
    );
};

export default MailPortalLoginPage;

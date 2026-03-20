import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../../../api';
import { useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { getErrorMessage } from '../../../utils/error';

const { Title, Text } = Typography;
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
                navigate('/mail/inbox');
            }
        } catch (error) {
            message.error(getErrorMessage(error, '邮箱门户登录失败'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fb' }}>
            <Card style={{ width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <Title level={3} style={{ marginBottom: 8 }}>Domain Mail</Title>
                    <Text type="secondary">邮箱用户登录入口，默认使用门户用户名 + 密码登录。</Text>
                </div>
                <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
                    <Form.Item label="门户用户名" name="username" rules={[{ required: true, message: '请输入门户用户名' }]}>
                        <Input prefix={<UserOutlined />} placeholder="门户用户名" autoComplete="username" />
                    </Form.Item>
                    <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                            登录邮箱门户
                        </Button>
                    </Form.Item>
                </Form>
            </Card>
        </div>
    );
};

export default MailPortalLoginPage;

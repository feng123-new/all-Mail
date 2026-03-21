import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, List, Row, Select, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../../../api';
import { requestData } from '../../../utils/request';
import { StatCard } from '../../../components';

const { Title, Text, Paragraph } = Typography;

interface MailboxItem {
    id: number;
    address: string;
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
}

interface SessionPayload {
    authenticated: boolean;
    mailboxUser: {
        id: number;
        username: string;
        email?: string | null;
        status: string;
        mustChangePassword?: boolean;
        lastLoginAt?: string | null;
    };
}

const MailPortalSettingsPage: React.FC = () => {
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [forwardLoading, setForwardLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [passwordForm] = Form.useForm();
    const [forwardForm] = Form.useForm();

    const loadMailboxes = useCallback(async () => {
        const result = await requestData<MailboxItem[]>(() => mailboxPortalApi.getMailboxes(), '获取邮箱列表失败', { silent: true });
        if (result) {
            setMailboxes(result);
            if (result[0]) {
                forwardForm.setFieldsValue({
                    mailboxId: result[0].id,
                    forwardMode: result[0].forwardMode || 'DISABLED',
                    forwardTo: result[0].forwardTo || undefined,
                });
            }
        }
    }, [forwardForm]);

    const loadSession = useCallback(async () => {
        const result = await requestData<SessionPayload>(() => mailboxPortalApi.getSession(), '获取会话信息失败', { silent: true });
        if (result) {
            setSession(result);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void Promise.all([loadMailboxes(), loadSession()]);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadMailboxes, loadSession]);

    const handlePasswordSubmit = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
        if (values.newPassword !== values.confirmPassword) {
            return;
        }
        setPasswordLoading(true);
        const result = await requestData(() => mailboxPortalApi.changePassword(values.oldPassword, values.newPassword), '修改密码失败');
        if (result) {
            passwordForm.resetFields();
            await loadSession();
        }
        setPasswordLoading(false);
    };

    const handleForwardSubmit = async (values: { mailboxId: number; forwardMode: 'DISABLED' | 'COPY' | 'MOVE'; forwardTo?: string }) => {
        setForwardLoading(true);
        const result = await requestData(() => mailboxPortalApi.updateForwarding({
            mailboxId: values.mailboxId,
            forwardMode: values.forwardMode,
            forwardTo: values.forwardMode === 'DISABLED' ? null : (values.forwardTo || null),
        }), '保存转发失败');
        if (result) {
            await loadMailboxes();
        }
        setForwardLoading(false);
    };

    const forwardingEnabledCount = useMemo(() => mailboxes.filter((item) => item.forwardMode && item.forwardMode !== 'DISABLED').length, [mailboxes]);
    const sendEnabledCount = useMemo(() => mailboxes.filter((item) => item.domain?.canSend).length, [mailboxes]);

    return (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <Card
                bordered={false}
                style={{
                    borderRadius: 24,
                    background: 'radial-gradient(circle at top left, rgba(88, 101, 242, 0.16), transparent 34%), linear-gradient(135deg, #ffffff 0%, #eef4ff 58%, #f8fbff 100%)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                }}
                styles={{ body: { padding: 28 } }}
            >
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Space wrap>
                        <Tag color="blue">Settings Center</Tag>
                        <Tag color="cyan">Mailbox Security</Tag>
                        {session?.mailboxUser.mustChangePassword ? <Tag color="warning">首次改密提醒</Tag> : <Tag color="success">安全状态正常</Tag>}
                    </Space>
                    <div>
                        <Title level={2} style={{ margin: 0 }}>设置中心</Title>
                        <Paragraph style={{ margin: '10px 0 0', color: '#475569' }}>
                            把密码、安全提示和邮箱转发集中到一处管理，不用在门户里来回切换页面。
                        </Paragraph>
                    </div>
                </Space>
            </Card>

            {session?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    message="当前账号仍处于首次密码状态"
                    description="为了避免门户长期使用初始密码，建议优先完成密码更新。"
                />
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={12} md={8}><StatCard title="可访问邮箱" value={mailboxes.length} icon={<ArrowRightOutlined />} iconBgColor="#5865f2" /></Col>
                <Col xs={12} md={8}><StatCard title="可发件邮箱" value={sendEnabledCount} icon={<SafetyCertificateOutlined />} iconBgColor="#0f766e" /></Col>
                <Col xs={12} md={8}><StatCard title="已开启转发" value={forwardingEnabledCount} icon={<LockOutlined />} iconBgColor="#7c3aed" /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={11}>
                    <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 24 } }}>
                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>密码与安全</Title>
                                <Text type="secondary">修改门户登录密码，首次登录用户建议尽快完成。</Text>
                            </div>
                            <Card bordered={false} style={{ borderRadius: 18, background: '#f8fafc' }} styles={{ body: { padding: 16 } }}>
                                <Space direction="vertical" size={6}>
                                    <Text type="secondary">当前账号</Text>
                                    <Text strong>{session?.mailboxUser.username || '-'}</Text>
                                    <Text type="secondary">最近登录：{session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : '暂无记录'}</Text>
                                </Space>
                            </Card>
                            <Form layout="vertical" form={passwordForm} onFinish={handlePasswordSubmit}>
                                <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                                    <Input.Password />
                                </Form.Item>
                                <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '密码至少 8 位' }]}>
                                    <Input.Password />
                                </Form.Item>
                                <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[
                                    { required: true, message: '请确认新密码' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('newPassword') === value) {
                                                return Promise.resolve();
                                            }
                                            return Promise.reject(new Error('两次输入的新密码不一致'));
                                        },
                                    }),
                                ]}>
                                    <Input.Password />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={passwordLoading}>更新密码</Button>
                            </Form>
                        </Space>
                    </Card>
                </Col>

                <Col xs={24} xl={13}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 24 } }}>
                            <Space direction="vertical" size={18} style={{ width: '100%' }}>
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>邮件转发</Title>
                                    <Text type="secondary">按邮箱单独控制是否转发，以及转发后保留副本还是只保留转发结果。</Text>
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>建议先从“保留副本并转发”开始，这样既不会打断当前收件查看，也更容易验证转发生效。</Text>
                                <Form layout="vertical" form={forwardForm} onFinish={handleForwardSubmit}>
                                    <Form.Item name="mailboxId" label="选择邮箱" rules={[{ required: true, message: '请选择邮箱' }]}>
                                        <Select options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
                                    </Form.Item>
                                    <Form.Item name="forwardMode" label="转发模式" rules={[{ required: true, message: '请选择转发模式' }]}> 
                                        <Select options={[{ value: 'DISABLED', label: '关闭' }, { value: 'COPY', label: '保留副本并转发' }, { value: 'MOVE', label: '转发后作为唯一副本' }]} />
                                    </Form.Item>
                                    <Form.Item noStyle shouldUpdate>
                                        {({ getFieldValue }) => getFieldValue('forwardMode') !== 'DISABLED' ? (
                                            <Form.Item name="forwardTo" label="转发目标邮箱" rules={[{ required: true, message: '请输入转发目标邮箱' }, { type: 'email', message: '请输入有效邮箱地址' }]}>
                                                <Input placeholder="target@example.com" />
                                            </Form.Item>
                                        ) : null}
                                    </Form.Item>
                                    <Button type="primary" htmlType="submit" loading={forwardLoading}>保存转发设置</Button>
                                </Form>
                            </Space>
                        </Card>

                        <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 24 } }}>
                            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                <div>
                                    <Title level={5} style={{ margin: 0 }}>当前邮箱转发概览</Title>
                                    <Text type="secondary">用来快速确认哪些邮箱启用了转发，哪些仍然只做收件。</Text>
                                </div>
                                <List
                                    dataSource={mailboxes}
                                    locale={{ emptyText: '暂无可访问邮箱' }}
                                    renderItem={(item) => (
                                        <List.Item key={item.id}>
                                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                <Space wrap>
                                                    <Text strong>{item.address}</Text>
                                                    <Tag color={item.domain?.canSend ? 'success' : 'default'}>{item.domain?.canSend ? '可发件' : '仅收件'}</Tag>
                                                    <Tag color={item.forwardMode && item.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
                                                        {item.forwardMode && item.forwardMode !== 'DISABLED' ? `转发 ${item.forwardMode}` : '未转发'}
                                                    </Tag>
                                                </Space>
                                                <Text type="secondary">目标：{item.forwardTo || '未配置'} · 域名：{item.domain?.name || '-'}</Text>
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            </Space>
                        </Card>
                    </Space>
                </Col>
            </Row>
        </Space>
    );
};

export default MailPortalSettingsPage;

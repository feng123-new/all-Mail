import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Alert, Button, Col, Form, Input, List, Row, Select, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, SurfaceCard } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { useMailboxAuthStore } from '../../../stores/mailboxAuthStore';
import { requestData } from '../../../utils/request';
import {
    fontSize12Style,
    fullWidthStyle,
    noMarginStyle,
} from '../../../styles/common';
import { shellPalette } from '../../../theme';

const { Title, Text } = Typography;

interface MailboxItem {
    id: number;
    address: string;
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    sendReady?: boolean;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
}

function getSendStatus(mailbox: MailboxItem) {
	if (mailbox.sendReady) {
		return { color: 'success' as const, label: '发件已就绪' };
	}
	if (mailbox.domain?.canSend) {
		return { color: 'warning' as const, label: '待配置发件' };
	}
	return { color: 'default' as const, label: '仅收件' };
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

interface ForwardingJobItem {
    id: string;
    status: 'PENDING' | 'RUNNING' | 'SENT' | 'FAILED' | 'SKIPPED';
    mode: 'COPY' | 'MOVE';
    forwardTo: string;
    attemptCount: number;
    lastError?: string | null;
    processedAt?: string | null;
    createdAt: string;
    nextAttemptAt?: string | null;
    inboundMessage: {
        id: string;
        subject?: string | null;
        fromAddress: string;
        finalAddress: string;
    };
}

const portalSettingsStyles = {
    fullWidth: fullWidthStyle,
    titleNoMargin: noMarginStyle,
    hintText: fontSize12Style,
    flexBetween: { justifyContent: 'space-between', width: '100%' },
    accountPanel: {
        borderRadius: 16,
        padding: 16,
        background: shellPalette.surfaceMuted,
        border: `1px solid ${shellPalette.border}`,
    },
} as const;

const MailPortalSettingsPage: FC = () => {
    const portalMailboxUser = useMailboxAuthStore((state) => state.mailboxUser);
    const mountedRef = useRef(true);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [forwardLoading, setForwardLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [forwardingJobs, setForwardingJobs] = useState<ForwardingJobItem[]>([]);
    const [session, setSession] = useState<SessionPayload | null>(null);
    const [passwordForm] = Form.useForm();
    const [forwardForm] = Form.useForm();
    const selectedMailboxId = Form.useWatch('mailboxId', forwardForm) as number | undefined;

    const syncForwardFormToMailbox = useCallback((mailbox?: MailboxItem | null) => {
        if (!mailbox || !mountedRef.current) {
            return;
        }

        forwardForm.setFieldsValue({
            mailboxId: mailbox.id,
            forwardMode: mailbox.forwardMode || 'DISABLED',
            forwardTo: mailbox.forwardTo || undefined,
        });
    }, [forwardForm]);

    const loadMailboxes = useCallback(async (preferredMailboxId?: number) => {
        const result = await requestData<MailboxItem[]>(() => portalAccountContract.getMailboxes(), '获取邮箱列表失败', { silent: true });
        if (result && mountedRef.current) {
            setMailboxes(result);
            const mailboxToFocus = result.find((item) => item.id === preferredMailboxId)
                || result.find((item) => item.id === selectedMailboxId)
                || result[0];
            syncForwardFormToMailbox(mailboxToFocus || null);
        }
    }, [selectedMailboxId, syncForwardFormToMailbox]);

    const loadForwardingJobs = useCallback(async (mailboxId?: number) => {
        if (!mailboxId) {
            setForwardingJobs([]);
            return;
        }

        const result = await requestData<{ list: ForwardingJobItem[] }>(
            () => portalAccountContract.getForwardingJobs({ mailboxId, page: 1, pageSize: 5 }),
            '获取最近转发结果失败',
            { silent: true }
        );
        if (mountedRef.current) {
            setForwardingJobs(result?.list || []);
        }
    }, []);

    const loadSession = useCallback(async () => {
        const result = await requestData<SessionPayload>(() => portalAccountContract.getSession(), '获取会话信息失败', { silent: true });
        if (result && mountedRef.current) {
            setSession(result);
            useMailboxAuthStore.setState((state) => ({
                mailboxUser: state.mailboxUser
                    ? { ...state.mailboxUser, ...result.mailboxUser }
                    : state.mailboxUser,
            }));
        }
    }, []);

    const mustChangePassword = Boolean(session?.mailboxUser.mustChangePassword ?? portalMailboxUser?.mustChangePassword);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            void loadSession();
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [loadSession]);

    useEffect(() => {
        if (mustChangePassword) {
            forwardForm.resetFields();
            return;
        }

        const timer = setTimeout(() => {
            void loadMailboxes();
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [forwardForm, loadMailboxes, mustChangePassword]);

    useEffect(() => {
        if (mustChangePassword) {
            const timer = setTimeout(() => {
                setForwardingJobs([]);
            }, 0);
            return () => {
                clearTimeout(timer);
            };
        }

        const timer = setTimeout(() => {
            void loadForwardingJobs(selectedMailboxId);
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [loadForwardingJobs, mustChangePassword, selectedMailboxId]);

    const handlePasswordSubmit = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
        if (values.newPassword !== values.confirmPassword) {
            return;
        }
        setPasswordLoading(true);
        const result = await requestData(() => portalAccountContract.changePassword(values.oldPassword, values.newPassword), '修改密码失败');
        if (result && mountedRef.current) {
            passwordForm.resetFields();
            await loadSession();
            await loadMailboxes();
        }
        if (mountedRef.current) {
            setPasswordLoading(false);
        }
    };

    const handleForwardSubmit = async (values: { mailboxId: number; forwardMode: 'DISABLED' | 'COPY' | 'MOVE'; forwardTo?: string }) => {
        setForwardLoading(true);
        const result = await requestData(() => portalAccountContract.updateForwarding({
            mailboxId: values.mailboxId,
            forwardMode: values.forwardMode,
            forwardTo: values.forwardMode === 'DISABLED' ? null : (values.forwardTo || null),
        }), '保存转发失败');
        if (result && mountedRef.current) {
            await loadMailboxes(values.mailboxId);
            await loadForwardingJobs(values.mailboxId);
        }
        if (mountedRef.current) {
            setForwardLoading(false);
        }
    };

    const forwardingEnabledCount = useMemo(() => mailboxes.filter((item) => item.forwardMode && item.forwardMode !== 'DISABLED').length, [mailboxes]);
    const sendEnabledCount = useMemo(() => mailboxes.filter((item) => item.sendReady).length, [mailboxes]);
    const selectedMailbox = useMemo(() => mailboxes.find((item) => item.id === selectedMailboxId), [mailboxes, selectedMailboxId]);

    return (
        <Space orientation="vertical" size={20} style={portalSettingsStyles.fullWidth}>
            <PageHeader
                eyebrow="Mailbox portal"
                title="设置中心"
                subtitle="把密码、安全提示和邮箱转发配置集中到一处管理，不用在门户里来回切换页面。"
            />

            <SurfaceCard tone="muted" bodyStyle={{ padding: 20 }}>
                <Space wrap size={10} style={portalSettingsStyles.flexBetween}>
                    <Space wrap>
                        <Tag color="blue">Settings Center</Tag>
                        <Tag color="cyan">Mailbox Security</Tag>
                        {session?.mailboxUser.mustChangePassword ? <Tag color="warning">首次改密提醒</Tag> : <Tag color="success">安全状态正常</Tag>}
                    </Space>
                    <Typography.Text type="secondary">当前账号：{session?.mailboxUser.username || '-'} · 最近登录：{session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : '暂无记录'}</Typography.Text>
                </Space>
            </SurfaceCard>

            {session?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    title="当前账号仍处于首次密码状态"
                    description="为了避免门户长期使用初始密码，建议优先完成密码更新。"
                />
            ) : null}

            {!mustChangePassword ? (
                <Row gutter={[16, 16]}>
                    <Col xs={12} md={8}><StatCard title="可访问邮箱" value={mailboxes.length} icon={<ArrowRightOutlined />} iconBgColor={shellPalette.primary} /></Col>
                    <Col xs={12} md={8}><StatCard title="可发件邮箱" value={sendEnabledCount} icon={<SafetyCertificateOutlined />} iconBgColor={shellPalette.accent} /></Col>
                    <Col xs={12} md={8}><StatCard title="已开启转发" value={forwardingEnabledCount} icon={<LockOutlined />} iconBgColor="#4f46e5" /></Col>
                </Row>
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={11}>
                    <SurfaceCard>
                        <Space orientation="vertical" size={18} style={portalSettingsStyles.fullWidth}>
                            <div>
                                <Title level={4} style={portalSettingsStyles.titleNoMargin}>密码与安全</Title>
                                <Text type="secondary">修改门户登录密码，首次登录用户建议尽快完成。</Text>
                            </div>
                            <div style={portalSettingsStyles.accountPanel}>
                                <Space orientation="vertical" size={6}>
                                    <Text type="secondary">当前账号</Text>
                                    <Text strong>{session?.mailboxUser.username || '-'}</Text>
                                    <Text type="secondary">最近登录：{session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : '暂无记录'}</Text>
                                </Space>
                            </div>
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
                    </SurfaceCard>
                </Col>

                {!mustChangePassword ? (
                <Col xs={24} xl={13}>
                    <Space orientation="vertical" size={16} style={portalSettingsStyles.fullWidth}>
                        <SurfaceCard>
                            <Space orientation="vertical" size={18} style={portalSettingsStyles.fullWidth}>
                                <div>
                                    <Title level={4} style={portalSettingsStyles.titleNoMargin}>邮件转发</Title>
                                    <Text type="secondary">按邮箱设置转发目标与模式，新收到的邮件会按规则自动执行转发。</Text>
                                </div>
                                <Alert
                                    type="info"
                                    showIcon
                                    title="当前版本会对新收到的邮件执行转发"
                                    description="这里会记录目标邮箱和 COPY / MOVE 模式；开启后只影响新收到的邮件，不会回放历史邮件。"
                                />
                                <Form layout="vertical" form={forwardForm} onFinish={handleForwardSubmit}>
                                    <Form.Item name="mailboxId" label="选择邮箱" rules={[{ required: true, message: '请选择邮箱' }]}>
                                        <Select
                                            options={mailboxes.map((item) => ({ value: item.id, label: item.address }))}
                                            onChange={(value) => {
                                                const mailbox = mailboxes.find((item) => item.id === value);
                                                syncForwardFormToMailbox(mailbox || null);
                                            }}
                                        />
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
                        </SurfaceCard>

                        <SurfaceCard tone="muted">
                            <Space orientation="vertical" size={14} style={portalSettingsStyles.fullWidth}>
                                <div>
                                    <Title level={5} style={portalSettingsStyles.titleNoMargin}>当前邮箱转发概览</Title>
                                    <Text type="secondary">用来快速确认哪些邮箱启用了转发，哪些仍然只做收件。</Text>
                                </div>
                                <List
                                    dataSource={mailboxes}
                                    locale={{ emptyText: '暂无可访问邮箱' }}
                                    renderItem={(item) => (
                                        <List.Item key={item.id}>
                                            <Space orientation="vertical" size={4} style={portalSettingsStyles.fullWidth}>
                                                <Space wrap>
											<Text strong>{item.address}</Text>
											<Tag color={getSendStatus(item).color}>{getSendStatus(item).label}</Tag>
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
                        </SurfaceCard>

                        <SurfaceCard tone="muted">
                            <Space orientation="vertical" size={14} style={portalSettingsStyles.fullWidth}>
                                <div>
                                    <Title level={5} style={portalSettingsStyles.titleNoMargin}>最近转发结果</Title>
                                    <Text type="secondary">这里会告诉你选中邮箱最近是否真的完成了转发，避免 MOVE 模式下邮件消失却无法确认结果。</Text>
                                </div>
                                {selectedMailbox?.forwardMode === 'MOVE' ? (
                                    <Alert
                                        type="info"
                                        showIcon
                                        title="当前邮箱启用了 MOVE 转发"
                                        description="当转发成功后，邮件会从门户收件视图隐藏；这里保留最近一次成功/失败结果，帮助你确认闭环是否完成。"
                                    />
                                ) : null}
                                <List
                                    dataSource={forwardingJobs}
                                    locale={{ emptyText: '当前邮箱暂无最近转发记录' }}
                                    renderItem={(item) => (
                                        <List.Item key={item.id}>
                                            <Space orientation="vertical" size={4} style={portalSettingsStyles.fullWidth}>
                                                <Space wrap>
                                                    <Tag color={item.status === 'SENT' ? 'success' : item.status === 'FAILED' ? 'error' : item.status === 'SKIPPED' ? 'default' : 'processing'}>{item.status}</Tag>
                                                    <Tag color={item.mode === 'MOVE' ? 'geekblue' : 'purple'}>{item.mode}</Tag>
                                                    <Text strong>{item.inboundMessage.subject || '(无主题)'}</Text>
                                                </Space>
                                                <Text type="secondary">来自：{item.inboundMessage.fromAddress} · 目标：{item.forwardTo}</Text>
                                                <Text type="secondary">处理时间：{item.processedAt ? new Date(item.processedAt).toLocaleString() : '待处理'} · 下次重试：{item.nextAttemptAt ? new Date(item.nextAttemptAt).toLocaleString() : '无'}</Text>
                                                {item.lastError ? <Text type="danger">{item.lastError}</Text> : null}
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            </Space>
                        </SurfaceCard>
                    </Space>
                </Col>
                ) : null}
            </Row>
        </Space>
    );
};

export default MailPortalSettingsPage;

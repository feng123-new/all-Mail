import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Alert, Button, Col, Empty, Form, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PageHeader, StatCard, SurfaceCard } from '../../../components';
import { portalAccountContract } from '../../../contracts/portal/account';
import { useI18n } from '../../../i18n';
import { defineMessage, type TranslationInput } from '../../../i18n/messages';
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

function getSendStatus(mailbox: MailboxItem, t: (source: TranslationInput, params?: Record<string, number | string>) => string) {
	if (mailbox.sendReady) {
		return { color: 'success' as const, label: t(portalSettingsI18n.sendReady) };
	}
	if (mailbox.domain?.canSend) {
		return { color: 'warning' as const, label: t(portalSettingsI18n.sendingPending) };
	}
	return { color: 'default' as const, label: t(portalSettingsI18n.inboxOnly) };
}

function getForwardModeOptionLabel(mode: 'DISABLED' | 'COPY' | 'MOVE', t: (source: TranslationInput) => string) {
    if (mode === 'COPY') {
        return t(portalSettingsI18n.forwardModeCopy);
    }

    if (mode === 'MOVE') {
        return t(portalSettingsI18n.forwardModeMove);
    }

    return t(portalSettingsI18n.forwardModeDisabled);
}

function getForwardStatusLabel(mode: 'DISABLED' | 'COPY' | 'MOVE' | undefined, t: (source: TranslationInput, params?: Record<string, number | string>) => string) {
    if (!mode || mode === 'DISABLED') {
        return t(portalSettingsI18n.notForwarding);
    }

    return getForwardModeOptionLabel(mode, t);
}

function getForwardingJobStatusLabel(status: ForwardingJobItem['status'], t: (source: TranslationInput) => string) {
    if (status === 'SENT') {
        return t(portalSettingsI18n.jobSent);
    }

    if (status === 'FAILED') {
        return t(portalSettingsI18n.jobFailed);
    }

    if (status === 'SKIPPED') {
        return t(portalSettingsI18n.jobSkipped);
    }

    if (status === 'RUNNING') {
        return t(portalSettingsI18n.jobRunning);
    }

    return t(portalSettingsI18n.jobPending);
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

const portalSettingsI18n = {
    eyebrow: defineMessage('portalSettings.eyebrow', '邮箱门户', 'Mailbox portal'),
    title: defineMessage('portalSettings.title', '设置中心', 'Settings center'),
    subtitle: defineMessage('portalSettings.subtitle', '把密码、安全提示和邮箱转发配置集中到一处管理，不用在门户里来回切换页面。', 'Manage password, security hints, and mailbox forwarding configuration in one place without bouncing around the portal.'),
    passwordAlertTitle: defineMessage('portalSettings.passwordAlertTitle', '当前账号仍处于首次密码状态', 'This account is still using the initial password'),
    passwordAlertDescription: defineMessage('portalSettings.passwordAlertDescription', '为了避免门户长期使用初始密码，建议优先完成密码更新。', 'Update the password first so the portal does not keep using the initial credential.'),
    accessibleMailboxes: defineMessage('portalSettings.stats.accessibleMailboxes', '可访问邮箱', 'Accessible mailboxes'),
    sendEnabledMailboxes: defineMessage('portalSettings.stats.sendEnabledMailboxes', '可发件邮箱', 'Send-enabled mailboxes'),
    forwardingEnabled: defineMessage('portalSettings.stats.forwardingEnabled', '已开启转发', 'Forwarding enabled'),
    sendReady: defineMessage('portalSettings.status.sendReady', '发件已就绪', 'Ready to send'),
    sendingPending: defineMessage('portalSettings.status.sendingPending', '待配置发件', 'Sending pending setup'),
    inboxOnly: defineMessage('portalSettings.status.inboxOnly', '仅收件', 'Inbox only'),
    forwardModeCopy: defineMessage('portalSettings.forwardMode.copy', '保留副本并转发', 'Forward and keep a copy'),
    forwardModeMove: defineMessage('portalSettings.forwardMode.move', '转发后作为唯一副本', 'Forward and keep it as the only copy'),
    forwardModeDisabled: defineMessage('portalSettings.forwardMode.disabled', '关闭', 'Disabled'),
    notForwarding: defineMessage('portalSettings.forwardStatus.disabled', '未转发', 'Not forwarding'),
    jobSent: defineMessage('portalSettings.jobStatus.sent', '已发送', 'Sent'),
    jobFailed: defineMessage('portalSettings.jobStatus.failed', '失败', 'Failed'),
    jobSkipped: defineMessage('portalSettings.jobStatus.skipped', '已跳过', 'Skipped'),
    jobRunning: defineMessage('portalSettings.jobStatus.running', '处理中', 'Running'),
    jobPending: defineMessage('portalSettings.jobStatus.pending', '待处理', 'Pending'),
    settingsCenterTag: defineMessage('portalSettings.tags.settingsCenter', 'Settings Center', 'Settings Center'),
    mailboxSecurityTag: defineMessage('portalSettings.tags.mailboxSecurity', 'Mailbox Security', 'Mailbox Security'),
    firstPasswordReminder: defineMessage('portalSettings.tags.firstPasswordReminder', '首次改密提醒', 'Initial password reminder'),
    securityHealthy: defineMessage('portalSettings.tags.securityHealthy', '安全状态正常', 'Security healthy'),
    currentAccountSummary: defineMessage('portalSettings.currentAccountSummary', '当前账号：{username} · 最近登录：{lastLogin}', 'Current account: {username} · Last sign-in: {lastLogin}'),
    currentAccountLabel: defineMessage('portalSettings.currentAccountLabel', '当前账号', 'Current account'),
    noRecord: defineMessage('portalSettings.noRecord', '暂无记录', 'No record yet'),
    latestLogin: defineMessage('portalSettings.latestLogin', '最近登录：{lastLogin}', 'Last sign-in: {lastLogin}'),
    fetchMailboxListFailed: defineMessage('portalSettings.fetchMailboxListFailed', '获取邮箱列表失败', 'Failed to load the mailbox list'),
    fetchForwardingResultsFailed: defineMessage('portalSettings.fetchForwardingResultsFailed', '获取最近转发结果失败', 'Failed to load recent forwarding results'),
    fetchSessionFailed: defineMessage('portalSettings.fetchSessionFailed', '获取会话信息失败', 'Failed to load the session'),
    changePasswordFailed: defineMessage('portalSettings.changePasswordFailed', '修改密码失败', 'Failed to change the password'),
    saveForwardingFailed: defineMessage('portalSettings.saveForwardingFailed', '保存转发失败', 'Failed to save forwarding settings'),
    updatePassword: defineMessage('portalSettings.updatePassword', '更新密码', 'Update password'),
    selectMailbox: defineMessage('portalSettings.selectMailbox', '选择邮箱', 'Select mailbox'),
    selectMailboxRequired: defineMessage('portalSettings.selectMailboxRequired', '请选择邮箱', 'Select a mailbox'),
    configureTargetMissing: defineMessage('portalSettings.configureTargetMissing', '未配置', 'Not configured'),
    targetDomain: defineMessage('portalSettings.targetDomain', '目标：{target} · 域名：{domain}', 'Target: {target} · Domain: {domain}'),
    fromTarget: defineMessage('portalSettings.fromTarget', '来自：{from} · 目标：{target}', 'From: {from} · Target: {target}'),
    noSubject: defineMessage('portalSettings.noSubject', '(无主题)', '(No subject)'),
    processingWindow: defineMessage('portalSettings.processingWindow', '处理时间：{processedAt} · 下次重试：{nextAttemptAt}', 'Processed at: {processedAt} · Next retry: {nextAttemptAt}'),
    none: defineMessage('portalSettings.none', '无', 'None'),
    passwordSecurityTitle: defineMessage('portalSettings.passwordSecurityTitle', '密码与安全', 'Password and security'),
    passwordSecuritySubtitle: defineMessage('portalSettings.passwordSecuritySubtitle', '修改门户登录密码，首次登录用户建议尽快完成。', 'Change the portal sign-in password. Users on the initial password should do this first.'),
    currentPassword: defineMessage('portalSettings.currentPassword', '当前密码', 'Current password'),
    currentPasswordRequired: defineMessage('portalSettings.currentPasswordRequired', '请输入当前密码', 'Enter the current password'),
    newPassword: defineMessage('portalSettings.newPassword', '新密码', 'New password'),
    newPasswordRequired: defineMessage('portalSettings.newPasswordRequired', '请输入新密码', 'Enter a new password'),
    passwordMinLength: defineMessage('portalSettings.passwordMinLength', '密码至少 8 位', 'Password must be at least 8 characters'),
    confirmNewPassword: defineMessage('portalSettings.confirmNewPassword', '确认新密码', 'Confirm the new password'),
    confirmNewPasswordRequired: defineMessage('portalSettings.confirmNewPasswordRequired', '请确认新密码', 'Confirm the new password'),
    passwordMismatch: defineMessage('portalSettings.passwordMismatch', '两次输入的新密码不一致', 'The two new passwords do not match'),
    forwardingTitle: defineMessage('portalSettings.forwardingTitle', '邮件转发', 'Mail forwarding'),
    forwardingSubtitle: defineMessage('portalSettings.forwardingSubtitle', '按邮箱设置转发目标与模式，新收到的邮件会按规则自动执行转发。', 'Configure forwarding target and mode per mailbox. New inbound mail will forward according to the rule.'),
    newMailForwardingTitle: defineMessage('portalSettings.newMailForwardingTitle', '当前版本会对新收到的邮件执行转发', 'This version forwards only newly received mail'),
    newMailForwardingDescription: defineMessage('portalSettings.newMailForwardingDescription', '这里会记录目标邮箱和 COPY / MOVE 模式；开启后只影响新收到的邮件，不会回放历史邮件。', 'The target mailbox and COPY / MOVE mode are recorded here. When enabled, forwarding only affects newly received mail and does not replay historical messages.'),
    forwardModeLabel: defineMessage('portalSettings.forwardModeLabel', '转发模式', 'Forwarding mode'),
    forwardModeRequired: defineMessage('portalSettings.forwardModeRequired', '请选择转发模式', 'Select a forwarding mode'),
    forwardTargetEmail: defineMessage('portalSettings.forwardTargetEmail', '转发目标邮箱', 'Forwarding target mailbox'),
    forwardTargetRequired: defineMessage('portalSettings.forwardTargetRequired', '请输入转发目标邮箱', 'Enter the forwarding target mailbox'),
    forwardTargetPlaceholder: defineMessage('portalSettings.forwardTargetPlaceholder', 'target@example.com', 'target@example.com'),
    validEmailRequired: defineMessage('portalSettings.validEmailRequired', '请输入有效邮箱地址', 'Enter a valid email address'),
    saveForwarding: defineMessage('portalSettings.saveForwarding', '保存转发设置', 'Save forwarding settings'),
    forwardingOverviewTitle: defineMessage('portalSettings.forwardingOverviewTitle', '当前邮箱转发概览', 'Forwarding overview for the current mailbox'),
    forwardingOverviewSubtitle: defineMessage('portalSettings.forwardingOverviewSubtitle', '用来快速确认哪些邮箱启用了转发，哪些仍然只做收件。', 'Quickly confirm which mailboxes already forward and which remain inbox-only.'),
    noAccessibleMailboxes: defineMessage('portalSettings.noAccessibleMailboxes', '暂无可访问邮箱', 'No accessible mailboxes yet'),
    recentForwardingTitle: defineMessage('portalSettings.recentForwardingTitle', '最近转发结果', 'Recent forwarding results'),
    recentForwardingSubtitle: defineMessage('portalSettings.recentForwardingSubtitle', '这里会告诉你选中邮箱最近是否真的完成了转发，避免 MOVE 模式下邮件消失却无法确认结果。', 'This shows whether forwarding for the selected mailbox actually completed recently, so MOVE mode does not make messages disappear without proof.'),
    moveForwardingTitle: defineMessage('portalSettings.moveForwardingTitle', '当前邮箱启用了 MOVE 转发', 'This mailbox uses MOVE forwarding'),
    moveForwardingDescription: defineMessage('portalSettings.moveForwardingDescription', '当转发成功后，邮件会从门户收件视图隐藏；这里保留最近一次成功/失败结果，帮助你确认闭环是否完成。', 'After a successful forward, the message is hidden from the portal inbox view. The latest success or failure is kept here so you can confirm the loop completed.'),
    noRecentForwarding: defineMessage('portalSettings.noRecentForwarding', '当前邮箱暂无最近转发记录', 'No recent forwarding records for this mailbox'),
} as const;

const MailPortalSettingsPage: FC = () => {
    const { t } = useI18n();
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
        const result = await requestData<MailboxItem[]>(() => portalAccountContract.getMailboxes(), t(portalSettingsI18n.fetchMailboxListFailed), { silent: true });
        if (result && mountedRef.current) {
            setMailboxes(result);
            const mailboxToFocus = result.find((item) => item.id === preferredMailboxId)
                || result.find((item) => item.id === selectedMailboxId)
                || result[0];
            syncForwardFormToMailbox(mailboxToFocus || null);
        }
    }, [selectedMailboxId, syncForwardFormToMailbox, t]);

    const loadForwardingJobs = useCallback(async (mailboxId?: number) => {
        if (!mailboxId) {
            setForwardingJobs([]);
            return;
        }

        const result = await requestData<{ list: ForwardingJobItem[] }>(
            () => portalAccountContract.getForwardingJobs({ mailboxId, page: 1, pageSize: 5 }),
            t(portalSettingsI18n.fetchForwardingResultsFailed),
            { silent: true }
        );
        if (mountedRef.current) {
            setForwardingJobs(result?.list || []);
        }
    }, [t]);

    const loadSession = useCallback(async () => {
        const result = await requestData<SessionPayload>(() => portalAccountContract.getSession(), t(portalSettingsI18n.fetchSessionFailed), { silent: true });
        if (result && mountedRef.current) {
            setSession(result);
            useMailboxAuthStore.setState((state) => ({
                mailboxUser: state.mailboxUser
                    ? { ...state.mailboxUser, ...result.mailboxUser }
                    : state.mailboxUser,
            }));
        }
    }, [t]);

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
        const result = await requestData(() => portalAccountContract.changePassword(values.oldPassword, values.newPassword), t(portalSettingsI18n.changePasswordFailed));
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
        }), t(portalSettingsI18n.saveForwardingFailed));
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
                eyebrow={t(portalSettingsI18n.eyebrow)}
                title={t(portalSettingsI18n.title)}
                subtitle={t(portalSettingsI18n.subtitle)}
            />

            <SurfaceCard tone="muted" bodyStyle={{ padding: 20 }}>
                    <Space wrap size={10} style={portalSettingsStyles.flexBetween}>
                        <Space wrap>
                            <Tag color="blue">{t(portalSettingsI18n.settingsCenterTag)}</Tag>
                            <Tag color="cyan">{t(portalSettingsI18n.mailboxSecurityTag)}</Tag>
                            {session?.mailboxUser.mustChangePassword ? <Tag color="warning">{t(portalSettingsI18n.firstPasswordReminder)}</Tag> : <Tag color="success">{t(portalSettingsI18n.securityHealthy)}</Tag>}
                        </Space>
                        <Typography.Text type="secondary">{t(portalSettingsI18n.currentAccountSummary, { username: session?.mailboxUser.username || '-', lastLogin: session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : t(portalSettingsI18n.noRecord) })}</Typography.Text>
                    </Space>
                </SurfaceCard>

            {session?.mailboxUser.mustChangePassword ? (
                <Alert
                    type="warning"
                    showIcon
                    title={t(portalSettingsI18n.passwordAlertTitle)}
                    description={t(portalSettingsI18n.passwordAlertDescription)}
                />
            ) : null}

            {!mustChangePassword ? (
                <Row gutter={[16, 16]}>
                    <Col xs={12} md={8}><StatCard title={t(portalSettingsI18n.accessibleMailboxes)} value={mailboxes.length} icon={<ArrowRightOutlined />} iconBgColor={shellPalette.primary} /></Col>
                    <Col xs={12} md={8}><StatCard title={t(portalSettingsI18n.sendEnabledMailboxes)} value={sendEnabledCount} icon={<SafetyCertificateOutlined />} iconBgColor={shellPalette.accent} /></Col>
                    <Col xs={12} md={8}><StatCard title={t(portalSettingsI18n.forwardingEnabled)} value={forwardingEnabledCount} icon={<LockOutlined />} iconBgColor="#4f46e5" /></Col>
                </Row>
            ) : null}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={11}>
                    <SurfaceCard>
                        <Space orientation="vertical" size={18} style={portalSettingsStyles.fullWidth}>
                            <div>
                                <Title level={4} style={portalSettingsStyles.titleNoMargin}>{t(portalSettingsI18n.passwordSecurityTitle)}</Title>
                                <Text type="secondary">{t(portalSettingsI18n.passwordSecuritySubtitle)}</Text>
                            </div>
                            <div style={portalSettingsStyles.accountPanel}>
                                <Space orientation="vertical" size={6}>
                                    <Text type="secondary">{t(portalSettingsI18n.currentAccountLabel)}</Text>
                                    <Text strong>{session?.mailboxUser.username || '-'}</Text>
                                    <Text type="secondary">{t(portalSettingsI18n.latestLogin, { lastLogin: session?.mailboxUser.lastLoginAt ? new Date(session.mailboxUser.lastLoginAt).toLocaleString() : t(portalSettingsI18n.noRecord) })}</Text>
                                </Space>
                            </div>
                            <Form layout="vertical" form={passwordForm} onFinish={handlePasswordSubmit}>
                                <Form.Item name="oldPassword" label={t(portalSettingsI18n.currentPassword)} rules={[{ required: true, message: t(portalSettingsI18n.currentPasswordRequired) }]}>
                                    <Input.Password />
                                </Form.Item>
                                <Form.Item name="newPassword" label={t(portalSettingsI18n.newPassword)} rules={[{ required: true, message: t(portalSettingsI18n.newPasswordRequired) }, { min: 8, message: t(portalSettingsI18n.passwordMinLength) }]}>
                                    <Input.Password />
                                </Form.Item>
                                <Form.Item name="confirmPassword" label={t(portalSettingsI18n.confirmNewPassword)} dependencies={['newPassword']} rules={[
                                    { required: true, message: t(portalSettingsI18n.confirmNewPasswordRequired) },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('newPassword') === value) {
                                                return Promise.resolve();
                                            }
                                            return Promise.reject(new Error(t(portalSettingsI18n.passwordMismatch)));
                                        },
                                    }),
                                ]}>
                                    <Input.Password />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={passwordLoading}>{t(portalSettingsI18n.updatePassword)}</Button>
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
                                    <Title level={4} style={portalSettingsStyles.titleNoMargin}>{t(portalSettingsI18n.forwardingTitle)}</Title>
                                    <Text type="secondary">{t(portalSettingsI18n.forwardingSubtitle)}</Text>
                                </div>
                                <Alert
                                    type="info"
                                    showIcon
                                    title={t(portalSettingsI18n.newMailForwardingTitle)}
                                    description={t(portalSettingsI18n.newMailForwardingDescription)}
                                />
                                <Form layout="vertical" form={forwardForm} onFinish={handleForwardSubmit}>
                                    <Form.Item name="mailboxId" label={t(portalSettingsI18n.selectMailbox)} rules={[{ required: true, message: t(portalSettingsI18n.selectMailboxRequired) }]}>
                                        <Select
                                            options={mailboxes.map((item) => ({ value: item.id, label: item.address }))}
                                            onChange={(value) => {
                                                const mailbox = mailboxes.find((item) => item.id === value);
                                                syncForwardFormToMailbox(mailbox || null);
                                            }}
                                        />
                                    </Form.Item>
                                    <Form.Item name="forwardMode" label={t(portalSettingsI18n.forwardModeLabel)} rules={[{ required: true, message: t(portalSettingsI18n.forwardModeRequired) }]}> 
                                        <Select options={[{ value: 'DISABLED', label: t(portalSettingsI18n.forwardModeDisabled) }, { value: 'COPY', label: t(portalSettingsI18n.forwardModeCopy) }, { value: 'MOVE', label: t(portalSettingsI18n.forwardModeMove) }]} />
                                    </Form.Item>
                                    <Form.Item noStyle shouldUpdate>
										{({ getFieldValue }) => getFieldValue('forwardMode') !== 'DISABLED' ? (
											<Form.Item name="forwardTo" label={t(portalSettingsI18n.forwardTargetEmail)} rules={[{ required: true, message: t(portalSettingsI18n.forwardTargetRequired) }, { type: 'email', message: t(portalSettingsI18n.validEmailRequired) }]}> 
												<Input placeholder={t(portalSettingsI18n.forwardTargetPlaceholder)} />
											</Form.Item>
										) : null}
                                    </Form.Item>
                                    <Button type="primary" htmlType="submit" loading={forwardLoading}>{t(portalSettingsI18n.saveForwarding)}</Button>
                                </Form>
                            </Space>
                        </SurfaceCard>

                        <SurfaceCard tone="muted">
                            <Space orientation="vertical" size={14} style={portalSettingsStyles.fullWidth}>
                                <div>
                                    <Title level={5} style={portalSettingsStyles.titleNoMargin}>{t(portalSettingsI18n.forwardingOverviewTitle)}</Title>
                                    <Text type="secondary">{t(portalSettingsI18n.forwardingOverviewSubtitle)}</Text>
                                </div>
                                {mailboxes.length === 0 ? (
                                    <Empty description={t(portalSettingsI18n.noAccessibleMailboxes)} />
                                ) : (
                                    <Space orientation="vertical" size={12} style={portalSettingsStyles.fullWidth}>
                                        {mailboxes.map((item) => (
                                            <div key={item.id}>
                                                <Space orientation="vertical" size={4} style={portalSettingsStyles.fullWidth}>
                                                    <Space wrap>
												<Text strong>{item.address}</Text>
												<Tag color={getSendStatus(item, t).color}>{getSendStatus(item, t).label}</Tag>
												<Tag color={item.forwardMode && item.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
													{getForwardStatusLabel(item.forwardMode, t)}
                                                        </Tag>
                                                    </Space>
                                                    <Text type="secondary">{t(portalSettingsI18n.targetDomain, { target: item.forwardTo || t(portalSettingsI18n.configureTargetMissing), domain: item.domain?.name || '-' })}</Text>
                                                </Space>
                                            </div>
                                        ))}
                                    </Space>
                                )}
                            </Space>
                        </SurfaceCard>

                        <SurfaceCard tone="muted">
                            <Space orientation="vertical" size={14} style={portalSettingsStyles.fullWidth}>
                                <div>
                                    <Title level={5} style={portalSettingsStyles.titleNoMargin}>{t(portalSettingsI18n.recentForwardingTitle)}</Title>
                                    <Text type="secondary">{t(portalSettingsI18n.recentForwardingSubtitle)}</Text>
                                </div>
                                {selectedMailbox?.forwardMode === 'MOVE' ? (
                                    <Alert
                                        type="info"
                                        showIcon
                                        title={t(portalSettingsI18n.moveForwardingTitle)}
                                        description={t(portalSettingsI18n.moveForwardingDescription)}
                                    />
                                ) : null}
                                {forwardingJobs.length === 0 ? (
                                    <Empty description={t(portalSettingsI18n.noRecentForwarding)} />
                                ) : (
                                    <Space orientation="vertical" size={12} style={portalSettingsStyles.fullWidth}>
                                        {forwardingJobs.map((item) => (
                                            <div key={item.id}>
                                                <Space orientation="vertical" size={4} style={portalSettingsStyles.fullWidth}>
                                                    <Space wrap>
                                                        <Tag color={item.status === 'SENT' ? 'success' : item.status === 'FAILED' ? 'error' : item.status === 'SKIPPED' ? 'default' : 'processing'}>{getForwardingJobStatusLabel(item.status, t)}</Tag>
												<Tag color={item.mode === 'MOVE' ? 'geekblue' : 'purple'}>{getForwardModeOptionLabel(item.mode, t)}</Tag>
                                                        <Text strong>{item.inboundMessage.subject || t(portalSettingsI18n.noSubject)}</Text>
                                                    </Space>
                                                    <Text type="secondary">{t(portalSettingsI18n.fromTarget, { from: item.inboundMessage.fromAddress, target: item.forwardTo })}</Text>
                                                    <Text type="secondary">{t(portalSettingsI18n.processingWindow, { processedAt: item.processedAt ? new Date(item.processedAt).toLocaleString() : t(portalSettingsI18n.jobPending), nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toLocaleString() : t(portalSettingsI18n.none) })}</Text>
                                                    {item.lastError ? <Text type="danger">{item.lastError}</Text> : null}
                                                </Space>
                                            </div>
                                        ))}
                                    </Space>
                                )}
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

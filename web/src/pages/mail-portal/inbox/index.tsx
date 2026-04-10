import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Drawer, Empty, Form, Input, Row, Segmented, Select, Space, Spin, Switch, Tag, Typography, message as antdMessage } from 'antd';
import { CopyOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../../components';
import { portalInboxContract } from '../../../contracts/portal/inbox';
import {
    getHostedInternalProfileSummaryHintMessage,
    getRepresentativeProtocolLabelMessage,
} from '../../../i18n/catalog/providers';
import { useI18n } from '../../../i18n';
import { defineMessage, type TranslationInput } from '../../../i18n/messages';
import { requestData } from '../../../utils/request';
import { renderPlainTextWithLinks, renderSanitizedEmailHtml } from '../../../utils/mailContent';
import {
    centeredPadding56Style,
    clickableStyle,
    flexBetweenFullWidthStyle,
    fullWidthStyle,
    marginBottom16Style,
    noMarginBottomStyle,
    preWrapBreakWordStyle,
} from '../../../styles/common';
import { shellPalette } from '../../../theme';
import {
    getHostedInternalProfileByProvisioningMode,
    getHostedInternalProfileDefinition,
    getRepresentativeProtocolTagColor,
    type HostedInternalCapabilitySummary,
    type HostedInternalProfileKey,
    type RepresentativeProtocol,
} from '../../../constants/providers';

const { Text, Paragraph, Title } = Typography;
type MailFolder = 'inbox' | 'sent';

const portalInboxI18n = {
    sent: defineMessage('portalInbox.status.sent', '已发送', 'Sent'),
    failed: defineMessage('portalInbox.status.failed', '失败', 'Failed'),
    running: defineMessage('portalInbox.status.running', '处理中', 'Running'),
    skipped: defineMessage('portalInbox.status.skipped', '已跳过', 'Skipped'),
    pending: defineMessage('portalInbox.status.pending', '待处理', 'Pending'),
    sendReady: defineMessage('portalInbox.sendReady', '发件已就绪', 'Ready to send'),
    sendingPending: defineMessage('portalInbox.sendingPending', '待配置发件', 'Sending pending setup'),
    inboxOnly: defineMessage('portalInbox.inboxOnly', '仅收件', 'Inbox only'),
    selectMailboxFirst: defineMessage('portalInbox.selectMailboxFirst', '请先选择邮箱', 'Select a mailbox first'),
    refresh: defineMessage('portalInbox.refresh', '刷新', 'Refresh'),
    composeMail: defineMessage('portalInbox.composeMail', '写邮件', 'Compose'),
    selectMailbox: defineMessage('portalInbox.selectMailbox', '选择邮箱', 'Select mailbox'),
    copyFailed: defineMessage('portalInbox.copyFailed', '复制失败，请手动复制', 'Copy failed. Please copy it manually.'),
    titleInboxWorkspace: defineMessage('portalInbox.titleInboxWorkspace', '收/发件工作区', 'Inbox workspace'),
    titleSentWorkspace: defineMessage('portalInbox.titleSentWorkspace', '发件工作区', 'Sent workspace'),
    subtitle: defineMessage('portalInbox.subtitle', '按邮箱查看消息与发件记录，必要时直接写邮件。', 'Review inbox messages and sent history by mailbox, and compose mail when needed.'),
    moveForwardingTitle: defineMessage('portalInbox.moveForwardingTitle', '当前邮箱启用了转发后隐藏收件', 'This mailbox hides inbox mail after forwarding'),
    sendingUnavailableByChannel: defineMessage('portalInbox.sendingUnavailableByChannel', '当前邮箱所在域名尚未配置有效发件通道，暂时无法查看有效发件结果。', 'The mailbox domain does not have a working sending channel yet, so sent results are unavailable.'),
    sendingUnavailableByDomain: defineMessage('portalInbox.sendingUnavailableByDomain', '当前邮箱所属域名为收件专用域名，不能发送邮件。', 'This mailbox belongs to an inbound-only domain and cannot send mail.'),
    currentMailbox: defineMessage('portalInbox.currentMailbox', '当前邮箱', 'Current mailbox'),
    domain: defineMessage('portalInbox.domain', '域名', 'Domain'),
    accessMethod: defineMessage('portalInbox.accessMethod', '接入方式', 'Access method'),
    forwardingEnabled: defineMessage('portalInbox.forwardingEnabled', '已启用转发', 'Forwarding enabled'),
    notForwarding: defineMessage('portalInbox.notForwarding', '未转发', 'Not forwarding'),
    mailboxCopied: defineMessage('portalInbox.mailboxCopied', '邮箱地址已复制', 'Mailbox address copied'),
    copyMailboxAddress: defineMessage('portalInbox.copyMailboxAddress', '复制邮箱地址', 'Copy mailbox address'),
    currentMessageCount: defineMessage('portalInbox.currentMessageCount', '当前消息数', 'Current message count'),
    sentHistoryCount: defineMessage('portalInbox.sentHistoryCount', '发件记录', 'Sent history'),
    inboxFolder: defineMessage('portalInbox.inboxFolder', '收件箱', 'Inbox'),
    sentFolder: defineMessage('portalInbox.sentFolder', '发件箱', 'Sent'),
    unreadAndCodes: defineMessage('portalInbox.unreadAndCodes', '未读 / 验证码', 'Unread / codes'),
    successAndFailure: defineMessage('portalInbox.successAndFailure', '成功 / 失败', 'Success / failure'),
    filters: defineMessage('portalInbox.filters', '过滤器', 'Filters'),
    unreadOnly: defineMessage('portalInbox.unreadOnly', '只看未读', 'Unread only'),
    inboxSearchPlaceholder: defineMessage('portalInbox.inboxSearchPlaceholder', '按主题、发件人、验证码搜索', 'Search by subject, sender, or code'),
    sentSearchPlaceholder: defineMessage('portalInbox.sentSearchPlaceholder', '按主题、收件人、状态搜索', 'Search by subject, recipient, or status'),
    noInboxMessages: defineMessage('portalInbox.noInboxMessages', '暂无符合条件的收件邮件', 'No inbox messages match the current filters'),
    noSentMessages: defineMessage('portalInbox.noSentMessages', '暂无符合条件的发件记录', 'No sent messages match the current filters'),
    noSubject: defineMessage('portalInbox.noSubject', '(无主题)', '(No subject)'),
    verificationCode: defineMessage('portalInbox.verificationCode', '验证码：{code}', 'Code: {code}'),
    read: defineMessage('portalInbox.read', '已读', 'Read'),
    unread: defineMessage('portalInbox.unread', '未读', 'Unread'),
    copyCode: defineMessage('portalInbox.copyCode', '复制验证码', 'Copy code'),
    codeCopied: defineMessage('portalInbox.codeCopied', '验证码已复制', 'Verification code copied'),
    fromMailbox: defineMessage('portalInbox.fromMailbox', '来自 {from} · 送达 {mailbox}', 'From {from} · Delivered to {mailbox}'),
    noPreview: defineMessage('portalInbox.noPreview', '无预览', 'No preview'),
    sentFromTo: defineMessage('portalInbox.sentFromTo', '发件人 {from} · 收件人 {recipients}', 'From {from} · To {recipients}'),
    messageDetails: defineMessage('portalInbox.messageDetails', '邮件详情', 'Message details'),
    composeTitle: defineMessage('portalInbox.composeTitle', '写邮件 · {address}', 'Compose · {address}'),
    composeTitleFallback: defineMessage('portalInbox.composeTitleFallback', '写邮件', 'Compose'),
    cancel: defineMessage('portalInbox.cancel', '取消', 'Cancel'),
    send: defineMessage('portalInbox.send', '发送', 'Send'),
    senderLine: defineMessage('portalInbox.senderLine', '发件人：{from}', 'Sender: {from}'),
    recipientLine: defineMessage('portalInbox.recipientLine', '收件地址：{recipient}', 'Recipient: {recipient}'),
    routeLine: defineMessage('portalInbox.routeLine', '命中路由：{routeKind}', 'Matched route: {routeKind}'),
    statusLine: defineMessage('portalInbox.statusLine', '发送状态：{status}', 'Send status: {status}'),
    providerMessageId: defineMessage('portalInbox.providerMessageId', 'Provider Message ID：', 'Provider Message ID:'),
    failureReasonLine: defineMessage('portalInbox.failureReasonLine', '失败原因：{reason}', 'Failure reason: {reason}'),
    selectRecipientLabel: defineMessage('portalInbox.recipientLabel', '收件人', 'Recipient'),
    selectRecipientRequired: defineMessage('portalInbox.recipientRequired', '请填写收件人', 'Enter at least one recipient'),
    recipientHint: defineMessage('portalInbox.recipientHint', '支持多个地址，使用逗号、分号或换行分隔。', 'Multiple addresses are supported. Separate them with commas, semicolons, or new lines.'),
    subjectLabel: defineMessage('portalInbox.subjectLabel', '主题', 'Subject'),
    subjectRequired: defineMessage('portalInbox.subjectRequired', '请填写主题', 'Enter a subject'),
    subjectPlaceholder: defineMessage('portalInbox.subjectPlaceholder', '请输入邮件主题', 'Enter the mail subject'),
    bodyLabel: defineMessage('portalInbox.bodyLabel', '正文', 'Body'),
    bodyRequired: defineMessage('portalInbox.bodyRequired', '请填写正文', 'Enter the message body'),
    bodyPlaceholder: defineMessage('portalInbox.bodyPlaceholder', '请输入正文，正文里的链接会按普通邮件发送。', 'Enter the body. Links in the body are sent as ordinary mail content.'),
    loadMailboxListFailed: defineMessage('portalInbox.loadMailboxListFailed', '获取邮箱列表失败', 'Failed to load the mailbox list'),
    loadMessageListFailed: defineMessage('portalInbox.loadMessageListFailed', '获取消息列表失败', 'Failed to load the message list'),
    loadSentListFailed: defineMessage('portalInbox.loadSentListFailed', '获取发件列表失败', 'Failed to load the sent list'),
    loadMessageDetailFailed: defineMessage('portalInbox.loadMessageDetailFailed', '获取消息详情失败', 'Failed to load the message details'),
    loadSentDetailFailed: defineMessage('portalInbox.loadSentDetailFailed', '获取发件详情失败', 'Failed to load the sent-message details'),
    recipientRequiredLegacy: defineMessage('portalInbox.recipientRequiredLegacy', '请至少填写一个收件人', 'Enter at least one recipient'),
    sendFailed: defineMessage('portalInbox.sendFailed', '发送邮件失败', 'Failed to send the message'),
    sendSuccess: defineMessage('portalInbox.sendSuccess', '邮件发送成功', 'Mail sent successfully'),
    composeDomainMissingSendingChannel: defineMessage('portalInbox.compose.domainMissingSendingChannel', '当前邮箱所在域名尚未配置有效发件通道，请联系管理员先补齐发件配置。', 'This mailbox domain does not have a working sending channel yet. Ask an administrator to finish the sending configuration first.'),
    composeDomainInboundOnly: defineMessage('portalInbox.compose.domainInboundOnly', '当前邮箱所属域名未开启发件能力，请切换到已允许发件的域名邮箱。', 'This mailbox belongs to a domain without sending enabled. Switch to a mailbox on a send-enabled domain.'),
    composeRecipientsLabel: defineMessage('portalInbox.compose.recipients', '收件人', 'Recipients'),
    composeRecipientsRequired: defineMessage('portalInbox.compose.recipientsRequired', '请填写收件人', 'Enter at least one recipient'),
    composeRecipientsExtra: defineMessage('portalInbox.compose.recipientsExtra', '支持多个地址，使用逗号、分号或换行分隔。', 'Multiple addresses are supported; separate them with commas, semicolons, or new lines.'),
    composeRecipientsPlaceholder: defineMessage('portalInbox.compose.recipientsPlaceholder', '例如：alice@example.com, bob@example.com', 'For example: alice@example.com, bob@example.com'),
    composeSubjectLabel: defineMessage('portalInbox.compose.subject', '主题', 'Subject'),
    composeSubjectRequired: defineMessage('portalInbox.compose.subjectRequired', '请填写主题', 'Enter a subject'),
    composeSubjectPlaceholder: defineMessage('portalInbox.compose.subjectPlaceholder', '请输入邮件主题', 'Enter the mail subject'),
    composeBodyLabel: defineMessage('portalInbox.compose.body', '正文', 'Body'),
    composeBodyRequired: defineMessage('portalInbox.compose.bodyRequired', '请填写正文', 'Enter the message body'),
    composeBodyPlaceholder: defineMessage('portalInbox.compose.bodyPlaceholder', '请输入正文，正文里的链接会按普通邮件发送。', 'Enter the message body. Links inside it will be sent as ordinary mail content.'),
    htmlContent: defineMessage('portalInbox.htmlContent', 'HTML 内容', 'HTML content'),
    textContent: defineMessage('portalInbox.textContent', '文本内容', 'Text content'),
    body: defineMessage('portalInbox.body', '正文', 'Body'),
} as const;

function getSentStatusLabel(status: string, t: (source: TranslationInput) => string) {
    if (status === 'SENT') {
        return t(portalInboxI18n.sent);
    }

    if (status === 'FAILED') {
        return t(portalInboxI18n.failed);
    }

    if (status === 'RUNNING') {
        return t(portalInboxI18n.running);
    }

    if (status === 'SKIPPED') {
        return t(portalInboxI18n.skipped);
    }

    return t(portalInboxI18n.pending);
}

interface MailboxItem {
    id: number;
    address: string;
    displayName?: string | null;
    provisioningMode?: 'MANUAL' | 'API_POOL';
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    providerProfile?: HostedInternalProfileKey;
    representativeProtocol?: RepresentativeProtocol;
    profileSummaryHint?: string;
    capabilitySummary?: HostedInternalCapabilitySummary;
    sendReady?: boolean;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
}

interface MessageItem {
    id: string;
    fromAddress: string;
    subject?: string | null;
    textPreview?: string | null;
    htmlPreview?: string | null;
    verificationCode?: string | null;
    routeKind?: string | null;
    receivedAt: string;
    mailbox?: { id: number; address: string } | null;
    isRead: boolean;
}

interface SentMessageItem {
    id: string;
    fromAddress: string;
    toAddresses: string[];
    subject?: string | null;
    status: string;
    providerMessageId?: string | null;
    lastError?: string | null;
    createdAt: string;
    mailbox?: { id: number; address: string } | null;
}

interface SendFormValues {
    to: string;
    subject: string;
    text: string;
}

const inboxStyles = {
    fullWidth: fullWidthStyle,
    sectionCard: {
        borderRadius: 18,
        border: `1px solid ${shellPalette.border}`,
    },
    compactCard: {
        borderRadius: 16,
        border: `1px solid ${shellPalette.border}`,
    },
    titleNoMargin: { margin: 0 },
    smallHint: { fontSize: 12 },
    mailboxValue: { fontWeight: 700, marginTop: 4 },
    statsValueLarge: { fontSize: 28, fontWeight: 800, marginTop: 6 },
    statsValueCompact: { fontSize: 16, fontWeight: 700, marginTop: 8 },
    listCursor: clickableStyle,
    detailStack: fullWidthStyle,
    detailMessageBody: preWrapBreakWordStyle,
} as const;

const MailPortalInboxPage: React.FC = () => {
    const { t } = useI18n();
    const [searchParams, setSearchParams] = useSearchParams();
    const [folder, setFolder] = useState<MailFolder>('inbox');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [sentMessages, setSentMessages] = useState<SentMessageItem[]>([]);
    const [selectedMailboxId, setSelectedMailboxId] = useState<number | undefined>(undefined);
    const [selectedMessage, setSelectedMessage] = useState<Record<string, unknown> | null>(null);
    const [detailVisible, setDetailVisible] = useState(false);
    const [composeVisible, setComposeVisible] = useState(() => searchParams.get('compose') === '1');
    const [sending, setSending] = useState(false);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [keyword, setKeyword] = useState('');
    const [form] = Form.useForm<SendFormValues>();

    const mailboxOptions = useMemo(() => mailboxes.map((item) => ({ value: item.id, label: item.address })), [mailboxes]);
    const selectedMailbox = useMemo(() => mailboxes.find((item) => item.id === selectedMailboxId), [mailboxes, selectedMailboxId]);
    const domainCanSend = Boolean(selectedMailbox?.domain?.canSend);
    const canSend = Boolean(selectedMailbox?.sendReady);
    const sendStatusLabel = canSend
        ? t(portalInboxI18n.sendReady)
        : domainCanSend
            ? t(portalInboxI18n.sendingPending)
            : t(portalInboxI18n.inboxOnly);
    const selectedMailboxProfile = useMemo(() => {
        if (!selectedMailbox) {
            return null;
        }
        return selectedMailbox.providerProfile
            ? getHostedInternalProfileDefinition(selectedMailbox.providerProfile)
            : getHostedInternalProfileByProvisioningMode(selectedMailbox.provisioningMode || 'MANUAL');
    }, [selectedMailbox]);

    const loadMailboxes = useCallback(async () => {
        const result = await requestData<MailboxItem[]>(() => portalInboxContract.getMailboxes(), t(portalInboxI18n.loadMailboxListFailed));
        if (result) {
            setMailboxes(result);
            if (!selectedMailboxId && result[0]) {
                setSelectedMailboxId(result[0].id);
            }
        }
    }, [selectedMailboxId, t]);

    const loadInboxMessages = useCallback(async (mailboxId?: number, unread: boolean = false) => {
        setLoading(true);
        const result = await requestData<{ list: MessageItem[] }>(() => portalInboxContract.getMessages({ mailboxId, unreadOnly: unread, page: 1, pageSize: 50 }), t(portalInboxI18n.loadMessageListFailed));
        if (result) {
            setMessages(result.list);
        }
        setLoading(false);
    }, [t]);

    const loadSentMessages = useCallback(async (mailboxId?: number) => {
        if (!mailboxId) {
            setSentMessages([]);
            return;
        }
        setLoading(true);
        const result = await requestData<{ list: SentMessageItem[] }>(() => portalInboxContract.getSentMessages({ mailboxId, page: 1, pageSize: 50 }), t(portalInboxI18n.loadSentListFailed));
        if (result) {
            setSentMessages(result.list);
        }
        setLoading(false);
    }, [t]);

    const reloadCurrentFolder = useCallback(async () => {
        if (folder === 'inbox') {
            await loadInboxMessages(selectedMailboxId, unreadOnly);
        } else {
            await loadSentMessages(selectedMailboxId);
        }
    }, [folder, loadInboxMessages, loadSentMessages, selectedMailboxId, unreadOnly]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadMailboxes();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadMailboxes]);

    useEffect(() => {
        if (selectedMailboxId) {
            const timer = window.setTimeout(() => {
                if (folder === 'inbox') {
                    void loadInboxMessages(selectedMailboxId, unreadOnly);
                } else {
                    void loadSentMessages(selectedMailboxId);
                }
            }, 0);
            return () => window.clearTimeout(timer);
        }
        return undefined;
    }, [folder, loadInboxMessages, loadSentMessages, selectedMailboxId, unreadOnly]);

    const openInboxMessage = async (id: string) => {
        setDetailLoading(true);
        setDetailVisible(true);
        const result = await requestData<Record<string, unknown>>(() => portalInboxContract.getMessage(id), t(portalInboxI18n.loadMessageDetailFailed));
        if (result) {
            setSelectedMessage(result);
            setMessages((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
        }
        setDetailLoading(false);
    };

    const openSentMessage = async (id: string) => {
        setDetailLoading(true);
        setDetailVisible(true);
        const result = await requestData<Record<string, unknown>>(() => portalInboxContract.getSentMessage(id), t(portalInboxI18n.loadSentDetailFailed));
        if (result) {
            setSelectedMessage(result);
        }
        setDetailLoading(false);
    };

    const handleSend = async (values: SendFormValues) => {
		if (!selectedMailboxId) {
			antdMessage.error(t(portalInboxI18n.selectMailboxFirst));
            return;
        }

		if (!canSend) {
			antdMessage.error(
				domainCanSend
					? t(portalInboxI18n.sendingUnavailableByChannel)
					: t(portalInboxI18n.sendingUnavailableByDomain),
			);
			return;
		}

        const recipients = values.to
            .split(/[\n,;]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (recipients.length === 0) {
			antdMessage.error(t(portalInboxI18n.recipientRequiredLegacy));
            return;
        }

        setSending(true);
        const result = await requestData<Record<string, unknown>>(
            () => portalInboxContract.sendMessage({
                mailboxId: selectedMailboxId,
                to: recipients,
                subject: values.subject,
                text: values.text,
            }),
			t(portalInboxI18n.sendFailed)
		);
        setSending(false);

        if (!result) {
            return;
        }

		antdMessage.success(t(portalInboxI18n.sendSuccess));
        form.resetFields();
        setComposeVisible(false);
        setSearchParams(() => new URLSearchParams());
        setFolder('sent');
        await loadSentMessages(selectedMailboxId);
    };

    const renderMessageBody = () => {
        const htmlPreview = String(selectedMessage?.htmlPreview || selectedMessage?.htmlBody || '').trim();
        const textPreview = String(selectedMessage?.textPreview || selectedMessage?.textBody || '').trim();

        return (
        <Space orientation="vertical" style={inboxStyles.fullWidth} size={12}>
                {htmlPreview ? (
                    <Card size="small" title={t(portalInboxI18n.htmlContent)}>
                        <div>{renderSanitizedEmailHtml(htmlPreview)}</div>
                    </Card>
                ) : null}
                {textPreview ? (
                    <Card size="small" title={htmlPreview ? t(portalInboxI18n.textContent) : t(portalInboxI18n.body)}>
                        <div style={inboxStyles.detailMessageBody}>{renderPlainTextWithLinks(textPreview)}</div>
                    </Card>
                ) : null}
                {!htmlPreview && !textPreview ? (
                    <Card size="small" title={t(portalInboxI18n.body)}>
                        <div>-</div>
                    </Card>
                ) : null}
            </Space>
        );
    };

    const filteredInboxMessages = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (!normalizedKeyword) {
            return messages;
        }
        return messages.filter((item) => [item.subject, item.fromAddress, item.textPreview, item.verificationCode, item.mailbox?.address]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedKeyword)));
    }, [keyword, messages]);

    const filteredSentMessages = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (!normalizedKeyword) {
            return sentMessages;
        }
        return sentMessages.filter((item) => [item.subject, item.fromAddress, item.toAddresses.join(','), item.mailbox?.address, item.status]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedKeyword)));
    }, [keyword, sentMessages]);

    const inboxStats = useMemo(() => ({
        total: messages.length,
        unread: messages.filter((item) => !item.isRead).length,
        withCode: messages.filter((item) => Boolean(item.verificationCode)).length,
    }), [messages]);

    const sentStats = useMemo(() => ({
        total: sentMessages.length,
        sent: sentMessages.filter((item) => item.status === 'SENT').length,
        failed: sentMessages.filter((item) => item.status === 'FAILED').length,
    }), [sentMessages]);

    const handleCopy = async (value: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(value);
            antdMessage.success(successMessage);
        } catch {
            antdMessage.error(t(portalInboxI18n.copyFailed));
        }
    };

    const listData = folder === 'inbox' ? filteredInboxMessages : filteredSentMessages;

    return (
        <Space orientation="vertical" size={20} style={inboxStyles.fullWidth}>
            <PageHeader
                title={folder === 'inbox' ? t(portalInboxI18n.titleInboxWorkspace) : t(portalInboxI18n.titleSentWorkspace)}
                subtitle={t(portalInboxI18n.subtitle)}
                extra={
                    <Space wrap>
                        <Segmented<MailFolder>
                            value={folder}
                            onChange={(value) => setFolder(value)}
                            options={[
                                { label: t(portalInboxI18n.inboxFolder), value: 'inbox' },
                                { label: t(portalInboxI18n.sentFolder), value: 'sent' },
                            ]}
                        />
                        <Button type="text" icon={<ReloadOutlined />} onClick={() => void reloadCurrentFolder()}>{t(portalInboxI18n.refresh)}</Button>
                        <Button type="primary" icon={<SendOutlined />} onClick={() => setComposeVisible(true)} disabled={!canSend || !selectedMailboxId}>{t(portalInboxI18n.composeMail)}</Button>
                    </Space>
                }
            />
            {folder === 'inbox' && selectedMailbox?.forwardMode === 'MOVE' ? (
                <Alert
                    type="info"
                    showIcon
                    title={t(portalInboxI18n.moveForwardingTitle)}
                />
            ) : null}

			{!canSend && folder === 'sent' ? (
				<Alert
					type="info"
					showIcon
					title={
						domainCanSend
							? t(portalInboxI18n.sendingUnavailableByChannel)
							: t(portalInboxI18n.sendingUnavailableByDomain)
					}
				/>
			) : null}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={7}>
                    <Space orientation="vertical" size={16} style={inboxStyles.fullWidth}>
                        <SurfaceCard style={inboxStyles.sectionCard} bodyStyle={{ padding: 22 }}>
                            <Space orientation="vertical" size={16} style={inboxStyles.fullWidth}>
                                <div>
                                    <Title level={4} style={inboxStyles.titleNoMargin}>{t(portalInboxI18n.currentMailbox)}</Title>
                                </div>
                                <Select style={inboxStyles.fullWidth} value={selectedMailboxId} onChange={setSelectedMailboxId} options={mailboxOptions} placeholder={t(portalInboxI18n.selectMailbox)} />
                                {selectedMailbox ? (
                                    <Space orientation="vertical" size={10} style={inboxStyles.fullWidth}>
                                        <div>
                                            <Text type="secondary">{t(portalInboxI18n.currentMailbox)}</Text>
                                            <div style={inboxStyles.mailboxValue}>{selectedMailbox.address}</div>
                                        </div>
                                        <div>
                                            <Text type="secondary">{t(portalInboxI18n.domain)}</Text>
                                            <div>{selectedMailbox.domain?.name || '-'}</div>
                                        </div>
                                        {selectedMailboxProfile ? (
                                            <div>
                                                <Text type="secondary">{t(portalInboxI18n.accessMethod)}</Text>
                                                <div style={inboxStyles.mailboxValue}>{t(getHostedInternalProfileSummaryHintMessage(selectedMailboxProfile.key))}</div>
                                            </div>
                                        ) : null}
                                        <Space wrap>
                                            {selectedMailboxProfile ? (
                                                <Tag color={getRepresentativeProtocolTagColor(selectedMailbox.representativeProtocol || selectedMailboxProfile.representativeProtocol)}>
                                                    {t(getRepresentativeProtocolLabelMessage(selectedMailbox.representativeProtocol || selectedMailboxProfile.representativeProtocol))}
                                                </Tag>
                                            ) : null}
											<Tag color={canSend ? 'success' : domainCanSend ? 'warning' : 'default'}>{sendStatusLabel}</Tag>
                                            <Tag color={selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
																{selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? t(portalInboxI18n.forwardingEnabled) : t(portalInboxI18n.notForwarding)}
                                            </Tag>
                                        </Space>
                                        <Button icon={<CopyOutlined />} onClick={() => void handleCopy(selectedMailbox.address, t(portalInboxI18n.mailboxCopied))}>{t(portalInboxI18n.copyMailboxAddress)}</Button>
                                    </Space>
                                ) : null}
                            </Space>
                        </SurfaceCard>

                        <Row gutter={[12, 12]}>
                            <Col span={12}>
                                <SurfaceCard style={inboxStyles.compactCard} bodyStyle={{ padding: 18 }}>
                                    <Text type="secondary">{folder === 'inbox' ? t(portalInboxI18n.currentMessageCount) : t(portalInboxI18n.sentHistoryCount)}</Text>
                                    <div style={inboxStyles.statsValueLarge}>{folder === 'inbox' ? inboxStats.total : sentStats.total}</div>
                                </SurfaceCard>
                            </Col>
                            <Col span={12}>
                                <SurfaceCard style={inboxStyles.compactCard} bodyStyle={{ padding: 18 }}>
                                    <Text type="secondary">{folder === 'inbox' ? t(portalInboxI18n.unreadAndCodes) : t(portalInboxI18n.successAndFailure)}</Text>
                                    <div style={inboxStyles.statsValueCompact}>
                                        {folder === 'inbox' ? `${inboxStats.unread} / ${inboxStats.withCode}` : `${sentStats.sent} / ${sentStats.failed}`}
                                    </div>
                                </SurfaceCard>
                            </Col>
                        </Row>

                        <SurfaceCard style={inboxStyles.sectionCard} bodyStyle={{ padding: 22 }}>
                            <Space orientation="vertical" size={14} style={inboxStyles.fullWidth}>
                                <div>
                                    <Title level={5} style={inboxStyles.titleNoMargin}>{t(portalInboxI18n.filters)}</Title>
                                </div>
                                {folder === 'inbox' ? (
                                    <Space style={flexBetweenFullWidthStyle}>
                                        <Text>{t(portalInboxI18n.unreadOnly)}</Text>
                                        <Switch checked={unreadOnly} onChange={setUnreadOnly} />
                                    </Space>
                                ) : null}
                                <Input
                                    prefix={<SearchOutlined />}
                                    value={keyword}
                                    onChange={(event) => setKeyword(event.target.value)}
                                    placeholder={folder === 'inbox' ? t(portalInboxI18n.inboxSearchPlaceholder) : t(portalInboxI18n.sentSearchPlaceholder)}
                                />
                            </Space>
                        </SurfaceCard>
                    </Space>
                </Col>

                <Col xs={24} xl={17}>
                    <SurfaceCard style={inboxStyles.sectionCard} bodyStyle={{ padding: 22 }}>
                        {loading ? (
                            <div style={centeredPadding56Style}><Spin /></div>
                        ) : listData.length === 0 ? (
                            <Empty description={folder === 'inbox' ? t(portalInboxI18n.noInboxMessages) : t(portalInboxI18n.noSentMessages)} />
                        ) : folder === 'inbox' ? (
                            <Space orientation="vertical" size={12} style={inboxStyles.fullWidth}>
                                {filteredInboxMessages.map((item) => (
                                    <div key={item.id} style={inboxStyles.listCursor}>
                                        <Space orientation="vertical" style={inboxStyles.fullWidth} size={6}>
                                            <Space wrap style={flexBetweenFullWidthStyle}>
                                                <Space wrap style={flexBetweenFullWidthStyle}>
                                                    <Text strong>{item.subject || t(portalInboxI18n.noSubject)}</Text>
                                                    {item.verificationCode ? <Tag color="magenta">{t(portalInboxI18n.verificationCode, { code: item.verificationCode })}</Tag> : null}
                                                    {item.routeKind ? <Tag>{item.routeKind}</Tag> : null}
                                                    <Tag color={item.isRead ? 'default' : 'blue'}>{item.isRead ? t(portalInboxI18n.read) : t(portalInboxI18n.unread)}</Tag>
                                                </Space>
                                                <Space wrap>
                                                    {item.verificationCode ? (
                                                        <Button
                                                            type="link"
                                                            icon={<CopyOutlined />}
                                                            onClick={() => {
                                                                void handleCopy(item.verificationCode || '', t(portalInboxI18n.codeCopied));
                                                            }}
                                                        >
                                                            {t(portalInboxI18n.copyCode)}
                                                        </Button>
                                                    ) : null}
                                                    <Button type="link" onClick={() => void openInboxMessage(item.id)}>
                                                        {t(portalInboxI18n.messageDetails)}
                                                    </Button>
                                                </Space>
                                            </Space>
                                            <Text type="secondary">{t(portalInboxI18n.fromMailbox, { from: item.fromAddress, mailbox: item.mailbox?.address || '-' })}</Text>
                                            <Paragraph ellipsis={{ rows: 2, expandable: false }} style={noMarginBottomStyle}>
                                                {item.textPreview || item.htmlPreview || t(portalInboxI18n.noPreview)}
                                            </Paragraph>
                                            <Text type="secondary">{new Date(item.receivedAt).toLocaleString()}</Text>
                                        </Space>
                                    </div>
                                ))}
                            </Space>
                        ) : (
                            <Space orientation="vertical" size={12} style={inboxStyles.fullWidth}>
                                {filteredSentMessages.map((item) => (
                                    <div key={item.id} style={inboxStyles.listCursor}>
                                        <Space orientation="vertical" style={inboxStyles.fullWidth} size={6}>
                                            <Space wrap style={flexBetweenFullWidthStyle}>
											<Space wrap>
                                                <Text strong>{item.subject || t(portalInboxI18n.noSubject)}</Text>
											<Tag color={item.status === 'SENT' ? 'green' : item.status === 'FAILED' ? 'red' : 'default'}>{getSentStatusLabel(item.status, t)}</Tag>
                                                </Space>
											<Button type="link" onClick={() => void openSentMessage(item.id)}>
												{t(portalInboxI18n.messageDetails)}
											</Button>
                                            </Space>
                                            <Text type="secondary">{t(portalInboxI18n.sentFromTo, { from: item.fromAddress, recipients: item.toAddresses.join(', ') || '-' })}</Text>
                                            <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                                        </Space>
                                    </div>
                                ))}
                            </Space>
                        )}
                    </SurfaceCard>
                </Col>
            </Row>

            <Drawer title={String(selectedMessage?.subject || t(portalInboxI18n.messageDetails))} open={detailVisible} onClose={() => setDetailVisible(false)} size={760}>
                {detailLoading ? <Spin /> : (
                    <Space orientation="vertical" style={inboxStyles.detailStack} size={14}>
                        <Space wrap style={flexBetweenFullWidthStyle}>
                            <Text>{t(portalInboxI18n.senderLine, { from: String(selectedMessage?.fromAddress || '-') })}</Text>
                            {folder === 'inbox' && String(selectedMessage?.verificationCode || '').trim() ? (
                                <Button icon={<CopyOutlined />} onClick={() => void handleCopy(String(selectedMessage?.verificationCode || ''), t(portalInboxI18n.codeCopied))}>
                                    {t(portalInboxI18n.copyCode)}
                                </Button>
                            ) : null}
                        </Space>
                        <Text>{t(portalInboxI18n.recipientLine, { recipient: String(selectedMessage?.toAddress || selectedMessage?.toAddresses || '-') })}</Text>
                        {folder === 'inbox' ? <Text>{t(portalInboxI18n.routeLine, { routeKind: String(selectedMessage?.routeKind || '-') })}</Text> : null}
                        {folder === 'inbox' ? <Text>{t(portalInboxI18n.verificationCode, { code: String(selectedMessage?.verificationCode || '-') })}</Text> : null}
                        {folder === 'sent' ? <Text>{t(portalInboxI18n.statusLine, { status: getSentStatusLabel(String(selectedMessage?.status || '-'), t) })}</Text> : null}
                        {folder === 'sent' ? <Text><strong>{t(portalInboxI18n.providerMessageId)}</strong>{String(selectedMessage?.providerMessageId || '-')}</Text> : null}
                        {folder === 'sent' ? <Text>{t(portalInboxI18n.failureReasonLine, { reason: String(selectedMessage?.lastError || '-') })}</Text> : null}
                        {renderMessageBody()}
                    </Space>
                )}
            </Drawer>

            <Drawer
                title={selectedMailbox ? t(portalInboxI18n.composeTitle, { address: selectedMailbox.address }) : t(portalInboxI18n.composeTitleFallback)}
                open={composeVisible}
                onClose={() => {
                    setComposeVisible(false);
                    setSearchParams(() => new URLSearchParams());
                }}
                size={680}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" onFinish={handleSend} initialValues={{ to: '', subject: '', text: '' }}>
					{!canSend ? (
						<Alert
							style={marginBottom16Style}
							type="warning"
						showIcon
						title={
							domainCanSend
								? t(portalInboxI18n.composeDomainMissingSendingChannel)
								: t(portalInboxI18n.composeDomainInboundOnly)
						}
					/>
				) : null}
					<Form.Item label={t(portalInboxI18n.composeRecipientsLabel)} name="to" rules={[{ required: true, message: t(portalInboxI18n.composeRecipientsRequired) }]} extra={t(portalInboxI18n.composeRecipientsExtra)}>
						<Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t(portalInboxI18n.composeRecipientsPlaceholder)} />
					</Form.Item>
					<Form.Item label={t(portalInboxI18n.composeSubjectLabel)} name="subject" rules={[{ required: true, message: t(portalInboxI18n.composeSubjectRequired) }]}>
						<Input maxLength={500} placeholder={t(portalInboxI18n.composeSubjectPlaceholder)} />
					</Form.Item>
					<Form.Item label={t(portalInboxI18n.composeBodyLabel)} name="text" rules={[{ required: true, message: t(portalInboxI18n.composeBodyRequired) }]}>
						<Input.TextArea autoSize={{ minRows: 10, maxRows: 18 }} placeholder={t(portalInboxI18n.composeBodyPlaceholder)} />
					</Form.Item>
                    <Space>
								<Button onClick={() => setComposeVisible(false)}>{t(portalInboxI18n.cancel)}</Button>
								<Button type="primary" htmlType="submit" loading={sending} disabled={!canSend || !selectedMailboxId}>{t(portalInboxI18n.send)}</Button>
                    </Space>
                </Form>
            </Drawer>
        </Space>
    );
};

export default MailPortalInboxPage;

import { useCallback, useEffect, useState, type Key } from 'react';
import { DeleteOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, SurfaceCard } from '../../components';
import { sendingContract } from '../../contracts/admin/sending';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { hasOnlyValidRecipients, parseRecipientInput } from './recipientInput';
import { fullWidthStyle } from '../../styles/common';
import { requestData } from '../../utils/request';

interface DomainOption {
    id: number;
    name: string;
    canSend?: boolean;
}

interface MailboxOption {
    id: number;
    address: string;
    domain?: { id: number; name: string; canSend?: boolean };
}

interface SendConfigRecord {
    id: number;
    provider: string;
    fromNameDefault?: string | null;
    replyToDefault?: string | null;
    status: string;
    domain?: { id: number; name: string; canSend?: boolean };
}

const { Text } = Typography;

const sendingConfigsI18n = {
    fetchConfigsFailed: defineMessage('sendingConfigs.fetchConfigsFailed', '获取发信配置失败', 'Failed to load sending configs'),
    fetchHistoryFailed: defineMessage('sendingConfigs.fetchHistoryFailed', '获取发件历史失败', 'Failed to load sent history'),
    fetchDomainsFailed: defineMessage('sendingConfigs.fetchDomainsFailed', '获取域名失败', 'Failed to load domains'),
    fetchMailboxesFailed: defineMessage('sendingConfigs.fetchMailboxesFailed', '获取邮箱失败', 'Failed to load mailboxes'),
    sendTestFailed: defineMessage('sendingConfigs.sendTestFailed', '发送测试邮件失败', 'Failed to send the test email'),
    deleteConfigFailed: defineMessage('sendingConfigs.deleteConfigFailed', '删除发信配置失败', 'Failed to delete the sending config'),
    deletedConfig: defineMessage('sendingConfigs.deletedConfig', '已删除 {domain} 的发信配置', 'Deleted the sending config for {domain}'),
    currentDomain: defineMessage('sendingConfigs.currentDomain', '该域名', 'that domain'),
    deleteHistoryFailed: defineMessage('sendingConfigs.deleteHistoryFailed', '删除发件历史失败', 'Failed to delete the sent-history entry'),
    clearedHistory: defineMessage('sendingConfigs.clearedHistory', '已清理 {count} 条发件历史', 'Cleared {count} sent-history entries'),
    selectHistoryBeforeDelete: defineMessage('sendingConfigs.selectHistoryBeforeDelete', '请先选择要清理的发件历史', 'Select the sent-history entries to clear first'),
    batchDeleteHistoryFailed: defineMessage('sendingConfigs.batchDeleteHistoryFailed', '批量清理发件历史失败', 'Failed to clear the selected sent-history entries'),
    deleteConfigConfirm: defineMessage('sendingConfigs.deleteConfigConfirm', '确定要删除这条发信配置吗？', 'Delete this sending config?'),
    deleteConfigDescription: defineMessage('sendingConfigs.deleteConfigDescription', '删除后该域名将无法继续从 all-Mail 直接发信。', 'After deletion, that domain can no longer send directly from all-Mail.'),
    senderDomain: defineMessage('sendingConfigs.senderDomain', '发件域名', 'Sending domain'),
    senderAddress: defineMessage('sendingConfigs.senderAddress', '发件地址', 'From address'),
    time: defineMessage('sendingConfigs.time', '时间', 'Time'),
    deleteHistoryConfirm: defineMessage('sendingConfigs.deleteHistoryConfirm', '确定要清理这条发件历史吗？', 'Clear this sent-history entry?'),
    deleteHistoryDescription: defineMessage('sendingConfigs.deleteHistoryDescription', '这只会删除历史记录，不会撤回已经发出的邮件。', 'This only deletes the history record; it does not recall mail that was already sent.'),
    batchDeleteHistoryConfirm: defineMessage('sendingConfigs.batchDeleteHistoryConfirm', '确定要清理选中的 {count} 条发件历史吗？', 'Clear the selected {count} sent-history entries?'),
    batchDeleteHistoryDescription: defineMessage('sendingConfigs.batchDeleteHistoryDescription', '仅清理历史记录，不会影响真实发件结果。', 'Only history records are cleared; real send results are not affected.'),
    noSubject: defineMessage('sendingConfigs.noSubject', '(无主题)', '(No subject)'),
    selectDomainRequired: defineMessage('sendingConfigs.selectDomainRequired', '请选择域名', 'Select a domain'),
    senderMailbox: defineMessage('sendingConfigs.senderMailbox', '发件邮箱', 'Sender mailbox'),
    senderAddressRequired: defineMessage('sendingConfigs.senderAddressRequired', '请输入发件地址', 'Enter the sender address'),
    validEmailRequired: defineMessage('sendingConfigs.validEmailRequired', '请输入有效邮箱地址', 'Enter a valid email address'),
    recipients: defineMessage('sendingConfigs.recipients', '收件人（逗号分隔）', 'Recipients (comma-separated)'),
    recipientsRequired: defineMessage('sendingConfigs.recipientsRequired', '请输入收件人', 'Enter at least one recipient'),
    recipientsInvalid: defineMessage('sendingConfigs.recipientsInvalid', '请检查收件人邮箱格式，支持逗号、分号或换行分隔多个地址', 'Check the recipient email format. You can separate multiple addresses with commas, semicolons, or new lines.'),
    recipientsExtra: defineMessage('sendingConfigs.recipientsExtra', '支持使用逗号、分号或换行分隔多个收件人地址。', 'You can separate multiple recipient addresses with commas, semicolons, or new lines.'),
    recipientsPlaceholder: defineMessage('sendingConfigs.recipientsPlaceholder', '例如：alice@example.com, bob@example.com', 'For example: alice@example.com, bob@example.com'),
    subjectRequired: defineMessage('sendingConfigs.subjectRequired', '请输入主题', 'Enter a subject'),
    textBody: defineMessage('sendingConfigs.textBody', '纯文本内容', 'Plain-text body'),
    htmlBody: defineMessage('sendingConfigs.htmlBody', 'HTML 内容', 'HTML body'),
} as const;

interface OutboundMessageRecord {
    id: string;
    providerMessageId?: string | null;
    fromAddress: string;
    subject?: string | null;
    status: string;
    lastError?: string | null;
    createdAt: string;
    domain?: { id: number; name: string } | null;
}

const SendingConfigsPage: React.FC = () => {
    const { t } = useI18n();
    const [configs, setConfigs] = useState<SendConfigRecord[]>([]);
    const [messages, setMessages] = useState<OutboundMessageRecord[]>([]);
    const [domains, setDomains] = useState<DomainOption[]>([]);
    const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [sendVisible, setSendVisible] = useState(false);
    const [sendLoading, setSendLoading] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Key[]>([]);
    const [deletingConfigId, setDeletingConfigId] = useState<number | null>(null);
    const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
    const [batchDeletingMessages, setBatchDeletingMessages] = useState(false);
    const [form] = Form.useForm();

    const loadData = useCallback(async () => {
        setLoading(true);
        const [configResult, messageResult, domainResult, mailboxResult] = await Promise.all([
            requestData<{ list: SendConfigRecord[] }>(() => sendingContract.getConfigs(), t(sendingConfigsI18n.fetchConfigsFailed)),
            requestData<{ list: OutboundMessageRecord[] }>(() => sendingContract.getMessages({ page: 1, pageSize: 50 }), t(sendingConfigsI18n.fetchHistoryFailed)),
            requestData<{ list: DomainOption[] }>(() => sendingContract.getDomains({ page: 1, pageSize: 100 }), t(sendingConfigsI18n.fetchDomainsFailed), { silent: true }),
            requestData<{ list: MailboxOption[] }>(() => sendingContract.getMailboxes({ page: 1, pageSize: 100 }), t(sendingConfigsI18n.fetchMailboxesFailed), { silent: true }),
        ]);
        setConfigs(configResult?.list || []);
        setMessages(messageResult?.list || []);
        setDomains((domainResult?.list || []).filter((item) => item.canSend));
        setMailboxes((mailboxResult?.list || []).filter((item) => item.domain?.canSend));
        setLoading(false);
    }, [t]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadData();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    const handleSend = async (values: { domainId: number; mailboxId?: number; from: string; to: string; subject: string; text?: string; html?: string }) => {
        const recipients = parseRecipientInput(values.to);
        setSendLoading(true);
        const result = await requestData(() => sendingContract.send({
            domainId: values.domainId,
            mailboxId: values.mailboxId || undefined,
            from: values.from,
            to: recipients,
            subject: values.subject,
            text: values.text,
            html: values.html,
        }), t(sendingConfigsI18n.sendTestFailed));
        if (result) {
            setSendVisible(false);
            form.resetFields();
            await loadData();
        }
        setSendLoading(false);
    };

    const handleDeleteConfig = useCallback(async (record: SendConfigRecord) => {
        setDeletingConfigId(record.id);
        const result = await requestData<{ deleted: boolean }>(
            () => sendingContract.deleteConfig(record.id),
            t(sendingConfigsI18n.deleteConfigFailed)
        );
        if (result?.deleted) {
            message.success(t(sendingConfigsI18n.deletedConfig, { domain: record.domain?.name || t(sendingConfigsI18n.currentDomain) }));
            await loadData();
        }
        setDeletingConfigId(null);
    }, [loadData, t]);

    const handleDeleteMessage = useCallback(async (record: OutboundMessageRecord) => {
        setDeletingMessageId(record.id);
        const result = await requestData<{ deleted: number }>(
            () => sendingContract.deleteMessage(record.id),
            t(sendingConfigsI18n.deleteHistoryFailed)
        );
        if (result) {
            message.success(t(sendingConfigsI18n.clearedHistory, { count: result.deleted }));
            setSelectedMessageIds((prev) => prev.filter((item) => item !== record.id));
            await loadData();
        }
        setDeletingMessageId(null);
    }, [loadData, t]);

    const handleBatchDeleteMessages = useCallback(async () => {
        if (selectedMessageIds.length === 0) {
            message.warning(t(sendingConfigsI18n.selectHistoryBeforeDelete));
            return;
        }

        setBatchDeletingMessages(true);
        const result = await requestData<{ deleted: number }>(
            () => sendingContract.batchDeleteMessages(selectedMessageIds.map((item) => String(item))),
            t(sendingConfigsI18n.batchDeleteHistoryFailed)
        );
        if (result) {
            message.success(t(sendingConfigsI18n.clearedHistory, { count: result.deleted }));
            setSelectedMessageIds([]);
            await loadData();
        }
        setBatchDeletingMessages(false);
    }, [loadData, selectedMessageIds, t]);

    const configColumns: ColumnsType<SendConfigRecord> = [
        { title: t(adminI18n.sendingConfigs.domain), key: 'domain', render: (_value, record) => record.domain?.name || '-' },
        { title: t(adminI18n.sendingConfigs.provider), dataIndex: 'provider', key: 'provider', render: (value) => t(value) },
        { title: t(adminI18n.sendingConfigs.defaultSender), dataIndex: 'fromNameDefault', key: 'fromNameDefault', render: (value) => value || '-' },
        { title: t(adminI18n.sendingConfigs.replyTo), dataIndex: 'replyToDefault', key: 'replyToDefault', render: (value) => value || '-' },
        { title: t(adminI18n.common.status), dataIndex: 'status', key: 'status', render: (value) => t(value) },
        {
            title: t(adminI18n.common.actions),
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title={t(sendingConfigsI18n.deleteConfigConfirm)}
                    description={t(sendingConfigsI18n.deleteConfigDescription)}
                    onConfirm={() => void handleDeleteConfig(record)}
                >
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingConfigId === record.id}
                    />
                </Popconfirm>
            ),
        },
    ];

    const messageColumns: ColumnsType<OutboundMessageRecord> = [
        { title: t(sendingConfigsI18n.senderDomain), key: 'domain', render: (_value, record) => record.domain?.name || '-' },
        { title: t(sendingConfigsI18n.senderAddress), dataIndex: 'fromAddress', key: 'fromAddress' },
        { title: t(adminI18n.sendingConfigs.subject), dataIndex: 'subject', key: 'subject', render: (value) => value || t(sendingConfigsI18n.noSubject) },
        { title: t(adminI18n.common.status), dataIndex: 'status', key: 'status', render: (value) => t(value) },
        { title: t(adminI18n.sendingConfigs.providerId), dataIndex: 'providerMessageId', key: 'providerMessageId', render: (value) => value || '-' },
        { title: t(adminI18n.sendingConfigs.failureReason), dataIndex: 'lastError', key: 'lastError', render: (value) => value || '-' },
        { title: t(sendingConfigsI18n.time), dataIndex: 'createdAt', key: 'createdAt', render: (value) => new Date(value).toLocaleString() },
        {
            title: t(adminI18n.common.actions),
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title={t(sendingConfigsI18n.deleteHistoryConfirm)}
                    description={t(sendingConfigsI18n.deleteHistoryDescription)}
                    onConfirm={() => void handleDeleteMessage(record)}
                >
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingMessageId === record.id}
                    />
                </Popconfirm>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t(adminI18n.sendingConfigs.title)}
                subtitle={t(adminI18n.sendingConfigs.subtitle)}
                extra={
                    <Space wrap>
                        <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
                            {t(adminI18n.common.refresh)}
                        </Button>
                        <Button type="primary" icon={<SendOutlined />} onClick={() => setSendVisible(true)}>
                            {t(adminI18n.sendingConfigs.sendTestMail)}
                        </Button>
                    </Space>
                }
            />
            <Space orientation="vertical" size="large" style={fullWidthStyle}>
                {selectedMessageIds.length > 0 ? (
                    <SurfaceCard tone="muted">
                        <Space wrap style={{ width: '100%', justifyContent: 'space-between', gap: 12 }}>
                            <Text type="secondary">{t(adminI18n.sendingConfigs.selectedHistoryCount, { count: selectedMessageIds.length })}</Text>
                            <Popconfirm
                                title={t(sendingConfigsI18n.batchDeleteHistoryConfirm, { count: selectedMessageIds.length })}
                                description={t(sendingConfigsI18n.batchDeleteHistoryDescription)}
                                onConfirm={() => void handleBatchDeleteMessages()}
                            >
                                <Button danger loading={batchDeletingMessages} icon={<DeleteOutlined />}>
                                    {t(adminI18n.sendingConfigs.clearSelected, { count: selectedMessageIds.length })}
                                </Button>
                            </Popconfirm>
                        </Space>
                    </SurfaceCard>
                ) : null}
                <SurfaceCard title={t(adminI18n.sendingConfigs.configTitle)}>
                    <Table rowKey="id" loading={loading} columns={configColumns} dataSource={configs} pagination={false} locale={{ emptyText: t(adminI18n.sendingConfigs.noConfigs) }} />
                </SurfaceCard>
                <SurfaceCard title={t(adminI18n.sendingConfigs.historyTitle)}>
                    <Table
                        rowKey="id"
                        loading={loading}
                        columns={messageColumns}
                        dataSource={messages}
                        pagination={false}
                        rowSelection={{
                            selectedRowKeys: selectedMessageIds,
                            onChange: setSelectedMessageIds,
                        }}
                        locale={{ emptyText: t(adminI18n.sendingConfigs.noHistory) }}
                    />
                </SurfaceCard>
            </Space>
            <Modal title={t(adminI18n.sendingConfigs.sendTestMail)} open={sendVisible} onCancel={() => setSendVisible(false)} onOk={() => form.submit()} confirmLoading={sendLoading} destroyOnHidden width={720}>
                <Form form={form} layout="vertical" onFinish={handleSend}>
                    <Form.Item name="domainId" label={t(adminI18n.sendingConfigs.domain)} rules={[{ required: true, message: t(sendingConfigsI18n.selectDomainRequired) }]}> 
                        <Select options={domains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="mailboxId" label={t(sendingConfigsI18n.senderMailbox)}>
                        <Select allowClear options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
                    </Form.Item>
                    <Form.Item name="from" label={t(sendingConfigsI18n.senderAddress)} rules={[{ required: true, message: t(sendingConfigsI18n.senderAddressRequired) }, { type: 'email', message: t(sendingConfigsI18n.validEmailRequired) }]}> 
                        <Input placeholder="noreply@example.com" />
                    </Form.Item>
                    <Form.Item
                        name="to"
                        label={t(sendingConfigsI18n.recipients)}
                        extra={t(sendingConfigsI18n.recipientsExtra)}
                        rules={[
                            { required: true, message: t(sendingConfigsI18n.recipientsRequired) },
                            {
                                validator: (_, value) => {
                                    const normalizedValue = typeof value === 'string' ? value.trim() : '';
                                    if (!normalizedValue) {
                                        return Promise.reject(new Error(t(sendingConfigsI18n.recipientsRequired)));
                                    }
                                    if (!hasOnlyValidRecipients(normalizedValue)) {
                                        return Promise.reject(new Error(t(sendingConfigsI18n.recipientsInvalid)));
                                    }
                                    return Promise.resolve();
                                },
                            },
                        ]}
                    > 
                        <Input.TextArea rows={3} placeholder={t(sendingConfigsI18n.recipientsPlaceholder)} />
                    </Form.Item>
                    <Form.Item name="subject" label={t(adminI18n.sendingConfigs.subject)} rules={[{ required: true, message: t(sendingConfigsI18n.subjectRequired) }]}> 
                        <Input />
                    </Form.Item>
                    <Form.Item name="text" label={t(sendingConfigsI18n.textBody)}>
                        <Input.TextArea rows={4} />
                    </Form.Item>
                    <Form.Item name="html" label={t(sendingConfigsI18n.htmlBody)}>
                        <Input.TextArea rows={4} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default SendingConfigsPage;

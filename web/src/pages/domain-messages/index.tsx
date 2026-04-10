import { useCallback, useEffect, useState, type FC } from 'react';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Drawer, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, SurfaceCard } from '../../components';
import { domainMessagesContract } from '../../contracts/admin/domainMessages';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { fullWidthStyle, noMarginStyle, preWrapBreakWordStyle, width180Style, width220Style } from '../../styles/common';
import { requestData } from '../../utils/request';

const { Text } = Typography;

const domainMessagesI18n = {
    fetchDomainsFailed: defineMessage('domainMessages.fetchDomainsFailed', '获取域名失败', 'Failed to load domains'),
    fetchMailboxesFailed: defineMessage('domainMessages.fetchMailboxesFailed', '获取邮箱失败', 'Failed to load mailboxes'),
    fetchListFailed: defineMessage('domainMessages.fetchListFailed', '获取域名消息失败', 'Failed to load domain messages'),
    fetchDetailFailed: defineMessage('domainMessages.fetchDetailFailed', '获取消息详情失败', 'Failed to load message details'),
    deleteFailed: defineMessage('domainMessages.deleteFailed', '删除域名消息失败', 'Failed to delete the domain message'),
    deleted: defineMessage('domainMessages.deleted', '已清理 {count} 条域名消息', 'Cleared {count} domain messages'),
    selectBeforeDelete: defineMessage('domainMessages.selectBeforeDelete', '请先选择要清理的域名消息', 'Select the domain messages to clear first'),
    batchDeleteFailed: defineMessage('domainMessages.batchDeleteFailed', '批量清理域名消息失败', 'Failed to clear the selected domain messages'),
    noSubject: defineMessage('domainMessages.noSubject', '(无主题)', '(No subject)'),
    sender: defineMessage('domainMessages.sender', '发件人', 'Sender'),
    mailbox: defineMessage('domainMessages.mailbox', '邮箱', 'Mailbox'),
    time: defineMessage('domainMessages.time', '时间', 'Time'),
    deleteConfirm: defineMessage('domainMessages.deleteConfirm', '确定要清理这条域名消息吗？', 'Clear this domain message?'),
    deleteDescription: defineMessage('domainMessages.deleteDescription', '清理后这条消息将从域名消息列表中移除。', 'After clearing, this message will be removed from the domain message list.'),
    batchDeleteConfirm: defineMessage('domainMessages.batchDeleteConfirm', '确定要清理选中的 {count} 条域名消息吗？', 'Clear the selected {count} domain messages?'),
    batchDeleteDescription: defineMessage('domainMessages.batchDeleteDescription', '仅清理当前选中的消息记录，不会影响其它邮箱。', 'Only the selected message records will be cleared. Other mailboxes are not affected.'),
    senderLabel: defineMessage('domainMessages.detail.senderLabel', '发件人：', 'Sender: '),
    recipientLabel: defineMessage('domainMessages.detail.recipientLabel', '收件地址：', 'Recipient: '),
    routeLabel: defineMessage('domainMessages.detail.routeLabel', '命中路由：', 'Matched route: '),
    verificationLabel: defineMessage('domainMessages.detail.verificationLabel', '验证码：', 'Verification code: '),
    storageLabel: defineMessage('domainMessages.detail.storageLabel', '存储状态：', 'Storage status: '),
    rawObjectKeyLabel: defineMessage('domainMessages.detail.rawObjectKeyLabel', '原始对象键：', 'Raw object key: '),
    portalVisibilityLabel: defineMessage('domainMessages.detail.portalVisibilityLabel', '门户可见性：', 'Portal visibility: '),
    attachmentSummaryLabel: defineMessage('domainMessages.detail.attachmentSummaryLabel', '附件摘要：', 'Attachment summary: '),
    attachmentsCount: defineMessage('domainMessages.detail.attachmentsCount', '{count} 个附件（当前多为仅元数据）', '{count} attachments (currently metadata only)'),
    noAttachments: defineMessage('domainMessages.detail.noAttachments', '无附件', 'No attachments'),
    previewTitle: defineMessage('domainMessages.detail.previewTitle', '内容预览', 'Content preview'),
} as const;

interface DomainOption {
    id: number;
    name: string;
}

interface MailboxOption {
    id: number;
    address: string;
}

interface MessageRecord {
    id: string;
    fromAddress: string;
    toAddress: string;
    subject?: string | null;
    verificationCode?: string | null;
    routeKind?: string | null;
    receivedAt: string;
    storageStatus?: string | null;
    mailbox?: { id: number; address: string } | null;
    domain?: { id: number; name: string } | null;
}

const DomainMessagesPage: FC = () => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [domains, setDomains] = useState<DomainOption[]>([]);
    const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
    const [messages, setMessages] = useState<MessageRecord[]>([]);
    const [domainId, setDomainId] = useState<number | undefined>(undefined);
    const [mailboxId, setMailboxId] = useState<number | undefined>(undefined);
    const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [batchDeleting, setBatchDeleting] = useState(false);

    const closeDrawerIfDeleted = useCallback((ids: string[]) => {
        if (detail?.id && ids.includes(String(detail.id))) {
            setDrawerVisible(false);
            setDetail(null);
        }
    }, [detail]);

    const loadOptions = useCallback(async () => {
        const [domainResult, mailboxResult] = await Promise.all([
            requestData<{ list: DomainOption[] }>(() => domainMessagesContract.getDomains({ page: 1, pageSize: 100 }), t(domainMessagesI18n.fetchDomainsFailed), { silent: true }),
            requestData<{ list: MailboxOption[] }>(() => domainMessagesContract.getMailboxes({ page: 1, pageSize: 100 }), t(domainMessagesI18n.fetchMailboxesFailed), { silent: true }),
        ]);
        setDomains(domainResult?.list || []);
        setMailboxes(mailboxResult?.list || []);
    }, [t]);

    const loadMessages = useCallback(async () => {
        setLoading(true);
        const result = await requestData<{ list: MessageRecord[] }>(
            () => domainMessagesContract.getList({ page: 1, pageSize: 100, domainId, mailboxId }),
            t(domainMessagesI18n.fetchListFailed)
        );
        if (result) {
            setMessages(result.list);
        }
        setLoading(false);
    }, [domainId, mailboxId, t]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadOptions();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadOptions]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadMessages();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadMessages]);

    const openDetail = async (id: string) => {
        const result = await requestData<Record<string, unknown>>(() => domainMessagesContract.getById(id), t(domainMessagesI18n.fetchDetailFailed));
        if (result) {
            setDetail(result);
            setDrawerVisible(true);
        }
    };

    const handleDelete = useCallback(async (record: MessageRecord) => {
        setDeletingId(record.id);
        const result = await requestData<{ deleted: number; ids: string[] }>(
            () => domainMessagesContract.delete(record.id),
            t(domainMessagesI18n.deleteFailed)
        );
        if (result) {
            message.success(t(domainMessagesI18n.deleted, { count: result.deleted }));
            setSelectedRowKeys((prev) => prev.filter((item) => item !== record.id));
            closeDrawerIfDeleted(result.ids);
            await loadMessages();
        }
        setDeletingId(null);
    }, [closeDrawerIfDeleted, loadMessages, t]);

    const handleBatchDelete = useCallback(async () => {
        if (selectedRowKeys.length === 0) {
            message.warning(t(domainMessagesI18n.selectBeforeDelete));
            return;
        }

        setBatchDeleting(true);
        const result = await requestData<{ deleted: number; ids: string[] }>(
            () => domainMessagesContract.batchDelete(selectedRowKeys.map((item) => String(item))),
            t(domainMessagesI18n.batchDeleteFailed)
        );
        if (result) {
            message.success(t(domainMessagesI18n.deleted, { count: result.deleted }));
            setSelectedRowKeys([]);
            closeDrawerIfDeleted(result.ids);
            await loadMessages();
        }
        setBatchDeleting(false);
    }, [closeDrawerIfDeleted, loadMessages, selectedRowKeys, t]);

    const columns: ColumnsType<MessageRecord> = [
        {
            title: t(adminI18n.sendingConfigs.subject),
            dataIndex: 'subject',
            key: 'subject',
            render: (value, record) => (
                <Button type="link" onClick={() => void openDetail(record.id)} style={noMarginStyle}>
                    {value || t(domainMessagesI18n.noSubject)}
                </Button>
            ),
        },
        { title: t(domainMessagesI18n.sender), dataIndex: 'fromAddress', key: 'fromAddress' },
        { title: t(domainMessagesI18n.mailbox), key: 'mailbox', render: (_, record) => record.mailbox?.address || '-' },
        {
            title: t(adminI18n.domainMessages.code),
            dataIndex: 'verificationCode',
            key: 'verificationCode',
            render: (value) => value ? <Tag color="magenta">{value}</Tag> : '-',
        },
        { title: t(adminI18n.domainMessages.route), dataIndex: 'routeKind', key: 'routeKind' },
        {
            title: t(domainMessagesI18n.time),
            dataIndex: 'receivedAt',
            key: 'receivedAt',
            render: (value) => new Date(value).toLocaleString(),
        },
        {
            title: t(adminI18n.domainMessages.storageStatus),
            dataIndex: 'storageStatus',
            key: 'storageStatus',
            render: (value) => <Tag color={value === 'STORED' ? 'success' : value === 'FAILED' ? 'error' : 'default'}>{t(value || 'PENDING')}</Tag>,
        },
        {
            title: t(adminI18n.common.actions),
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title={t(domainMessagesI18n.deleteConfirm)}
                    description={t(domainMessagesI18n.deleteDescription)}
                    onConfirm={() => void handleDelete(record)}
                >
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingId === record.id}
                    />
                </Popconfirm>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t(adminI18n.domainMessages.title)}
                subtitle={t(adminI18n.domainMessages.subtitle)}
                extra={
                    <Space wrap>
                        <Select
                            allowClear
                            placeholder={t(adminI18n.domainMessages.filterDomain)}
                            style={width180Style}
                            value={domainId}
                            onChange={setDomainId}
                            options={domains.map((item) => ({ value: item.id, label: item.name }))}
                        />
                        <Select
                            allowClear
                            placeholder={t(adminI18n.domainMessages.filterMailbox)}
                            style={width220Style}
                            value={mailboxId}
                            onChange={setMailboxId}
                            options={mailboxes.map((item) => ({ value: item.id, label: item.address }))}
                        />
                        {selectedRowKeys.length > 0 ? (
                            <Popconfirm
                                title={t(domainMessagesI18n.batchDeleteConfirm, { count: selectedRowKeys.length })}
                                description={t(domainMessagesI18n.batchDeleteDescription)}
                                onConfirm={() => void handleBatchDelete()}
                            >
                                <Button danger loading={batchDeleting} icon={<DeleteOutlined />}>
                                    {t(adminI18n.domainMessages.clearSelected, { count: selectedRowKeys.length })}
                                </Button>
                            </Popconfirm>
                        ) : null}
                        <Button icon={<ReloadOutlined />} onClick={() => void loadMessages()}>
                            {t(adminI18n.common.refresh)}
                        </Button>
                    </Space>
                }
            />
            <SurfaceCard>
                <Table
                    rowKey="id"
                    loading={loading}
                    columns={columns}
                    dataSource={messages}
                    pagination={false}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: setSelectedRowKeys,
                    }}
                    locale={{ emptyText: t(adminI18n.domainMessages.empty) }}
                />
            </SurfaceCard>
            <Drawer title={String(detail?.subject || t(adminI18n.domainMessages.messageDetail))} open={drawerVisible} onClose={() => setDrawerVisible(false)} size={720}>
                <Space orientation="vertical" style={fullWidthStyle}>
                                        <Text><strong>{t(domainMessagesI18n.senderLabel)}</strong>{String(detail?.fromAddress || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.recipientLabel)}</strong>{String(detail?.toAddress || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.routeLabel)}</strong>{String(detail?.routeKind || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.verificationLabel)}</strong>{String(detail?.verificationCode || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.storageLabel)}</strong>{String(detail?.storageStatus || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.rawObjectKeyLabel)}</strong>{String(detail?.rawObjectKey || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.portalVisibilityLabel)}</strong>{String(detail?.portalState || '-')}</Text>
                                        <Text><strong>{t(domainMessagesI18n.attachmentSummaryLabel)}</strong>{Array.isArray(detail?.attachmentsMeta) ? t(domainMessagesI18n.attachmentsCount, { count: detail.attachmentsMeta.length }) : t(domainMessagesI18n.noAttachments)}</Text>
                                        <SurfaceCard size="small" title={t(domainMessagesI18n.previewTitle)} tone="muted">
                        <div style={preWrapBreakWordStyle}>{String(detail?.textPreview || detail?.htmlPreview || '-')}</div>
                    </SurfaceCard>
                </Space>
            </Drawer>
        </div>
    );
};

export default DomainMessagesPage;

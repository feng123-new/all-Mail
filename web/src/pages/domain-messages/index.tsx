import React, { useCallback, useEffect, useState } from 'react';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { domainApi, domainMailboxApi, domainMessageApi } from '../../api';
import { PageHeader } from '../../components';
import { requestData } from '../../utils/request';

const { Text } = Typography;

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
    mailbox?: { id: number; address: string } | null;
    domain?: { id: number; name: string } | null;
}

const DomainMessagesPage: React.FC = () => {
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
            requestData<{ list: DomainOption[] }>(() => domainApi.getList({ page: 1, pageSize: 100 }), '获取域名失败', { silent: true }),
            requestData<{ list: MailboxOption[] }>(() => domainMailboxApi.getList({ page: 1, pageSize: 100 }), '获取邮箱失败', { silent: true }),
        ]);
        setDomains(domainResult?.list || []);
        setMailboxes(mailboxResult?.list || []);
    }, []);

    const loadMessages = useCallback(async () => {
        setLoading(true);
        const result = await requestData<{ list: MessageRecord[] }>(
            () => domainMessageApi.getList({ page: 1, pageSize: 100, domainId, mailboxId }),
            '获取域名消息失败'
        );
        if (result) {
            setMessages(result.list);
        }
        setLoading(false);
    }, [domainId, mailboxId]);

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
        const result = await requestData<Record<string, unknown>>(() => domainMessageApi.getById(id), '获取消息详情失败');
        if (result) {
            setDetail(result);
            setDrawerVisible(true);
        }
    };

    const handleDelete = useCallback(async (record: MessageRecord) => {
        setDeletingId(record.id);
        const result = await requestData<{ deleted: number; ids: string[] }>(
            () => domainMessageApi.delete(record.id),
            '删除域名消息失败'
        );
        if (result) {
            message.success(`已清理 ${result.deleted} 条域名消息`);
            setSelectedRowKeys((prev) => prev.filter((item) => item !== record.id));
            closeDrawerIfDeleted(result.ids);
            await loadMessages();
        }
        setDeletingId(null);
    }, [closeDrawerIfDeleted, loadMessages]);

    const handleBatchDelete = useCallback(async () => {
        if (selectedRowKeys.length === 0) {
            message.warning('请先选择要清理的域名消息');
            return;
        }

        setBatchDeleting(true);
        const result = await requestData<{ deleted: number; ids: string[] }>(
            () => domainMessageApi.batchDelete(selectedRowKeys.map((item) => String(item))),
            '批量清理域名消息失败'
        );
        if (result) {
            message.success(`已清理 ${result.deleted} 条域名消息`);
            setSelectedRowKeys([]);
            closeDrawerIfDeleted(result.ids);
            await loadMessages();
        }
        setBatchDeleting(false);
    }, [closeDrawerIfDeleted, loadMessages, selectedRowKeys]);

    const columns: ColumnsType<MessageRecord> = [
        {
            title: '主题',
            dataIndex: 'subject',
            key: 'subject',
            render: (value, record) => (
                <Button type="link" onClick={() => void openDetail(record.id)} style={{ padding: 0 }}>
                    {value || '(无主题)'}
                </Button>
            ),
        },
        { title: '发件人', dataIndex: 'fromAddress', key: 'fromAddress' },
        { title: '邮箱', key: 'mailbox', render: (_, record) => record.mailbox?.address || '-' },
        {
            title: '验证码',
            dataIndex: 'verificationCode',
            key: 'verificationCode',
            render: (value) => value ? <Tag color="magenta">{value}</Tag> : '-',
        },
        { title: '路由', dataIndex: 'routeKind', key: 'routeKind' },
        {
            title: '时间',
            dataIndex: 'receivedAt',
            key: 'receivedAt',
            render: (value) => new Date(value).toLocaleString(),
        },
        {
            title: '操作',
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title="确定要清理这条域名消息吗？"
                    description="清理后这条消息将从域名消息列表中移除。"
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
                title="域名消息"
                subtitle="查看所有入站邮件，支持按域名和邮箱筛选；现在可直接清理无效历史，减少域名管理时的历史噪音。"
                extra={
                    <Space wrap>
                        <Select
                            allowClear
                            placeholder="筛选域名"
                            style={{ width: 180 }}
                            value={domainId}
                            onChange={setDomainId}
                            options={domains.map((item) => ({ value: item.id, label: item.name }))}
                        />
                        <Select
                            allowClear
                            placeholder="筛选邮箱"
                            style={{ width: 220 }}
                            value={mailboxId}
                            onChange={setMailboxId}
                            options={mailboxes.map((item) => ({ value: item.id, label: item.address }))}
                        />
                        {selectedRowKeys.length > 0 ? (
                            <Popconfirm
                                title={`确定要清理选中的 ${selectedRowKeys.length} 条域名消息吗？`}
                                description="仅清理当前选中的消息记录，不会影响其它邮箱。"
                                onConfirm={() => void handleBatchDelete()}
                            >
                                <Button danger loading={batchDeleting} icon={<DeleteOutlined />}>
                                    清理选中 ({selectedRowKeys.length})
                                </Button>
                            </Popconfirm>
                        ) : null}
                        <Button icon={<ReloadOutlined />} onClick={() => void loadMessages()}>
                            刷新
                        </Button>
                    </Space>
                }
            />
            <Card>
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
                    locale={{ emptyText: '暂无域名消息' }}
                />
            </Card>
            <Drawer title={String(detail?.subject || '邮件详情')} open={drawerVisible} onClose={() => setDrawerVisible(false)} width={720}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Text><strong>发件人：</strong>{String(detail?.fromAddress || '-')}</Text>
                    <Text><strong>收件人：</strong>{String(detail?.toAddress || '-')}</Text>
                    <Text><strong>命中路由：</strong>{String(detail?.routeKind || '-')}</Text>
                    <Text><strong>验证码：</strong>{String(detail?.verificationCode || '-')}</Text>
                    <Card size="small" title="内容预览">
                        <div style={{ whiteSpace: 'pre-wrap' }}>{String(detail?.textPreview || detail?.htmlPreview || '-')}</div>
                    </Card>
                </Space>
            </Drawer>
        </div>
    );
};

export default DomainMessagesPage;

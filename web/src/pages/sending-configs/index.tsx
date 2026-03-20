import React, { useCallback, useEffect, useState } from 'react';
import { DeleteOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { domainApi, domainMailboxApi, sendingApi } from '../../api';
import { PageHeader } from '../../components';
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

interface OutboundMessageRecord {
    id: string;
    providerMessageId?: string | null;
    fromAddress: string;
    subject?: string | null;
    status: string;
    createdAt: string;
    domain?: { id: number; name: string } | null;
}

const SendingConfigsPage: React.FC = () => {
    const [configs, setConfigs] = useState<SendConfigRecord[]>([]);
    const [messages, setMessages] = useState<OutboundMessageRecord[]>([]);
    const [domains, setDomains] = useState<DomainOption[]>([]);
    const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [sendVisible, setSendVisible] = useState(false);
    const [sendLoading, setSendLoading] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<React.Key[]>([]);
    const [deletingConfigId, setDeletingConfigId] = useState<number | null>(null);
    const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
    const [batchDeletingMessages, setBatchDeletingMessages] = useState(false);
    const [form] = Form.useForm();

    const loadData = useCallback(async () => {
        setLoading(true);
        const [configResult, messageResult, domainResult, mailboxResult] = await Promise.all([
            requestData<{ list: SendConfigRecord[] }>(() => sendingApi.getConfigs(), '获取发信配置失败'),
            requestData<{ list: OutboundMessageRecord[] }>(() => sendingApi.getMessages({ page: 1, pageSize: 50 }), '获取发件历史失败'),
            requestData<{ list: DomainOption[] }>(() => domainApi.getList({ page: 1, pageSize: 100 }), '获取域名失败', { silent: true }),
            requestData<{ list: MailboxOption[] }>(() => domainMailboxApi.getList({ page: 1, pageSize: 100 }), '获取邮箱失败', { silent: true }),
        ]);
        setConfigs(configResult?.list || []);
        setMessages(messageResult?.list || []);
        setDomains((domainResult?.list || []).filter((item) => item.canSend));
        setMailboxes((mailboxResult?.list || []).filter((item) => item.domain?.canSend));
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadData();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    const handleSend = async (values: { domainId: number; mailboxId?: number; from: string; to: string; subject: string; text?: string; html?: string }) => {
        setSendLoading(true);
        const result = await requestData(() => sendingApi.send({
            domainId: values.domainId,
            mailboxId: values.mailboxId,
            from: values.from,
            to: values.to.split(',').map((item) => item.trim()).filter(Boolean),
            subject: values.subject,
            text: values.text,
            html: values.html,
        }), '发送测试邮件失败');
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
            () => sendingApi.deleteConfig(record.id),
            '删除发信配置失败'
        );
        if (result?.deleted) {
            message.success(`已删除 ${record.domain?.name || '该域名'} 的发信配置`);
            await loadData();
        }
        setDeletingConfigId(null);
    }, [loadData]);

    const handleDeleteMessage = useCallback(async (record: OutboundMessageRecord) => {
        setDeletingMessageId(record.id);
        const result = await requestData<{ deleted: number }>(
            () => sendingApi.deleteMessage(record.id),
            '删除发件历史失败'
        );
        if (result) {
            message.success(`已清理 ${result.deleted} 条发件历史`);
            setSelectedMessageIds((prev) => prev.filter((item) => item !== record.id));
            await loadData();
        }
        setDeletingMessageId(null);
    }, [loadData]);

    const handleBatchDeleteMessages = useCallback(async () => {
        if (selectedMessageIds.length === 0) {
            message.warning('请先选择要清理的发件历史');
            return;
        }

        setBatchDeletingMessages(true);
        const result = await requestData<{ deleted: number }>(
            () => sendingApi.batchDeleteMessages(selectedMessageIds.map((item) => String(item))),
            '批量清理发件历史失败'
        );
        if (result) {
            message.success(`已清理 ${result.deleted} 条发件历史`);
            setSelectedMessageIds([]);
            await loadData();
        }
        setBatchDeletingMessages(false);
    }, [loadData, selectedMessageIds]);

    const configColumns: ColumnsType<SendConfigRecord> = [
        { title: '域名', key: 'domain', render: (_value, record) => record.domain?.name || '-' },
        { title: 'Provider', dataIndex: 'provider', key: 'provider' },
        { title: '默认发件人', dataIndex: 'fromNameDefault', key: 'fromNameDefault', render: (value) => value || '-' },
        { title: 'Reply-To', dataIndex: 'replyToDefault', key: 'replyToDefault', render: (value) => value || '-' },
        { title: '状态', dataIndex: 'status', key: 'status' },
        {
            title: '操作',
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title="确定要删除这条发信配置吗？"
                    description="删除后该域名将无法继续从 all-Mail 直接发信。"
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
        { title: '发件域名', key: 'domain', render: (_value, record) => record.domain?.name || '-' },
        { title: 'From', dataIndex: 'fromAddress', key: 'fromAddress' },
        { title: '主题', dataIndex: 'subject', key: 'subject', render: (value) => value || '(无主题)' },
        { title: '状态', dataIndex: 'status', key: 'status' },
        { title: 'Provider ID', dataIndex: 'providerMessageId', key: 'providerMessageId', render: (value) => value || '-' },
        { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (value) => new Date(value).toLocaleString() },
        {
            title: '操作',
            key: 'actions',
            width: 96,
            render: (_value, record) => (
                <Popconfirm
                    title="确定要清理这条发件历史吗？"
                    description="这只会删除历史记录，不会撤回已经发出的邮件。"
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
                title="发信配置与历史"
                subtitle="查看域名发信配置并对可发信域名执行测试发送；现在支持直接清理无效配置和历史记录。"
                extra={
                    <Space wrap>
                        {selectedMessageIds.length > 0 ? (
                            <Popconfirm
                                title={`确定要清理选中的 ${selectedMessageIds.length} 条发件历史吗？`}
                                description="仅清理历史记录，不会影响真实发件结果。"
                                onConfirm={() => void handleBatchDeleteMessages()}
                            >
                                <Button danger loading={batchDeletingMessages} icon={<DeleteOutlined />}>
                                    清理选中 ({selectedMessageIds.length})
                                </Button>
                            </Popconfirm>
                        ) : null}
                        <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<SendOutlined />} onClick={() => setSendVisible(true)}>
                            发送测试邮件
                        </Button>
                    </Space>
                }
            />
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="发信配置">
                    <Table rowKey="id" loading={loading} columns={configColumns} dataSource={configs} pagination={false} locale={{ emptyText: '暂无发信配置' }} />
                </Card>
                <Card title="发件历史">
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
                        locale={{ emptyText: '暂无发件历史' }}
                    />
                </Card>
            </Space>
            <Modal title="发送测试邮件" open={sendVisible} onCancel={() => setSendVisible(false)} onOk={() => form.submit()} confirmLoading={sendLoading} destroyOnClose width={720}>
                <Form form={form} layout="vertical" onFinish={handleSend}>
                    <Form.Item name="domainId" label="域名" rules={[{ required: true, message: '请选择域名' }]}>
                        <Select options={domains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="mailboxId" label="发件邮箱">
                        <Select allowClear options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
                    </Form.Item>
                    <Form.Item name="from" label="From 地址" rules={[{ required: true, message: '请输入 From 地址' }, { type: 'email', message: '请输入有效邮箱地址' }]}>
                        <Input placeholder="noreply@example.com" />
                    </Form.Item>
                    <Form.Item name="to" label="To（逗号分隔）" rules={[{ required: true, message: '请输入收件人' }]}>
                        <Input placeholder="user@example.com" />
                    </Form.Item>
                    <Form.Item name="subject" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="text" label="纯文本内容">
                        <Input.TextArea rows={4} />
                    </Form.Item>
                    <Form.Item name="html" label="HTML 内容">
                        <Input.TextArea rows={4} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default SendingConfigsPage;

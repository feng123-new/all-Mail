import { useCallback, useEffect, useState, type FC } from 'react';
import { Button, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { LOG_ACTION_OPTIONS, getLogActionColor, getLogActionLabel } from '../../constants/logActions';
import type { LogAction } from '../../constants/logActions';
import { adminI18n } from '../../i18n/catalog/admin';
import { logsContract } from '../../contracts/admin/logs';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { marginBottom16Style, width160Style } from '../../styles/common';
import { requestData } from '../../utils/request';
import dayjs from 'dayjs';

const { Text } = Typography;

const operationLogsI18n = {
    fetchFailed: defineMessage('operationLogs.fetchFailed', '获取日志失败', 'Failed to load logs'),
    deleteFailed: defineMessage('operationLogs.deleteFailed', '删除日志失败', 'Failed to delete the log entry'),
    deleted: defineMessage('operationLogs.deleted', '日志已删除', 'Log entry deleted'),
    selectBeforeDelete: defineMessage('operationLogs.selectBeforeDelete', '请先选择要删除的日志', 'Select the logs to delete first'),
    batchDeleteFailed: defineMessage('operationLogs.batchDeleteFailed', '批量删除日志失败', 'Failed to delete the selected logs'),
    batchDeleted: defineMessage('operationLogs.batchDeleted', '已删除 {count} 条日志', 'Deleted {count} logs'),
    accessKey: defineMessage('operationLogs.accessKey', '访问密钥', 'API key'),
    requestId: defineMessage('operationLogs.requestId', '请求 ID', 'Request ID'),
    deleteConfirm: defineMessage('operationLogs.deleteConfirm', '确定要删除这条日志吗？', 'Delete this log entry?'),
    deleteLabel: defineMessage('operationLogs.deleteLabel', '删除', 'Delete'),
    batchDeleteConfirm: defineMessage('operationLogs.batchDeleteConfirm', '确定要删除选中的 {count} 条日志吗？', 'Delete the selected {count} logs?'),
    batchDeleteLabel: defineMessage('operationLogs.batchDeleteLabel', '批量删除 ({count})', 'Delete selected ({count})'),
    empty: defineMessage('operationLogs.empty', '暂无 API 调用日志', 'No API audit logs yet'),
    actionType: defineMessage('operationLogs.actionType', '动作类型', 'Action type'),
    actionColumnLabel: defineMessage('operationLogs.actionColumnLabel', '操作', 'Actions'),
} as const;

const operationLogsStyles = {
    actionTypeTag: {
        display: 'inline-flex',
        maxWidth: '100%',
        whiteSpace: 'normal',
        lineHeight: '18px',
        paddingBlock: 4,
        alignItems: 'center',
    } as const,
    emailText: {
        display: 'block',
        maxWidth: '100%',
    } as const,
} as const;

interface LogItem {
    id: number;
    action: string;
    apiKeyName: string;
    email: string;
    requestIp: string;
    requestId: string | null;
    responseCode: number;
    responseTimeMs: number;
    createdAt: string;
}

const OperationLogsPage: FC = () => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [actionFilter, setActionFilter] = useState<LogAction | undefined>();
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [batchDeleting, setBatchDeleting] = useState(false);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        const result = await requestData<{ list: LogItem[]; total: number }>(
            () => logsContract.getList({ page, pageSize, action: actionFilter }),
            t(operationLogsI18n.fetchFailed)
        );
        if (result) {
            setLogs(result.list);
            setTotal(result.total);
        }
        setLoading(false);
    }, [actionFilter, page, pageSize, t]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchLogs();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [fetchLogs]);

    const handleDelete = useCallback(async (id: number) => {
        setDeletingId(id);
        const result = await requestData<{ deleted: boolean }>(
            () => logsContract.delete(id),
            t(operationLogsI18n.deleteFailed)
        );
            if (result?.deleted) {
            message.success(t(operationLogsI18n.deleted));
            setSelectedRowKeys((prev) => prev.filter((item) => item !== id));
            await fetchLogs();
        }
        setDeletingId(null);
    }, [fetchLogs, t]);

    const handleBatchDelete = useCallback(async () => {
        if (selectedRowKeys.length === 0) {
            message.warning(t(operationLogsI18n.selectBeforeDelete));
            return;
        }
        setBatchDeleting(true);
        const result = await requestData<{ deleted: number }>(
            () => logsContract.batchDelete(selectedRowKeys as number[]),
            t(operationLogsI18n.batchDeleteFailed)
        );
        if (result) {
            message.success(t(operationLogsI18n.batchDeleted, { count: result.deleted }));
            setSelectedRowKeys([]);
            await fetchLogs();
        }
        setBatchDeleting(false);
    }, [fetchLogs, selectedRowKeys, t]);

    const columns = [
        {
            title: t(adminI18n.operationLogs.time),
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm:ss'),
        },
        {
            title: t(operationLogsI18n.accessKey),
            dataIndex: 'apiKeyName',
            key: 'apiKeyName',
            width: 150,
            render: (name: string) => name === '-' ? <Text type="secondary">-</Text> : <Tag color="blue">{name}</Tag>,
        },
        {
            title: t(operationLogsI18n.actionType),
            dataIndex: 'action',
            key: 'action',
            width: 160,
            render: (action: string) => {
                return (
                    <Tag color={getLogActionColor(action)} style={operationLogsStyles.actionTypeTag}>
                        {t(getLogActionLabel(action))}
                    </Tag>
                );
            },
        },
        {
            title: t(adminI18n.operationLogs.email),
            dataIndex: 'email',
            key: 'email',
            ellipsis: true,
            width: 160,
            render: (email: string) => email === '-' ? <Text type="secondary">-</Text> : <Text ellipsis={{ tooltip: email }} style={operationLogsStyles.emailText}>{email}</Text>,
        },
        {
            title: t(adminI18n.operationLogs.statusCode),
            dataIndex: 'responseCode',
            key: 'responseCode',
            width: 80,
            align: 'left' as const,
            render: (code: number) => (
                <Tag color={code === 200 ? 'success' : 'error'}>{code}</Tag>
            ),
        },
        {
            title: t(adminI18n.operationLogs.latency),
            dataIndex: 'responseTimeMs',
            key: 'responseTimeMs',
            width: 100,
            align: 'left' as const,
            render: (ms: number) => `${ms} ms`,
        },
        {
            title: t(adminI18n.operationLogs.ipAddress),
            dataIndex: 'requestIp',
            key: 'requestIp',
            width: 130,
        },
        {
            title: t(operationLogsI18n.requestId),
            dataIndex: 'requestId',
            key: 'requestId',
            width: 200,
            render: (requestId: string | null) => requestId ? <Text copyable>{requestId}</Text> : <Text type="secondary">-</Text>,
        },
        {
            title: t(operationLogsI18n.actionColumnLabel),
            key: 'actions',
            width: 96,
            align: 'left' as const,
            render: (_: unknown, record: LogItem) => (
                <Popconfirm title={t(operationLogsI18n.deleteConfirm)} onConfirm={() => void handleDelete(record.id)}>
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t(operationLogsI18n.deleteLabel)}
                        loading={deletingId === record.id}
                    />
                </Popconfirm>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t(adminI18n.operationLogs.title)}
                subtitle={t(adminI18n.operationLogs.subtitle)}
                extra={
                    <Space>
                        {selectedRowKeys.length > 0 ? (
                            <Popconfirm
                                title={t(operationLogsI18n.batchDeleteConfirm, { count: selectedRowKeys.length })}
                                onConfirm={() => void handleBatchDelete()}
                            >
                                <Button danger loading={batchDeleting} icon={<DeleteOutlined />}>
                                    {t(operationLogsI18n.batchDeleteLabel, { count: selectedRowKeys.length })}
                                </Button>
                            </Popconfirm>
                        ) : null}
                        <Button icon={<ReloadOutlined />} onClick={() => void fetchLogs()}>
                            {t(adminI18n.common.refresh)}
                        </Button>
                    </Space>
                }
            />

            <SurfaceCard>
                <Space style={marginBottom16Style}>
                    <Select
                        placeholder={t(adminI18n.operationLogs.filterByAction)}
                        style={width160Style}
                        allowClear
                        options={LOG_ACTION_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                        onChange={(val) => setActionFilter(val as LogAction | undefined)}
                    />
                    <Text type="secondary">
                        {t(adminI18n.operationLogs.note)}
                    </Text>
                </Space>

                <Table
                    dataSource={logs}
                    columns={columns}
                    rowKey="id"
                    rowSelection={{
                        selectedRowKeys,
                        onChange: setSelectedRowKeys,
                    }}
                    loading={loading}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        showQuickJumper: true,
                        showTotal: (count) => t(adminI18n.common.totalCount, { count }),
                        onChange: (p, ps) => {
                            setPage(p);
                            setPageSize(ps);
                        },
                    }}
                    locale={{ emptyText: t(operationLogsI18n.empty) }}
                />
            </SurfaceCard>
        </div>
    );
};

export default OperationLogsPage;

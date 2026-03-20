import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Button,
    Card,
    Form,
    Input,
    InputNumber,
    message,
    Modal,
    Popconfirm,
    Select,
    Space,
    Switch,
    Table,
    Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { apiKeyApi, domainApi, domainMailboxApi, mailboxUserApi } from '../../api';
import { PageHeader } from '../../components';
import { getErrorMessage } from '../../utils/error';
import { requestData } from '../../utils/request';

interface DomainOption {
    id: number;
    name: string;
    status?: string;
    canReceive?: boolean;
    canSend?: boolean;
}

interface ApiKeyOption {
    id: number;
    name: string;
    keyPrefix: string;
    status: 'ACTIVE' | 'DISABLED';
}

interface UserRecord {
    id: number;
    username: string;
    email?: string | null;
    status: 'ACTIVE' | 'DISABLED';
    mailboxCount?: number;
}

interface MailboxRecord {
    id: number;
    domainId: number;
    address: string;
    localPart: string;
    displayName?: string | null;
    status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED';
    provisioningMode: 'MANUAL' | 'API_POOL';
    batchTag?: string | null;
    ownerUserId?: number | null;
    apiUsageCount?: number;
    inboundMessageCount?: number;
    domain?: { id: number; name: string };
    ownerUser?: { id: number; username: string } | null;
}

interface BatchCreateResult {
    createdCount?: number;
    mailboxes?: Array<Record<string, unknown>>;
}

interface BatchDeleteResult {
    deletedCount?: number;
}

interface BatchAssignResult {
    userId: number;
    username: string;
    addedCount: number;
    totalAccessible: number;
}

interface PagedListResult<T> {
    list: T[];
    total: number;
}

interface ApiEnvelope<T> {
    code: number;
    data: T;
}

type BatchCreateMode = 'PREFIX' | 'LIST';

const provisioningOptions = [
    { value: 'MANUAL', label: 'MANUAL（人工邮箱）' },
    { value: 'API_POOL', label: 'API_POOL（API 池邮箱）' },
];

const MAX_LIST_PAGE_SIZE = 100;

async function fetchAllPagedItems<T>(fetchPage: (page: number, pageSize: number) => Promise<ApiEnvelope<PagedListResult<T>>>): Promise<ApiEnvelope<T[]>> {
    let page = 1;
    let total = 0;
    const items: T[] = [];

    do {
        const result = await fetchPage(page, MAX_LIST_PAGE_SIZE);
        items.push(...result.data.list);
        total = result.data.total;
        page += 1;
    } while (items.length < total);

    return {
        code: 200,
        data: items,
    };
}

const DomainMailboxesPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [mailboxes, setMailboxes] = useState<MailboxRecord[]>([]);
    const [domains, setDomains] = useState<DomainOption[]>([]);
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [apiKeys, setApiKeys] = useState<ApiKeyOption[]>([]);
    const [selectedMailboxIds, setSelectedMailboxIds] = useState<number[]>([]);
    const [filterDomainId, setFilterDomainId] = useState<number | undefined>(undefined);
    const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
    const [filterProvisioningMode, setFilterProvisioningMode] = useState<'MANUAL' | 'API_POOL' | undefined>(undefined);
    const [filterBatchTag, setFilterBatchTag] = useState('');

    const [mailboxModalVisible, setMailboxModalVisible] = useState(false);
    const [batchCreateModalVisible, setBatchCreateModalVisible] = useState(false);
    const [batchDeleteModalVisible, setBatchDeleteModalVisible] = useState(false);
    const [batchAssignModalVisible, setBatchAssignModalVisible] = useState(false);
    const [editingMailbox, setEditingMailbox] = useState<MailboxRecord | null>(null);
    const [savingMailbox, setSavingMailbox] = useState(false);
    const [savingBatchCreate, setSavingBatchCreate] = useState(false);
    const [savingBatchDelete, setSavingBatchDelete] = useState(false);
    const [savingBatchAssign, setSavingBatchAssign] = useState(false);
    const [mailboxForm] = Form.useForm();
    const [batchCreateForm] = Form.useForm();
    const [batchDeleteForm] = Form.useForm();
    const [batchAssignForm] = Form.useForm();

    const batchCreateMode = (Form.useWatch('createMode', batchCreateForm) as BatchCreateMode | undefined) || 'PREFIX';

    const loadData = useCallback(async () => {
        setLoading(true);
        const [domainResult, mailboxResult, userResult, apiKeyResult] = await Promise.all([
            requestData<DomainOption[]>(async () => fetchAllPagedItems<DomainOption>(
                async (page, pageSize) => domainApi.getList<DomainOption>({ page, pageSize })
            ), '获取域名失败', { silent: true }),
            requestData<MailboxRecord[]>(async () => fetchAllPagedItems<MailboxRecord>(
                async (page, pageSize) => domainMailboxApi.getList<MailboxRecord>({
                    page,
                    pageSize,
                    domainId: filterDomainId,
                    status: filterStatus,
                    provisioningMode: filterProvisioningMode,
                    batchTag: filterBatchTag.trim() || undefined,
                })
            ), '获取域名邮箱失败'),
            requestData<UserRecord[]>(async () => fetchAllPagedItems<UserRecord>(
                async (page, pageSize) => mailboxUserApi.getList<UserRecord>({ page, pageSize })
            ), '获取邮箱用户失败', { silent: true }),
            requestData<ApiKeyOption[]>(async () => fetchAllPagedItems<ApiKeyOption>(
                async (page, pageSize) => apiKeyApi.getList<ApiKeyOption>({ page, pageSize, status: 'ACTIVE' })
            ), '获取 API Key 失败', { silent: true }),
        ]);

        setDomains((domainResult || []).filter((item) => item.status !== 'DISABLED'));
        setMailboxes(mailboxResult || []);
        setUsers(userResult || []);
        setApiKeys(apiKeyResult || []);
        setLoading(false);
    }, [filterBatchTag, filterDomainId, filterProvisioningMode, filterStatus]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadData();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    const activeDomains = useMemo(
        () => domains.filter((item) => item.status !== 'DISABLED'),
        [domains]
    );

    const openMailboxModal = (record?: MailboxRecord) => {
        setEditingMailbox(record || null);
        mailboxForm.resetFields();
        if (record) {
            mailboxForm.setFieldsValue({
                domainId: record.domainId,
                localPart: record.localPart,
                displayName: record.displayName,
                ownerUserId: record.ownerUserId ?? undefined,
                status: record.status,
                provisioningMode: record.provisioningMode,
                batchTag: record.batchTag ?? undefined,
            });
        } else {
            mailboxForm.setFieldsValue({
                provisioningMode: 'MANUAL',
            });
        }
        setMailboxModalVisible(true);
    };

    const openBatchCreateModal = () => {
        batchCreateForm.resetFields();
        batchCreateForm.setFieldsValue({
            createMode: 'PREFIX',
            count: 10,
            startFrom: 1,
            padding: 0,
            provisioningMode: 'API_POOL',
            canLogin: false,
            bindApiKeyIds: [],
        });
        setBatchCreateModalVisible(true);
    };

    const openBatchDeleteModal = () => {
        batchDeleteForm.resetFields();
        batchDeleteForm.setFieldsValue({
            provisioningMode: filterProvisioningMode,
            domainId: filterDomainId,
            batchTag: filterBatchTag.trim() || undefined,
        });
        setBatchDeleteModalVisible(true);
    };

    const openBatchAssignModal = () => {
        batchAssignForm.resetFields();
        setBatchAssignModalVisible(true);
    };

    const handleMailboxSubmit = async (values: Record<string, unknown>) => {
        setSavingMailbox(true);
        const action = editingMailbox
            ? domainMailboxApi.update(editingMailbox.id, values)
            : domainMailboxApi.create(values);
        const result = await requestData(() => action, editingMailbox ? '更新邮箱失败' : '创建邮箱失败');
        if (result) {
            setMailboxModalVisible(false);
            await loadData();
        }
        setSavingMailbox(false);
    };

    const handleBatchCreateSubmit = async () => {
        try {
            const values = await batchCreateForm.validateFields();
            const payload: Record<string, unknown> = {
                domainId: values.domainId,
                displayName: values.displayName,
                provisioningMode: values.provisioningMode,
                batchTag: values.batchTag,
                canLogin: values.canLogin,
                password: values.password,
                ownerUserId: values.ownerUserId,
                bindApiKeyIds: values.bindApiKeyIds || [],
            };

            if (values.createMode === 'LIST') {
                const localParts = String(values.localPartsText || '')
                    .split(/[\n,]+/)
                    .map((item) => item.trim())
                    .filter(Boolean);
                payload.localParts = localParts;
            } else {
                payload.prefix = values.prefix;
                payload.count = values.count;
                payload.startFrom = values.startFrom;
                payload.padding = values.padding;
            }

            setSavingBatchCreate(true);
            const result = await requestData<BatchCreateResult>(() => domainMailboxApi.batchCreate(payload), '批量创建域名邮箱失败');
            if (result) {
                message.success(`批量创建成功，共 ${result.createdCount || result.mailboxes?.length || 0} 个邮箱`);
                setBatchCreateModalVisible(false);
                await loadData();
            }
        } catch {
            return;
        } finally {
            setSavingBatchCreate(false);
        }
    };

    const handleDeleteSelected = useCallback(async () => {
        if (selectedMailboxIds.length === 0) {
            message.warning('请先勾选要删除的域名邮箱');
            return;
        }
        setSavingBatchDelete(true);
        try {
            const result = await requestData<BatchDeleteResult>(() => domainMailboxApi.batchDelete({ ids: selectedMailboxIds }), '批量删除域名邮箱失败');
            if (result) {
                message.success(`已删除 ${result.deletedCount || selectedMailboxIds.length} 个域名邮箱`);
                setSelectedMailboxIds([]);
                await loadData();
            }
        } finally {
            setSavingBatchDelete(false);
        }
    }, [loadData, selectedMailboxIds]);

    const handleBatchDeleteSubmit = async () => {
        try {
            const values = await batchDeleteForm.validateFields();
            setSavingBatchDelete(true);
            const result = await requestData<BatchDeleteResult>(() => domainMailboxApi.batchDelete({
                domainId: values.domainId,
                batchTag: values.batchTag,
                provisioningMode: values.provisioningMode,
            }), '按条件批量删除域名邮箱失败');
            if (result) {
                message.success(`已删除 ${result.deletedCount || 0} 个域名邮箱`);
                setBatchDeleteModalVisible(false);
                setSelectedMailboxIds([]);
                await loadData();
            }
        } finally {
            setSavingBatchDelete(false);
        }
    };

    const handleBatchAssignSubmit = async () => {
        if (selectedMailboxIds.length === 0) {
            message.warning('请先勾选要加入门户的域名邮箱');
            return;
        }

        try {
            const values = await batchAssignForm.validateFields();
            setSavingBatchAssign(true);
            const result = await requestData<BatchAssignResult>(
                () => mailboxUserApi.addMailboxes(Number(values.userId), selectedMailboxIds),
                '批量加入门户用户失败'
            );
            if (result) {
                message.success(`已把 ${selectedMailboxIds.length} 个邮箱加入门户用户 ${result.username}，本次新增 ${result.addedCount} 个权限`);
                setBatchAssignModalVisible(false);
                setSelectedMailboxIds([]);
                await loadData();
            }
        } finally {
            setSavingBatchAssign(false);
        }
    };

    const handleSingleDelete = useCallback(async (record: MailboxRecord) => {
        try {
            const result = await requestData(() => domainMailboxApi.delete(record.id), '删除域名邮箱失败');
            if (result) {
                message.success('删除成功');
                await loadData();
            }
        } catch (error) {
            message.error(getErrorMessage(error, '删除失败'));
        }
    }, [loadData]);

    const mailboxColumns: ColumnsType<MailboxRecord> = [
        { title: '邮箱地址', dataIndex: 'address', key: 'address' },
        { title: '域名', key: 'domain', render: (_, record) => record.domain?.name || record.domainId },
        {
            title: '类型',
            dataIndex: 'provisioningMode',
            key: 'provisioningMode',
            render: (value) => <Tag color={value === 'API_POOL' ? 'blue' : 'default'}>{value}</Tag>,
        },
        { title: '批次标签', dataIndex: 'batchTag', key: 'batchTag', render: (value) => value || '-' },
        { title: '负责人', key: 'ownerUser', render: (_, record) => record.ownerUser?.username || '-' },
        { title: '收件数', dataIndex: 'inboundMessageCount', key: 'inboundMessageCount', render: (value) => value || 0 },
        { title: 'API 使用数', dataIndex: 'apiUsageCount', key: 'apiUsageCount', render: (value) => value || 0 },
        { title: '状态', dataIndex: 'status', key: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'success' : 'default'}>{value}</Tag> },
        {
            title: '动作',
            key: 'actions',
            render: (_, record) => (
                <Space wrap>
                    <Button onClick={() => openMailboxModal(record)}>编辑</Button>
                    <Popconfirm title={`确定删除 ${record.address} 吗？`} onConfirm={() => void handleSingleDelete(record)}>
                        <Button danger>删除</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title="域名邮箱"
                subtitle="这里专注域名邮箱的创建、批量维护、负责人绑定和 API 池供给；门户用户 CRUD 已拆到独立的“门户用户”页面统一管理。"
                extra={
                    <Space wrap>
                        <Button onClick={() => navigate('/mailbox-users')}>前往门户用户</Button>
                        <Button onClick={openBatchDeleteModal} icon={<DeleteOutlined />}>按域名/批次删除</Button>
                        <Button onClick={openBatchCreateModal}>批量创建邮箱</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openMailboxModal()}>新增邮箱</Button>
                    </Space>
                }
            />
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card
                    title="域名邮箱供给"
                    extra={
                        <Space wrap>
                            <Select
                                allowClear
                                placeholder="筛选域名"
                                style={{ width: 180 }}
                                value={filterDomainId}
                                onChange={(value) => setFilterDomainId(value)}
                                options={activeDomains.map((item) => ({ value: item.id, label: item.name }))}
                            />
                            <Select
                                allowClear
                                placeholder="筛选状态"
                                style={{ width: 140 }}
                                value={filterStatus}
                                onChange={(value) => setFilterStatus(value)}
                                options={[
                                    { value: 'ACTIVE', label: 'ACTIVE' },
                                    { value: 'DISABLED', label: 'DISABLED' },
                                    { value: 'SUSPENDED', label: 'SUSPENDED' },
                                ]}
                            />
                            <Select
                                allowClear
                                placeholder="筛选类型"
                                style={{ width: 170 }}
                                value={filterProvisioningMode}
                                onChange={(value) => setFilterProvisioningMode(value)}
                                options={provisioningOptions}
                            />
                            <Input
                                placeholder="批次标签"
                                style={{ width: 180 }}
                                value={filterBatchTag}
                                onChange={(event) => setFilterBatchTag(event.target.value)}
                            />
                            <Popconfirm
                                title={`确定删除已勾选的 ${selectedMailboxIds.length} 个邮箱吗？`}
                                onConfirm={() => void handleDeleteSelected()}
                                disabled={selectedMailboxIds.length === 0}
                            >
                                <Button danger disabled={selectedMailboxIds.length === 0} loading={savingBatchDelete}>批量删除已选</Button>
                            </Popconfirm>
                            <Button icon={<UserAddOutlined />} disabled={selectedMailboxIds.length === 0 || users.length === 0} onClick={openBatchAssignModal}>
                                批量加入门户用户
                            </Button>
                        </Space>
                    }
                >
                    <Table
                        rowKey="id"
                        loading={loading}
                        columns={mailboxColumns}
                        dataSource={mailboxes}
                        pagination={false}
                        rowSelection={{
                            selectedRowKeys: selectedMailboxIds,
                            onChange: (keys) => setSelectedMailboxIds(keys.map((item) => Number(item))),
                        }}
                    />
                </Card>
            </Space>

            <Modal
                title={editingMailbox ? '编辑邮箱' : '新增邮箱'}
                open={mailboxModalVisible}
                onCancel={() => setMailboxModalVisible(false)}
                onOk={() => mailboxForm.submit()}
                confirmLoading={savingMailbox}
                destroyOnClose
            >
                <Form form={mailboxForm} layout="vertical" onFinish={handleMailboxSubmit}>
                    <Form.Item name="domainId" label="域名" rules={[{ required: true, message: '请选择域名' }]}>
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} disabled={Boolean(editingMailbox)} />
                    </Form.Item>
                    <Form.Item name="localPart" label="邮箱前缀" rules={[{ required: true, message: '请输入邮箱前缀' }]}>
                        <Input placeholder="inbox" disabled={Boolean(editingMailbox)} />
                    </Form.Item>
                    <Form.Item name="displayName" label="展示名">
                        <Input placeholder="Support Inbox" />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label="邮箱类型">
                        <Select options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="batchTag" label="批次标签">
                        <Input placeholder="manual-support-20260318" />
                    </Form.Item>
                    <Form.Item name="ownerUserId" label="负责人">
                        <Select allowClear options={users.map((item) => ({ value: item.id, label: item.username }))} />
                    </Form.Item>
                    <Form.Item name="password" label="门户密码">
                        <Input.Password placeholder={editingMailbox ? '留空则不修改' : '如需门户登录可直接设置'} />
                    </Form.Item>
                    {editingMailbox ? (
                        <Form.Item name="status" label="状态">
                            <Select allowClear options={[
                                { value: 'ACTIVE', label: 'ACTIVE' },
                                { value: 'DISABLED', label: 'DISABLED' },
                                { value: 'SUSPENDED', label: 'SUSPENDED' },
                            ]} />
                        </Form.Item>
                    ) : null}
                </Form>
            </Modal>

            <Modal
                title="批量创建域名邮箱"
                open={batchCreateModalVisible}
                onCancel={() => setBatchCreateModalVisible(false)}
                onOk={() => void handleBatchCreateSubmit()}
                confirmLoading={savingBatchCreate}
                width={760}
                destroyOnClose
            >
                <Form form={batchCreateForm} layout="vertical">
                    <Form.Item name="domainId" label="域名" rules={[{ required: true, message: '请选择域名' }]}> 
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label="创建类型" rules={[{ required: true, message: '请选择创建类型' }]}> 
                        <Select options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="bindApiKeyIds" label="绑定到 API Key（可多选）">
                        <Select
                            mode="multiple"
                            allowClear
                            placeholder="选择后会自动把域名加入这些 API Key 的 allowed domains"
                            options={apiKeys.map((item) => ({ value: item.id, label: `${item.name} (${item.keyPrefix})` }))}
                        />
                    </Form.Item>
                    <Form.Item name="batchTag" label="批次标签">
                        <Input placeholder="api-pool-520958-20260318" />
                    </Form.Item>
                    <Form.Item name="createMode" label="生成方式" rules={[{ required: true, message: '请选择生成方式' }]}> 
                        <Select options={[{ value: 'PREFIX', label: '按前缀+数量生成' }, { value: 'LIST', label: '按前缀列表导入' }]} />
                    </Form.Item>
                    {batchCreateMode === 'LIST' ? (
                        <Form.Item name="localPartsText" label="邮箱前缀列表" rules={[{ required: true, message: '请输入邮箱前缀列表' }]}> 
                            <Input.TextArea rows={6} placeholder={`user001\nuser002\nuser003`} />
                        </Form.Item>
                    ) : (
                        <Space size="middle" align="start" style={{ display: 'flex' }}>
                            <Form.Item name="prefix" label="前缀" rules={[{ required: true, message: '请输入前缀' }]}> 
                                <Input placeholder="demo" style={{ width: 180 }} />
                            </Form.Item>
                            <Form.Item name="count" label="数量" rules={[{ required: true, message: '请输入数量' }]}> 
                                <InputNumber min={1} max={1000} style={{ width: 120 }} />
                            </Form.Item>
                            <Form.Item name="startFrom" label="起始编号"> 
                                <InputNumber min={0} style={{ width: 120 }} />
                            </Form.Item>
                            <Form.Item name="padding" label="补零位数"> 
                                <InputNumber min={0} max={10} style={{ width: 120 }} />
                            </Form.Item>
                        </Space>
                    )}
                    <Form.Item name="displayName" label="统一展示名">
                        <Input placeholder="API Pool Mailbox" />
                    </Form.Item>
                    <Form.Item name="ownerUserId" label="负责人">
                        <Select allowClear options={users.map((item) => ({ value: item.id, label: item.username }))} />
                    </Form.Item>
                    <Form.Item name="canLogin" label="允许门户登录" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="password" label="统一密码">
                        <Input.Password placeholder="如需登录可统一设置" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="批量加入门户用户"
                open={batchAssignModalVisible}
                onCancel={() => setBatchAssignModalVisible(false)}
                onOk={() => void handleBatchAssignSubmit()}
                confirmLoading={savingBatchAssign}
                destroyOnClose
            >
                <Form form={batchAssignForm} layout="vertical">
                    <Form.Item label="已选域名邮箱">
                        <Input value={`${selectedMailboxIds.length} 个`} disabled />
                    </Form.Item>
                    <Form.Item name="userId" label="门户用户" rules={[{ required: true, message: '请选择门户用户' }]}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="选择要加入的门户用户"
                            options={users.map((item) => ({ value: item.id, label: `${item.username}${item.email ? ` (${item.email})` : ''}` }))}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="按域名/批次批量删除"
                open={batchDeleteModalVisible}
                onCancel={() => setBatchDeleteModalVisible(false)}
                onOk={() => void handleBatchDeleteSubmit()}
                confirmLoading={savingBatchDelete}
                destroyOnClose
            >
                <Form form={batchDeleteForm} layout="vertical">
                    <Form.Item name="domainId" label="域名" rules={[{ required: true, message: '请选择域名' }]}> 
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label="邮箱类型">
                        <Select allowClear options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="batchTag" label="批次标签">
                        <Input placeholder="留空则删除该域名下匹配类型的所有邮箱" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default DomainMailboxesPage;

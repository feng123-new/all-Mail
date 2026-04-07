import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Button,
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
import { PageHeader, SurfaceCard } from '../../components';
import { domainMailboxesContract } from '../../contracts/admin/domainMailboxes';
import {
    fullWidthStyle,
    marginBottom16Style,
    width120Style,
    width140Style,
    width170Style,
    width180Style,
} from '../../styles/common';
import {
    getHostedInternalProfileByProvisioningMode,
    getHostedInternalProfileDefinition,
    getRepresentativeProtocolLabel,
    getRepresentativeProtocolTagColor,
    type HostedInternalCapabilitySummary,
    type HostedInternalProfileKey,
    type RepresentativeProtocol,
} from '../../constants/providers';
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
    providerProfile?: HostedInternalProfileKey;
    representativeProtocol?: RepresentativeProtocol;
    profileSummaryHint?: string;
    capabilitySummary?: HostedInternalCapabilitySummary;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
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

const domainMailboxStyles = {
    fullWidth: fullWidthStyle,
    profileHint: { color: 'rgba(0, 0, 0, 0.45)', fontSize: 12 },
    filterRow: marginBottom16Style,
    batchPrefixRow: { display: 'flex' },
} as const;

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
    const mailboxProvisioningMode = (Form.useWatch('provisioningMode', mailboxForm) as 'MANUAL' | 'API_POOL' | undefined) || editingMailbox?.provisioningMode || 'MANUAL';
    const mailboxDomainId = Form.useWatch('domainId', mailboxForm) as number | undefined;

    const loadData = useCallback(async () => {
        setLoading(true);
        const [domainResult, mailboxResult, userResult, apiKeyResult] = await Promise.all([
            requestData<DomainOption[]>(async () => fetchAllPagedItems<DomainOption>(
                async (page, pageSize) => domainMailboxesContract.getDomains<DomainOption>({ page, pageSize })
            ), '获取域名失败', { silent: true }),
            requestData<MailboxRecord[]>(async () => fetchAllPagedItems<MailboxRecord>(
                async (page, pageSize) => domainMailboxesContract.getMailboxes<MailboxRecord>({
                    page,
                    pageSize,
                    domainId: filterDomainId,
                    status: filterStatus,
                    provisioningMode: filterProvisioningMode,
                    batchTag: filterBatchTag.trim() || undefined,
                })
            ), '获取域名邮箱失败'),
            requestData<UserRecord[]>(async () => fetchAllPagedItems<UserRecord>(
                async (page, pageSize) => domainMailboxesContract.getUsers<UserRecord>({ page, pageSize })
            ), '获取邮箱用户失败', { silent: true }),
            requestData<ApiKeyOption[]>(async () => fetchAllPagedItems<ApiKeyOption>(
                async (page, pageSize) => domainMailboxesContract.getApiKeys<ApiKeyOption>({ page, pageSize, status: 'ACTIVE' })
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
    const mailboxProfileDefinition = useMemo(
        () => getHostedInternalProfileByProvisioningMode(mailboxProvisioningMode),
        [mailboxProvisioningMode]
    );
    const selectedMailboxDomain = useMemo(
        () => activeDomains.find((item) => item.id === mailboxDomainId),
        [activeDomains, mailboxDomainId]
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
            ? domainMailboxesContract.updateMailbox(editingMailbox.id, values)
            : domainMailboxesContract.createMailbox(values);
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
            const result = await requestData<BatchCreateResult>(() => domainMailboxesContract.batchCreateMailboxes(payload), '批量创建域名邮箱失败');
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
            const result = await requestData<BatchDeleteResult>(() => domainMailboxesContract.batchDeleteMailboxes({ ids: selectedMailboxIds }), '批量删除域名邮箱失败');
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
            const result = await requestData<BatchDeleteResult>(() => domainMailboxesContract.batchDeleteMailboxes({
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
                () => domainMailboxesContract.addMailboxesToUser(Number(values.userId), selectedMailboxIds),
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
            const result = await requestData(() => domainMailboxesContract.deleteMailbox(record.id), '删除域名邮箱失败');
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
            render: (value, record) => {
                const profileDefinition = record.providerProfile
                    ? getHostedInternalProfileDefinition(record.providerProfile)
                    : getHostedInternalProfileByProvisioningMode(value);
                const representativeProtocol = record.representativeProtocol || profileDefinition.representativeProtocol;
                return (
                    <Space orientation="vertical" size={4}>
                        <Space wrap>
                            <Tag color={getRepresentativeProtocolTagColor(representativeProtocol)}>
                                {getRepresentativeProtocolLabel(representativeProtocol)}
                            </Tag>
                            <Tag color={value === 'API_POOL' ? 'blue' : 'default'}>{value}</Tag>
                        </Space>
                        <div style={domainMailboxStyles.profileHint}>
                            {record.profileSummaryHint || profileDefinition.summaryHint}
                        </div>
                    </Space>
                );
            },
        },
        {
            title: '能力',
            key: 'capabilities',
            render: (_, record) => (
                <Space wrap>
                    <Tag color={record.capabilitySummary?.receiveMail ? 'success' : 'default'}>
                        {record.capabilitySummary?.receiveMail ? '可收件' : '收件关闭'}
                    </Tag>
                    <Tag color={record.capabilitySummary?.sendMail ? 'processing' : 'default'}>
                        {record.capabilitySummary?.sendMail ? '可发件' : '仅收件'}
                    </Tag>
                    <Tag color={record.capabilitySummary?.apiAccess ? 'purple' : 'default'}>
                        {record.capabilitySummary?.apiAccess ? 'API 池可分配' : '人工维护'}
                    </Tag>
                </Space>
            ),
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
                subtitle="这里专注 Hosted Internal 域名邮箱的创建、批量维护、负责人绑定和 API 池供给；门户用户 CRUD 已拆到独立的“门户用户”页面统一管理。"
                extra={
                    <Space wrap>
                        <Button onClick={openBatchCreateModal}>批量创建邮箱</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openMailboxModal()}>新增邮箱</Button>
                    </Space>
                }
            />
            <Space orientation="vertical" size="large" style={domainMailboxStyles.fullWidth}>
                <Alert
                    type="info"
                    showIcon
                    title="域名邮箱现在统一按 Hosted Internal 协议合同展示"
                    description="MANUAL 与 API_POOL 只是 Hosted Internal 下的两个 profile：MANUAL 更偏人工维护和门户协同，API_POOL 更偏批量分配与程序化收件。"
                />
                <SurfaceCard
                    title="域名邮箱供给"
                    extra={
                        <Space wrap>
                            <Button onClick={() => navigate('/mailbox-users')}>门户用户</Button>
                            <Button onClick={openBatchDeleteModal} icon={<DeleteOutlined />}>按域名/批次删除</Button>
                            <Select
                                allowClear
                                placeholder="筛选域名"
                                style={width180Style}
                                value={filterDomainId}
                                onChange={(value) => setFilterDomainId(value)}
                                options={activeDomains.map((item) => ({ value: item.id, label: item.name }))}
                            />
                            <Select
                                allowClear
                                placeholder="筛选状态"
                                style={width140Style}
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
                                style={width170Style}
                                value={filterProvisioningMode}
                                onChange={(value) => setFilterProvisioningMode(value)}
                                options={provisioningOptions}
                            />
                            <Input
                                placeholder="批次标签"
                                style={width180Style}
                                value={filterBatchTag}
                                onChange={(event) => setFilterBatchTag(event.target.value)}
                            />
                        </Space>
                    }
                >
                    {selectedMailboxIds.length > 0 ? (
                        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ color: 'rgba(15, 23, 42, 0.62)', fontSize: 13 }}>
                                已选择 {selectedMailboxIds.length} 个邮箱，可继续做负责人分配或批量删除。
                            </div>
                            <Space wrap>
                                <Button icon={<UserAddOutlined />} disabled={users.length === 0} onClick={openBatchAssignModal}>
                                    批量加入门户用户
                                </Button>
                                <Popconfirm
                                    title={`确定删除已勾选的 ${selectedMailboxIds.length} 个邮箱吗？`}
                                    onConfirm={() => void handleDeleteSelected()}
                                >
                                    <Button danger loading={savingBatchDelete}>批量删除已选</Button>
                                </Popconfirm>
                            </Space>
                        </div>
                    ) : null}
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
                </SurfaceCard>
            </Space>

            <Modal
                title={editingMailbox ? '编辑邮箱' : '新增邮箱'}
                open={mailboxModalVisible}
                onCancel={() => setMailboxModalVisible(false)}
                onOk={() => mailboxForm.submit()}
                confirmLoading={savingMailbox}
                destroyOnHidden
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
                    <Alert
                        type="info"
                        showIcon
                        style={marginBottom16Style}
                        title={`当前 profile：${mailboxProfileDefinition.label}`}
                        description={`${mailboxProfileDefinition.classificationNote} ${selectedMailboxDomain?.canSend ? '当前域名允许发件，因此该邮箱会同时显示站内发件能力。' : '当前域名未开启发件，因此该邮箱会按“仅收件”的 Hosted Internal 邮箱处理。'}`}
                    />
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
                destroyOnHidden
            >
                <Form form={batchCreateForm} layout="vertical">
                    <Form.Item name="domainId" label="域名" rules={[{ required: true, message: '请选择域名' }]}> 
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label="创建类型" rules={[{ required: true, message: '请选择创建类型' }]}> 
                        <Select options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="bindApiKeyIds" label="同步授权域名到 API Key（可多选）">
                        <Select
                            mode="multiple"
                            allowClear
                            placeholder="选择后会把当前域名加入这些 API Key 的 allowed domains，不会创建单邮箱级别的独占绑定"
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
                        <Space size="middle" align="start" style={domainMailboxStyles.batchPrefixRow}>
                            <Form.Item name="prefix" label="前缀" rules={[{ required: true, message: '请输入前缀' }]}> 
                                <Input placeholder="demo" style={width180Style} />
                            </Form.Item>
                            <Form.Item name="count" label="数量" rules={[{ required: true, message: '请输入数量' }]}> 
                                <InputNumber min={1} max={1000} style={width120Style} />
                            </Form.Item>
                            <Form.Item name="startFrom" label="起始编号"> 
                                <InputNumber min={0} style={width120Style} />
                            </Form.Item>
                            <Form.Item name="padding" label="补零位数"> 
                                <InputNumber min={0} max={10} style={width120Style} />
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
                destroyOnHidden
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
                destroyOnHidden
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

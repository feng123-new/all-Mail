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
import { adminI18n } from '../../i18n/catalog/admin';
import {
    getHostedInternalProfileClassificationNoteMessage,
    getHostedInternalProfileLabelMessage,
    getHostedInternalProfileSummaryHintMessage,
    getRepresentativeProtocolLabelMessage,
} from '../../i18n/catalog/providers';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
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

const domainMailboxesI18n = {
    enabled: defineMessage('domainMailboxes.enabled', '启用', 'Enabled'),
    suspended: defineMessage('domainMailboxes.suspended', '已暂停', 'Suspended'),
    fetchDomainsFailed: defineMessage('domainMailboxes.fetchDomainsFailed', '获取域名失败', 'Failed to load domains'),
    fetchMailboxesFailed: defineMessage('domainMailboxes.fetchMailboxesFailed', '获取域名邮箱失败', 'Failed to load domain mailboxes'),
    fetchUsersFailed: defineMessage('domainMailboxes.fetchUsersFailed', '获取邮箱用户失败', 'Failed to load portal users'),
    fetchApiKeysFailed: defineMessage('domainMailboxes.fetchApiKeysFailed', '获取访问密钥失败', 'Failed to load API keys'),
    createMailboxFailed: defineMessage('domainMailboxes.createMailboxFailed', '创建邮箱失败', 'Failed to create the mailbox'),
    updateMailboxFailed: defineMessage('domainMailboxes.updateMailboxFailed', '更新邮箱失败', 'Failed to update the mailbox'),
    batchCreateFailed: defineMessage('domainMailboxes.batchCreateFailed', '批量创建域名邮箱失败', 'Failed to batch create domain mailboxes'),
    batchCreateSuccess: defineMessage('domainMailboxes.batchCreateSuccess', '批量创建成功，共 {count} 个邮箱', 'Batch created {count} mailboxes'),
    selectMailboxesForDelete: defineMessage('domainMailboxes.selectMailboxesForDelete', '请先勾选要删除的域名邮箱', 'Select the domain mailboxes to delete first'),
    batchDeleteFailed: defineMessage('domainMailboxes.batchDeleteFailed', '批量删除域名邮箱失败', 'Failed to batch delete domain mailboxes'),
    deletedCount: defineMessage('domainMailboxes.deletedCount', '已删除 {count} 个域名邮箱', 'Deleted {count} domain mailboxes'),
    deleteByFilterFailed: defineMessage('domainMailboxes.deleteByFilterFailed', '按条件批量删除域名邮箱失败', 'Failed to batch delete domain mailboxes by filters'),
    selectMailboxesForAssign: defineMessage('domainMailboxes.selectMailboxesForAssign', '请先勾选要加入门户的域名邮箱', 'Select the domain mailboxes to add to a portal user first'),
    batchAssignFailed: defineMessage('domainMailboxes.batchAssignFailed', '批量加入门户用户失败', 'Failed to batch add mailboxes to the portal user'),
    batchAssignSuccess: defineMessage('domainMailboxes.batchAssignSuccess', '已把 {selectedCount} 个邮箱加入门户用户 {username}，本次新增 {addedCount} 个权限', 'Added {selectedCount} mailboxes to portal user {username}; {addedCount} permissions were newly granted'),
    deleteMailboxFailed: defineMessage('domainMailboxes.deleteMailboxFailed', '删除域名邮箱失败', 'Failed to delete the domain mailbox'),
    deleteSuccess: defineMessage('domainMailboxes.deleteSuccess', '删除成功', 'Deleted successfully'),
    deleteFailed: defineMessage('domainMailboxes.deleteFailed', '删除失败', 'Delete failed'),
    mailboxAddress: defineMessage('domainMailboxes.mailboxAddress', '邮箱地址', 'Mailbox address'),
    mailboxType: defineMessage('domainMailboxes.mailboxType', '类型', 'Type'),
    batchDeleteConfirm: defineMessage('domainMailboxes.batchDeleteConfirm', '确定删除已勾选的 {count} 个邮箱吗？', 'Delete the selected {count} mailboxes?'),
    selectDomainRequired: defineMessage('domainMailboxes.selectDomainRequired', '请选择域名', 'Select a domain'),
    localPart: defineMessage('domainMailboxes.localPart', '邮箱前缀', 'Mailbox prefix'),
    localPartRequired: defineMessage('domainMailboxes.localPartRequired', '请输入邮箱前缀', 'Enter the mailbox prefix'),
    displayName: defineMessage('domainMailboxes.displayName', '展示名', 'Display name'),
    mailboxKind: defineMessage('domainMailboxes.mailboxKind', '邮箱类型', 'Mailbox type'),
    currentProfile: defineMessage('domainMailboxes.currentProfile', '当前 profile：{profile}', 'Current profile: {profile}'),
    domainCanSendNote: defineMessage('domainMailboxes.domainCanSendNote', '当前域名允许发件，因此该邮箱会同时显示站内发件能力。', 'This domain allows sending, so the mailbox will also expose hosted sending capability.'),
    domainInboxOnlyNote: defineMessage('domainMailboxes.domainInboxOnlyNote', '当前域名未开启发件，因此该邮箱会按“仅收件”的站内托管邮箱处理。', 'This domain does not allow sending, so the mailbox is treated as a hosted inbox-only mailbox.'),
    portalPassword: defineMessage('domainMailboxes.portalPassword', '门户密码', 'Portal password'),
    localPartPlaceholder: defineMessage('domainMailboxes.localPartPlaceholder', 'inbox', 'inbox'),
    displayNamePlaceholder: defineMessage('domainMailboxes.displayNamePlaceholder', 'Support Inbox', 'Support Inbox'),
    batchTagPlaceholder: defineMessage('domainMailboxes.batchTagPlaceholder', 'manual-support-20260318', 'manual-support-20260318'),
    keepPasswordBlankPlaceholder: defineMessage('domainMailboxes.keepPasswordBlankPlaceholder', '留空则不修改', 'Leave blank to keep the current password'),
    setPortalPasswordPlaceholder: defineMessage('domainMailboxes.setPortalPasswordPlaceholder', '如需门户登录可直接设置', 'Set directly if portal login is needed'),
    batchCreateTitle: defineMessage('domainMailboxes.batchCreateTitle', '批量创建域名邮箱', 'Batch create domain mailboxes'),
    createType: defineMessage('domainMailboxes.createType', '创建类型', 'Creation type'),
    selectCreateTypeRequired: defineMessage('domainMailboxes.selectCreateTypeRequired', '请选择创建类型', 'Select a creation type'),
    syncDomainToApiKey: defineMessage('domainMailboxes.syncDomainToApiKey', '同步授权域名到 API Key（可多选）', 'Sync the domain to API keys (multiple)'),
    syncDomainToApiKeyPlaceholder: defineMessage('domainMailboxes.syncDomainToApiKeyPlaceholder', '选择后会把当前域名加入这些 API Key 的 allowed domains，不会创建单邮箱级别的独占绑定', 'Selecting API keys adds this domain to their allowed domains without creating mailbox-exclusive bindings'),
    batchTagExamplePlaceholder: defineMessage('domainMailboxes.batchTagExamplePlaceholder', 'api-pool-520958-20260318', 'api-pool-520958-20260318'),
    createMode: defineMessage('domainMailboxes.createMode', '生成方式', 'Generation mode'),
    selectCreateModeRequired: defineMessage('domainMailboxes.selectCreateModeRequired', '请选择生成方式', 'Select a generation mode'),
    generateByPrefix: defineMessage('domainMailboxes.generateByPrefix', '按前缀+数量生成', 'Generate by prefix and count'),
    importByPrefixList: defineMessage('domainMailboxes.importByPrefixList', '按前缀列表导入', 'Import from a prefix list'),
    localPartList: defineMessage('domainMailboxes.localPartList', '邮箱前缀列表', 'Mailbox prefix list'),
    localPartListRequired: defineMessage('domainMailboxes.localPartListRequired', '请输入邮箱前缀列表', 'Enter the mailbox prefix list'),
    localPartListPlaceholder: defineMessage('domainMailboxes.localPartListPlaceholder', 'user001\nuser002\nuser003', 'user001\nuser002\nuser003'),
    prefix: defineMessage('domainMailboxes.prefix', '前缀', 'Prefix'),
    prefixRequired: defineMessage('domainMailboxes.prefixRequired', '请输入前缀', 'Enter the prefix'),
    prefixPlaceholder: defineMessage('domainMailboxes.prefixPlaceholder', 'demo', 'demo'),
    count: defineMessage('domainMailboxes.count', '数量', 'Count'),
    countRequired: defineMessage('domainMailboxes.countRequired', '请输入数量', 'Enter the count'),
    startFrom: defineMessage('domainMailboxes.startFrom', '起始编号', 'Start from'),
    padding: defineMessage('domainMailboxes.padding', '补零位数', 'Padding digits'),
    unifiedDisplayName: defineMessage('domainMailboxes.unifiedDisplayName', '统一展示名', 'Unified display name'),
    unifiedDisplayNamePlaceholder: defineMessage('domainMailboxes.unifiedDisplayNamePlaceholder', 'API Pool Mailbox', 'API Pool Mailbox'),
    allowPortalLogin: defineMessage('domainMailboxes.allowPortalLogin', '允许门户登录', 'Allow portal login'),
    unifiedPassword: defineMessage('domainMailboxes.unifiedPassword', '统一密码', 'Unified password'),
    unifiedPasswordPlaceholder: defineMessage('domainMailboxes.unifiedPasswordPlaceholder', '如需登录可统一设置', 'Set a shared password if login is needed'),
    batchAssignTitle: defineMessage('domainMailboxes.batchAssignTitle', '批量加入门户用户', 'Batch add to portal user'),
    selectedDomainMailboxes: defineMessage('domainMailboxes.selectedDomainMailboxes', '已选域名邮箱', 'Selected domain mailboxes'),
    selectedMailboxCount: defineMessage('domainMailboxes.selectedMailboxCount', '{count} 个', '{count} selected'),
    portalUser: defineMessage('domainMailboxes.portalUser', '门户用户', 'Portal user'),
    selectPortalUserRequired: defineMessage('domainMailboxes.selectPortalUserRequired', '请选择门户用户', 'Select a portal user'),
    selectPortalUserPlaceholder: defineMessage('domainMailboxes.selectPortalUserPlaceholder', '选择要加入的门户用户', 'Select the portal user to receive access'),
    batchDeleteByFilterTitle: defineMessage('domainMailboxes.batchDeleteByFilterTitle', '按域名/批次批量删除', 'Batch delete by domain or batch'),
    deleteBatchTagPlaceholder: defineMessage('domainMailboxes.deleteBatchTagPlaceholder', '留空则删除该域名下匹配类型的所有邮箱', 'Leave blank to delete all matching mailboxes under the domain'),
} as const;

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
    const { t } = useI18n();
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
    const provisioningOptions = useMemo(
        () => [
            { value: 'MANUAL', label: t(adminI18n.domainMailboxes.manualMode) },
            { value: 'API_POOL', label: t(adminI18n.domainMailboxes.apiPoolMode) },
        ],
        [t]
    );
    const mailboxStatusOptions = useMemo(
        () => [
            { value: 'ACTIVE', label: t(domainMailboxesI18n.enabled) },
            { value: 'DISABLED', label: t(adminI18n.common.disabled) },
            { value: 'SUSPENDED', label: t(domainMailboxesI18n.suspended) },
        ],
        [t]
    );

    const batchCreateMode = (Form.useWatch('createMode', batchCreateForm) as BatchCreateMode | undefined) || 'PREFIX';
    const mailboxProvisioningMode = (Form.useWatch('provisioningMode', mailboxForm) as 'MANUAL' | 'API_POOL' | undefined) || editingMailbox?.provisioningMode || 'MANUAL';
    const mailboxDomainId = Form.useWatch('domainId', mailboxForm) as number | undefined;

    const loadData = useCallback(async () => {
        setLoading(true);
        const [domainResult, mailboxResult, userResult, apiKeyResult] = await Promise.all([
            requestData<DomainOption[]>(async () => fetchAllPagedItems<DomainOption>(
                async (page, pageSize) => domainMailboxesContract.getDomains<DomainOption>({ page, pageSize })
            ), t(domainMailboxesI18n.fetchDomainsFailed), { silent: true }),
            requestData<MailboxRecord[]>(async () => fetchAllPagedItems<MailboxRecord>(
                async (page, pageSize) => domainMailboxesContract.getMailboxes<MailboxRecord>({
                    page,
                    pageSize,
                    domainId: filterDomainId,
                    status: filterStatus,
                    provisioningMode: filterProvisioningMode,
                    batchTag: filterBatchTag.trim() || undefined,
                })
            ), t(domainMailboxesI18n.fetchMailboxesFailed)),
            requestData<UserRecord[]>(async () => fetchAllPagedItems<UserRecord>(
                async (page, pageSize) => domainMailboxesContract.getUsers<UserRecord>({ page, pageSize })
            ), t(domainMailboxesI18n.fetchUsersFailed), { silent: true }),
            requestData<ApiKeyOption[]>(async () => fetchAllPagedItems<ApiKeyOption>(
                async (page, pageSize) => domainMailboxesContract.getApiKeys<ApiKeyOption>({ page, pageSize, status: 'ACTIVE' })
            ), t(domainMailboxesI18n.fetchApiKeysFailed), { silent: true }),
        ]);

        setDomains((domainResult || []).filter((item) => item.status !== 'DISABLED'));
        setMailboxes(mailboxResult || []);
        setUsers(userResult || []);
        setApiKeys(apiKeyResult || []);
        setLoading(false);
    }, [filterBatchTag, filterDomainId, filterProvisioningMode, filterStatus, t]);

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
        const result = await requestData(
            () => action,
            editingMailbox
                ? t(domainMailboxesI18n.updateMailboxFailed)
                : t(domainMailboxesI18n.createMailboxFailed)
        );
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
            const result = await requestData<BatchCreateResult>(
                () => domainMailboxesContract.batchCreateMailboxes(payload),
                t(domainMailboxesI18n.batchCreateFailed)
            );
            if (result) {
                message.success(
                    t(domainMailboxesI18n.batchCreateSuccess, {
                        count: result.createdCount || result.mailboxes?.length || 0,
                    })
                );
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
            message.warning(t(domainMailboxesI18n.selectMailboxesForDelete));
            return;
        }
        setSavingBatchDelete(true);
        try {
            const result = await requestData<BatchDeleteResult>(
                () => domainMailboxesContract.batchDeleteMailboxes({ ids: selectedMailboxIds }),
                t(domainMailboxesI18n.batchDeleteFailed)
            );
            if (result) {
                message.success(
                    t(domainMailboxesI18n.deletedCount, {
                        count: result.deletedCount || selectedMailboxIds.length,
                    })
                );
                setSelectedMailboxIds([]);
                await loadData();
            }
        } finally {
            setSavingBatchDelete(false);
        }
    }, [loadData, selectedMailboxIds, t]);

    const handleBatchDeleteSubmit = async () => {
        try {
            const values = await batchDeleteForm.validateFields();
            setSavingBatchDelete(true);
            const result = await requestData<BatchDeleteResult>(() => domainMailboxesContract.batchDeleteMailboxes({
                domainId: values.domainId,
                batchTag: values.batchTag,
                provisioningMode: values.provisioningMode,
            }), t(domainMailboxesI18n.deleteByFilterFailed));
            if (result) {
                message.success(t(domainMailboxesI18n.deletedCount, { count: result.deletedCount || 0 }));
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
            message.warning(t(domainMailboxesI18n.selectMailboxesForAssign));
            return;
        }

        try {
            const values = await batchAssignForm.validateFields();
            setSavingBatchAssign(true);
            const result = await requestData<BatchAssignResult>(
                () => domainMailboxesContract.addMailboxesToUser(Number(values.userId), selectedMailboxIds),
                t(domainMailboxesI18n.batchAssignFailed)
            );
            if (result) {
                message.success(
                    t(domainMailboxesI18n.batchAssignSuccess, {
                        selectedCount: selectedMailboxIds.length,
                        username: result.username,
                        addedCount: result.addedCount,
                    })
                );
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
            const result = await requestData(
                () => domainMailboxesContract.deleteMailbox(record.id),
                t(domainMailboxesI18n.deleteMailboxFailed)
            );
            if (result) {
                message.success(t(domainMailboxesI18n.deleteSuccess));
                await loadData();
            }
        } catch (error) {
            message.error(getErrorMessage(error, t(domainMailboxesI18n.deleteFailed)));
        }
    }, [loadData, t]);

    const mailboxColumns: ColumnsType<MailboxRecord> = [
        { title: t(domainMailboxesI18n.mailboxAddress), dataIndex: 'address', key: 'address' },
        { title: t(adminI18n.sendingConfigs.domain), key: 'domain', render: (_, record) => record.domain?.name || record.domainId },
        {
            title: t(domainMailboxesI18n.mailboxType),
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
                                {t(getRepresentativeProtocolLabelMessage(representativeProtocol))}
                            </Tag>
                            <Tag color={value === 'API_POOL' ? 'blue' : 'default'}>{value === 'API_POOL' ? t(adminI18n.domainMailboxes.apiPoolMode) : t(adminI18n.domainMailboxes.manualMode)}</Tag>
                        </Space>
                        <div style={domainMailboxStyles.profileHint}>
                            {t(getHostedInternalProfileSummaryHintMessage(profileDefinition.key))}
                        </div>
                    </Space>
                );
            },
        },
        {
            title: t(adminI18n.domainMailboxes.capability),
            key: 'capabilities',
            render: (_, record) => (
                <Space wrap>
                    <Tag color={record.capabilitySummary?.receiveMail ? 'success' : 'default'}>
                        {record.capabilitySummary?.receiveMail ? t(adminI18n.domainMailboxes.receiveEnabled) : t(adminI18n.domainMailboxes.receiveDisabled)}
                    </Tag>
                    <Tag color={record.capabilitySummary?.sendMail ? 'processing' : 'default'}>
                        {record.capabilitySummary?.sendMail ? t(adminI18n.domainMailboxes.sendEnabled) : t(adminI18n.domainMailboxes.inboxOnly)}
                    </Tag>
                    <Tag color={record.capabilitySummary?.apiAccess ? 'purple' : 'default'}>
                        {record.capabilitySummary?.apiAccess ? t(adminI18n.domainMailboxes.apiPoolAssignable) : t(adminI18n.domainMailboxes.manualManaged)}
                    </Tag>
                </Space>
            ),
        },
        { title: t(adminI18n.domainMailboxes.batchTag), dataIndex: 'batchTag', key: 'batchTag', render: (value) => value || '-' },
        { title: t(adminI18n.domainMailboxes.owner), key: 'ownerUser', render: (_, record) => record.ownerUser?.username || '-' },
        { title: t(adminI18n.domainMailboxes.inboundCount), dataIndex: 'inboundMessageCount', key: 'inboundMessageCount', render: (value) => value || 0 },
        { title: t(adminI18n.domainMailboxes.apiUsageCount), dataIndex: 'apiUsageCount', key: 'apiUsageCount', render: (value) => value || 0 },
        { title: t(adminI18n.common.status), dataIndex: 'status', key: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'success' : 'default'}>{value === 'ACTIVE' ? t(domainMailboxesI18n.enabled) : value === 'SUSPENDED' ? t(domainMailboxesI18n.suspended) : t(adminI18n.common.disabled)}</Tag> },
        {
            title: t(adminI18n.common.actions),
            key: 'actions',
            render: (_, record) => (
                <Space wrap>
                    <Button onClick={() => openMailboxModal(record)}>{t(adminI18n.common.edit)}</Button>
                    <Popconfirm title={t(adminI18n.domainMailboxes.deleteMailboxConfirm, { address: record.address })} onConfirm={() => void handleSingleDelete(record)}>
                        <Button danger>{t(adminI18n.common.remove)}</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t(adminI18n.domainMailboxes.title)}
                subtitle={t(adminI18n.domainMailboxes.subtitle)}
                extra={
                    <Space wrap>
                        <Button onClick={openBatchCreateModal}>{t(adminI18n.domainMailboxes.batchCreate)}</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openMailboxModal()}>{t(adminI18n.domainMailboxes.addMailbox)}</Button>
                    </Space>
                }
            />
            <Space orientation="vertical" size="large" style={domainMailboxStyles.fullWidth}>
                <Alert
                    type="info"
                    showIcon
                    title={t(adminI18n.domainMailboxes.hostedAlertTitle)}
                    description={t(adminI18n.domainMailboxes.hostedAlertBody)}
                />
                <SurfaceCard
                    title={t(adminI18n.domainMailboxes.supplyTitle)}
                    extra={
                        <Space wrap>
                            <Button onClick={() => navigate('/mailbox-users')}>{t(adminI18n.domainMailboxes.portalUsers)}</Button>
                            <Button onClick={openBatchDeleteModal} icon={<DeleteOutlined />}>{t(adminI18n.domainMailboxes.deleteByBatch)}</Button>
                            <Select
                                allowClear
                                placeholder={t(adminI18n.domainMailboxes.filterDomain)}
                                style={width180Style}
                                value={filterDomainId}
                                onChange={(value) => setFilterDomainId(value)}
                                options={activeDomains.map((item) => ({ value: item.id, label: item.name }))}
                            />
                            <Select
                                allowClear
                                placeholder={t(adminI18n.domainMailboxes.filterStatus)}
                                style={width140Style}
                                value={filterStatus}
                                onChange={(value) => setFilterStatus(value)}
                                options={mailboxStatusOptions}
                            />
                            <Select
                                allowClear
                                placeholder={t(adminI18n.domainMailboxes.filterType)}
                                style={width170Style}
                                value={filterProvisioningMode}
                                onChange={(value) => setFilterProvisioningMode(value)}
                                options={provisioningOptions}
                            />
                            <Input
                                placeholder={t(adminI18n.domainMailboxes.filterBatchTag)}
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
                                {t(adminI18n.domainMailboxes.selectedCount, { count: selectedMailboxIds.length })}
                            </div>
                            <Space wrap>
                                <Button icon={<UserAddOutlined />} disabled={users.length === 0} onClick={openBatchAssignModal}>
                                    {t(adminI18n.domainMailboxes.batchJoinUser)}
                                </Button>
                                <Popconfirm
                                    title={t(domainMailboxesI18n.batchDeleteConfirm, { count: selectedMailboxIds.length })}
                                    onConfirm={() => void handleDeleteSelected()}
                                >
                                    <Button danger loading={savingBatchDelete}>{t(adminI18n.domainMailboxes.batchDeleteSelected)}</Button>
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
                title={editingMailbox ? t(adminI18n.domainMailboxes.editMailbox) : t(adminI18n.domainMailboxes.createMailbox)}
                open={mailboxModalVisible}
                onCancel={() => setMailboxModalVisible(false)}
                onOk={() => mailboxForm.submit()}
                confirmLoading={savingMailbox}
                destroyOnHidden
            >
                    <Form form={mailboxForm} layout="vertical" onFinish={handleMailboxSubmit}>
                    <Form.Item name="domainId" label={t(adminI18n.sendingConfigs.domain)} rules={[{ required: true, message: t(domainMailboxesI18n.selectDomainRequired) }]}>
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} disabled={Boolean(editingMailbox)} />
                    </Form.Item>
                    <Form.Item name="localPart" label={t(domainMailboxesI18n.localPart)} rules={[{ required: true, message: t(domainMailboxesI18n.localPartRequired) }]}>
                        <Input placeholder={t(domainMailboxesI18n.localPartPlaceholder)} disabled={Boolean(editingMailbox)} />
                    </Form.Item>
                    <Form.Item name="displayName" label={t(domainMailboxesI18n.displayName)}>
                        <Input placeholder={t(domainMailboxesI18n.displayNamePlaceholder)} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label={t(domainMailboxesI18n.mailboxKind)}>
                        <Select options={provisioningOptions} />
                    </Form.Item>
                    <Alert
                        type="info"
                        showIcon
                        style={marginBottom16Style}
                        title={t(domainMailboxesI18n.currentProfile, { profile: t(getHostedInternalProfileLabelMessage(mailboxProfileDefinition.key)) })}
                        description={`${t(getHostedInternalProfileClassificationNoteMessage(mailboxProfileDefinition.key))} ${selectedMailboxDomain?.canSend ? t(domainMailboxesI18n.domainCanSendNote) : t(domainMailboxesI18n.domainInboxOnlyNote)}`}
                    />
                    <Form.Item name="batchTag" label={t(adminI18n.domainMailboxes.batchTag)}>
                        <Input placeholder={t(domainMailboxesI18n.batchTagPlaceholder)} />
                    </Form.Item>
                    <Form.Item name="ownerUserId" label={t(adminI18n.domainMailboxes.owner)}>
                        <Select allowClear options={users.map((item) => ({ value: item.id, label: item.username }))} />
                    </Form.Item>
                    <Form.Item name="password" label={t(domainMailboxesI18n.portalPassword)}>
                        <Input.Password placeholder={editingMailbox ? t(domainMailboxesI18n.keepPasswordBlankPlaceholder) : t(domainMailboxesI18n.setPortalPasswordPlaceholder)} />
                    </Form.Item>
                    {editingMailbox ? (
                        <Form.Item name="status" label={t(adminI18n.common.status)}>
                            <Select allowClear options={mailboxStatusOptions} />
                        </Form.Item>
                    ) : null}
                </Form>
            </Modal>

            <Modal
                title={t(domainMailboxesI18n.batchCreateTitle)}
                open={batchCreateModalVisible}
                onCancel={() => setBatchCreateModalVisible(false)}
                onOk={() => void handleBatchCreateSubmit()}
                confirmLoading={savingBatchCreate}
                width={760}
                destroyOnHidden
            >
                <Form form={batchCreateForm} layout="vertical">
                    <Form.Item name="domainId" label={t(adminI18n.sendingConfigs.domain)} rules={[{ required: true, message: t(domainMailboxesI18n.selectDomainRequired) }]}> 
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label={t(domainMailboxesI18n.createType)} rules={[{ required: true, message: t(domainMailboxesI18n.selectCreateTypeRequired) }]}> 
                        <Select options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="bindApiKeyIds" label={t(domainMailboxesI18n.syncDomainToApiKey)}>
                        <Select
                            mode="multiple"
                            allowClear
                            placeholder={t(domainMailboxesI18n.syncDomainToApiKeyPlaceholder)}
                            options={apiKeys.map((item) => ({ value: item.id, label: `${item.name} (${item.keyPrefix})` }))}
                        />
                    </Form.Item>
                    <Form.Item name="batchTag" label={t(adminI18n.domainMailboxes.batchTag)}>
                        <Input placeholder={t(domainMailboxesI18n.batchTagExamplePlaceholder)} />
                    </Form.Item>
                    <Form.Item name="createMode" label={t(domainMailboxesI18n.createMode)} rules={[{ required: true, message: t(domainMailboxesI18n.selectCreateModeRequired) }]}> 
                        <Select options={[{ value: 'PREFIX', label: t(domainMailboxesI18n.generateByPrefix) }, { value: 'LIST', label: t(domainMailboxesI18n.importByPrefixList) }]} />
                    </Form.Item>
                    {batchCreateMode === 'LIST' ? (
                        <Form.Item name="localPartsText" label={t(domainMailboxesI18n.localPartList)} rules={[{ required: true, message: t(domainMailboxesI18n.localPartListRequired) }]}> 
                            <Input.TextArea rows={6} placeholder={t(domainMailboxesI18n.localPartListPlaceholder)} />
                        </Form.Item>
                    ) : (
                        <Space size="middle" align="start" style={domainMailboxStyles.batchPrefixRow}>
                            <Form.Item name="prefix" label={t(domainMailboxesI18n.prefix)} rules={[{ required: true, message: t(domainMailboxesI18n.prefixRequired) }]}> 
                                <Input placeholder={t(domainMailboxesI18n.prefixPlaceholder)} style={width180Style} />
                            </Form.Item>
                            <Form.Item name="count" label={t(domainMailboxesI18n.count)} rules={[{ required: true, message: t(domainMailboxesI18n.countRequired) }]}> 
                                <InputNumber min={1} max={1000} style={width120Style} />
                            </Form.Item>
                            <Form.Item name="startFrom" label={t(domainMailboxesI18n.startFrom)}> 
                                <InputNumber min={0} style={width120Style} />
                            </Form.Item>
                            <Form.Item name="padding" label={t(domainMailboxesI18n.padding)}> 
                                <InputNumber min={0} max={10} style={width120Style} />
                            </Form.Item>
                        </Space>
                    )}
                    <Form.Item name="displayName" label={t(domainMailboxesI18n.unifiedDisplayName)}>
                        <Input placeholder={t(domainMailboxesI18n.unifiedDisplayNamePlaceholder)} />
                    </Form.Item>
                    <Form.Item name="ownerUserId" label={t(adminI18n.domainMailboxes.owner)}>
                        <Select allowClear options={users.map((item) => ({ value: item.id, label: item.username }))} />
                    </Form.Item>
                    <Form.Item name="canLogin" label={t(domainMailboxesI18n.allowPortalLogin)} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="password" label={t(domainMailboxesI18n.unifiedPassword)}>
                        <Input.Password placeholder={t(domainMailboxesI18n.unifiedPasswordPlaceholder)} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={t(domainMailboxesI18n.batchAssignTitle)}
                open={batchAssignModalVisible}
                onCancel={() => setBatchAssignModalVisible(false)}
                onOk={() => void handleBatchAssignSubmit()}
                confirmLoading={savingBatchAssign}
                destroyOnHidden
            >
                <Form form={batchAssignForm} layout="vertical">
                    <Form.Item label={t(domainMailboxesI18n.selectedDomainMailboxes)}>
                        <Input value={t(domainMailboxesI18n.selectedMailboxCount, { count: selectedMailboxIds.length })} disabled />
                    </Form.Item>
                    <Form.Item name="userId" label={t(domainMailboxesI18n.portalUser)} rules={[{ required: true, message: t(domainMailboxesI18n.selectPortalUserRequired) }]}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder={t(domainMailboxesI18n.selectPortalUserPlaceholder)}
                            options={users.map((item) => ({ value: item.id, label: `${item.username}${item.email ? ` (${item.email})` : ''}` }))}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={t(domainMailboxesI18n.batchDeleteByFilterTitle)}
                open={batchDeleteModalVisible}
                onCancel={() => setBatchDeleteModalVisible(false)}
                onOk={() => void handleBatchDeleteSubmit()}
                confirmLoading={savingBatchDelete}
                destroyOnHidden
            >
                <Form form={batchDeleteForm} layout="vertical">
                    <Form.Item name="domainId" label={t(adminI18n.sendingConfigs.domain)} rules={[{ required: true, message: t(domainMailboxesI18n.selectDomainRequired) }]}> 
                        <Select options={activeDomains.map((item) => ({ value: item.id, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="provisioningMode" label={t(domainMailboxesI18n.mailboxKind)}>
                        <Select allowClear options={provisioningOptions} />
                    </Form.Item>
                    <Form.Item name="batchTag" label={t(adminI18n.domainMailboxes.batchTag)}>
                        <Input placeholder={t(domainMailboxesI18n.deleteBatchTagPlaceholder)} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default DomainMailboxesPage;

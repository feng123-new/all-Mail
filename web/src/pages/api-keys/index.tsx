import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Table,
    Button,
    Space,
    Modal,
    Form,
    Input,
    Select,
    message,
    Popconfirm,
    Tag,
    Typography,
    Card,
    Tooltip,
    InputNumber,
    Progress,
    Statistic,
    Row,
    Col,
    Badge,
    Divider,
    DatePicker,
    Checkbox,
    Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    DatabaseOutlined,
    ThunderboltOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { apiKeysContract } from '../../contracts/admin/apiKeys';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import {
    centeredPadding40Style,
    centeredTextStyle,
    displayBlockMarginBottom8Style,
    fontSize11Style,
    fullWidthStyle,
    marginBottom8Style,
    marginBottom16Style,
    marginBottom24Style,
    marginLeft4Style,
    marginRight8Style,
    neutralCodePanelStyle,
    width180Style,
    width200Style,
} from '../../styles/common';
import { getErrorMessage } from '../../utils/error';
import { requestData } from '../../utils/request';
import { LOG_ACTION_OPTIONS } from '../../constants/logActions';
import dayjs from 'dayjs';

const { Text, Paragraph } = Typography;

const apiKeysPageI18n = {
    deleteFailed: defineMessage('apiKeys.deleteFailed', '删除失败', 'Delete failed'),
    updateSuccess: defineMessage('apiKeys.updateSuccess', '更新成功', 'Updated successfully'),
    close: defineMessage('apiKeys.close', '关闭', 'Close'),
    loadGroupsFailed: defineMessage('apiKeys.loadGroupsFailed', '获取分组失败', 'Failed to load groups'),
    loadDomainsFailed: defineMessage('apiKeys.loadDomainsFailed', '获取域名失败', 'Failed to load domains'),
    loadEmailOptionsFailed: defineMessage('apiKeys.loadEmailOptionsFailed', '获取邮箱选项失败', 'Failed to load mailbox options'),
    loadListFailed: defineMessage('apiKeys.loadListFailed', '获取数据失败', 'Failed to load data'),
    loadDetailFailed: defineMessage('apiKeys.loadDetailFailed', '获取访问密钥详情失败', 'Failed to load the API key details'),
    fetchAllocationStatsFailed: defineMessage('apiKeys.fetchAllocationStatsFailed', '获取分配统计失败', 'Failed to load allocation stats'),
    allocationReset: defineMessage('apiKeys.allocationReset', '分配记录已重置', 'Allocation history reset'),
    resetFailed: defineMessage('apiKeys.resetFailed', '重置失败', 'Reset failed'),
    fetchMailboxScopeFailed: defineMessage('apiKeys.fetchMailboxScopeFailed', '获取资源邮箱列表失败', 'Failed to load resource mailboxes'),
    savedMailboxScope: defineMessage('apiKeys.savedMailboxScope', '已保存，共 {count} 个资源邮箱', 'Saved. {count} resource mailboxes are selected.'),
    enabled: defineMessage('apiKeys.enabled', '启用', 'Enabled'),
    nameRequired: defineMessage('apiKeys.nameRequired', '请输入名称', 'Enter a name'),
    nameExample: defineMessage('apiKeys.nameExample', '例如：生产环境、测试环境', 'For example: production, staging'),
    rateLimitPerMinute: defineMessage('apiKeys.rateLimitPerMinute', '速率限制（每分钟请求数）', 'Rate limit (requests per minute)'),
    expiresAtOptional: defineMessage('apiKeys.expiresAtOptional', '过期时间（可选）', 'Expires at (optional)'),
    neverExpiresPlaceholder: defineMessage('apiKeys.neverExpiresPlaceholder', '不设置则永不过期', 'Leave empty for no expiry'),
    permissions: defineMessage('apiKeys.permissions', '可调用接口权限', 'Allowed API permissions'),
    permissionsRequired: defineMessage('apiKeys.permissionsRequired', '至少选择一个权限', 'Select at least one permission'),
    allowedGroups: defineMessage('apiKeys.allowedGroups', '可用分组（可选）', 'Allowed groups (optional)'),
    allowedGroupsHint: defineMessage('apiKeys.allowedGroupsHint', '不选择表示不限制分组', 'Leave empty to allow all groups'),
    allGroupsPlaceholder: defineMessage('apiKeys.allGroupsPlaceholder', '默认：全部分组', 'Default: all groups'),
    allowedMailboxes: defineMessage('apiKeys.allowedMailboxes', '可分配邮箱（可选）', 'Allowed mailboxes (optional)'),
    allowedMailboxesHint: defineMessage('apiKeys.allowedMailboxesHint', '不选择表示使用分组范围内全部邮箱资源', 'Leave empty to use every mailbox in the allowed groups'),
    allMailboxesPlaceholder: defineMessage('apiKeys.allMailboxesPlaceholder', '默认：分组范围内全部邮箱', 'Default: every mailbox in the allowed groups'),
    allowedDomains: defineMessage('apiKeys.allowedDomains', '可用域名邮箱域名（可选）', 'Allowed domain-mail domains (optional)'),
    allowedDomainsHint: defineMessage('apiKeys.allowedDomainsHint', '用于域名邮箱自动化接口；不选择表示不限制域名范围', 'Used by domain-mail automation APIs. Leave empty to allow all domains.'),
    allDomainsPlaceholder: defineMessage('apiKeys.allDomainsPlaceholder', '默认：全部 API 池域名', 'Default: all API-pool domains'),
    scopedMailboxCount: defineMessage('apiKeys.scopedMailboxCount', '当前可选邮箱：{count}', 'Currently available mailboxes: {count}'),
    copyKeyWarning: defineMessage('apiKeys.copyKeyWarning', '⚠️ 请立即复制并妥善保存此访问密钥，它不会再次显示！', '⚠️ Copy and store this API key now. It will not be shown again.'),
    copied: defineMessage('apiKeys.copied', '已复制', 'Copied'),
    perMinute: defineMessage('apiKeys.perMinute', '{count}/分钟', '{count}/min'),
    poolStatsTitle: defineMessage('apiKeys.poolStatsTitle', '分配统计 - {name}', 'Allocation stats - {name}'),
    loading: defineMessage('apiKeys.loading', '加载中...', 'Loading...'),
    filterByGroupInline: defineMessage('apiKeys.filterByGroupInline', '按分组筛选：', 'Filter by group:'),
    allGroupsFilterPlaceholder: defineMessage('apiKeys.allGroupsFilterPlaceholder', '全部分组', 'All groups'),
    totalResourcesTitle: defineMessage('apiKeys.totalResourcesTitle', '总资源数', 'Total resources'),
    allocatedTitle: defineMessage('apiKeys.allocatedTitle', '已分配', 'Allocated'),
    remainingAllocatableTitle: defineMessage('apiKeys.remainingAllocatableTitle', '剩余可分配', 'Remaining allocatable'),
    allocationProgress: defineMessage('apiKeys.allocationProgress', '分配进度', 'Allocation progress'),
    resetNotice: defineMessage('apiKeys.resetNotice', '重置后，此访问密钥会清空当前分配记录，可重新分配邮箱资源', 'After reset, this API key clears its current allocation history and can allocate mailbox resources again.'),
    resetConfirm: defineMessage('apiKeys.resetConfirm', '确定要重置分配记录吗？', 'Reset the allocation history?'),
    resetConfirmGroupDescription: defineMessage('apiKeys.resetConfirmGroupDescription', '仅重置分组 "{groupName}" 的分配记录', 'Only reset the allocation history for group "{groupName}"'),
    resetConfirmAllDescription: defineMessage('apiKeys.resetConfirmAllDescription', '重置后该访问密钥可重新分配所有邮箱资源', 'After reset, this API key can allocate all mailbox resources again'),
    resetAllocationButton: defineMessage('apiKeys.resetAllocationButton', '重置分配记录', 'Reset allocation history'),
    noData: defineMessage('apiKeys.noData', '暂无数据', 'No data'),
    mailboxScopeTitle: defineMessage('apiKeys.mailboxScopeTitle', '资源邮箱范围 - {name}', 'Resource mailbox scope - {name}'),
    saveButton: defineMessage('apiKeys.saveButton', '保存', 'Save'),
    cancelButton: defineMessage('apiKeys.cancelButton', '取消', 'Cancel'),
    searchMailboxOrGroup: defineMessage('apiKeys.searchMailboxOrGroup', '搜索邮箱或分组', 'Search mailboxes or groups'),
    mailboxScopeHint: defineMessage('apiKeys.mailboxScopeHint', '勾选的邮箱表示该访问密钥已占用这些邮箱资源，自动分配时会跳过它们', 'Checked mailboxes are already occupied by this API key, so automatic allocation skips them.'),
    selectFiltered: defineMessage('apiKeys.selectFiltered', '全选当前筛选', 'Select all filtered'),
    clearFiltered: defineMessage('apiKeys.clearFiltered', '清空当前筛选', 'Clear filtered selection'),
    selectedCountSummary: defineMessage('apiKeys.selectedCountSummary', '已选择 {selectedCount} / {totalCount}（当前筛选 {filteredSelectedCount} / {filteredTotalCount}）', 'Selected {selectedCount} / {totalCount} (current filter {filteredSelectedCount} / {filteredTotalCount})'),
} as const;

const apiKeyStyles = {
    fullWidth: fullWidthStyle,
    permissionGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', rowGap: 8 },
    warningBlock: { display: 'block', marginBottom: 16 },
    keyPreview: { ...neutralCodePanelStyle, wordBreak: 'break-all' },
    centeredLoading: centeredPadding40Style,
    filterRow: marginBottom16Style,
    marginBottom24: marginBottom24Style,
    progressLabel: displayBlockMarginBottom8Style,
    centeredText: centeredTextStyle,
    emptyMuted: { ...centeredPadding40Style, color: '#999' },
    emailScrollBox: { maxHeight: 400, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 12 },
    checkboxGroup: fullWidthStyle,
    emailCol: marginBottom8Style,
    groupTag: { ...marginLeft4Style, ...fontSize11Style },
} as const;

interface EmailGroup {
    id: number;
    name: string;
    description: string | null;
    emailCount: number;
}

interface ApiKey {
    id: number;
    name: string;
    keyPrefix: string;
    rateLimit: number;
    status: 'ACTIVE' | 'DISABLED';
    expiresAt: string | null;
    lastUsedAt: string | null;
    usageCount: number;
    createdAt: string;
    createdByName: string;
}

interface ApiKeyDetail extends ApiKey {
    permissions?: Record<string, boolean> | null;
    allowedGroupIds?: number[] | null;
    allowedEmailIds?: number[] | null;
    allowedDomainIds?: number[] | null;
}

interface DomainOption {
    id: number;
    name: string;
    status?: string;
}

interface EmailOptionItem {
    id: number;
    email: string;
    groupId: number | null;
    group: { id: number; name: string } | null;
}

interface PoolStats {
    total: number;
    used: number;
    remaining: number;
}

interface PoolEmailItem {
    id: number;
    email: string;
    used: boolean;
    groupId: number | null;
    groupName: string | null;
}

interface ApiKeyListResult {
    list: ApiKey[];
    total: number;
}

interface PagedListResult<T> {
    list: T[];
    total: number;
}

interface ApiEnvelope<T> {
    code: number;
    data: T;
}

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

const ApiKeysPage = () => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<ApiKey[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [newKeyModalVisible, setNewKeyModalVisible] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [poolModalVisible, setPoolModalVisible] = useState(false);
    const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
    const [poolLoading, setPoolLoading] = useState(false);
    const [currentApiKey, setCurrentApiKey] = useState<ApiKey | null>(null);
    const [emailList, setEmailList] = useState<PoolEmailItem[]>([]);
    const [selectedEmails, setSelectedEmails] = useState<number[]>([]);
    const [emailKeyword, setEmailKeyword] = useState('');
    const [emailModalVisible, setEmailModalVisible] = useState(false);
    const [emailLoading, setEmailLoading] = useState(false);
    const [savingEmails, setSavingEmails] = useState(false);
    const [apiKeyDetailLoading, setApiKeyDetailLoading] = useState(false);
    const [groups, setGroups] = useState<EmailGroup[]>([]);
    const [domains, setDomains] = useState<DomainOption[]>([]);
    const [allEmailOptions, setAllEmailOptions] = useState<EmailOptionItem[]>([]);
    const [poolGroupName, setPoolGroupName] = useState<string | undefined>(undefined);
    const [emailGroupId, setEmailGroupId] = useState<number | undefined>(undefined);
    const latestListRequestIdRef = useRef(0);
    const [form] = Form.useForm();
    const selectedAllowedGroupIds = Form.useWatch('allowedGroupIds', form) as number[] | undefined;

    const permissionActionOptions = useMemo(
        () =>
            LOG_ACTION_OPTIONS.map((item) => ({
                value: item.value,
                label: t(item.label),
            })),
        [t]
    );
    const allPermissionActions = useMemo(
        () => permissionActionOptions.map((item) => item.value),
        [permissionActionOptions]
    );

    const extractUsedEmailIds = useCallback(
        (emails: PoolEmailItem[]) => emails.filter((item) => item.used).map((item) => item.id),
        []
    );

    const fetchGroups = useCallback(async () => {
        const result = await requestData<EmailGroup[]>(
            () => apiKeysContract.getGroups(),
            t(apiKeysPageI18n.loadGroupsFailed),
            { silent: true }
        );
        if (result) {
            setGroups(result);
        }
    }, [t]);

    const fetchDomains = useCallback(async () => {
        const result = await requestData<DomainOption[]>(
            async () => fetchAllPagedItems<DomainOption>(
                async (page, pageSize) => apiKeysContract.getDomains<DomainOption>({ page, pageSize })
            ),
            t(apiKeysPageI18n.loadDomainsFailed),
            { silent: true }
        );
        if (result) {
            setDomains(result.filter((item) => item.status !== 'DISABLED'));
        }
    }, [t]);

    const fetchAllEmailOptions = useCallback(async () => {
        const result = await requestData<EmailOptionItem[]>(
            async () => fetchAllPagedItems<EmailOptionItem>(
                async (page, pageSize) => apiKeysContract.getEmails<EmailOptionItem>({ page, pageSize, status: 'ACTIVE' })
            ),
            t(apiKeysPageI18n.loadEmailOptionsFailed),
            { silent: true }
        );
        if (result) {
            setAllEmailOptions(result);
        }
    }, [t]);

    const fetchData = useCallback(async () => {
        const currentRequestId = ++latestListRequestIdRef.current;
        setLoading(true);
        const result = await requestData<ApiKeyListResult>(
            () => apiKeysContract.getList({ page, pageSize: Math.min(pageSize, MAX_LIST_PAGE_SIZE) }),
            t(apiKeysPageI18n.loadListFailed)
        );
        if (currentRequestId !== latestListRequestIdRef.current) {
            return;
        }
        if (result) {
            setData(result.list);
            setTotal(result.total);
        }
        setLoading(false);
    }, [page, pageSize, t]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    useEffect(() => {
        fetchDomains();
    }, [fetchDomains]);

    useEffect(() => {
        fetchAllEmailOptions();
    }, [fetchAllEmailOptions]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCreate = () => {
        setEditingId(null);
        setApiKeyDetailLoading(false);
        form.resetFields();
        form.setFieldsValue({
            permissions: allPermissionActions,
            allowedGroupIds: [],
            allowedEmailIds: [],
            allowedDomainIds: [],
        });
        setModalVisible(true);
    };

    const handleEdit = useCallback(async (record: ApiKey) => {
        setEditingId(record.id);
        setApiKeyDetailLoading(true);
        form.setFieldsValue({
            name: record.name,
            rateLimit: record.rateLimit,
            status: record.status,
            expiresAt: record.expiresAt ? dayjs(record.expiresAt) : null,
            permissions: allPermissionActions,
        });
        setModalVisible(true);
        try {
            const detail = await requestData<ApiKeyDetail>(
                () => apiKeysContract.getById(record.id),
                t(apiKeysPageI18n.loadDetailFailed)
            );
            if (detail) {
                const selectedPermissions = detail.permissions
                    ? Object.entries(detail.permissions)
                        .filter(([, allowed]) => allowed)
                        .map(([permission]) => permission.replace(/-/g, '_'))
                    : allPermissionActions;
                form.setFieldsValue({
                    name: detail.name,
                    rateLimit: detail.rateLimit,
                    status: detail.status,
                    expiresAt: detail.expiresAt ? dayjs(detail.expiresAt) : null,
                    permissions: selectedPermissions.length > 0 ? selectedPermissions : allPermissionActions,
                    allowedGroupIds: detail.allowedGroupIds || [],
                    allowedEmailIds: detail.allowedEmailIds || [],
                    allowedDomainIds: detail.allowedDomainIds || [],
                });
            }
        } finally {
            setApiKeyDetailLoading(false);
        }
    }, [allPermissionActions, form, t]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            const res = await apiKeysContract.delete(id);
            if (res.code === 200) {
                message.success(t(adminI18n.apiKeys.deletedSuccess));
                fetchData();
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, t(apiKeysPageI18n.deleteFailed)));
        }
    }, [fetchData, t]);

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();
            const selectedPermissions = Array.isArray(values.permissions)
                ? values.permissions as string[]
                : [];
            const allowedGroupIds = Array.isArray(values.allowedGroupIds)
                ? Array.from(new Set(values.allowedGroupIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)))
                : [];
            const allowedEmailIds = Array.isArray(values.allowedEmailIds)
                ? Array.from(new Set(values.allowedEmailIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)))
                : [];
            const allowedDomainIds = Array.isArray(values.allowedDomainIds)
                ? Array.from(new Set(values.allowedDomainIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)))
                : [];
            const permissions = selectedPermissions.reduce<Record<string, boolean>>((acc, action) => {
                acc[action] = true;
                return acc;
            }, {});

            if (editingId) {
                const submitData = {
                    ...values,
                    expiresAt: values.expiresAt ? values.expiresAt.toISOString() : null,
                    permissions,
                    allowedGroupIds,
                    allowedEmailIds,
                    allowedDomainIds,
                };
                const res = await apiKeysContract.update(editingId, submitData);
                if (res.code === 200) {
                    message.success(t(apiKeysPageI18n.updateSuccess));
                    setModalVisible(false);
                    fetchData();
                }
            } else {
                const submitData = {
                    ...values,
                    expiresAt: values.expiresAt ? values.expiresAt.toISOString() : undefined,
                    permissions,
                    allowedGroupIds,
                    allowedEmailIds,
                    allowedDomainIds,
                };
                const res = await apiKeysContract.create(submitData);
                if (res.code === 200) {
                    setModalVisible(false);
                    setNewKey(res.data.key);
                    setNewKeyModalVisible(true);
                    fetchData();
                }
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, t(adminI18n.apiKeys.saveFailed)));
        }
    };

    const handleViewPool = useCallback(async (record: ApiKey) => {
        setCurrentApiKey(record);
        setPoolGroupName(undefined);
        setPoolModalVisible(true);
        setPoolLoading(true);
        try {
            const res = await apiKeysContract.getAllocationStats(record.id);
            if (res.code === 200) {
                setPoolStats(res.data);
            }
        } catch {
            message.error(t(apiKeysPageI18n.fetchAllocationStatsFailed));
        } finally {
            setPoolLoading(false);
        }
    }, [t]);

    const handlePoolGroupChange = async (groupName: string | undefined) => {
        setPoolGroupName(groupName);
        if (!currentApiKey) return;
        setPoolLoading(true);
        try {
            const res = await apiKeysContract.getAllocationStats(currentApiKey.id, groupName);
            if (res.code === 200) {
                setPoolStats(res.data);
            }
        } catch {
            message.error(t(apiKeysPageI18n.fetchAllocationStatsFailed));
        } finally {
            setPoolLoading(false);
        }
    };

    const handleResetPool = async () => {
        if (!currentApiKey) return;
        try {
            const res = await apiKeysContract.resetAllocation(currentApiKey.id, poolGroupName);
            if (res.code === 200) {
                message.success(t(apiKeysPageI18n.allocationReset));
                const statsRes = await apiKeysContract.getAllocationStats(currentApiKey.id, poolGroupName);
                if (statsRes.code === 200) {
                    setPoolStats(statsRes.data);
                }
            }
        } catch {
                message.error(t(apiKeysPageI18n.resetFailed));
        }
    };

    const handleManageEmails = useCallback(async (record: ApiKey) => {
        setCurrentApiKey(record);
        setEmailGroupId(undefined);
        setEmailModalVisible(true);
        setEmailLoading(true);
        try {
            const res = await apiKeysContract.getAssignedMailboxes<PoolEmailItem>(record.id);
            if (res.code === 200) {
                const emails = res.data;
                setEmailList(emails);
                setSelectedEmails(extractUsedEmailIds(emails));
                setEmailKeyword('');
            }
        } catch {
            message.error(t(apiKeysPageI18n.fetchMailboxScopeFailed));
        } finally {
            setEmailLoading(false);
        }
    }, [extractUsedEmailIds, t]);

    const handleEmailGroupChange = useCallback(async (groupId: number | undefined) => {
        setEmailGroupId(groupId);
        if (!currentApiKey) return;
        setEmailLoading(true);
        try {
            const res = await apiKeysContract.getAssignedMailboxes<PoolEmailItem>(currentApiKey.id, groupId);
            if (res.code === 200) {
                const emails = res.data;
                setEmailList(emails);
                setSelectedEmails(extractUsedEmailIds(emails));
                setEmailKeyword('');
            }
        } catch {
            message.error(t(apiKeysPageI18n.fetchMailboxScopeFailed));
        } finally {
            setEmailLoading(false);
        }
    }, [currentApiKey, extractUsedEmailIds, t]);

    const handleSaveEmails = async () => {
        if (!currentApiKey) return;
        setSavingEmails(true);
        try {
            const res = await apiKeysContract.updateAssignedMailboxes(currentApiKey.id, selectedEmails, emailGroupId);
            if (res.code === 200) {
                message.success(t(apiKeysPageI18n.savedMailboxScope, { count: res.data.count }));
                setEmailModalVisible(false);
                const statsRes = await apiKeysContract.getAllocationStats(currentApiKey.id);
                if (statsRes.code === 200) {
                    setPoolStats(statsRes.data);
                }
            }
        } catch {
            message.error(t(adminI18n.apiKeys.saveFailed));
        } finally {
            setSavingEmails(false);
        }
    };

    const columns: ColumnsType<ApiKey> = useMemo(() => [
        {
            title: t(adminI18n.apiKeys.name),
            dataIndex: 'name',
            key: 'name',
            render: (name, record) => (
                <Space>
                    <Text strong>{name}</Text>
                    {record.status === 'DISABLED' && <Badge status="error" />}
                </Space>
            ),
        },
        {
            title: t(adminI18n.apiKeys.keyPrefix),
            dataIndex: 'keyPrefix',
            key: 'keyPrefix',
            width: 120,
            render: (text) => <Text code>{text}...</Text>,
        },
        {
            title: t(adminI18n.apiKeys.rateLimit),
            dataIndex: 'rateLimit',
            key: 'rateLimit',
            width: 100,
            render: (val) => <Tag color="blue">{t(apiKeysPageI18n.perMinute, { count: val })}</Tag>,
        },
        {
            title: t(adminI18n.common.status),
            dataIndex: 'status',
            key: 'status',
            width: 80,
            render: (status) => (
                <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>
                    {status === 'ACTIVE' ? t(apiKeysPageI18n.enabled) : t(adminI18n.common.disabled)}
                </Tag>
            ),
        },
        {
            title: t(adminI18n.apiKeys.usageCount),
            dataIndex: 'usageCount',
            key: 'usageCount',
            width: 100,
            render: (val) => <Text type="secondary">{val?.toLocaleString() || 0}</Text>,
        },
        {
            title: t(adminI18n.apiKeys.expiresAt),
            dataIndex: 'expiresAt',
            key: 'expiresAt',
            width: 120,
            render: (val) => {
                if (!val) return <Text type="secondary">{t(adminI18n.apiKeys.neverExpires)}</Text>;
                const isExpired = dayjs(val).isBefore(dayjs());
                return (
                    <Text type={isExpired ? 'danger' : undefined}>
                        {dayjs(val).format('YYYY-MM-DD')}
                    </Text>
                );
            },
        },
        {
            title: t(adminI18n.apiKeys.lastUsedAt),
            dataIndex: 'lastUsedAt',
            key: 'lastUsedAt',
            width: 140,
            render: (val) => val ? dayjs(val).format('MM-DD HH:mm') : <Text type="secondary">{t(adminI18n.apiKeys.neverUsed)}</Text>,
        },
        {
            title: t(adminI18n.common.actions),
            key: 'action',
            width: 180,
            render: (_, record) => (
                <Space size="small">
                    <Tooltip title={t(adminI18n.apiKeys.allocationStats)}>
                        <Button
                            type="text"
                            icon={<DatabaseOutlined />}
                            onClick={() => handleViewPool(record)}
                        />
                    </Tooltip>
                    <Tooltip title={t(adminI18n.apiKeys.manageMailboxes)}>
                        <Button
                            type="text"
                            icon={<ThunderboltOutlined />}
                            onClick={() => handleManageEmails(record)}
                        />
                    </Tooltip>
                    <Tooltip title={t(adminI18n.common.edit)}>
                        <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                        />
                    </Tooltip>
                    <Tooltip title={t(adminI18n.common.remove)}>
                        <Popconfirm
                            title={t(adminI18n.apiKeys.deleteConfirm)}
                            onConfirm={() => handleDelete(record.id)}
                        >
                            <Button type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                    </Tooltip>
                </Space>
            ),
        },
    ], [handleDelete, handleEdit, handleManageEmails, handleViewPool, t]);

    const tablePagination = useMemo(
        () => ({
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (count: number) => t(adminI18n.common.totalCount, { count }),
            onChange: (currentPage: number, currentPageSize: number) => {
                setPage(currentPage);
                setPageSize(Math.min(currentPageSize, MAX_LIST_PAGE_SIZE));
            },
        }),
        [page, pageSize, t, total]
    );

    const poolGroupOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.name,
                label: `${group.name} (${group.emailCount})`,
            })),
        [groups]
    );

    const emailGroupOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.id,
                label: group.name,
            })),
        [groups]
    );

    const scopedAllowedEmailOptions = useMemo(() => {
        const selectedGroupSet = new Set(
            Array.isArray(selectedAllowedGroupIds)
                ? selectedAllowedGroupIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
                : []
        );

        const candidates = selectedGroupSet.size > 0
            ? allEmailOptions.filter((item) => item.groupId !== null && selectedGroupSet.has(item.groupId))
            : allEmailOptions;

        return candidates.map((item) => ({
            value: item.id,
            label: item.group?.name ? `${item.email}（${item.group.name}）` : item.email,
        }));
    }, [allEmailOptions, selectedAllowedGroupIds]);

    useEffect(() => {
        const currentValue = form.getFieldValue('allowedEmailIds');
        const selected = Array.isArray(currentValue) ? currentValue : [];
        if (selected.length === 0) {
            return;
        }

        const allowedSet = new Set(scopedAllowedEmailOptions.map((item) => item.value));
        const nextSelected = selected.filter((item: number) => allowedSet.has(item));
        if (nextSelected.length !== selected.length) {
            form.setFieldValue('allowedEmailIds', nextSelected);
        }
    }, [form, scopedAllowedEmailOptions]);

    const filteredEmailList = useMemo(() => {
        const keyword = emailKeyword.trim().toLowerCase();
        if (!keyword) {
            return emailList;
        }

        return emailList.filter((item) => {
            const emailText = item.email.toLowerCase();
            const groupText = item.groupName?.toLowerCase() || '';
            return emailText.includes(keyword) || groupText.includes(keyword);
        });
    }, [emailKeyword, emailList]);

    const filteredEmailIdSet = useMemo(
        () => new Set(filteredEmailList.map((item) => item.id)),
        [filteredEmailList]
    );

    const selectedInFilteredCount = useMemo(
        () => selectedEmails.filter((id) => filteredEmailIdSet.has(id)).length,
        [filteredEmailIdSet, selectedEmails]
    );

    return (
        <div>
            <PageHeader
                title={t(adminI18n.apiKeys.title)}
                subtitle={t(adminI18n.apiKeys.subtitle)}
                extra={
                    <Space>
                        <Button icon={<ReloadOutlined />} onClick={fetchData}>
                            {t(adminI18n.common.refresh)}
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                            {t(adminI18n.apiKeys.create)}
                        </Button>
                    </Space>
                }
            />

            <SurfaceCard>
                <Table
                    columns={columns}
                    dataSource={data}
                    rowKey="id"
                    loading={loading}
                    pagination={tablePagination}
                    virtual
                    scroll={{ y: 560, x: 1200 }}
                />
            </SurfaceCard>

            {/* 创建/编辑弹窗 */}
            <Modal
                title={editingId ? t(adminI18n.apiKeys.edit) : t(adminI18n.apiKeys.create)}
                open={modalVisible}
                onOk={handleSubmit}
                onCancel={() => setModalVisible(false)}
                destroyOnHidden
                width={500}
            >
                <Spin spinning={apiKeyDetailLoading}>
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label={t(adminI18n.apiKeys.name)}
                    rules={[{ required: true, message: t(apiKeysPageI18n.nameRequired) }]}
                    >
                        <Input placeholder={t(apiKeysPageI18n.nameExample)} />
                    </Form.Item>
                    <Form.Item
                        name="rateLimit"
                    label={t(apiKeysPageI18n.rateLimitPerMinute)}
                        initialValue={60}
                    >
                        <InputNumber min={1} max={10000} style={apiKeyStyles.fullWidth} />
                    </Form.Item>
                    <Form.Item
                        name="expiresAt"
                    label={t(apiKeysPageI18n.expiresAtOptional)}
                    >
                        <DatePicker
                            style={apiKeyStyles.fullWidth}
                        placeholder={t(apiKeysPageI18n.neverExpiresPlaceholder)}
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>
                    {editingId && (
                        <Form.Item
                            name="status"
                            label={t(adminI18n.common.status)}
                        >
                            <Select>
                            <Select.Option value="ACTIVE">{t(apiKeysPageI18n.enabled)}</Select.Option>
                                <Select.Option value="DISABLED">{t(adminI18n.common.disabled)}</Select.Option>
                            </Select>
                        </Form.Item>
                    )}
                    <Form.Item
                        name="permissions"
                    label={t(apiKeysPageI18n.permissions)}
                    rules={[{ required: true, type: 'array', min: 1, message: t(apiKeysPageI18n.permissionsRequired) }]}
                    >
                        <Checkbox.Group
                            options={permissionActionOptions}
                            style={apiKeyStyles.permissionGrid}
                        />
                    </Form.Item>
                    <Form.Item
                        name="allowedGroupIds"
                    label={t(apiKeysPageI18n.allowedGroups)}
                    tooltip={t(apiKeysPageI18n.allowedGroupsHint)}
                    >
                        <Select
                            mode="multiple"
                            allowClear
                        placeholder={t(apiKeysPageI18n.allGroupsPlaceholder)}
                            options={emailGroupOptions}
                            optionFilterProp="label"
                            maxTagCount="responsive"
                        />
                    </Form.Item>
                    <Form.Item
                        name="allowedEmailIds"
                    label={t(apiKeysPageI18n.allowedMailboxes)}
                    tooltip={t(apiKeysPageI18n.allowedMailboxesHint)}
                    >
                        <Select
                            mode="multiple"
                            allowClear
                            showSearch
                        placeholder={t(apiKeysPageI18n.allMailboxesPlaceholder)}
                            options={scopedAllowedEmailOptions}
                            optionFilterProp="label"
                            maxTagCount="responsive"
                        />
                    </Form.Item>
                    <Form.Item
                        name="allowedDomainIds"
                    label={t(apiKeysPageI18n.allowedDomains)}
                    tooltip={t(apiKeysPageI18n.allowedDomainsHint)}
                    >
                        <Select
                            mode="multiple"
                            allowClear
                        placeholder={t(apiKeysPageI18n.allDomainsPlaceholder)}
                            options={domains.map((item) => ({ value: item.id, label: item.name }))}
                            optionFilterProp="label"
                            maxTagCount="responsive"
                        />
                    </Form.Item>
                    <Text type="secondary">
                            {t(apiKeysPageI18n.scopedMailboxCount, { count: scopedAllowedEmailOptions.length })}
                    </Text>
                </Form>
                </Spin>
            </Modal>

            {/* 新建 Key 显示弹窗 */}
            <Modal
                title={t(adminI18n.apiKeys.created)}
                open={newKeyModalVisible}
                onOk={() => setNewKeyModalVisible(false)}
                onCancel={() => setNewKeyModalVisible(false)}
                destroyOnHidden
                    footer={[
                        <Button key="close" onClick={() => setNewKeyModalVisible(false)}>
						{t(apiKeysPageI18n.close)}
                        </Button>,
                    ]}
            >
                <Card>
                    <Text type="warning" style={apiKeyStyles.warningBlock}>
                        {t(apiKeysPageI18n.copyKeyWarning)}
                    </Text>
                    <Paragraph
                        copyable={{
                            text: newKey,
                            onCopy: () => message.success(t(apiKeysPageI18n.copied)),
                        }}
                        code
                        style={apiKeyStyles.keyPreview}
                    >
                        {newKey}
                    </Paragraph>
                </Card>
            </Modal>

            {poolModalVisible && (
                <Modal
                    title={
                        <Space>
                            <DatabaseOutlined />
                            <span>{t(apiKeysPageI18n.poolStatsTitle, { name: currentApiKey?.name || '-' })}</span>
                        </Space>
                    }
                    open={poolModalVisible}
                    onCancel={() => setPoolModalVisible(false)}
                    footer={null}
                    destroyOnHidden
                    width={500}
                >
					{poolLoading ? (
						<div style={apiKeyStyles.centeredLoading}>{t(apiKeysPageI18n.loading)}</div>
					) : poolStats ? (
						<div>
							<div style={apiKeyStyles.filterRow}>
								<Text type="secondary" style={marginRight8Style}>{t(apiKeysPageI18n.filterByGroupInline)}</Text>
								<Select
									allowClear
									placeholder={t(apiKeysPageI18n.allGroupsFilterPlaceholder)}
									style={width200Style}
                                    value={poolGroupName}
                                    options={poolGroupOptions}
                                    onChange={(val: string | undefined) => handlePoolGroupChange(val)}
                                />
                            </div>
                            <Row gutter={16} style={apiKeyStyles.marginBottom24}>
                                <Col span={8}>
                                    <div className="stat-blue">
								<Statistic
									title={t(apiKeysPageI18n.totalResourcesTitle)}
									value={poolStats.total}
								/>
                                    </div>
                                </Col>
                                <Col span={8}>
                                    <div className="stat-orange">
								<Statistic
									title={t(apiKeysPageI18n.allocatedTitle)}
									value={poolStats.used}
								/>
                                    </div>
                                </Col>
                                <Col span={8}>
                                    <div className={poolStats.remaining > 0 ? 'stat-green' : 'stat-red'}>
								<Statistic
									title={t(apiKeysPageI18n.remainingAllocatableTitle)}
									value={poolStats.remaining}
								/>
                                    </div>
                                </Col>
                            </Row>
                            <style>{`
                                .stat-blue .ant-statistic-content-value { color: #1890ff; }
                                .stat-orange .ant-statistic-content-value { color: #faad14; }
                                .stat-green .ant-statistic-content-value { color: #52c41a; }
                                .stat-red .ant-statistic-content-value { color: #ff4d4f; }
                            `}</style>

                            <div style={apiKeyStyles.marginBottom24}>
								<Text type="secondary" style={apiKeyStyles.progressLabel}>
									{t(apiKeysPageI18n.allocationProgress)}
								</Text>
                                <Progress
                                    percent={poolStats.total > 0 ? Math.round((poolStats.used / poolStats.total) * 100) : 0}
                                    status={poolStats.remaining === 0 ? 'exception' : 'active'}
                                    strokeColor={{
                                        '0%': '#108ee9',
                                        '100%': '#87d068',
                                    }}
                                />
                            </div>

                            <Divider />

                            <div style={apiKeyStyles.centeredText}>
								<Text type="secondary" style={apiKeyStyles.warningBlock}>
									{t(apiKeysPageI18n.resetNotice)}
								</Text>
								<Popconfirm
									title={t(apiKeysPageI18n.resetConfirm)}
									description={poolGroupName ? t(apiKeysPageI18n.resetConfirmGroupDescription, { groupName: poolGroupName }) : t(apiKeysPageI18n.resetConfirmAllDescription)}
									onConfirm={handleResetPool}
								>
                                    <Button
                                        type="primary"
                                        danger
                                        icon={<ThunderboltOutlined />}
                                    >
										{t(apiKeysPageI18n.resetAllocationButton)}
									</Button>
								</Popconfirm>
							</div>
						</div>
					) : (
						<div style={apiKeyStyles.emptyMuted}>
							{t(apiKeysPageI18n.noData)}
						</div>
					)}
                </Modal>
            )}

            {emailModalVisible && (
                <Modal
                    title={
                        <Space>
                            <ThunderboltOutlined />
                            <span>{t(apiKeysPageI18n.mailboxScopeTitle, { name: currentApiKey?.name || '-' })}</span>
                        </Space>
                    }
                    open={emailModalVisible}
                    onCancel={() => setEmailModalVisible(false)}
					onOk={handleSaveEmails}
					okText={t(apiKeysPageI18n.saveButton)}
					cancelText={t(apiKeysPageI18n.cancelButton)}
                    confirmLoading={savingEmails}
                    destroyOnHidden
                    width={600}
                >
                    {emailLoading ? (
                        <div style={apiKeyStyles.centeredLoading}>
                            <Spin />
                        </div>
                    ) : (
						<div>
							<div style={apiKeyStyles.filterRow}>
							<Space>
								<Text type="secondary">{t(apiKeysPageI18n.filterByGroupInline)}</Text>
								<Select
									allowClear
									placeholder={t(apiKeysPageI18n.allGroupsFilterPlaceholder)}
									style={width180Style}
                                        value={emailGroupId}
                                        options={emailGroupOptions}
                                        onChange={(val: number | undefined) => handleEmailGroupChange(val)}
                                    />
                                </Space>
                            </div>
                            <div style={apiKeyStyles.filterRow}>
								<Input
									allowClear
									value={emailKeyword}
									onChange={(event) => setEmailKeyword(event.target.value)}
									prefix={<SearchOutlined />}
									placeholder={t(apiKeysPageI18n.searchMailboxOrGroup)}
								/>
							</div>
							<div style={apiKeyStyles.filterRow}>
								<Text type="secondary">
									{t(apiKeysPageI18n.mailboxScopeHint)}
								</Text>
                            </div>
                            <div style={apiKeyStyles.filterRow}>
                                <Space>
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            setSelectedEmails((prev) => Array.from(new Set([
                                                ...prev,
                                                ...filteredEmailList.map((item) => item.id),
                                            ])));
                                        }}
                                    >
										{t(apiKeysPageI18n.selectFiltered)}
                                    </Button>
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            setSelectedEmails((prev) => prev.filter((id) => !filteredEmailIdSet.has(id)));
                                        }}
                                    >
										{t(apiKeysPageI18n.clearFiltered)}
                                    </Button>
                                    <Text type="secondary">
										{t(apiKeysPageI18n.selectedCountSummary, {
											selectedCount: selectedEmails.length,
											totalCount: emailList.length,
											filteredSelectedCount: selectedInFilteredCount,
											filteredTotalCount: filteredEmailList.length,
										})}
                                    </Text>
                                </Space>
                            </div>
                            <div style={apiKeyStyles.emailScrollBox}>
                                <Checkbox.Group
                                    value={selectedEmails}
                                    onChange={(vals) => setSelectedEmails(vals as number[])}
                                    style={apiKeyStyles.checkboxGroup}
                                >
                                    <Row>
                                        {filteredEmailList.map((email: { id: number; email: string; used: boolean; groupId: number | null; groupName: string | null }) => (
                                            <Col span={12} key={email.id} style={apiKeyStyles.emailCol}>
                                                <Checkbox value={email.id}>
                                                    {email.email}
                                                    {email.groupName && (
                                                        <Tag color="blue" style={apiKeyStyles.groupTag}>{email.groupName}</Tag>
                                                    )}
                                                </Checkbox>
                                            </Col>
                                        ))}
                                    </Row>
                                </Checkbox.Group>
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
};

export default ApiKeysPage;

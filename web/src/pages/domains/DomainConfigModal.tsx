import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { domainsContract } from '../../contracts/admin/domains';
import { fullWidthStyle, marginBottom16Style } from '../../styles/common';
import { requestData } from '../../utils/request';

const { Text } = Typography;

interface DomainMailboxRecord {
    id: number;
    address: string;
    localPart: string;
    status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED';
    canLogin: boolean;
    isCatchAllTarget: boolean;
}

interface DomainSendingConfigRecord {
    id: number;
    provider: 'RESEND';
    fromNameDefault?: string | null;
    replyToDefault?: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
}

interface DomainDetailRecord {
    id: number;
    name: string;
    displayName?: string | null;
    status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'ERROR';
    provider?: string | null;
    canReceive: boolean;
    canSend: boolean;
    isCatchAllEnabled: boolean;
    catchAllTargetMailboxId?: number | null;
    verificationToken?: string | null;
    dnsStatus?: {
        provider?: string;
        expectedMxConfigured?: boolean;
        expectedIngressConfigured?: boolean;
    } | null;
    resendDomainId?: string | null;
    createdAt: string;
    updatedAt: string;
    creator?: { id: number; username: string } | null;
    mailboxes: DomainMailboxRecord[];
    sendingConfigs: DomainSendingConfigRecord[];
    inboundMessageCount: number;
    outboundMessageCount: number;
}

interface DomainAliasRecord {
    id: number;
    mailboxId: number;
    aliasLocalPart: string;
    aliasAddress: string;
    status: 'ACTIVE' | 'DISABLED';
    createdAt?: string;
    updatedAt?: string;
    mailbox?: {
        id: number;
        address: string;
        status: string;
    };
}

interface VerificationFormValues {
    verificationToken?: string;
}

interface CatchAllFormValues {
    isCatchAllEnabled: boolean;
    catchAllTargetMailboxId?: number;
}

interface SendingConfigFormValues {
    fromNameDefault?: string;
    replyToDefault?: string;
    apiKey?: string;
}

interface AliasFormValues {
    mailboxId?: number;
    aliasLocalPart?: string;
}

interface DomainConfigModalProps {
    domainId: number | null;
    domainName?: string;
    open: boolean;
    onCancel: () => void;
    onUpdated: () => Promise<void> | void;
}

const aliasStatusColor: Record<DomainAliasRecord['status'], string> = {
    ACTIVE: 'success',
    DISABLED: 'default',
};

const domainConfigStyles = {
    fullWidth: fullWidthStyle,
    hint: {
        marginTop: -8,
        marginBottom: 8,
        color: 'rgba(0, 0, 0, 0.45)',
        fontSize: 12,
    },
    sectionActions: {
        justifyContent: 'space-between',
        width: '100%',
    },
} as const;

function formatBooleanTag(value: boolean, trueLabel: string, falseLabel: string, trueColor = 'success') {
    return <Tag color={value ? trueColor : 'default'}>{value ? trueLabel : falseLabel}</Tag>;
}

function getPrimarySendingConfig(detail: DomainDetailRecord | null): DomainSendingConfigRecord | null {
    return detail?.sendingConfigs[0] ?? null;
}

export default function DomainConfigModal({ domainId, domainName, open, onCancel, onUpdated }: DomainConfigModalProps) {
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<DomainDetailRecord | null>(null);
    const [aliases, setAliases] = useState<DomainAliasRecord[]>([]);
    const [aliasModalVisible, setAliasModalVisible] = useState(false);
    const [savingVerification, setSavingVerification] = useState(false);
    const [savingCatchAll, setSavingCatchAll] = useState(false);
    const [savingSendingConfig, setSavingSendingConfig] = useState(false);
    const [savingAlias, setSavingAlias] = useState(false);
    const [togglingAliasId, setTogglingAliasId] = useState<number | null>(null);
    const [deletingAliasId, setDeletingAliasId] = useState<number | null>(null);
    const [verificationForm] = Form.useForm<VerificationFormValues>();
    const [catchAllForm] = Form.useForm<CatchAllFormValues>();
    const [sendingConfigForm] = Form.useForm<SendingConfigFormValues>();
    const [aliasForm] = Form.useForm<AliasFormValues>();

    const loadConfig = useCallback(async () => {
        if (!domainId) {
            return;
        }

        setLoading(true);
        const [detailResult, aliasResult] = await Promise.all([
            requestData<DomainDetailRecord>(() => domainsContract.getById<DomainDetailRecord>(domainId), '获取域名配置失败'),
            requestData<DomainAliasRecord[]>(() => domainsContract.getAliases<DomainAliasRecord>(domainId), '获取 Alias 列表失败'),
        ]);

        if (detailResult) {
            setDetail(detailResult);
            verificationForm.setFieldsValue({ verificationToken: detailResult.verificationToken ?? undefined });
            catchAllForm.setFieldsValue({
                isCatchAllEnabled: detailResult.isCatchAllEnabled,
                catchAllTargetMailboxId: detailResult.catchAllTargetMailboxId ?? undefined,
            });
            const primarySendingConfig = getPrimarySendingConfig(detailResult);
            sendingConfigForm.setFieldsValue({
                fromNameDefault: primarySendingConfig?.fromNameDefault ?? undefined,
                replyToDefault: primarySendingConfig?.replyToDefault ?? undefined,
                apiKey: undefined,
            });
        }

        setAliases(aliasResult || []);
        setLoading(false);
    }, [catchAllForm, domainId, sendingConfigForm, verificationForm]);

    useEffect(() => {
        if (open && domainId) {
            let active = true;
            Promise.resolve().then(() => {
                if (active) {
                    void loadConfig();
                }
            });
            return () => {
                active = false;
            };
        }
    }, [domainId, loadConfig, open]);

    const primarySendingConfig = useMemo(() => getPrimarySendingConfig(detail), [detail]);
    const mailboxOptions = useMemo(
        () => detail?.mailboxes.map((mailbox) => ({ value: mailbox.id, label: mailbox.address, disabled: mailbox.status !== 'ACTIVE' })) ?? [],
        [detail],
    );
    const activeMailboxOptions = useMemo(
        () => detail?.mailboxes.filter((mailbox) => mailbox.status === 'ACTIVE').map((mailbox) => ({ value: mailbox.id, label: mailbox.address })) ?? [],
        [detail],
    );
    const defaultAliasMailbox = activeMailboxOptions[0] ?? null;

    const refreshAfterMutation = useCallback(async () => {
        await loadConfig();
        await onUpdated();
    }, [loadConfig, onUpdated]);

    const handleRegenerateVerification = useCallback(async () => {
        if (!domainId) {
            return;
        }

        setSavingVerification(true);
        const result = await requestData(
            () => domainsContract.verify(domainId),
            '重新生成验证 Token 失败',
        );
        if (result) {
            message.success('已重新生成验证 Token');
            await refreshAfterMutation();
        }
        setSavingVerification(false);
    }, [domainId, refreshAfterMutation]);

    const handleSaveVerification = useCallback(async (values: VerificationFormValues) => {
        if (!domainId) {
            return;
        }

        setSavingVerification(true);
        const token = values.verificationToken?.trim();
        const result = await requestData(
            () => domainsContract.verify(domainId, token || undefined),
            '保存验证 Token 失败',
        );
        if (result) {
            message.success('验证 Token 已保存');
            await refreshAfterMutation();
        }
        setSavingVerification(false);
    }, [domainId, refreshAfterMutation]);

    const handleSaveCatchAll = useCallback(async (values: CatchAllFormValues) => {
        if (!domainId) {
            return;
        }

        setSavingCatchAll(true);
        const result = await requestData(
            () => domainsContract.saveCatchAll(domainId, {
                isCatchAllEnabled: values.isCatchAllEnabled,
                catchAllTargetMailboxId: values.isCatchAllEnabled ? (values.catchAllTargetMailboxId ?? null) : null,
            }),
            '保存 Catch-all 配置失败',
        );
        if (result) {
            message.success('Catch-all 配置已保存');
            await refreshAfterMutation();
        }
        setSavingCatchAll(false);
    }, [domainId, refreshAfterMutation]);

    const handleSaveSendingConfig = useCallback(async (values: SendingConfigFormValues) => {
        if (!domainId) {
            return;
        }

        const apiKey = values.apiKey?.trim();
        if (!primarySendingConfig && !apiKey) {
            sendingConfigForm.setFields([{ name: 'apiKey', errors: ['首次创建发信配置时必须填写 Resend API Key'] }]);
            return;
        }

        setSavingSendingConfig(true);
        const result = await requestData(
            () => domainsContract.saveSendingConfig(domainId, {
                provider: 'RESEND',
                fromNameDefault: values.fromNameDefault?.trim() || null,
                replyToDefault: values.replyToDefault?.trim() || null,
                apiKey: apiKey || undefined,
            }),
            '保存发信配置失败',
        );
        if (result) {
            message.success('发信配置已保存');
            sendingConfigForm.setFieldsValue({ apiKey: undefined });
            await refreshAfterMutation();
        }
        setSavingSendingConfig(false);
    }, [domainId, primarySendingConfig, refreshAfterMutation, sendingConfigForm]);

    const openAliasModal = useCallback(() => {
        aliasForm.resetFields();
        aliasForm.setFieldsValue({ mailboxId: activeMailboxOptions[0]?.value });
        setAliasModalVisible(true);
    }, [activeMailboxOptions, aliasForm]);

    const handleCreateAlias = useCallback(async (values: AliasFormValues) => {
        const mailboxId = values.mailboxId;
        const aliasLocalPart = values.aliasLocalPart?.trim();
        if (!domainId || !mailboxId || !aliasLocalPart) {
            return;
        }

        setSavingAlias(true);
        const result = await requestData(
            () => domainsContract.createAlias(domainId, {
                mailboxId,
                aliasLocalPart,
            }),
            '新增 Alias 失败',
        );
        if (result) {
            message.success('Alias 已新增');
            setAliasModalVisible(false);
            aliasForm.resetFields();
            await loadConfig();
        }
        setSavingAlias(false);
    }, [aliasForm, domainId, loadConfig]);

    const handleToggleAlias = useCallback(async (record: DomainAliasRecord) => {
        if (!domainId) {
            return;
        }

        const nextStatus: DomainAliasRecord['status'] = record.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
        setTogglingAliasId(record.id);
        const result = await requestData(
            () => domainsContract.updateAlias(domainId, record.id, { status: nextStatus }),
            `${nextStatus === 'ACTIVE' ? '启用' : '停用'} Alias 失败`,
        );
        if (result) {
            message.success(`Alias 已${nextStatus === 'ACTIVE' ? '启用' : '停用'}`);
            await loadConfig();
        }
        setTogglingAliasId(null);
    }, [domainId, loadConfig]);

    const handleDeleteAlias = useCallback(async (record: DomainAliasRecord) => {
        if (!domainId) {
            return;
        }

        setDeletingAliasId(record.id);
        const result = await requestData(
            () => domainsContract.deleteAlias(domainId, record.id),
            '删除 Alias 失败',
        );
        if (result) {
            message.success('Alias 已删除');
            await loadConfig();
        }
        setDeletingAliasId(null);
    }, [domainId, loadConfig]);

    const handleClose = useCallback(() => {
        setAliasModalVisible(false);
        onCancel();
    }, [onCancel]);

    const aliasColumns: ColumnsType<DomainAliasRecord> = [
        { title: 'Alias 地址', dataIndex: 'aliasAddress', key: 'aliasAddress' },
        { title: '目标邮箱', key: 'mailbox', render: (_value, record) => record.mailbox?.address || record.mailboxId },
        { title: '状态', dataIndex: 'status', key: 'status', render: (value: DomainAliasRecord['status']) => <Tag color={aliasStatusColor[value]}>{value}</Tag> },
        {
            title: '操作',
            key: 'actions',
            render: (_value, record) => (
                <Space wrap>
                    <Button loading={togglingAliasId === record.id} onClick={() => void handleToggleAlias(record)}>
                        {record.status === 'ACTIVE' ? '停用' : '启用'}
                    </Button>
                    <Button danger loading={deletingAliasId === record.id} onClick={() => void handleDeleteAlias(record)}>
                        删除
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <>
            <Modal
                title={`域名能力配置 · ${domainName || detail?.name || ''}`}
                open={open}
                onCancel={handleClose}
                footer={null}
                destroyOnHidden
                width={960}
            >
                {loading || !detail ? (
                    <Text type="secondary">正在加载域名配置…</Text>
                ) : (
                    <Space orientation="vertical" size="large" style={domainConfigStyles.fullWidth}>
                        <Alert
                            showIcon
                            type="info"
                            title={`${detail.name} · ${detail.provider || 'hosted_internal'}`}
                            description={`收件 ${detail.inboundMessageCount} 条，发件 ${detail.outboundMessageCount} 条，邮箱 ${detail.mailboxes.length} 个，当前域名状态 ${detail.status}。`}
                        />

                        <Descriptions bordered size="small" column={2}>
                            <Descriptions.Item label="展示名">{detail.displayName || '-'}</Descriptions.Item>
                            <Descriptions.Item label="创建人">{detail.creator?.username || '-'}</Descriptions.Item>
                            <Descriptions.Item label="收件能力">{formatBooleanTag(detail.canReceive, '启用', '关闭')}</Descriptions.Item>
                            <Descriptions.Item label="发件能力">{formatBooleanTag(detail.canSend, '启用', '关闭', 'gold')}</Descriptions.Item>
                            <Descriptions.Item label="Catch-all">{formatBooleanTag(detail.isCatchAllEnabled, '启用', '关闭')}</Descriptions.Item>
                            <Descriptions.Item label="Resend Domain ID">{detail.resendDomainId || '-'}</Descriptions.Item>
                            <Descriptions.Item label="MX 配置">
                                {formatBooleanTag(Boolean(detail.dnsStatus?.expectedMxConfigured), '已声明', '待配置')}
                            </Descriptions.Item>
                            <Descriptions.Item label="Ingress 配置">
                                {formatBooleanTag(Boolean(detail.dnsStatus?.expectedIngressConfigured), '已声明', '待配置')}
                            </Descriptions.Item>
                        </Descriptions>

                        <div>
                            <Space align="center" style={domainConfigStyles.sectionActions}>
                                <Text strong>DNS Verify</Text>
                                <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
                                    刷新详情
                                </Button>
                            </Space>
                            <div style={marginBottom16Style} />
                            <Form form={verificationForm} layout="vertical" onFinish={handleSaveVerification}>
                                <Form.Item name="verificationToken" label="自定义验证 Token">
                                    <Input placeholder="留空后使用系统生成的 Token" />
                                </Form.Item>
                                <div style={domainConfigStyles.hint}>
                                    当前 Token：{detail.verificationToken || '尚未生成'}
                                </div>
                                <Space wrap>
                                    <Button type="primary" loading={savingVerification} htmlType="submit">
                                        保存验证 Token
                                    </Button>
                                    <Button loading={savingVerification} onClick={() => void handleRegenerateVerification()}>
                                        重新生成 Token
                                    </Button>
                                </Space>
                            </Form>
                        </div>

                        <div>
                            <Text strong>Catch-all</Text>
                            <div style={marginBottom16Style} />
                            <Form form={catchAllForm} layout="vertical" onFinish={handleSaveCatchAll}>
                                <Form.Item name="isCatchAllEnabled" label="启用 Catch-all" valuePropName="checked">
                                    <Switch aria-label="启用 catch-all" />
                                </Form.Item>
                                <Form.Item
                                    name="catchAllTargetMailboxId"
                                    label="Catch-all 目标邮箱"
                                    rules={[
                                        ({ getFieldValue }) => ({
                                            validator: async (_, value) => {
                                                if (!getFieldValue('isCatchAllEnabled') || value) {
                                                    return;
                                                }
                                                throw new Error('启用 Catch-all 时必须选择目标邮箱');
                                            },
                                        }),
                                    ]}
                                >
                                    <Select allowClear options={mailboxOptions} placeholder="请选择域名内的目标邮箱" />
                                </Form.Item>
                                <Space wrap>
                                    <Button type="primary" loading={savingCatchAll} htmlType="submit">
                                        保存 Catch-all
                                    </Button>
                                </Space>
                            </Form>
                        </div>

                        <div>
                            <Text strong>Sending Config</Text>
                            <div style={marginBottom16Style} />
                            {!detail.canSend ? (
                                <Alert
                                    showIcon
                                    type="warning"
                                    style={marginBottom16Style}
                                    title="当前域名未启用发件能力"
                                    description="只有允许发件的域名才能保存 Resend 配置。先在域名基础信息里开启 canSend，再回到这里补发信配置。"
                                />
                            ) : null}
                            <Form form={sendingConfigForm} layout="vertical" onFinish={handleSaveSendingConfig}>
                                <Form.Item label="Provider">
                                    <Input value="RESEND" disabled />
                                </Form.Item>
                                <Form.Item name="fromNameDefault" label="默认发件人名称">
                                    <Input placeholder="Operations Team" />
                                </Form.Item>
                                <Form.Item name="replyToDefault" label="默认 Reply-To">
                                    <Input placeholder="reply@example.com" />
                                </Form.Item>
                                <Form.Item name="apiKey" label={primarySendingConfig ? '更新 Resend API Key（可选）' : 'Resend API Key'}>
                                    <Input.Password placeholder={primarySendingConfig ? '留空则保留现有密钥' : '首次创建必须填写 API Key'} />
                                </Form.Item>
                                <div style={domainConfigStyles.hint}>
                                    {primarySendingConfig
                                        ? `当前已存在 ${primarySendingConfig.provider} 配置，状态 ${primarySendingConfig.status}。`
                                        : '当前域名还没有发信配置，首次创建需要填写 Resend API Key。'}
                                </div>
                                <Space wrap>
                                    <Button type="primary" loading={savingSendingConfig} htmlType="submit" disabled={!detail.canSend}>
                                        保存发信配置
                                    </Button>
                                </Space>
                            </Form>
                        </div>

                        <div>
                            <Space align="center" style={domainConfigStyles.sectionActions}>
                                <Text strong>Aliases</Text>
                                <Button type="primary" icon={<PlusOutlined />} onClick={openAliasModal} disabled={activeMailboxOptions.length === 0}>
                                    新增 Alias
                                </Button>
                            </Space>
                            <div style={marginBottom16Style} />
                            {aliases.length === 0 ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Alias" />
                            ) : (
                                <Table rowKey="id" columns={aliasColumns} dataSource={aliases} pagination={false} />
                            )}
                        </div>
                    </Space>
                )}
            </Modal>

            <Modal
                title={`新增 Alias · ${domainName || detail?.name || ''}`}
                open={aliasModalVisible}
                onCancel={() => setAliasModalVisible(false)}
                onOk={() => aliasForm.submit()}
                confirmLoading={savingAlias}
                destroyOnHidden
            >
                <Form form={aliasForm} layout="vertical" onFinish={handleCreateAlias}>
                    {activeMailboxOptions.length === 1 ? (
                        <>
                            <Form.Item label="目标邮箱">
                                <Input value={defaultAliasMailbox?.label} disabled />
                            </Form.Item>
                            <Form.Item name="mailboxId" initialValue={defaultAliasMailbox?.value} hidden>
                                <Input />
                            </Form.Item>
                        </>
                    ) : (
                        <Form.Item name="mailboxId" label="目标邮箱" rules={[{ required: true, message: '请选择 Alias 的目标邮箱' }]}>
                            <Select options={activeMailboxOptions} placeholder="请选择目标邮箱" />
                        </Form.Item>
                    )}
                    <Form.Item name="aliasLocalPart" label="Alias 本地部分" rules={[{ required: true, message: '请输入 Alias 本地部分' }]}>
                        <Input placeholder="support" />
                    </Form.Item>
                    {detail?.name ? <div style={domainConfigStyles.hint}>将自动拼接为 `{`<local-part>@${detail.name}`}`。</div> : null}
                </Form>
            </Modal>
        </>
    );
}

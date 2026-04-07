import { useCallback, useEffect, useState, type FC } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { domainsContract } from '../../contracts/admin/domains';
import { fontSize12Style, marginBottom16Style } from '../../styles/common';
import { requestData } from '../../utils/request';
import DomainConfigModal from './DomainConfigModal';

interface DomainRecord {
    id: number;
    name: string;
    displayName?: string | null;
    status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'ERROR';
    canReceive: boolean;
    canSend: boolean;
    mailboxCount?: number;
}

const statusColor: Record<string, string> = {
    PENDING: 'processing',
    ACTIVE: 'success',
    DISABLED: 'default',
    ERROR: 'error',
};

const domainStyles = {
    sendHint: { marginTop: -8, marginBottom: 8, color: '#8c8c8c', fontSize: fontSize12Style.fontSize },
} as const;

const DomainsPage: FC = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [domains, setDomains] = useState<DomainRecord[]>([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingDomain, setEditingDomain] = useState<DomainRecord | null>(null);
    const [configDomain, setConfigDomain] = useState<DomainRecord | null>(null);
    const [form] = Form.useForm();

    const loadDomains = useCallback(async () => {
        setLoading(true);
        const result = await requestData<{ list: DomainRecord[] }>(() => domainsContract.getList({ page: 1, pageSize: 100 }), '获取域名列表失败');
        if (result) {
            setDomains(result.list);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        let active = true;
        Promise.resolve().then(() => {
            if (active) {
                void loadDomains();
            }
        });
        return () => {
            active = false;
        };
    }, [loadDomains]);

    const openCreateModal = () => {
        setEditingDomain(null);
        form.resetFields();
        form.setFieldsValue({ canReceive: true, canSend: false });
        setModalVisible(true);
    };

    const openEditModal = (record: DomainRecord) => {
        setEditingDomain(record);
        form.setFieldsValue(record);
        setModalVisible(true);
    };

    const openConfigModal = (record: DomainRecord) => {
        setConfigDomain(record);
    };

    const handleSubmit = async (values: Record<string, unknown>) => {
        setSaving(true);
        const action = editingDomain
            ? domainsContract.update(editingDomain.id, values as { displayName?: string | null; status?: string; canReceive?: boolean; canSend?: boolean })
            : domainsContract.create(values as { name: string; displayName?: string; canReceive?: boolean; canSend?: boolean });

        const result = await requestData(() => action, editingDomain ? '更新域名失败' : '创建域名失败');
        if (result) {
            setModalVisible(false);
            await loadDomains();
        }
        setSaving(false);
    };

    const setDomainStatus = async (record: DomainRecord, status: DomainRecord['status']) => {
        const result = await requestData(() => domainsContract.update(record.id, { status }), `${status === 'ACTIVE' ? '激活' : '更新'}域名失败`);
        if (result) {
            await loadDomains();
        }
    };

    const columns: ColumnsType<DomainRecord> = [
        { title: '域名', dataIndex: 'name', key: 'name' },
        { title: '展示名', dataIndex: 'displayName', key: 'displayName', render: (value) => value || '-' },
        { title: '状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={statusColor[value] || 'default'}>{value}</Tag> },
        { title: '收件', dataIndex: 'canReceive', key: 'canReceive', render: (value: boolean) => value ? <Tag color="green">启用</Tag> : <Tag>关闭</Tag> },
        { title: '发件', dataIndex: 'canSend', key: 'canSend', render: (value: boolean) => value ? <Tag color="gold">启用</Tag> : <Tag>关闭</Tag> },
        { title: '邮箱数', dataIndex: 'mailboxCount', key: 'mailboxCount', render: (value) => value || 0 },
        {
            title: '动作',
            key: 'actions',
            render: (_, record) => (
                <Space wrap>
                    <Button onClick={() => openEditModal(record)}>编辑</Button>
                    <Button icon={<SettingOutlined />} onClick={() => openConfigModal(record)}>配置</Button>
                    {record.status !== 'ACTIVE' ? (
                        <Button type="primary" onClick={() => void setDomainStatus(record, 'ACTIVE')}>激活</Button>
                    ) : (
                        <Button onClick={() => void setDomainStatus(record, 'DISABLED')}>停用</Button>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title="域名"
                subtitle="这里负责域名基础状态与 hosted_internal 能力配置；域名邮箱、门户用户、域名消息和发信历史仍保持独立页面。"
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新增域名</Button>}
            />
            <Alert
                showIcon
                type="info"
                style={marginBottom16Style}
                title="是否允许某个域名开启发件能力，最终由服务端环境变量 SEND_ENABLED_DOMAINS 控制。未列入允许名单的域名会保持收件专用。"
            />
            <SurfaceCard>
                <Table rowKey="id" loading={loading} columns={columns} dataSource={domains} pagination={false} />
            </SurfaceCard>
            <Modal
                title={editingDomain ? '编辑域名' : '新增域名'}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                onOk={() => form.submit()}
                confirmLoading={saving}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    {!editingDomain ? (
                        <Form.Item name="name" label="域名" rules={[{ required: true, message: '请输入域名' }]}>
                            <Input placeholder="example.com" />
                        </Form.Item>
                    ) : null}
                    <Form.Item name="displayName" label="展示名">
                        <Input placeholder="业务域名" />
                    </Form.Item>
                    {editingDomain ? (
                        <Form.Item name="status" label="状态">
                            <Select options={[
                                { value: 'PENDING', label: 'PENDING' },
                                { value: 'ACTIVE', label: 'ACTIVE' },
                                { value: 'DISABLED', label: 'DISABLED' },
                                { value: 'ERROR', label: 'ERROR' },
                            ]} />
                        </Form.Item>
                    ) : null}
                    <Form.Item name="canReceive" label="允许收件" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="canSend" label="允许发件" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <div style={domainStyles.sendHint}>
                        只有服务端 `SEND_ENABLED_DOMAINS` 中列出的域名才能保存为“允许发件”。
                    </div>
                </Form>
            </Modal>
            <DomainConfigModal
                open={Boolean(configDomain)}
                domainId={configDomain?.id ?? null}
                domainName={configDomain?.name}
                onCancel={() => setConfigDomain(null)}
                onUpdated={loadDomains}
            />
        </div>
    );
};

export default DomainsPage;

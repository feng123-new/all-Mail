import { useCallback, useEffect, useState, type FC } from 'react';
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
    Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { adminsContract } from '../../contracts/admin/admins';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { useAuthStore } from '../../stores/authStore';
import { getAdminRoleLabel, getAdminStatusLabel, isSuperAdmin, normalizeAdminStatus } from '../../utils/auth';
import { getErrorMessage } from '../../utils/error';
import { requestData } from '../../utils/request';
import dayjs from 'dayjs';

interface Admin {
    id: number;
    username: string;
    email: string | null;
    role: 'SUPER_ADMIN' | 'ADMIN';
    status: 'ACTIVE' | 'DISABLED';
    twoFactorEnabled: boolean;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    createdAt: string;
}

interface AdminListResult {
    list: Admin[];
    total: number;
}

const adminsPageI18n = {
    fetchFailed: defineMessage('admins.fetchFailed', '获取数据失败', 'Failed to load admin data'),
    deleteSuccess: defineMessage('admins.deleteSuccess', '删除成功', 'Deleted successfully'),
    deleteFailed: defineMessage('admins.deleteFailed', '删除失败', 'Delete failed'),
    updateSuccess: defineMessage('admins.updateSuccess', '更新成功', 'Updated successfully'),
    createSuccess: defineMessage('admins.createSuccess', '创建成功', 'Created successfully'),
    saveFailed: defineMessage('admins.saveFailed', '保存失败', 'Save failed'),
    email: defineMessage('admins.email', '邮箱', 'Email'),
    enabled: defineMessage('admins.enabled', '已启用', 'Enabled'),
    disabled: defineMessage('admins.disabled', '未启用', 'Disabled'),
    ipAddress: defineMessage('admins.ipAddress', 'IP：{value}', 'IP: {value}'),
    unknown: defineMessage('admins.unknown', '未知', 'Unknown'),
    usernameRequired: defineMessage('admins.usernameRequired', '请输入用户名', 'Enter a username'),
    usernameMinLength: defineMessage('admins.usernameMinLength', '用户名至少 3 个字符', 'Username must be at least 3 characters'),
    password: defineMessage('admins.password', '密码', 'Password'),
    passwordRequired: defineMessage('admins.passwordRequired', '请输入密码', 'Enter a password'),
    passwordMinLength: defineMessage('admins.passwordMinLength', '密码至少 8 个字符', 'Password must be at least 8 characters'),
    keepPasswordEmpty: defineMessage('admins.keepPasswordEmpty', '留空则不修改密码', 'Leave blank to keep the current password'),
    optional: defineMessage('admins.optional', '可选', 'Optional'),
    admin: defineMessage('admins.role.admin', '管理员', 'Admin'),
    superAdmin: defineMessage('admins.role.superAdmin', '超级管理员', 'Super admin'),
    twoFactor: defineMessage('admins.twoFactor', '双重验证', 'Two-factor authentication'),
    twoFactorExtra: defineMessage('admins.twoFactorExtra', '启用双重验证需管理员本人在“设置”页完成绑定', 'Enabling two-factor authentication requires the admin to complete setup in Settings.'),
} as const;

const AdminsPage: FC = () => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<Admin[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingTwoFactorEnabled, setEditingTwoFactorEnabled] = useState(false);
    const [form] = Form.useForm();
    const { admin: currentAdmin } = useAuthStore();

    const fetchData = useCallback(async () => {
        setLoading(true);
        const result = await requestData<AdminListResult>(
            () => adminsContract.getList({ page, pageSize }),
            t(adminsPageI18n.fetchFailed)
        );
        if (result) {
            setData(result.list);
            setTotal(result.total);
        }
        setLoading(false);
    }, [page, pageSize, t]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchData();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [fetchData]);

    const handleCreate = () => {
        setEditingId(null);
        setEditingTwoFactorEnabled(false);
        form.resetFields();
        setModalVisible(true);
    };

    const handleEdit = (record: Admin) => {
        setEditingId(record.id);
        setEditingTwoFactorEnabled(record.twoFactorEnabled);
        form.setFieldsValue({
            username: record.username,
            email: record.email,
            role: record.role,
            status: record.status,
            twoFactorEnabled: record.twoFactorEnabled,
            password: '',
        });
        setModalVisible(true);
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await adminsContract.delete(id);
            if (res.code === 200) {
                message.success(t(adminsPageI18n.deleteSuccess));
                fetchData();
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, t(adminsPageI18n.deleteFailed)));
        }
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();

            if (editingId) {
                // 如果密码为空，不更新密码
                if (!values.password) {
                    delete values.password;
                }
                const res = await adminsContract.update(editingId, values);
                if (res.code === 200) {
                    message.success(t(adminsPageI18n.updateSuccess));
                    setModalVisible(false);
                    fetchData();
                }
            } else {
                const res = await adminsContract.create(values);
                if (res.code === 200) {
                    message.success(t(adminsPageI18n.createSuccess));
                    setModalVisible(false);
                    fetchData();
                }
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, t(adminsPageI18n.saveFailed)));
        }
    };

    const columns: ColumnsType<Admin> = [
        {
            title: t(adminI18n.admins.username),
            dataIndex: 'username',
            key: 'username',
        },
        {
            title: t(adminsPageI18n.email),
            dataIndex: 'email',
            key: 'email',
            render: (val) => val || '-',
        },
        {
            title: t(adminI18n.admins.role),
            dataIndex: 'role',
            key: 'role',
            render: (role) => (
                <Tag color={isSuperAdmin(role) ? 'gold' : 'blue'}>
                    {t(getAdminRoleLabel(role))}
                </Tag>
            ),
        },
        {
            title: t(adminI18n.common.status),
            dataIndex: 'status',
            key: 'status',
            render: (status) => (
                <Tag color={normalizeAdminStatus(status) === 'ACTIVE' ? 'green' : 'red'}>
                    {t(getAdminStatusLabel(status))}
                </Tag>
            ),
        },
        {
            title: t(adminI18n.admins.twoFactor),
            dataIndex: 'twoFactorEnabled',
            key: 'twoFactorEnabled',
            render: (enabled: boolean) => (
                <Tag color={enabled ? 'green' : 'default'}>
                    {enabled ? t(adminsPageI18n.enabled) : t(adminsPageI18n.disabled)}
                </Tag>
            ),
        },
        {
            title: t(adminI18n.admins.lastLogin),
            dataIndex: 'lastLoginAt',
            key: 'lastLoginAt',
            render: (val, record) =>
                val ? (
                    <Tooltip title={t(adminsPageI18n.ipAddress, { value: record.lastLoginIp || t(adminsPageI18n.unknown) })}>
                        {dayjs(val).format('YYYY-MM-DD HH:mm')}
                    </Tooltip>
                ) : (
                    '-'
                ),
        },
        {
            title: t(adminI18n.common.createdAt),
            dataIndex: 'createdAt',
            key: 'createdAt',
            render: (val) => dayjs(val).format('YYYY-MM-DD HH:mm'),
        },
        {
            title: t(adminI18n.common.actions),
            key: 'action',
            width: 120,
            render: (_, record) => (
                <Space>
                    <Tooltip title={t(adminI18n.common.edit)}>
                        <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                        />
                    </Tooltip>
                    {record.id !== currentAdmin?.id && (
                        <Tooltip title={t(adminI18n.common.remove)}>
                            <Popconfirm
                                title={t(adminI18n.admins.addDeleteConfirm)}
                                onConfirm={() => handleDelete(record.id)}
                            >
                                <Button type="text" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                        </Tooltip>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t(adminI18n.admins.title)}
                subtitle={t(adminI18n.admins.subtitle)}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>{t(adminI18n.admins.add)}</Button>}
            />

            <SurfaceCard>
                <Table
                    columns={columns}
                    dataSource={data}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        showTotal: (total) => t(adminI18n.common.totalCount, { count: total }),
                        onChange: (p, ps) => {
                            setPage(p);
                            setPageSize(ps);
                        },
                    }}
                />
            </SurfaceCard>

            <Modal
                title={editingId ? t(adminI18n.admins.edit) : t(adminI18n.admins.add)}
                open={modalVisible}
                onOk={handleSubmit}
                onCancel={() => setModalVisible(false)}
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="username"
                        label={t(adminI18n.admins.username)}
                        rules={[
                            { required: true, message: t(adminsPageI18n.usernameRequired) },
                            { min: 3, message: t(adminsPageI18n.usernameMinLength) },
                        ]}
                    >
                        <Input placeholder={t(adminsPageI18n.usernameRequired)} />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label={t(adminsPageI18n.password)}
                        rules={
                            editingId
                                ? []
                                : [
                                    { required: true, message: t(adminsPageI18n.passwordRequired) },
                                    { min: 8, message: t(adminsPageI18n.passwordMinLength) },
                                ]
                        }
                    >
                        <Input.Password
                            placeholder={editingId ? t(adminsPageI18n.keepPasswordEmpty) : t(adminsPageI18n.passwordRequired)}
                        />
                    </Form.Item>
                    <Form.Item name="email" label={t(adminsPageI18n.email)}>
                        <Input placeholder={t(adminsPageI18n.optional)} type="email" />
                    </Form.Item>
                    <Form.Item name="role" label={t(adminI18n.admins.role)} initialValue="ADMIN">
                        <Select>
                            <Select.Option value="ADMIN">{t(adminsPageI18n.admin)}</Select.Option>
                            <Select.Option value="SUPER_ADMIN">{t(adminsPageI18n.superAdmin)}</Select.Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="status" label={t(adminI18n.common.status)} initialValue="ACTIVE">
                        <Select>
                            <Select.Option value="ACTIVE">{t(adminsPageI18n.enabled)}</Select.Option>
                            <Select.Option value="DISABLED">{t(adminI18n.common.disabled)}</Select.Option>
                        </Select>
                    </Form.Item>
                    {editingId && (
                        <Form.Item
                            name="twoFactorEnabled"
                            label={t(adminsPageI18n.twoFactor)}
                            extra={!editingTwoFactorEnabled ? t(adminsPageI18n.twoFactorExtra) : undefined}
                        >
                            <Select>
                                <Select.Option value={true} disabled={!editingTwoFactorEnabled}>{t(adminsPageI18n.enabled)}</Select.Option>
                                <Select.Option value={false}>{t(adminsPageI18n.disabled)}</Select.Option>
                            </Select>
                        </Form.Item>
                    )}
                </Form>
            </Modal>
        </div>
    );
};

export default AdminsPage;

import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, LoginOutlined, PlusOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { mailboxUsersContract } from '../../contracts/admin/mailboxUsers';
import { requestData } from '../../utils/request';

interface UserRecord {
    id: number;
    username: string;
    email?: string | null;
    status: 'ACTIVE' | 'DISABLED';
    mustChangePassword: boolean;
    mailboxCount?: number;
}

interface MailboxOption {
    id: number;
    address: string;
}

interface MailboxUserFormValues {
	portalUsername?: string;
	contactEmail?: string;
	portalPassword?: string;
	status?: 'ACTIVE' | 'DISABLED';
	mailboxIds?: number[];
}

interface MailboxUserDetail {
	id: number;
	email?: string | null;
	status: 'ACTIVE' | 'DISABLED';
	memberships: Array<{
		mailbox: {
			id: number;
		};
	}>;
}

const PORTAL_LOGIN_PREFILL_PREFIX = 'all-mail:portal-login:';
const PORTAL_LOGIN_PREFILL_TTL_MS = 10 * 60 * 1000;

const MailboxUsersPage: FC = () => {
    const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [detailLoading, setDetailLoading] = useState(false);
	const [users, setUsers] = useState<UserRecord[]>([]);
    const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [editing, setEditing] = useState<UserRecord | null>(null);
    const [form] = Form.useForm<MailboxUserFormValues>();
	const isMountedRef = useRef(true);

	useEffect(() => () => {
		isMountedRef.current = false;
	}, []);

	const portalBaseUrl = useMemo(() => {
		if (!globalThis.location?.origin) {
			return '/mail/login';
		}
		return `${globalThis.location.origin}/mail/login`;
	}, []);

    const savePortalCredentialPrefill = useCallback((username: string, password?: string) => {
        const normalizedPassword = password?.trim();
        if (!normalizedPassword) {
            return;
        }

		globalThis.localStorage?.setItem(
			`${PORTAL_LOGIN_PREFILL_PREFIX}${username}`,
			JSON.stringify({
				password: normalizedPassword,
                expiresAt: Date.now() + PORTAL_LOGIN_PREFILL_TTL_MS,
            })
        );
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [userResult, mailboxResult] = await Promise.all([
            requestData<{ list: UserRecord[] }>(() => mailboxUsersContract.getUsers({ page: 1, pageSize: 100 }), '获取邮箱用户失败'),
            requestData<{ list: MailboxOption[] }>(() => mailboxUsersContract.getMailboxes({ page: 1, pageSize: 100 }), '获取域名邮箱失败', { silent: true }),
        ]);
		if (!isMountedRef.current) {
			return;
		}
        if (userResult) setUsers(userResult.list);
        if (mailboxResult) setMailboxes(mailboxResult.list);
        setLoading(false);
    }, []);

	useEffect(() => {
		const timer = setTimeout(() => {
			void loadData();
		}, 0);
		return () => clearTimeout(timer);
	}, [loadData]);

	const openModal = (record?: UserRecord) => {
		setEditing(record || null);
		setDetailLoading(false);
		form.resetFields();
		if (record) {
			form.setFieldsValue({
				contactEmail: record.email ?? undefined,
				status: record.status,
				mailboxIds: [],
				portalPassword: undefined,
			});
			setDetailLoading(true);
			void (async () => {
				const detail = await requestData<MailboxUserDetail>(
					() => mailboxUsersContract.getById(record.id),
					`获取门户用户 ${record.username} 详情失败`,
				);
				if (!isMountedRef.current) {
					return;
				}
				if (detail) {
					form.setFieldsValue({
						contactEmail: detail.email ?? undefined,
						status: detail.status,
						mailboxIds: detail.memberships.map((item) => item.mailbox.id),
						portalPassword: undefined,
					});
				}
				setDetailLoading(false);
			})();
		} else {
			form.setFieldsValue({
				portalUsername: undefined,
                contactEmail: undefined,
                portalPassword: undefined,
                status: 'ACTIVE',
                mailboxIds: [],
            });
        }
        setModalVisible(true);
    };

    const buildPortalLoginUrl = useCallback((record: UserRecord) => {
        const params = new URLSearchParams({ username: record.username });
        return `${portalBaseUrl}?${params.toString()}`;
    }, [portalBaseUrl]);

	const handleOpenPortal = useCallback((record: UserRecord) => {
		globalThis.open?.(buildPortalLoginUrl(record), '_blank', 'noopener,noreferrer');
	}, [buildPortalLoginUrl]);

	const handleCopyPortalLink = useCallback(async (record: UserRecord) => {
		const loginUrl = buildPortalLoginUrl(record);
		try {
			await globalThis.navigator?.clipboard?.writeText(loginUrl);
			message.success(`已复制 ${record.username} 的门户登录链接`);
		} catch {
			message.error('复制门户链接失败，请手动打开');
        }
    }, [buildPortalLoginUrl]);

    const handleSubmit = async (values: MailboxUserFormValues) => {
        setSaving(true);

        const username = editing?.username ?? values.portalUsername?.trim() ?? '';
        const payload = {
            ...(editing ? {} : { username }),
            email: values.contactEmail?.trim() || undefined,
            password: values.portalPassword?.trim() || undefined,
            ...(editing && values.portalPassword?.trim() ? { mustChangePassword: true } : {}),
            status: values.status,
            mailboxIds: values.mailboxIds || [],
        };

        const action = editing
            ? mailboxUsersContract.update(editing.id, payload)
            : mailboxUsersContract.create(payload);

        const result = await requestData(() => action, editing ? '更新邮箱用户失败' : '创建邮箱用户失败');
        if (result) {
            savePortalCredentialPrefill(username, values.portalPassword);
            setModalVisible(false);
            await loadData();
        }
        setSaving(false);
    };

    const handleDelete = async (record: UserRecord) => {
        const result = await requestData(
            () => mailboxUsersContract.delete(record.id),
            `删除门户用户 ${record.username} 失败`
        );
		if (result) {
			globalThis.localStorage?.removeItem(`${PORTAL_LOGIN_PREFILL_PREFIX}${record.username}`);
			message.success(`已删除门户用户 ${record.username}`);
			await loadData();
		}
    };

    const columns: ColumnsType<UserRecord> = [
        {
            title: '门户用户名',
            dataIndex: 'username',
            key: 'username',
            render: (value: string) => <Tag color="blue">{value}</Tag>,
        },
        { title: '联系邮箱', dataIndex: 'email', key: 'email', render: (value) => value || '-' },
        { title: '状态', dataIndex: 'status', key: 'status' },
        { title: '必须改密', dataIndex: 'mustChangePassword', key: 'mustChangePassword', render: (value: boolean) => value ? '是' : '否' },
        { title: '邮箱数', dataIndex: 'mailboxCount', key: 'mailboxCount' },
        {
            title: '门户入口',
            key: 'portalLink',
            width: 260,
            render: (_value, record) => (
                <Space wrap>
                    <Tooltip title="打开门户登录页，并默认填入门户用户名；如果你刚刚重置过密码，也会短时自动带入这次新密码。">
                        <Button icon={<LoginOutlined />} onClick={() => handleOpenPortal(record)}>
                            门户登录
                        </Button>
                    </Tooltip>
                    <Tooltip title="复制门户登录链接，方便发给用户自己登录">
                        <Button icon={<CopyOutlined />} onClick={() => void handleCopyPortalLink(record)}>
                            复制链接
                        </Button>
                    </Tooltip>
                </Space>
            ),
        },
        {
            title: '动作',
            key: 'actions',
            render: (_value, record) => (
                <Space wrap>
                    <Button onClick={() => openModal(record)}>编辑</Button>
                    <Popconfirm
                        title={`确定删除门户用户 ${record.username} 吗？`}
                        description="会自动解除该用户和域名邮箱的负责人/成员关系。"
                        onConfirm={() => void handleDelete(record)}
                    >
                        <Button danger>删除</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title="门户用户"
                subtitle="这里统一管理门户登录用户、初始密码和邮箱访问范围；你可以直接打开门户登录页，默认填入门户用户名，刚刚修改过的门户密码也会短时自动带入。"
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增门户用户</Button>}
            />
            <SurfaceCard>
                <Table rowKey="id" loading={loading} columns={columns} dataSource={users} pagination={false} />
            </SurfaceCard>
		<Modal title={editing ? '编辑门户用户' : '新增门户用户'} open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} confirmLoading={saving || detailLoading} destroyOnHidden>
				<Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
                    {!editing ? (
                        <Form.Item name="portalUsername" label="门户用户名" rules={[{ required: true, message: '请输入门户用户名' }]}>
                            <Input placeholder="例如：wangheng" autoComplete="off" />
                        </Form.Item>
                    ) : null}
                    <Form.Item
                        name="contactEmail"
                        label="联系邮箱"
                        rules={[{ type: 'email', message: '请输入有效邮箱地址' }]}
                    >
                        <Input placeholder="可选，仅用于联系或找回，不作为默认登录名" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="portalPassword" label={editing ? '重置密码' : '门户密码'} rules={editing ? [] : [{ required: true, message: '请输入密码' }]}>
                        <Input.Password placeholder={editing ? '留空则不修改' : '至少 8 位'} autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item name="status" label="状态">
                        <Select options={[{ value: 'ACTIVE', label: 'ACTIVE' }, { value: 'DISABLED', label: 'DISABLED' }]} />
                    </Form.Item>
					<Form.Item name="mailboxIds" label="可访问邮箱">
						<Select mode="multiple" loading={detailLoading} options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
					</Form.Item>
				</Form>
			</Modal>
        </div>
    );
};

export default MailboxUsersPage;

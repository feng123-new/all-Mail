import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, LoginOutlined, PlusOutlined } from '@ant-design/icons';
import { PageHeader, SurfaceCard } from '../../components';
import { mailboxUsersContract } from '../../contracts/admin/mailboxUsers';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
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

const mailboxUsersI18n = {
    fetchUsersFailed: defineMessage('mailboxUsers.fetchUsersFailed', '获取邮箱用户失败', 'Failed to load portal users'),
    fetchMailboxesFailed: defineMessage('mailboxUsers.fetchMailboxesFailed', '获取域名邮箱失败', 'Failed to load domain mailboxes'),
    fetchUserDetailFailed: defineMessage('mailboxUsers.fetchUserDetailFailed', '获取门户用户 {username} 详情失败', 'Failed to load portal user details for {username}'),
    copiedPortalLink: defineMessage('mailboxUsers.copiedPortalLink', '已复制 {username} 的门户登录链接', 'Copied the portal login link for {username}'),
    copyPortalLinkFailed: defineMessage('mailboxUsers.copyPortalLinkFailed', '复制门户链接失败，请手动打开', 'Failed to copy the portal link. Open it manually.'),
    updateFailed: defineMessage('mailboxUsers.updateFailed', '更新邮箱用户失败', 'Failed to update the portal user'),
    createFailed: defineMessage('mailboxUsers.createFailed', '创建邮箱用户失败', 'Failed to create the portal user'),
    deleteFailed: defineMessage('mailboxUsers.deleteFailed', '删除门户用户 {username} 失败', 'Failed to delete portal user {username}'),
    deleted: defineMessage('mailboxUsers.deleted', '已删除门户用户 {username}', 'Deleted portal user {username}'),
    username: defineMessage('mailboxUsers.username', '门户用户名', 'Portal username'),
    contactEmail: defineMessage('mailboxUsers.contactEmail', '联系邮箱', 'Contact email'),
    status: defineMessage('mailboxUsers.status', '状态', 'Status'),
    mustChangePassword: defineMessage('mailboxUsers.mustChangePassword', '必须改密', 'Password reset required'),
    mailboxCount: defineMessage('mailboxUsers.mailboxCount', '邮箱数', 'Mailbox count'),
    portalEntry: defineMessage('mailboxUsers.portalEntry', '门户入口', 'Portal access'),
    openPortalHint: defineMessage('mailboxUsers.openPortalHint', '打开门户登录页，并默认填入门户用户名；如果你刚刚重置过密码，也会短时自动带入这次新密码。', 'Open the portal login page with the username prefilled. If you just reset the password, the new password is also prefilled briefly.'),
    portalLogin: defineMessage('mailboxUsers.portalLogin', '门户登录', 'Portal login'),
    copyLinkHint: defineMessage('mailboxUsers.copyLinkHint', '复制门户登录链接，方便发给用户自己登录', 'Copy the portal login link so the user can sign in directly.'),
    copyLink: defineMessage('mailboxUsers.copyLink', '复制链接', 'Copy link'),
    actions: defineMessage('mailboxUsers.actions', '动作', 'Actions'),
    edit: defineMessage('mailboxUsers.edit', '编辑', 'Edit'),
    deleteConfirm: defineMessage('mailboxUsers.deleteConfirm', '确定删除门户用户 {username} 吗？', 'Delete portal user {username}?'),
    deleteDescription: defineMessage('mailboxUsers.deleteDescription', '会自动解除该用户和域名邮箱的负责人/成员关系。', 'This also removes the user from domain-mailbox ownership and membership.'),
    delete: defineMessage('mailboxUsers.delete', '删除', 'Delete'),
    subtitle: defineMessage('mailboxUsers.subtitle', '这里统一管理门户登录用户、初始密码和邮箱访问范围；你可以直接打开门户登录页，默认填入门户用户名，刚刚修改过的门户密码也会短时自动带入。', 'Manage portal users, initial passwords, and mailbox access scope in one place. The portal login page can open with the username prefilled, and recently reset passwords are briefly prefilled too.'),
    editPortalUser: defineMessage('mailboxUsers.editPortalUser', '编辑门户用户', 'Edit portal user'),
    usernameRequired: defineMessage('mailboxUsers.usernameRequired', '请输入门户用户名', 'Enter the portal username'),
	usernameExample: defineMessage('mailboxUsers.usernameExample', '例如：portal-user-01', 'Example: portal-user-01'),
    validEmailRequired: defineMessage('mailboxUsers.validEmailRequired', '请输入有效邮箱地址', 'Enter a valid email address'),
    contactEmailPlaceholder: defineMessage('mailboxUsers.contactEmailPlaceholder', '可选，仅用于联系或找回，不作为默认登录名', 'Optional, only for contact or recovery. It is not used as the default login name.'),
    resetPassword: defineMessage('mailboxUsers.resetPassword', '重置密码', 'Reset password'),
    portalPassword: defineMessage('mailboxUsers.portalPassword', '门户密码', 'Portal password'),
    passwordRequired: defineMessage('mailboxUsers.passwordRequired', '请输入密码', 'Enter a password'),
    unchangedPassword: defineMessage('mailboxUsers.unchangedPassword', '留空则不修改', 'Leave blank to keep the current password'),
    minPasswordHint: defineMessage('mailboxUsers.minPasswordHint', '至少 8 位', 'At least 8 characters'),
    enabled: defineMessage('mailboxUsers.enabled', '已启用', 'Enabled'),
    disabled: defineMessage('mailboxUsers.disabled', '已停用', 'Disabled'),
    yes: defineMessage('mailboxUsers.yes', '是', 'Yes'),
    no: defineMessage('mailboxUsers.no', '否', 'No'),
    accessibleMailboxes: defineMessage('mailboxUsers.accessibleMailboxes', '可访问邮箱', 'Accessible mailboxes'),
} as const;

const MailboxUsersPage: FC = () => {
    const { t } = useI18n();
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
            requestData<{ list: UserRecord[] }>(() => mailboxUsersContract.getUsers({ page: 1, pageSize: 100 }), t(mailboxUsersI18n.fetchUsersFailed)),
            requestData<{ list: MailboxOption[] }>(() => mailboxUsersContract.getMailboxes({ page: 1, pageSize: 100 }), t(mailboxUsersI18n.fetchMailboxesFailed), { silent: true }),
        ]);
		if (!isMountedRef.current) {
			return;
		}
        if (userResult) setUsers(userResult.list);
        if (mailboxResult) setMailboxes(mailboxResult.list);
        setLoading(false);
    }, [t]);

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
                    t(mailboxUsersI18n.fetchUserDetailFailed, { username: record.username }),
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
			message.success(t(mailboxUsersI18n.copiedPortalLink, { username: record.username }));
		} catch {
			message.error(t(mailboxUsersI18n.copyPortalLinkFailed));
        }
    }, [buildPortalLoginUrl, t]);

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

        const result = await requestData(() => action, editing ? t(mailboxUsersI18n.updateFailed) : t(mailboxUsersI18n.createFailed));
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
            t(mailboxUsersI18n.deleteFailed, { username: record.username })
        );
		if (result) {
			globalThis.localStorage?.removeItem(`${PORTAL_LOGIN_PREFILL_PREFIX}${record.username}`);
			message.success(t(mailboxUsersI18n.deleted, { username: record.username }));
			await loadData();
		}
    };

    const columns: ColumnsType<UserRecord> = [
        {
            title: t(mailboxUsersI18n.username),
            dataIndex: 'username',
            key: 'username',
            render: (value: string) => <Tag color="blue">{value}</Tag>,
        },
        { title: t(mailboxUsersI18n.contactEmail), dataIndex: 'email', key: 'email', render: (value) => value || '-' },
        { title: t(mailboxUsersI18n.status), dataIndex: 'status', key: 'status', render: (value: UserRecord['status']) => value === 'ACTIVE' ? t(mailboxUsersI18n.enabled) : t(mailboxUsersI18n.disabled) },
        { title: t(mailboxUsersI18n.mustChangePassword), dataIndex: 'mustChangePassword', key: 'mustChangePassword', render: (value: boolean) => value ? t(mailboxUsersI18n.yes) : t(mailboxUsersI18n.no) },
        { title: t(mailboxUsersI18n.mailboxCount), dataIndex: 'mailboxCount', key: 'mailboxCount' },
        {
            title: t(mailboxUsersI18n.portalEntry),
            key: 'portalLink',
            width: 260,
            render: (_value, record) => (
                <Space wrap>
                    <Tooltip title={t(mailboxUsersI18n.openPortalHint)}>
                        <Button icon={<LoginOutlined />} onClick={() => handleOpenPortal(record)}>
                            {t(mailboxUsersI18n.portalLogin)}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t(mailboxUsersI18n.copyLinkHint)}>
                        <Button icon={<CopyOutlined />} onClick={() => void handleCopyPortalLink(record)}>
                            {t(mailboxUsersI18n.copyLink)}
                        </Button>
                    </Tooltip>
                </Space>
            ),
        },
        {
            title: t(mailboxUsersI18n.actions),
            key: 'actions',
            render: (_value, record) => (
                <Space wrap>
                    <Button onClick={() => openModal(record)}>{t(mailboxUsersI18n.edit)}</Button>
                    <Popconfirm
                        title={t(mailboxUsersI18n.deleteConfirm, { username: record.username })}
                        description={t(mailboxUsersI18n.deleteDescription)}
                        onConfirm={() => void handleDelete(record)}
                    >
                        <Button danger>{t(mailboxUsersI18n.delete)}</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
                <PageHeader
                    title={t(adminI18n.mailboxUsers.title)}
                    subtitle={t(mailboxUsersI18n.subtitle)}
                    extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>{t(adminI18n.mailboxUsers.addPortalUser)}</Button>}
                />
            <SurfaceCard>
                <Table rowKey="id" loading={loading} columns={columns} dataSource={users} pagination={false} />
            </SurfaceCard>
		<Modal title={editing ? t(mailboxUsersI18n.editPortalUser) : t(adminI18n.mailboxUsers.addPortalUser)} open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} confirmLoading={saving || detailLoading} destroyOnHidden>
				<Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
                    {!editing ? (
                        <Form.Item name="portalUsername" label={t(mailboxUsersI18n.username)} rules={[{ required: true, message: t(mailboxUsersI18n.usernameRequired) }]}> 
                            <Input placeholder={t(mailboxUsersI18n.usernameExample)} autoComplete="off" />
                        </Form.Item>
                    ) : null}
                    <Form.Item
                        name="contactEmail"
                        label={t(mailboxUsersI18n.contactEmail)}
                        rules={[{ type: 'email', message: t(mailboxUsersI18n.validEmailRequired) }]}
                    >
                        <Input placeholder={t(mailboxUsersI18n.contactEmailPlaceholder)} autoComplete="off" />
                    </Form.Item>
					<Form.Item name="portalPassword" label={editing ? t(mailboxUsersI18n.resetPassword) : t(mailboxUsersI18n.portalPassword)} rules={editing ? [] : [{ required: true, message: t(mailboxUsersI18n.passwordRequired) }]}> 
						<Input.Password placeholder={editing ? t(mailboxUsersI18n.unchangedPassword) : t(mailboxUsersI18n.minPasswordHint)} autoComplete="new-password" />
					</Form.Item>
					<Form.Item name="status" label={t(mailboxUsersI18n.status)}>
						<Select options={[{ value: 'ACTIVE', label: t(mailboxUsersI18n.enabled) }, { value: 'DISABLED', label: t(mailboxUsersI18n.disabled) }]} />
					</Form.Item>
					<Form.Item name="mailboxIds" label={t(mailboxUsersI18n.accessibleMailboxes)}>
						<Select mode="multiple" loading={detailLoading} options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
					</Form.Item>
				</Form>
			</Modal>
        </div>
    );
};

export default MailboxUsersPage;

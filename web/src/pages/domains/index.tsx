import {
	DeleteOutlined,
	PlusOutlined,
	SettingOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Form,
	Input,
	Modal,
	message,
	Popconfirm,
	Select,
	Space,
	Switch,
	Table,
	Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { type FC, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, SurfaceCard } from "../../components";
import { domainsContract } from "../../contracts/admin/domains";
import { useI18n } from "../../i18n";
import { defineMessage } from "../../i18n/messages";
import { fontSize12Style, marginBottom16Style } from "../../styles/common";
import { requestData } from "../../utils/request";
import DomainConfigModal from "./DomainConfigModal";

interface DomainRecord {
	id: number;
	name: string;
	displayName?: string | null;
	status: "PENDING" | "ACTIVE" | "DISABLED" | "ERROR";
	canReceive: boolean;
	canSend: boolean;
	mailboxCount?: number;
}

const statusColor: Record<string, string> = {
	PENDING: "processing",
	ACTIVE: "success",
	DISABLED: "default",
	ERROR: "error",
};

const domainStyles = {
	sendHint: {
		marginTop: -8,
		marginBottom: 8,
		color: "#8c8c8c",
		fontSize: fontSize12Style.fontSize,
	},
} as const;

const domainsI18n = {
	loadFailed: defineMessage(
		"domains.loadFailed",
		"获取域名列表失败",
		"Failed to load domains",
	),
	createFailed: defineMessage(
		"domains.createFailed",
		"创建域名失败",
		"Failed to create the domain",
	),
	updateFailed: defineMessage(
		"domains.updateFailed",
		"更新域名失败",
		"Failed to update the domain",
	),
	activateFailed: defineMessage(
		"domains.activateFailed",
		"激活域名失败",
		"Failed to activate the domain",
	),
	updateStatusFailed: defineMessage(
		"domains.updateStatusFailed",
		"更新域名失败",
		"Failed to update the domain",
	),
	pageTitle: defineMessage("domains.pageTitle", "域名", "Domains"),
	pageSubtitle: defineMessage(
		"domains.pageSubtitle",
		"这里负责域名基础状态与 hosted_internal 能力配置；域名邮箱、门户用户、域名消息和发信历史仍保持独立页面。",
		"This page owns the base domain state and hosted_internal capability settings; domain mailboxes, portal users, domain messages, and sending history remain on their own pages.",
	),
	addDomain: defineMessage("domains.addDomain", "新增域名", "Add domain"),
	sendEnabledDomainsHint: defineMessage(
		"domains.sendEnabledDomainsHint",
		"是否允许某个域名开启发件能力，最终由服务端环境变量 SEND_ENABLED_DOMAINS 控制。未列入允许名单的域名会保持收件专用。",
		"Whether a domain may enable sending is ultimately controlled by the server-side SEND_ENABLED_DOMAINS environment variable. Domains that are not on the allowlist remain inbound-only.",
	),
	columnDomain: defineMessage("domains.columnDomain", "域名", "Domain"),
	columnDisplayName: defineMessage(
		"domains.columnDisplayName",
		"展示名",
		"Display name",
	),
	columnStatus: defineMessage("domains.columnStatus", "状态", "Status"),
	columnReceive: defineMessage("domains.columnReceive", "收件", "Receive"),
	columnSend: defineMessage("domains.columnSend", "发件", "Send"),
	columnMailboxCount: defineMessage(
		"domains.columnMailboxCount",
		"邮箱数",
		"Mailbox count",
	),
	columnActions: defineMessage("domains.columnActions", "动作", "Actions"),
	enabled: defineMessage("domains.enabled", "启用", "Enabled"),
	disabled: defineMessage("domains.disabled", "关闭", "Disabled"),
	edit: defineMessage("domains.edit", "编辑", "Edit"),
	configure: defineMessage("domains.configure", "配置", "Configure"),
	activate: defineMessage("domains.activate", "激活", "Activate"),
	deactivate: defineMessage("domains.deactivate", "停用", "Disable"),
	delete: defineMessage("domains.delete", "删除", "Delete"),
	deleteConfirm: defineMessage(
		"domains.deleteConfirm",
		"确定删除域名 {domain} 吗？",
		"Delete domain {domain}?",
	),
	deleted: defineMessage(
		"domains.deleted",
		"已删除域名 {domain}",
		"Deleted domain {domain}",
	),
	deleteFailed: defineMessage(
		"domains.deleteFailed",
		"删除域名失败",
		"Failed to delete the domain",
	),
	onboardingTitle: defineMessage(
		"domains.onboardingTitle",
		"推荐接入顺序",
		"Recommended onboarding order",
	),
	onboardingBody: defineMessage(
		"domains.onboardingBody",
		"先创建域名，再进入“配置”完成 Cloudflare 校验；确认通过后创建第一个域名邮箱；如需收件汇总，回到配置页启用 Catch-all；如需发件，再补 Resend 配置。",
		"Create the domain first, then open Configure and complete Cloudflare validation. After that, create the first domain mailbox. If you need inbound aggregation, return to Configure and enable catch-all. If you need outbound mail, finish the Resend setup last.",
	),
	createMailbox: defineMessage(
		"domains.createMailbox",
		"新增邮箱",
		"Add mailbox",
	),
	openSendingConfigs: defineMessage(
		"domains.openSendingConfigs",
		"发信配置",
		"Sending config",
	),
	editDomainTitle: defineMessage(
		"domains.editDomainTitle",
		"编辑域名",
		"Edit domain",
	),
	createDomainTitle: defineMessage(
		"domains.createDomainTitle",
		"新增域名",
		"Create domain",
	),
	formDomainLabel: defineMessage("domains.formDomainLabel", "域名", "Domain"),
	formDomainRequired: defineMessage(
		"domains.formDomainRequired",
		"请输入域名",
		"Enter the domain name",
	),
	formDomainPlaceholder: defineMessage(
		"domains.formDomainPlaceholder",
		"example.com",
		"example.com",
	),
	formDisplayNameLabel: defineMessage(
		"domains.formDisplayNameLabel",
		"展示名",
		"Display name",
	),
	formDisplayNamePlaceholder: defineMessage(
		"domains.formDisplayNamePlaceholder",
		"业务域名",
		"Business domain",
	),
	canReceive: defineMessage(
		"domains.canReceive",
		"允许收件",
		"Allow inbound mail",
	),
	canSend: defineMessage("domains.canSend", "允许发件", "Allow outbound mail"),
	sendHint: defineMessage(
		"domains.sendHint",
		"只有服务端 `SEND_ENABLED_DOMAINS` 中列出的域名才能保存为“允许发件”。",
		"Only domains listed in the server-side `SEND_ENABLED_DOMAINS` setting can be saved as send-enabled.",
	),
	pending: defineMessage("domains.pending", "待验证", "Pending"),
	active: defineMessage("domains.active", "启用", "Active"),
	disabledText: defineMessage("domains.disabledText", "停用", "Disabled"),
	error: defineMessage("domains.error", "错误", "Error"),
} as const;

function getDomainStatusMessage(status: DomainRecord["status"]) {
	switch (status) {
		case "ACTIVE":
			return domainsI18n.active;
		case "DISABLED":
			return domainsI18n.disabledText;
		case "ERROR":
			return domainsI18n.error;
		default:
			return domainsI18n.pending;
	}
}

const DomainsPage: FC = () => {
	const { t } = useI18n();
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [domains, setDomains] = useState<DomainRecord[]>([]);
	const [modalVisible, setModalVisible] = useState(false);
	const [editingDomain, setEditingDomain] = useState<DomainRecord | null>(null);
	const [configDomain, setConfigDomain] = useState<DomainRecord | null>(null);
	const [deletingDomainId, setDeletingDomainId] = useState<number | null>(null);
	const [form] = Form.useForm();

	const loadDomains = useCallback(async () => {
		setLoading(true);
		const result = await requestData<{ list: DomainRecord[] }>(
			() => domainsContract.getList({ page: 1, pageSize: 100 }),
			domainsI18n.loadFailed,
		);
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
			? domainsContract.update(
					editingDomain.id,
					values as {
						displayName?: string | null;
						status?: string;
						canReceive?: boolean;
						canSend?: boolean;
					},
				)
			: domainsContract.create(
					values as {
						name: string;
						displayName?: string;
						canReceive?: boolean;
						canSend?: boolean;
					},
				);

		const result = await requestData(
			() => action,
			editingDomain ? domainsI18n.updateFailed : domainsI18n.createFailed,
		);
		if (result) {
			setModalVisible(false);
			await loadDomains();
		}
		setSaving(false);
	};

	const setDomainStatus = async (
		record: DomainRecord,
		status: DomainRecord["status"],
	) => {
		const result = await requestData(
			() => domainsContract.update(record.id, { status }),
			status === "ACTIVE"
				? domainsI18n.activateFailed
				: domainsI18n.updateStatusFailed,
		);
		if (result) {
			await loadDomains();
		}
	};

	const handleDelete = async (record: DomainRecord) => {
		setDeletingDomainId(record.id);
		const result = await requestData<{ success: boolean }>(
			() => domainsContract.delete(record.id),
			domainsI18n.deleteFailed,
		);
		if (result?.success) {
			message.success(t(domainsI18n.deleted, { domain: record.name }));
			await loadDomains();
		}
		setDeletingDomainId(null);
	};

	const columns: ColumnsType<DomainRecord> = [
		{
			title: t(domainsI18n.columnDomain),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t(domainsI18n.columnDisplayName),
			dataIndex: "displayName",
			key: "displayName",
			render: (value) => value || "-",
		},
		{
			title: t(domainsI18n.columnStatus),
			dataIndex: "status",
			key: "status",
			render: (value: DomainRecord["status"]) => (
				<Tag color={statusColor[value] || "default"}>
					{t(getDomainStatusMessage(value))}
				</Tag>
			),
		},
		{
			title: t(domainsI18n.columnReceive),
			dataIndex: "canReceive",
			key: "canReceive",
			render: (value: boolean) =>
				value ? (
					<Tag color="green">{t(domainsI18n.enabled)}</Tag>
				) : (
					<Tag>{t(domainsI18n.disabled)}</Tag>
				),
		},
		{
			title: t(domainsI18n.columnSend),
			dataIndex: "canSend",
			key: "canSend",
			render: (value: boolean) =>
				value ? (
					<Tag color="gold">{t(domainsI18n.enabled)}</Tag>
				) : (
					<Tag>{t(domainsI18n.disabled)}</Tag>
				),
		},
		{
			title: t(domainsI18n.columnMailboxCount),
			dataIndex: "mailboxCount",
			key: "mailboxCount",
			render: (value) => value || 0,
		},
		{
			title: t(domainsI18n.columnActions),
			key: "actions",
			render: (_, record) => (
				<Space wrap>
					<Button onClick={() => openEditModal(record)}>
						{t(domainsI18n.edit)}
					</Button>
					<Button
						icon={<SettingOutlined />}
						onClick={() => openConfigModal(record)}
					>
						{t(domainsI18n.configure)}
					</Button>
					<Button
						onClick={() =>
							navigate(`/domain-mailboxes?domainId=${record.id}&intent=create`)
						}
					>
						{t(domainsI18n.createMailbox)}
					</Button>
					{record.canSend ? (
						<Button onClick={() => navigate("/sending-configs")}>
							{t(domainsI18n.openSendingConfigs)}
						</Button>
					) : null}
					{record.status !== "ACTIVE" ? (
						<Button
							type="primary"
							onClick={() => void setDomainStatus(record, "ACTIVE")}
						>
							{t(domainsI18n.activate)}
						</Button>
					) : (
						<Button onClick={() => void setDomainStatus(record, "DISABLED")}>
							{t(domainsI18n.deactivate)}
						</Button>
					)}
					<Popconfirm
						title={t(domainsI18n.deleteConfirm, { domain: record.name })}
						description={t(
							defineMessage(
								"domains.deleteDescription",
								"如果域名仍有关联邮箱或域名消息，请先去“域名邮箱”与“域名消息”页面清理后再删除。",
								"If the domain still has linked mailboxes or domain messages, clear them from the Domain Mailboxes and Domain Messages pages before deleting it.",
							),
						)}
						onConfirm={() => void handleDelete(record)}
					>
						<Button
							danger
							icon={<DeleteOutlined />}
							loading={deletingDomainId === record.id}
						>
							{t(domainsI18n.delete)}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	];

	return (
		<div>
			<PageHeader
				title={t(domainsI18n.pageTitle)}
				subtitle={t(domainsI18n.pageSubtitle)}
				extra={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={openCreateModal}
					>
						{t(domainsI18n.addDomain)}
					</Button>
				}
			/>
			<Alert
				showIcon
				type="info"
				style={marginBottom16Style}
				title={t(domainsI18n.sendEnabledDomainsHint)}
			/>
			<Alert
				showIcon
				type="info"
				style={marginBottom16Style}
				title={t(domainsI18n.onboardingTitle)}
				description={t(domainsI18n.onboardingBody)}
			/>
			<SurfaceCard>
				<Table
					rowKey="id"
					loading={loading}
					columns={columns}
					dataSource={domains}
					pagination={false}
				/>
			</SurfaceCard>
			<Modal
				title={
					editingDomain
						? t(domainsI18n.editDomainTitle)
						: t(domainsI18n.createDomainTitle)
				}
				open={modalVisible}
				onCancel={() => setModalVisible(false)}
				onOk={() => form.submit()}
				confirmLoading={saving}
				destroyOnHidden
			>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					{!editingDomain ? (
						<Form.Item
							name="name"
							label={t(domainsI18n.formDomainLabel)}
							rules={[
								{
									required: true,
									message: t(domainsI18n.formDomainRequired),
								},
							]}
						>
							<Input placeholder={t(domainsI18n.formDomainPlaceholder)} />
						</Form.Item>
					) : null}
					<Form.Item
						name="displayName"
						label={t(domainsI18n.formDisplayNameLabel)}
					>
						<Input placeholder={t(domainsI18n.formDisplayNamePlaceholder)} />
					</Form.Item>
					{editingDomain ? (
						<Form.Item name="status" label={t(domainsI18n.columnStatus)}>
							<Select
								options={[
									{ value: "PENDING", label: t(domainsI18n.pending) },
									{ value: "ACTIVE", label: t(domainsI18n.active) },
									{ value: "DISABLED", label: t(domainsI18n.disabledText) },
									{ value: "ERROR", label: t(domainsI18n.error) },
								]}
							/>
						</Form.Item>
					) : null}
					<Form.Item
						name="canReceive"
						label={t(domainsI18n.canReceive)}
						valuePropName="checked"
					>
						<Switch />
					</Form.Item>
					<Form.Item
						name="canSend"
						label={t(domainsI18n.canSend)}
						valuePropName="checked"
					>
						<Switch />
					</Form.Item>
					<div style={domainStyles.sendHint}>{t(domainsI18n.sendHint)}</div>
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

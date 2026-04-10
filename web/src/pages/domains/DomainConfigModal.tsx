import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
	Alert,
	Button,
	Descriptions,
	Empty,
	Form,
	Input,
	Modal,
	message,
	Select,
	Space,
	Switch,
	Table,
	Tag,
	Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { domainsContract } from "../../contracts/admin/domains";
import { useI18n } from "../../i18n";
import { defineMessage } from "../../i18n/messages";
import { fullWidthStyle, marginBottom16Style } from "../../styles/common";
import { requestData } from "../../utils/request";

const { Text } = Typography;

const domainConfigModalI18n = {
	loadDomainFailed: defineMessage(
		"domainConfigModal.loadDomainFailed",
		"获取域名配置失败",
		"Failed to load domain configuration",
	),
	loadAliasesFailed: defineMessage(
		"domainConfigModal.loadAliasesFailed",
		"获取 Alias 列表失败",
		"Failed to load aliases",
	),
	regenerateTokenFailed: defineMessage(
		"domainConfigModal.regenerateTokenFailed",
		"重新生成验证 Token 失败",
		"Failed to regenerate the verification token",
	),
	saveTokenFailed: defineMessage(
		"domainConfigModal.saveTokenFailed",
		"保存验证 Token 失败",
		"Failed to save the verification token",
	),
	saveCatchAllFailed: defineMessage(
		"domainConfigModal.saveCatchAllFailed",
		"保存 Catch-all 配置失败",
		"Failed to save the catch-all configuration",
	),
	firstApiKeyRequiredError: defineMessage(
		"domainConfigModal.firstApiKeyRequiredError",
		"首次创建发信配置时必须填写 Resend API Key",
		"A Resend API key is required when creating the first sending configuration",
	),
	saveSendingFailed: defineMessage(
		"domainConfigModal.saveSendingFailed",
		"保存发信配置失败",
		"Failed to save the sending configuration",
	),
	createAliasFailed: defineMessage(
		"domainConfigModal.createAliasFailed",
		"新增 Alias 失败",
		"Failed to add the alias",
	),
	enableAliasFailed: defineMessage(
		"domainConfigModal.enableAliasFailed",
		"启用 Alias 失败",
		"Failed to enable the alias",
	),
	disableAliasFailed: defineMessage(
		"domainConfigModal.disableAliasFailed",
		"停用 Alias 失败",
		"Failed to disable the alias",
	),
	deleteAliasFailed: defineMessage(
		"domainConfigModal.deleteAliasFailed",
		"删除 Alias 失败",
		"Failed to delete the alias",
	),
	tokenRegenerated: defineMessage(
		"domainConfigModal.tokenRegenerated",
		"已重新生成验证 Token",
		"Verification token regenerated",
	),
	tokenSaved: defineMessage(
		"domainConfigModal.tokenSaved",
		"验证 Token 已保存",
		"Verification token saved",
	),
	catchAllSaved: defineMessage(
		"domainConfigModal.catchAllSaved",
		"Catch-all 配置已保存",
		"Catch-all configuration saved",
	),
	sendingSaved: defineMessage(
		"domainConfigModal.sendingSaved",
		"发信配置已保存",
		"Sending configuration saved",
	),
	aliasAdded: defineMessage(
		"domainConfigModal.aliasAdded",
		"Alias 已新增",
		"Alias added",
	),
	aliasEnabled: defineMessage(
		"domainConfigModal.aliasEnabled",
		"Alias 已启用",
		"Alias enabled",
	),
	aliasDisabled: defineMessage(
		"domainConfigModal.aliasDisabled",
		"Alias 已停用",
		"Alias disabled",
	),
	aliasDeleted: defineMessage(
		"domainConfigModal.aliasDeleted",
		"Alias 已删除",
		"Alias deleted",
	),
	active: defineMessage("domainConfigModal.active", "启用", "Active"),
	disabledText: defineMessage(
		"domainConfigModal.disabledText",
		"停用",
		"Disabled",
	),
	suspended: defineMessage("domainConfigModal.suspended", "暂停", "Suspended"),
	pendingStatus: defineMessage(
		"domainConfigModal.pendingStatus",
		"待验证",
		"Pending",
	),
	errorStatus: defineMessage("domainConfigModal.errorStatus", "错误", "Error"),
	hostedInternal: defineMessage(
		"domainConfigModal.hostedInternal",
		"Hosted Internal",
		"Hosted Internal",
	),
} as const;

interface DomainMailboxRecord {
	id: number;
	address: string;
	localPart: string;
	status: "ACTIVE" | "DISABLED" | "SUSPENDED";
	canLogin: boolean;
	isCatchAllTarget: boolean;
}

interface DomainSendingConfigRecord {
	id: number;
	provider: "RESEND";
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
	status: "PENDING" | "ACTIVE" | "DISABLED" | "ERROR";
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
	status: "ACTIVE" | "DISABLED";
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

const aliasStatusColor: Record<DomainAliasRecord["status"], string> = {
	ACTIVE: "success",
	DISABLED: "default",
};

const domainConfigStyles = {
	fullWidth: fullWidthStyle,
	hint: {
		marginTop: -8,
		marginBottom: 8,
		color: "rgba(0, 0, 0, 0.45)",
		fontSize: 12,
	},
	sectionActions: {
		justifyContent: "space-between",
		width: "100%",
	},
} as const;

function formatBooleanTag(
	value: boolean,
	trueLabel: string,
	falseLabel: string,
	trueColor = "success",
) {
	return (
		<Tag color={value ? trueColor : "default"}>
			{value ? trueLabel : falseLabel}
		</Tag>
	);
}

function getPrimarySendingConfig(
	detail: DomainDetailRecord | null,
): DomainSendingConfigRecord | null {
	return detail?.sendingConfigs[0] ?? null;
}

function getAliasStatusMessage(status: DomainAliasRecord["status"]) {
	switch (status) {
		case "ACTIVE":
			return domainConfigModalI18n.active;
		default:
			return domainConfigModalI18n.disabledText;
	}
}

function getDomainStatusMessage(status: DomainDetailRecord["status"]) {
	switch (status) {
		case "ACTIVE":
			return domainConfigModalI18n.active;
		case "DISABLED":
			return domainConfigModalI18n.disabledText;
		case "ERROR":
			return domainConfigModalI18n.errorStatus;
		default:
			return domainConfigModalI18n.pendingStatus;
	}
}

export default function DomainConfigModal({
	domainId,
	domainName,
	open,
	onCancel,
	onUpdated,
}: DomainConfigModalProps) {
	const { t } = useI18n();
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
			requestData<DomainDetailRecord>(
				() => domainsContract.getById<DomainDetailRecord>(domainId),
				domainConfigModalI18n.loadDomainFailed,
			),
			requestData<DomainAliasRecord[]>(
				() => domainsContract.getAliases<DomainAliasRecord>(domainId),
				domainConfigModalI18n.loadAliasesFailed,
			),
		]);

		if (detailResult) {
			setDetail(detailResult);
			verificationForm.setFieldsValue({
				verificationToken: detailResult.verificationToken ?? undefined,
			});
			catchAllForm.setFieldsValue({
				isCatchAllEnabled: detailResult.isCatchAllEnabled,
				catchAllTargetMailboxId:
					detailResult.catchAllTargetMailboxId ?? undefined,
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

	const primarySendingConfig = useMemo(
		() => getPrimarySendingConfig(detail),
		[detail],
	);
	const mailboxOptions = useMemo(
		() =>
			detail?.mailboxes.map((mailbox) => ({
				value: mailbox.id,
				label: mailbox.address,
				disabled: mailbox.status !== "ACTIVE",
			})) ?? [],
		[detail],
	);
	const activeMailboxOptions = useMemo(
		() =>
			detail?.mailboxes
				.filter((mailbox) => mailbox.status === "ACTIVE")
				.map((mailbox) => ({ value: mailbox.id, label: mailbox.address })) ??
			[],
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
			domainConfigModalI18n.regenerateTokenFailed,
		);
		if (result) {
			message.success(t(domainConfigModalI18n.tokenRegenerated));
			await refreshAfterMutation();
		}
		setSavingVerification(false);
	}, [domainId, refreshAfterMutation, t]);

	const handleSaveVerification = useCallback(
		async (values: VerificationFormValues) => {
			if (!domainId) {
				return;
			}

			setSavingVerification(true);
			const token = values.verificationToken?.trim();
			const result = await requestData(
				() => domainsContract.verify(domainId, token || undefined),
				domainConfigModalI18n.saveTokenFailed,
			);
			if (result) {
				message.success(t(domainConfigModalI18n.tokenSaved));
				await refreshAfterMutation();
			}
			setSavingVerification(false);
		},
		[domainId, refreshAfterMutation, t],
	);

	const handleSaveCatchAll = useCallback(
		async (values: CatchAllFormValues) => {
			if (!domainId) {
				return;
			}

			setSavingCatchAll(true);
			const result = await requestData(
				() =>
					domainsContract.saveCatchAll(domainId, {
						isCatchAllEnabled: values.isCatchAllEnabled,
						catchAllTargetMailboxId: values.isCatchAllEnabled
							? (values.catchAllTargetMailboxId ?? null)
							: null,
					}),
				domainConfigModalI18n.saveCatchAllFailed,
			);
			if (result) {
				message.success(t(domainConfigModalI18n.catchAllSaved));
				await refreshAfterMutation();
			}
			setSavingCatchAll(false);
		},
		[domainId, refreshAfterMutation, t],
	);

	const handleSaveSendingConfig = useCallback(
		async (values: SendingConfigFormValues) => {
			if (!domainId) {
				return;
			}

			const apiKey = values.apiKey?.trim();
			if (!primarySendingConfig && !apiKey) {
				sendingConfigForm.setFields([
					{
						name: "apiKey",
						errors: [t(domainConfigModalI18n.firstApiKeyRequiredError)],
					},
				]);
				return;
			}

			setSavingSendingConfig(true);
			const result = await requestData(
				() =>
					domainsContract.saveSendingConfig(domainId, {
						provider: "RESEND",
						fromNameDefault: values.fromNameDefault?.trim() || null,
						replyToDefault: values.replyToDefault?.trim() || null,
						apiKey: apiKey || undefined,
					}),
				domainConfigModalI18n.saveSendingFailed,
			);
			if (result) {
				message.success(t(domainConfigModalI18n.sendingSaved));
				sendingConfigForm.setFieldsValue({ apiKey: undefined });
				await refreshAfterMutation();
			}
			setSavingSendingConfig(false);
		},
		[
			domainId,
			primarySendingConfig,
			refreshAfterMutation,
			sendingConfigForm,
			t,
		],
	);

	const openAliasModal = useCallback(() => {
		aliasForm.resetFields();
		aliasForm.setFieldsValue({ mailboxId: activeMailboxOptions[0]?.value });
		setAliasModalVisible(true);
	}, [activeMailboxOptions, aliasForm]);

	const handleCreateAlias = useCallback(
		async (values: AliasFormValues) => {
			const mailboxId = values.mailboxId;
			const aliasLocalPart = values.aliasLocalPart?.trim();
			if (!domainId || !mailboxId || !aliasLocalPart) {
				return;
			}

			setSavingAlias(true);
			const result = await requestData(
				() =>
					domainsContract.createAlias(domainId, {
						mailboxId,
						aliasLocalPart,
					}),
				domainConfigModalI18n.createAliasFailed,
			);
			if (result) {
				message.success(t(domainConfigModalI18n.aliasAdded));
				setAliasModalVisible(false);
				aliasForm.resetFields();
				await loadConfig();
			}
			setSavingAlias(false);
		},
		[aliasForm, domainId, loadConfig, t],
	);

	const handleToggleAlias = useCallback(
		async (record: DomainAliasRecord) => {
			if (!domainId) {
				return;
			}

			const nextStatus: DomainAliasRecord["status"] =
				record.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
			setTogglingAliasId(record.id);
			const result = await requestData(
				() =>
					domainsContract.updateAlias(domainId, record.id, {
						status: nextStatus,
					}),
				nextStatus === "ACTIVE"
					? domainConfigModalI18n.enableAliasFailed
					: domainConfigModalI18n.disableAliasFailed,
			);
			if (result) {
				message.success(
					t(
						nextStatus === "ACTIVE"
							? domainConfigModalI18n.aliasEnabled
							: domainConfigModalI18n.aliasDisabled,
					),
				);
				await loadConfig();
			}
			setTogglingAliasId(null);
		},
		[domainId, loadConfig, t],
	);

	const handleDeleteAlias = useCallback(
		async (record: DomainAliasRecord) => {
			if (!domainId) {
				return;
			}

			setDeletingAliasId(record.id);
			const result = await requestData(
				() => domainsContract.deleteAlias(domainId, record.id),
				domainConfigModalI18n.deleteAliasFailed,
			);
			if (result) {
				message.success(t(domainConfigModalI18n.aliasDeleted));
				await loadConfig();
			}
			setDeletingAliasId(null);
		},
		[domainId, loadConfig, t],
	);

	const handleClose = useCallback(() => {
		setAliasModalVisible(false);
		onCancel();
	}, [onCancel]);

	const aliasColumns: ColumnsType<DomainAliasRecord> = [
		{
			title: t(
				defineMessage(
					"domainConfigModal.aliasAddressColumn",
					"Alias 地址",
					"Alias address",
				),
			),
			dataIndex: "aliasAddress",
			key: "aliasAddress",
		},
		{
			title: t(
				defineMessage(
					"domainConfigModal.targetMailboxColumn",
					"目标邮箱",
					"Target mailbox",
				),
			),
			key: "mailbox",
			render: (_value, record) => record.mailbox?.address || record.mailboxId,
		},
		{
			title: t(
				defineMessage("domainConfigModal.statusColumn", "状态", "Status"),
			),
			dataIndex: "status",
			key: "status",
			render: (value: DomainAliasRecord["status"]) => (
				<Tag color={aliasStatusColor[value]}>
					{t(getAliasStatusMessage(value))}
				</Tag>
			),
		},
		{
			title: t(
				defineMessage("domainConfigModal.actionsColumn", "操作", "Actions"),
			),
			key: "actions",
			render: (_value, record) => (
				<Space wrap>
					<Button
						loading={togglingAliasId === record.id}
						onClick={() => void handleToggleAlias(record)}
					>
						{record.status === "ACTIVE"
							? t(
									defineMessage(
										"domainConfigModal.disableAlias",
										"停用",
										"Disable",
									),
								)
							: t(
									defineMessage(
										"domainConfigModal.enableAlias",
										"启用",
										"Enable",
									),
								)}
					</Button>
					<Button
						danger
						loading={deletingAliasId === record.id}
						onClick={() => void handleDeleteAlias(record)}
					>
						{t(
							defineMessage("domainConfigModal.deleteAlias", "删除", "Delete"),
						)}
					</Button>
				</Space>
			),
		},
	];

	return (
		<>
			<Modal
				title={t(
					defineMessage(
						"domainConfigModal.title",
						"域名能力配置 · {name}",
						"Domain capability settings · {name}",
					),
					{ name: domainName || detail?.name || "" },
				)}
				open={open}
				onCancel={handleClose}
				footer={null}
				destroyOnHidden
				width={960}
			>
				{loading || !detail ? (
					<Text type="secondary">
						{t(
							defineMessage(
								"domainConfigModal.loading",
								"正在加载域名配置…",
								"Loading domain configuration…",
							),
						)}
					</Text>
				) : (
					<Space
						orientation="vertical"
						size="large"
						style={domainConfigStyles.fullWidth}
					>
						<Alert
							showIcon
							type="info"
							title={t(
								defineMessage(
									"domainConfigModal.summaryTitle",
									"{name} · {provider}",
									"{name} · {provider}",
								),
								{
									name: detail.name,
									provider:
										detail.provider || t(domainConfigModalI18n.hostedInternal),
								},
							)}
							description={t(
								defineMessage(
									"domainConfigModal.summaryDescription",
									"收件 {inboundCount} 条，发件 {outboundCount} 条，邮箱 {mailboxCount} 个，当前域名状态 {status}。",
									"{inboundCount} inbound, {outboundCount} outbound, {mailboxCount} mailboxes, current domain status {status}.",
								),
								{
									inboundCount: detail.inboundMessageCount,
									outboundCount: detail.outboundMessageCount,
									mailboxCount: detail.mailboxes.length,
									status: t(getDomainStatusMessage(detail.status)),
								},
							)}
						/>

						<Descriptions bordered size="small" column={2}>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.displayNameLabel",
										"展示名",
										"Display name",
									),
								)}
							>
								{detail.displayName || "-"}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.creatorLabel",
										"创建人",
										"Creator",
									),
								)}
							>
								{detail.creator?.username || "-"}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.receiveCapabilityLabel",
										"收件能力",
										"Inbound capability",
									),
								)}
							>
								{formatBooleanTag(
									detail.canReceive,
									t(
										defineMessage(
											"domainConfigModal.enabled",
											"启用",
											"Enabled",
										),
									),
									t(
										defineMessage(
											"domainConfigModal.disabled",
											"关闭",
											"Disabled",
										),
									),
								)}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.sendCapabilityLabel",
										"发件能力",
										"Outbound capability",
									),
								)}
							>
								{formatBooleanTag(
									detail.canSend,
									t(
										defineMessage(
											"domainConfigModal.enabled",
											"启用",
											"Enabled",
										),
									),
									t(
										defineMessage(
											"domainConfigModal.disabled",
											"关闭",
											"Disabled",
										),
									),
									"gold",
								)}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.catchAllLabel",
										"Catch-all",
										"Catch-all",
									),
								)}
							>
								{formatBooleanTag(
									detail.isCatchAllEnabled,
									t(
										defineMessage(
											"domainConfigModal.enabled",
											"启用",
											"Enabled",
										),
									),
									t(
										defineMessage(
											"domainConfigModal.disabled",
											"关闭",
											"Disabled",
										),
									),
								)}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.resendDomainIdLabel",
										"Resend Domain ID",
										"Resend domain ID",
									),
								)}
							>
								{detail.resendDomainId || "-"}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.mxConfigLabel",
										"MX 配置",
										"MX configuration",
									),
								)}
							>
								{formatBooleanTag(
									Boolean(detail.dnsStatus?.expectedMxConfigured),
									t(
										defineMessage(
											"domainConfigModal.declared",
											"已声明",
											"Declared",
										),
									),
									t(
										defineMessage(
											"domainConfigModal.pending",
											"待配置",
											"Pending",
										),
									),
								)}
							</Descriptions.Item>
							<Descriptions.Item
								label={t(
									defineMessage(
										"domainConfigModal.ingressConfigLabel",
										"Ingress 配置",
										"Ingress configuration",
									),
								)}
							>
								{formatBooleanTag(
									Boolean(detail.dnsStatus?.expectedIngressConfigured),
									t(
										defineMessage(
											"domainConfigModal.declared",
											"已声明",
											"Declared",
										),
									),
									t(
										defineMessage(
											"domainConfigModal.pending",
											"待配置",
											"Pending",
										),
									),
								)}
							</Descriptions.Item>
						</Descriptions>

						<div>
							<Space align="center" style={domainConfigStyles.sectionActions}>
								<Text strong>
									{t(
										defineMessage(
											"domainConfigModal.dnsVerifyHeading",
											"DNS Verify",
											"DNS verify",
										),
									)}
								</Text>
								<Button
									icon={<ReloadOutlined />}
									onClick={() => void loadConfig()}
								>
									{t(
										defineMessage(
											"domainConfigModal.refreshDetails",
											"刷新详情",
											"Refresh details",
										),
									)}
								</Button>
							</Space>
							<div style={marginBottom16Style} />
							<Form
								form={verificationForm}
								layout="vertical"
								onFinish={handleSaveVerification}
							>
								<Form.Item
									name="verificationToken"
									label={t(
										defineMessage(
											"domainConfigModal.customVerificationToken",
											"自定义验证 Token",
											"Custom verification token",
										),
									)}
								>
									<Input
										placeholder={t(
											defineMessage(
												"domainConfigModal.customVerificationTokenPlaceholder",
												"留空后使用系统生成的 Token",
												"Leave blank to use a system-generated token",
											),
										)}
									/>
								</Form.Item>
								<div style={domainConfigStyles.hint}>
									{t(
										defineMessage(
											"domainConfigModal.currentToken",
											"当前 Token：{token}",
											"Current token: {token}",
										),
										{
											token:
												detail.verificationToken ||
												t(
													defineMessage(
														"domainConfigModal.notGeneratedYet",
														"尚未生成",
														"Not generated yet",
													),
												),
										},
									)}
								</div>
								<Space wrap>
									<Button
										type="primary"
										loading={savingVerification}
										htmlType="submit"
									>
										{t(
											defineMessage(
												"domainConfigModal.saveVerificationToken",
												"保存验证 Token",
												"Save verification token",
											),
										)}
									</Button>
									<Button
										loading={savingVerification}
										onClick={() => void handleRegenerateVerification()}
									>
										{t(
											defineMessage(
												"domainConfigModal.regenerateToken",
												"重新生成 Token",
												"Regenerate token",
											),
										)}
									</Button>
								</Space>
							</Form>
						</div>

						<div>
							<Text strong>
								{t(
									defineMessage(
										"domainConfigModal.catchAllHeading",
										"Catch-all",
										"Catch-all",
									),
								)}
							</Text>
							<div style={marginBottom16Style} />
							<Form
								form={catchAllForm}
								layout="vertical"
								onFinish={handleSaveCatchAll}
							>
								<Form.Item
									name="isCatchAllEnabled"
									label={t(
										defineMessage(
											"domainConfigModal.enableCatchAll",
											"启用 Catch-all",
											"Enable catch-all",
										),
									)}
									valuePropName="checked"
								>
									<Switch
										aria-label={t(
											defineMessage(
												"domainConfigModal.enableCatchAllAria",
												"启用 catch-all",
												"Enable catch-all",
											),
										)}
									/>
								</Form.Item>
								<Form.Item
									name="catchAllTargetMailboxId"
									label={t(
										defineMessage(
											"domainConfigModal.catchAllTargetLabel",
											"Catch-all 目标邮箱",
											"Catch-all target mailbox",
										),
									)}
									rules={[
										({ getFieldValue }) => ({
											validator: async (_, value) => {
												if (!getFieldValue("isCatchAllEnabled") || value) {
													return;
												}
												throw new Error(
													t(
														defineMessage(
															"domainConfigModal.catchAllTargetRequired",
															"启用 Catch-all 时必须选择目标邮箱",
															"Select a target mailbox when catch-all is enabled",
														),
													),
												);
											},
										}),
									]}
								>
									<Select
										allowClear
										options={mailboxOptions}
										placeholder={t(
											defineMessage(
												"domainConfigModal.catchAllTargetPlaceholder",
												"请选择域名内的目标邮箱",
												"Select a target mailbox inside this domain",
											),
										)}
									/>
								</Form.Item>
								<Space wrap>
									<Button
										type="primary"
										loading={savingCatchAll}
										htmlType="submit"
									>
										{t(
											defineMessage(
												"domainConfigModal.saveCatchAll",
												"保存 Catch-all",
												"Save catch-all",
											),
										)}
									</Button>
								</Space>
							</Form>
						</div>

						<div>
							<Text strong>
								{t(
									defineMessage(
										"domainConfigModal.sendingConfigHeading",
										"Sending Config",
										"Sending config",
									),
								)}
							</Text>
							<div style={marginBottom16Style} />
							{!detail.canSend ? (
								<Alert
									showIcon
									type="warning"
									style={marginBottom16Style}
									title={t(
										defineMessage(
											"domainConfigModal.sendingDisabledTitle",
											"当前域名未启用发件能力",
											"Sending is not enabled for this domain",
										),
									)}
									description={t(
										defineMessage(
											"domainConfigModal.sendingDisabledDescription",
											"只有允许发件的域名才能保存 Resend 配置。先在域名基础信息里开启 canSend，再回到这里补发信配置。",
											"Only send-enabled domains can save a Resend configuration. Enable canSend in the domain basics first, then return here to finish the sending setup.",
										),
									)}
								/>
							) : null}
							<Form
								form={sendingConfigForm}
								layout="vertical"
								onFinish={handleSaveSendingConfig}
							>
								<Form.Item
									label={t(
										defineMessage(
											"domainConfigModal.providerLabel",
											"Provider",
											"Provider",
										),
									)}
								>
									<Input value="RESEND" disabled />
								</Form.Item>
								<Form.Item
									name="fromNameDefault"
									label={t(
										defineMessage(
											"domainConfigModal.defaultSenderName",
											"默认发件人名称",
											"Default sender name",
										),
									)}
								>
									<Input
										placeholder={t(
											defineMessage(
												"domainConfigModal.defaultSenderNamePlaceholder",
												"Operations Team",
												"Operations Team",
											),
										)}
									/>
								</Form.Item>
								<Form.Item
									name="replyToDefault"
									label={t(
										defineMessage(
											"domainConfigModal.defaultReplyTo",
											"默认 Reply-To",
											"Default Reply-To",
										),
									)}
								>
									<Input
										placeholder={t(
											defineMessage(
												"domainConfigModal.defaultReplyToPlaceholder",
												"reply@example.com",
												"reply@example.com",
											),
										)}
									/>
								</Form.Item>
								<Form.Item
									name="apiKey"
									label={
										primarySendingConfig
											? t(
													defineMessage(
														"domainConfigModal.updateResendApiKey",
														"更新 Resend API Key（可选）",
														"Update Resend API key (optional)",
													),
												)
											: t(
													defineMessage(
														"domainConfigModal.resendApiKey",
														"Resend API Key",
														"Resend API key",
													),
												)
									}
								>
									<Input.Password
										placeholder={
											primarySendingConfig
												? t(
														defineMessage(
															"domainConfigModal.keepExistingApiKey",
															"留空则保留现有密钥",
															"Leave blank to keep the existing key",
														),
													)
												: t(
														defineMessage(
															"domainConfigModal.firstApiKeyRequired",
															"首次创建必须填写 API Key",
															"An API key is required for the first setup",
														),
													)
										}
									/>
								</Form.Item>
								<div style={domainConfigStyles.hint}>
									{primarySendingConfig
										? t(
												defineMessage(
													"domainConfigModal.existingSendingConfig",
													"当前已存在 {provider} 配置，状态 {status}。",
													"A {provider} configuration already exists with status {status}.",
												),
												{
													provider: primarySendingConfig.provider,
													status: primarySendingConfig.status,
												},
											)
										: t(
												defineMessage(
													"domainConfigModal.firstSendingConfigHint",
													"当前域名还没有发信配置，首次创建需要填写 Resend API Key。",
													"This domain does not have a sending configuration yet. The first setup requires a Resend API key.",
												),
											)}
								</div>
								<Space wrap>
									<Button
										type="primary"
										loading={savingSendingConfig}
										htmlType="submit"
										disabled={!detail.canSend}
									>
										{t(
											defineMessage(
												"domainConfigModal.saveSendingConfig",
												"保存发信配置",
												"Save sending configuration",
											),
										)}
									</Button>
								</Space>
							</Form>
						</div>

						<div>
							<Space align="center" style={domainConfigStyles.sectionActions}>
								<Text strong>
									{t(
										defineMessage(
											"domainConfigModal.aliasesHeading",
											"Aliases",
											"Aliases",
										),
									)}
								</Text>
								<Button
									type="primary"
									icon={<PlusOutlined />}
									onClick={openAliasModal}
									disabled={activeMailboxOptions.length === 0}
								>
									{t(
										defineMessage(
											"domainConfigModal.addAlias",
											"新增 Alias",
											"Add alias",
										),
									)}
								</Button>
							</Space>
							<div style={marginBottom16Style} />
							{aliases.length === 0 ? (
								<Empty
									image={Empty.PRESENTED_IMAGE_SIMPLE}
									description={t(
										defineMessage(
											"domainConfigModal.noAliases",
											"暂无 Alias",
											"No aliases yet",
										),
									)}
								/>
							) : (
								<Table
									rowKey="id"
									columns={aliasColumns}
									dataSource={aliases}
									pagination={false}
								/>
							)}
						</div>
					</Space>
				)}
			</Modal>

			<Modal
				title={t(
					defineMessage(
						"domainConfigModal.addAliasTitle",
						"新增 Alias · {name}",
						"Add alias · {name}",
					),
					{ name: domainName || detail?.name || "" },
				)}
				open={aliasModalVisible}
				onCancel={() => setAliasModalVisible(false)}
				onOk={() => aliasForm.submit()}
				confirmLoading={savingAlias}
				destroyOnHidden
			>
				<Form form={aliasForm} layout="vertical" onFinish={handleCreateAlias}>
					{activeMailboxOptions.length === 1 ? (
						<>
							<Form.Item
								label={t(
									defineMessage(
										"domainConfigModal.targetMailboxLabel",
										"目标邮箱",
										"Target mailbox",
									),
								)}
							>
								<Input value={defaultAliasMailbox?.label} disabled />
							</Form.Item>
							<Form.Item
								name="mailboxId"
								initialValue={defaultAliasMailbox?.value}
								hidden
							>
								<Input />
							</Form.Item>
						</>
					) : (
						<Form.Item
							name="mailboxId"
							label={t(
								defineMessage(
									"domainConfigModal.targetMailboxLabel",
									"目标邮箱",
									"Target mailbox",
								),
							)}
							rules={[
								{
									required: true,
									message: t(
										defineMessage(
											"domainConfigModal.targetMailboxRequired",
											"请选择 Alias 的目标邮箱",
											"Select the target mailbox for the alias",
										),
									),
								},
							]}
						>
							<Select
								options={activeMailboxOptions}
								placeholder={t(
									defineMessage(
										"domainConfigModal.targetMailboxPlaceholder",
										"请选择目标邮箱",
										"Select the target mailbox",
									),
								)}
							/>
						</Form.Item>
					)}
					<Form.Item
						name="aliasLocalPart"
						label={t(
							defineMessage(
								"domainConfigModal.aliasLocalPartLabel",
								"Alias 本地部分",
								"Alias local part",
							),
						)}
						rules={[
							{
								required: true,
								message: t(
									defineMessage(
										"domainConfigModal.aliasLocalPartRequired",
										"请输入 Alias 本地部分",
										"Enter the alias local part",
									),
								),
							},
						]}
					>
						<Input
							placeholder={t(
								defineMessage(
									"domainConfigModal.aliasLocalPartPlaceholder",
									"support",
									"support",
								),
							)}
						/>
					</Form.Item>
					{detail?.name ? (
						<div style={domainConfigStyles.hint}>
							{t(
								defineMessage(
									"domainConfigModal.aliasAssembledHint",
									"将自动拼接为 `<local-part>@{domain}`。",
									"It will be assembled automatically as `<local-part>@{domain}`.",
								),
								{ domain: detail.name },
							)}
						</div>
					) : null}
				</Form>
			</Modal>
		</>
	);
}

import {
	DeleteOutlined,
	PlusOutlined,
	UserAddOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Form,
	Input,
	message,
	Popconfirm,
	Select,
	Space,
	Table,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, SurfaceCard } from "../../components";
import { getHostedInternalProfileByProvisioningMode } from "../../constants/providers";
import { domainMailboxesContract } from "../../contracts/admin/domainMailboxes";
import { useI18n } from "../../i18n";
import { adminI18n } from "../../i18n/catalog/admin";
import { width140Style, width170Style, width180Style } from "../../styles/common";
import { getErrorMessage } from "../../utils/error";
import { requestData } from "../../utils/request";
import { createMailboxColumns } from "./columns";
import {
	DomainMailboxBatchAssignModal,
	DomainMailboxBatchCreateModal,
	DomainMailboxBatchDeleteModal,
	DomainMailboxModal,
} from "./modals";
import {
	type ApiKeyOption,
	type BatchAssignResult,
	type BatchCreateMode,
	type BatchCreateResult,
	type BatchDeleteResult,
	type DomainOption,
	domainMailboxesI18n,
	domainMailboxStyles,
	fetchAllPagedItems,
	type MailboxRecord,
	type UserRecord,
} from "./shared";

type ProvisioningOption = { value: "MANUAL" | "API_POOL"; label: string };

const DomainMailboxesPage = () => {
	const { t } = useI18n();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const [loading, setLoading] = useState(true);
	const [mailboxes, setMailboxes] = useState<MailboxRecord[]>([]);
	const [domains, setDomains] = useState<DomainOption[]>([]);
	const [users, setUsers] = useState<UserRecord[]>([]);
	const [apiKeys, setApiKeys] = useState<ApiKeyOption[]>([]);
	const [selectedMailboxIds, setSelectedMailboxIds] = useState<number[]>([]);
	const [filterDomainId, setFilterDomainId] = useState<number | undefined>(
		undefined,
	);
	const [filterStatus, setFilterStatus] = useState<string | undefined>(
		undefined,
	);
	const [filterProvisioningMode, setFilterProvisioningMode] = useState<
		"MANUAL" | "API_POOL" | undefined
	>(undefined);
	const [filterBatchTag, setFilterBatchTag] = useState("");

	const [mailboxModalVisible, setMailboxModalVisible] = useState(false);
	const [batchCreateModalVisible, setBatchCreateModalVisible] = useState(false);
	const [batchDeleteModalVisible, setBatchDeleteModalVisible] = useState(false);
	const [batchAssignModalVisible, setBatchAssignModalVisible] = useState(false);
	const [editingMailbox, setEditingMailbox] = useState<MailboxRecord | null>(
		null,
	);
	const [savingMailbox, setSavingMailbox] = useState(false);
	const [savingBatchCreate, setSavingBatchCreate] = useState(false);
	const [savingBatchDelete, setSavingBatchDelete] = useState(false);
	const [savingBatchAssign, setSavingBatchAssign] = useState(false);
	const [mailboxForm] = Form.useForm();
	const [batchCreateForm] = Form.useForm();
	const [batchDeleteForm] = Form.useForm();
	const [batchAssignForm] = Form.useForm();
	const presetDomainId = Number(searchParams.get("domainId") || 0) || undefined;
	const createIntent = searchParams.get("intent");
	const provisioningOptions = useMemo<ProvisioningOption[]>(
		() => [
			{ value: "MANUAL", label: t(adminI18n.domainMailboxes.manualMode) },
			{ value: "API_POOL", label: t(adminI18n.domainMailboxes.apiPoolMode) },
		],
		[t],
	);
	const mailboxStatusOptions = useMemo(
		() => [
			{ value: "ACTIVE", label: t(domainMailboxesI18n.enabled) },
			{ value: "DISABLED", label: t(adminI18n.common.disabled) },
			{ value: "SUSPENDED", label: t(domainMailboxesI18n.suspended) },
		],
		[t],
	);

	const batchCreateMode =
		(Form.useWatch("createMode", batchCreateForm) as
			| BatchCreateMode
			| undefined) || "PREFIX";
	const mailboxProvisioningMode =
		(Form.useWatch("provisioningMode", mailboxForm) as
			| "MANUAL"
			| "API_POOL"
			| undefined) ||
		editingMailbox?.provisioningMode ||
		"MANUAL";
	const mailboxDomainId = Form.useWatch("domainId", mailboxForm) as
		| number
		| undefined;

	const loadData = useCallback(async () => {
		setLoading(true);
		const [domainResult, mailboxResult, userResult, apiKeyResult] =
			await Promise.all([
				requestData<DomainOption[]>(
					async () =>
						fetchAllPagedItems<DomainOption>(async (page, pageSize) =>
							domainMailboxesContract.getDomains<DomainOption>({
								page,
								pageSize,
							}),
						),
					t(domainMailboxesI18n.fetchDomainsFailed),
					{ silent: true },
				),
				requestData<MailboxRecord[]>(
					async () =>
						fetchAllPagedItems<MailboxRecord>(async (page, pageSize) =>
							domainMailboxesContract.getMailboxes<MailboxRecord>({
								page,
								pageSize,
								domainId: filterDomainId,
								status: filterStatus,
								provisioningMode: filterProvisioningMode,
								batchTag: filterBatchTag.trim() || undefined,
							}),
						),
					t(domainMailboxesI18n.fetchMailboxesFailed),
				),
				requestData<UserRecord[]>(
					async () =>
						fetchAllPagedItems<UserRecord>(async (page, pageSize) =>
							domainMailboxesContract.getUsers<UserRecord>({ page, pageSize }),
						),
					t(domainMailboxesI18n.fetchUsersFailed),
					{ silent: true },
				),
				requestData<ApiKeyOption[]>(
					async () =>
						fetchAllPagedItems<ApiKeyOption>(async (page, pageSize) =>
							domainMailboxesContract.getApiKeys<ApiKeyOption>({
								page,
								pageSize,
								status: "ACTIVE",
							}),
						),
					t(domainMailboxesI18n.fetchApiKeysFailed),
					{ silent: true },
				),
			]);

		setDomains(
			(domainResult || []).filter((item) => item.status !== "DISABLED"),
		);
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
		() => domains.filter((item) => item.status !== "DISABLED"),
		[domains],
	);
	const mailboxProfileDefinition = useMemo(
		() => getHostedInternalProfileByProvisioningMode(mailboxProvisioningMode),
		[mailboxProvisioningMode],
	);
	const selectedMailboxDomain = useMemo(
		() => activeDomains.find((item) => item.id === mailboxDomainId),
		[activeDomains, mailboxDomainId],
	);

	const openMailboxModal = useCallback(
		(record?: MailboxRecord, nextDomainId?: number) => {
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
					provisioningMode: "MANUAL",
					domainId: nextDomainId,
				});
			}
			setMailboxModalVisible(true);
		},
		[mailboxForm],
	);

	useEffect(() => {
		if (createIntent !== "create" || !presetDomainId || mailboxModalVisible) {
			return;
		}

		const presetDomain = activeDomains.find(
			(item) => item.id === presetDomainId,
		);
		if (!presetDomain) {
			return;
		}

		setFilterDomainId(presetDomainId);
		openMailboxModal(undefined, presetDomainId);

		const nextParams = new URLSearchParams(searchParams);
		nextParams.delete("intent");
		nextParams.delete("domainId");
		setSearchParams(nextParams, { replace: true });
	}, [
		activeDomains,
		createIntent,
		mailboxModalVisible,
		openMailboxModal,
		presetDomainId,
		searchParams,
		setSearchParams,
	]);

	const openBatchCreateModal = () => {
		batchCreateForm.resetFields();
		batchCreateForm.setFieldsValue({
			createMode: "PREFIX",
			count: 10,
			startFrom: 1,
			padding: 0,
			provisioningMode: "API_POOL",
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
				: t(domainMailboxesI18n.createMailboxFailed),
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

			if (values.createMode === "LIST") {
				const localParts = String(values.localPartsText || "")
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
				t(domainMailboxesI18n.batchCreateFailed),
			);
			if (result) {
				message.success(
					t(domainMailboxesI18n.batchCreateSuccess, {
						count: result.createdCount || result.mailboxes?.length || 0,
					}),
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
				() =>
					domainMailboxesContract.batchDeleteMailboxes({
						ids: selectedMailboxIds,
					}),
				t(domainMailboxesI18n.batchDeleteFailed),
			);
			if (result) {
				message.success(
					t(domainMailboxesI18n.deletedCount, {
						count: result.deletedCount || selectedMailboxIds.length,
					}),
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
			const result = await requestData<BatchDeleteResult>(
				() =>
					domainMailboxesContract.batchDeleteMailboxes({
						domainId: values.domainId,
						batchTag: values.batchTag,
						provisioningMode: values.provisioningMode,
					}),
				t(domainMailboxesI18n.deleteByFilterFailed),
			);
			if (result) {
				message.success(
					t(domainMailboxesI18n.deletedCount, {
						count: result.deletedCount || 0,
					}),
				);
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
				() =>
					domainMailboxesContract.addMailboxesToUser(
						Number(values.userId),
						selectedMailboxIds,
					),
				t(domainMailboxesI18n.batchAssignFailed),
			);
			if (result) {
				message.success(
					t(domainMailboxesI18n.batchAssignSuccess, {
						selectedCount: selectedMailboxIds.length,
						username: result.username,
						addedCount: result.addedCount,
					}),
				);
				setBatchAssignModalVisible(false);
				setSelectedMailboxIds([]);
				await loadData();
			}
		} finally {
			setSavingBatchAssign(false);
		}
	};

	const handleSingleDelete = useCallback(
		async (record: MailboxRecord) => {
			try {
				const result = await requestData(
					() => domainMailboxesContract.deleteMailbox(record.id),
					t(domainMailboxesI18n.deleteMailboxFailed),
				);
				if (result) {
					message.success(t(domainMailboxesI18n.deleteSuccess));
					await loadData();
				}
			} catch (error) {
				message.error(
					getErrorMessage(error, t(domainMailboxesI18n.deleteFailed)),
				);
			}
		},
		[loadData, t],
	);

	const mailboxColumns = useMemo(
		() =>
			createMailboxColumns({
				t,
				openMailboxModal,
				handleSingleDelete,
			}),
		[handleSingleDelete, openMailboxModal, t],
	);

	return (
		<div>
			<PageHeader
				title={t(adminI18n.domainMailboxes.title)}
				subtitle={t(adminI18n.domainMailboxes.subtitle)}
				extra={
					<Space wrap>
						<Button onClick={openBatchCreateModal}>
							{t(adminI18n.domainMailboxes.batchCreate)}
						</Button>
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => openMailboxModal()}
						>
							{t(adminI18n.domainMailboxes.addMailbox)}
						</Button>
					</Space>
				}
			/>
			<Space
				orientation="vertical"
				size="large"
				style={domainMailboxStyles.fullWidth}
			>
				<Alert
					type="info"
					showIcon
					title={t(adminI18n.domainMailboxes.hostedAlertTitle)}
					description={t(adminI18n.domainMailboxes.hostedAlertBody)}
				/>
				<Alert
					type="info"
					showIcon
					title={t(domainMailboxesI18n.onboardingTitle)}
					description={
						<>
							<div>{t(domainMailboxesI18n.onboardingBody)}</div>
							{filterDomainId ? (
								<div style={domainMailboxStyles.profileHint}>
									{t(domainMailboxesI18n.onboardingFocusedDomain, {
										domain:
											activeDomains.find((item) => item.id === filterDomainId)
												?.name || String(filterDomainId),
									})}
								</div>
							) : null}
						</>
					}
				/>
				<SurfaceCard
					title={t(adminI18n.domainMailboxes.supplyTitle)}
					extra={
						<Space wrap>
							<Button onClick={() => navigate("/mailbox-users")}>
								{t(adminI18n.domainMailboxes.portalUsers)}
							</Button>
							<Button onClick={openBatchDeleteModal} icon={<DeleteOutlined />}>
								{t(adminI18n.domainMailboxes.deleteByBatch)}
							</Button>
							<Select
								allowClear
								placeholder={t(adminI18n.domainMailboxes.filterDomain)}
								style={width180Style}
								value={filterDomainId}
								onChange={(value) => setFilterDomainId(value)}
								options={activeDomains.map((item) => ({
									value: item.id,
									label: item.name,
								}))}
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
						<div
							style={{
								marginBottom: 16,
								display: "flex",
								justifyContent: "space-between",
								gap: 12,
								flexWrap: "wrap",
							}}
						>
							<div style={{ color: "rgba(15, 23, 42, 0.62)", fontSize: 13 }}>
								{t(adminI18n.domainMailboxes.selectedCount, {
									count: selectedMailboxIds.length,
								})}
							</div>
							<Space wrap>
								<Button
									icon={<UserAddOutlined />}
									disabled={users.length === 0}
									onClick={openBatchAssignModal}
								>
									{t(adminI18n.domainMailboxes.batchJoinUser)}
								</Button>
								<Popconfirm
									title={t(domainMailboxesI18n.batchDeleteConfirm, {
										count: selectedMailboxIds.length,
									})}
									onConfirm={() => void handleDeleteSelected()}
								>
									<Button danger loading={savingBatchDelete}>
										{t(adminI18n.domainMailboxes.batchDeleteSelected)}
									</Button>
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
							onChange: (keys) =>
								setSelectedMailboxIds(keys.map((item) => Number(item))),
						}}
					/>
				</SurfaceCard>
			</Space>

			<DomainMailboxModal
				open={mailboxModalVisible}
				editingMailbox={editingMailbox}
				saving={savingMailbox}
				form={mailboxForm}
				activeDomains={activeDomains}
				users={users}
				provisioningOptions={provisioningOptions}
				mailboxStatusOptions={mailboxStatusOptions}
				mailboxProfileDefinition={mailboxProfileDefinition}
				selectedMailboxDomain={selectedMailboxDomain}
				onCancel={() => setMailboxModalVisible(false)}
				onConfirm={() => mailboxForm.submit()}
				onFinish={handleMailboxSubmit}
			/>

			<DomainMailboxBatchCreateModal
				open={batchCreateModalVisible}
				saving={savingBatchCreate}
				form={batchCreateForm}
				activeDomains={activeDomains}
				apiKeys={apiKeys}
				users={users}
				provisioningOptions={provisioningOptions}
				batchCreateMode={batchCreateMode}
				onCancel={() => setBatchCreateModalVisible(false)}
				onSubmit={() => void handleBatchCreateSubmit()}
			/>

			<DomainMailboxBatchAssignModal
				open={batchAssignModalVisible}
				saving={savingBatchAssign}
				form={batchAssignForm}
				users={users}
				selectedMailboxIds={selectedMailboxIds}
				onCancel={() => setBatchAssignModalVisible(false)}
				onSubmit={() => void handleBatchAssignSubmit()}
			/>

			<DomainMailboxBatchDeleteModal
				open={batchDeleteModalVisible}
				saving={savingBatchDelete}
				form={batchDeleteForm}
				activeDomains={activeDomains}
				provisioningOptions={provisioningOptions}
				onCancel={() => setBatchDeleteModalVisible(false)}
				onSubmit={() => void handleBatchDeleteSubmit()}
			/>
		</div>
	);
};

export default DomainMailboxesPage;

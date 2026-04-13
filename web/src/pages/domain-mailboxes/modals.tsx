import {
	Alert,
	Form,
	Input,
	InputNumber,
	Modal,
	Select,
	Space,
	Switch,
} from "antd";
import type { FormInstance } from "antd/es/form";
import { useI18n } from "../../i18n";
import { adminI18n } from "../../i18n/catalog/admin";
import {
	getHostedInternalProfileClassificationNoteMessage,
	getHostedInternalProfileLabelMessage,
} from "../../i18n/catalog/providers";
import { width120Style, width180Style } from "../../styles/common";
import {
	type ApiKeyOption,
	type BatchCreateMode,
	type DomainOption,
	domainMailboxesI18n,
	domainMailboxStyles,
	type MailboxRecord,
	type UserRecord,
} from "./shared";

type ProvisioningOption = { value: "MANUAL" | "API_POOL"; label: string };
type MailboxStatusOption = { value: string; label: string };

interface MailboxModalProps {
	open: boolean;
	editingMailbox: MailboxRecord | null;
	saving: boolean;
	form: FormInstance;
	activeDomains: DomainOption[];
	users: UserRecord[];
	provisioningOptions: ProvisioningOption[];
	mailboxStatusOptions: MailboxStatusOption[];
	mailboxProfileDefinition: ReturnType<
		typeof import("../../constants/providers").getHostedInternalProfileByProvisioningMode
	>;
	selectedMailboxDomain?: DomainOption;
	onCancel: () => void;
	onConfirm: () => void;
	onFinish: (values: Record<string, unknown>) => void | Promise<void>;
}

export function DomainMailboxModal({
	open,
	editingMailbox,
	saving,
	form,
	activeDomains,
	users,
	provisioningOptions,
	mailboxStatusOptions,
	mailboxProfileDefinition,
	selectedMailboxDomain,
	onCancel,
	onConfirm,
	onFinish,
}: MailboxModalProps) {
	const { t } = useI18n();

	return (
		<Modal
			title={
				editingMailbox
					? t(adminI18n.domainMailboxes.editMailbox)
					: t(adminI18n.domainMailboxes.createMailbox)
			}
			open={open}
			onCancel={onCancel}
			onOk={onConfirm}
			confirmLoading={saving}
			destroyOnHidden
		>
			<Form form={form} layout="vertical" onFinish={onFinish}>
				<Form.Item
					name="domainId"
					label={t(adminI18n.sendingConfigs.domain)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectDomainRequired),
						},
					]}
				>
					<Select
						options={activeDomains.map((item) => ({
							value: item.id,
							label: item.name,
						}))}
						disabled={Boolean(editingMailbox)}
					/>
				</Form.Item>
				<Form.Item
					name="localPart"
					label={t(domainMailboxesI18n.localPart)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.localPartRequired),
						},
					]}
				>
					<Input
						placeholder={t(domainMailboxesI18n.localPartPlaceholder)}
						disabled={Boolean(editingMailbox)}
					/>
				</Form.Item>
				<Form.Item
					name="displayName"
					label={t(domainMailboxesI18n.displayName)}
				>
					<Input placeholder={t(domainMailboxesI18n.displayNamePlaceholder)} />
				</Form.Item>
				<Form.Item
					name="provisioningMode"
					label={t(domainMailboxesI18n.mailboxKind)}
				>
					<Select options={provisioningOptions} />
				</Form.Item>
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 16 }}
					title={t(domainMailboxesI18n.currentProfile, {
						profile: t(
							getHostedInternalProfileLabelMessage(
								mailboxProfileDefinition.key,
							),
						),
					})}
					description={`${t(getHostedInternalProfileClassificationNoteMessage(mailboxProfileDefinition.key))} ${selectedMailboxDomain?.canSend ? t(domainMailboxesI18n.domainCanSendNote) : t(domainMailboxesI18n.domainInboxOnlyNote)}`}
				/>
				<Form.Item
					name="batchTag"
					label={t(adminI18n.domainMailboxes.batchTag)}
				>
					<Input placeholder={t(domainMailboxesI18n.batchTagPlaceholder)} />
				</Form.Item>
				<Form.Item
					name="ownerUserId"
					label={t(adminI18n.domainMailboxes.owner)}
				>
					<Select
						allowClear
						options={users.map((item) => ({
							value: item.id,
							label: item.username,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="password"
					label={t(domainMailboxesI18n.portalPassword)}
				>
					<Input.Password
						placeholder={
							editingMailbox
								? t(domainMailboxesI18n.keepPasswordBlankPlaceholder)
								: t(domainMailboxesI18n.setPortalPasswordPlaceholder)
						}
					/>
				</Form.Item>
				{editingMailbox ? (
					<Form.Item name="status" label={t(adminI18n.common.status)}>
						<Select allowClear options={mailboxStatusOptions} />
					</Form.Item>
				) : null}
			</Form>
		</Modal>
	);
}

interface BatchCreateModalProps {
	open: boolean;
	saving: boolean;
	form: FormInstance;
	activeDomains: DomainOption[];
	apiKeys: ApiKeyOption[];
	users: UserRecord[];
	provisioningOptions: ProvisioningOption[];
	batchCreateMode: BatchCreateMode;
	onCancel: () => void;
	onSubmit: () => void;
}

export function DomainMailboxBatchCreateModal({
	open,
	saving,
	form,
	activeDomains,
	apiKeys,
	users,
	provisioningOptions,
	batchCreateMode,
	onCancel,
	onSubmit,
}: BatchCreateModalProps) {
	const { t } = useI18n();

	return (
		<Modal
			title={t(domainMailboxesI18n.batchCreateTitle)}
			open={open}
			onCancel={onCancel}
			onOk={onSubmit}
			confirmLoading={saving}
			width={760}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="domainId"
					label={t(adminI18n.sendingConfigs.domain)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectDomainRequired),
						},
					]}
				>
					<Select
						options={activeDomains.map((item) => ({
							value: item.id,
							label: item.name,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="provisioningMode"
					label={t(domainMailboxesI18n.createType)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectCreateTypeRequired),
						},
					]}
				>
					<Select options={provisioningOptions} />
				</Form.Item>
				<Form.Item
					name="bindApiKeyIds"
					label={t(domainMailboxesI18n.syncDomainToApiKey)}
				>
					<Select
						mode="multiple"
						allowClear
						placeholder={t(domainMailboxesI18n.syncDomainToApiKeyPlaceholder)}
						options={apiKeys.map((item) => ({
							value: item.id,
							label: `${item.name} (${item.keyPrefix})`,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="batchTag"
					label={t(adminI18n.domainMailboxes.batchTag)}
				>
					<Input
						placeholder={t(domainMailboxesI18n.batchTagExamplePlaceholder)}
					/>
				</Form.Item>
				<Form.Item
					name="createMode"
					label={t(domainMailboxesI18n.createMode)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectCreateModeRequired),
						},
					]}
				>
					<Select
						options={[
							{
								value: "PREFIX",
								label: t(domainMailboxesI18n.generateByPrefix),
							},
							{
								value: "LIST",
								label: t(domainMailboxesI18n.importByPrefixList),
							},
						]}
					/>
				</Form.Item>
				{batchCreateMode === "LIST" ? (
					<Form.Item
						name="localPartsText"
						label={t(domainMailboxesI18n.localPartList)}
						rules={[
							{
								required: true,
								message: t(domainMailboxesI18n.localPartListRequired),
							},
						]}
					>
						<Input.TextArea
							rows={6}
							placeholder={t(domainMailboxesI18n.localPartListPlaceholder)}
						/>
					</Form.Item>
				) : (
					<Space
						size="middle"
						align="start"
						style={domainMailboxStyles.batchPrefixRow}
					>
						<Form.Item
							name="prefix"
							label={t(domainMailboxesI18n.prefix)}
							rules={[
								{
									required: true,
									message: t(domainMailboxesI18n.prefixRequired),
								},
							]}
						>
							<Input
								placeholder={t(domainMailboxesI18n.prefixPlaceholder)}
								style={width180Style}
							/>
						</Form.Item>
						<Form.Item
							name="count"
							label={t(domainMailboxesI18n.count)}
							rules={[
								{
									required: true,
									message: t(domainMailboxesI18n.countRequired),
								},
							]}
						>
							<InputNumber min={1} max={1000} style={width120Style} />
						</Form.Item>
						<Form.Item
							name="startFrom"
							label={t(domainMailboxesI18n.startFrom)}
						>
							<InputNumber min={0} style={width120Style} />
						</Form.Item>
						<Form.Item name="padding" label={t(domainMailboxesI18n.padding)}>
							<InputNumber min={0} max={10} style={width120Style} />
						</Form.Item>
					</Space>
				)}
				<Form.Item
					name="displayName"
					label={t(domainMailboxesI18n.unifiedDisplayName)}
				>
					<Input
						placeholder={t(domainMailboxesI18n.unifiedDisplayNamePlaceholder)}
					/>
				</Form.Item>
				<Form.Item
					name="ownerUserId"
					label={t(adminI18n.domainMailboxes.owner)}
				>
					<Select
						allowClear
						options={users.map((item) => ({
							value: item.id,
							label: item.username,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="canLogin"
					label={t(domainMailboxesI18n.allowPortalLogin)}
					valuePropName="checked"
				>
					<Switch />
				</Form.Item>
				<Form.Item
					name="password"
					label={t(domainMailboxesI18n.unifiedPassword)}
				>
					<Input.Password
						placeholder={t(domainMailboxesI18n.unifiedPasswordPlaceholder)}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
}

interface BatchAssignModalProps {
	open: boolean;
	saving: boolean;
	form: FormInstance;
	users: UserRecord[];
	selectedMailboxIds: number[];
	onCancel: () => void;
	onSubmit: () => void;
}

export function DomainMailboxBatchAssignModal({
	open,
	saving,
	form,
	users,
	selectedMailboxIds,
	onCancel,
	onSubmit,
}: BatchAssignModalProps) {
	const { t } = useI18n();

	return (
		<Modal
			title={t(domainMailboxesI18n.batchAssignTitle)}
			open={open}
			onCancel={onCancel}
			onOk={onSubmit}
			confirmLoading={saving}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item label={t(domainMailboxesI18n.selectedDomainMailboxes)}>
					<Input
						value={t(domainMailboxesI18n.selectedMailboxCount, {
							count: selectedMailboxIds.length,
						})}
						disabled
					/>
				</Form.Item>
				<Form.Item
					name="userId"
					label={t(domainMailboxesI18n.portalUser)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectPortalUserRequired),
						},
					]}
				>
					<Select
						showSearch
						optionFilterProp="label"
						placeholder={t(domainMailboxesI18n.selectPortalUserPlaceholder)}
						options={users.map((item) => ({
							value: item.id,
							label: `${item.username}${item.email ? ` (${item.email})` : ""}`,
						}))}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
}

interface BatchDeleteModalProps {
	open: boolean;
	saving: boolean;
	form: FormInstance;
	activeDomains: DomainOption[];
	provisioningOptions: ProvisioningOption[];
	onCancel: () => void;
	onSubmit: () => void;
}

export function DomainMailboxBatchDeleteModal({
	open,
	saving,
	form,
	activeDomains,
	provisioningOptions,
	onCancel,
	onSubmit,
}: BatchDeleteModalProps) {
	const { t } = useI18n();

	return (
		<Modal
			title={t(domainMailboxesI18n.batchDeleteByFilterTitle)}
			open={open}
			onCancel={onCancel}
			onOk={onSubmit}
			confirmLoading={saving}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="domainId"
					label={t(adminI18n.sendingConfigs.domain)}
					rules={[
						{
							required: true,
							message: t(domainMailboxesI18n.selectDomainRequired),
						},
					]}
				>
					<Select
						options={activeDomains.map((item) => ({
							value: item.id,
							label: item.name,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="provisioningMode"
					label={t(domainMailboxesI18n.mailboxKind)}
				>
					<Select allowClear options={provisioningOptions} />
				</Form.Item>
				<Form.Item
					name="batchTag"
					label={t(adminI18n.domainMailboxes.batchTag)}
				>
					<Input
						placeholder={t(domainMailboxesI18n.deleteBatchTagPlaceholder)}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
}

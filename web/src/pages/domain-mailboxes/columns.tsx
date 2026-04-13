import { Button, Popconfirm, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
	getHostedInternalProfileByProvisioningMode,
	getHostedInternalProfileDefinition,
	getRepresentativeProtocolTagColor,
} from "../../constants/providers";
import { adminI18n } from "../../i18n/catalog/admin";
import {
	getHostedInternalProfileSummaryHintMessage,
	getRepresentativeProtocolLabelMessage,
} from "../../i18n/catalog/providers";
import type { TranslationInput } from "../../i18n/messages";
import {
	domainMailboxesI18n,
	domainMailboxStyles,
	type MailboxRecord,
} from "./shared";

type TranslateFn = (
	input: TranslationInput,
	params?: Record<string, number | string>,
) => string;

interface CreateMailboxColumnsOptions {
	t: TranslateFn;
	openMailboxModal: (record?: MailboxRecord) => void;
	handleSingleDelete: (record: MailboxRecord) => Promise<void> | void;
}

export function createMailboxColumns({
	t,
	openMailboxModal,
	handleSingleDelete,
}: CreateMailboxColumnsOptions): ColumnsType<MailboxRecord> {
	return [
		{
			title: t(domainMailboxesI18n.mailboxAddress),
			dataIndex: "address",
			key: "address",
		},
		{
			title: t(adminI18n.sendingConfigs.domain),
			key: "domain",
			render: (_, record) => record.domain?.name || record.domainId,
		},
		{
			title: t(domainMailboxesI18n.mailboxType),
			dataIndex: "provisioningMode",
			key: "provisioningMode",
			render: (value, record) => {
				const profileDefinition = record.providerProfile
					? getHostedInternalProfileDefinition(record.providerProfile)
					: getHostedInternalProfileByProvisioningMode(value);
				const representativeProtocol =
					record.representativeProtocol ||
					profileDefinition.representativeProtocol;
				return (
					<Space orientation="vertical" size={4}>
						<Space wrap>
							<Tag
								color={getRepresentativeProtocolTagColor(
									representativeProtocol,
								)}
							>
								{t(
									getRepresentativeProtocolLabelMessage(representativeProtocol),
								)}
							</Tag>
							<Tag color={value === "API_POOL" ? "blue" : "default"}>
								{value === "API_POOL"
									? t(adminI18n.domainMailboxes.apiPoolMode)
									: t(adminI18n.domainMailboxes.manualMode)}
							</Tag>
						</Space>
						<div style={domainMailboxStyles.profileHint}>
							{t(
								getHostedInternalProfileSummaryHintMessage(
									profileDefinition.key,
								),
							)}
						</div>
					</Space>
				);
			},
		},
		{
			title: t(adminI18n.domainMailboxes.capability),
			key: "capabilities",
			render: (_, record) => (
				<Space wrap>
					<Tag
						color={
							record.capabilitySummary?.receiveMail ? "success" : "default"
						}
					>
						{record.capabilitySummary?.receiveMail
							? t(adminI18n.domainMailboxes.receiveEnabled)
							: t(adminI18n.domainMailboxes.receiveDisabled)}
					</Tag>
					<Tag
						color={
							record.capabilitySummary?.sendMail ? "processing" : "default"
						}
					>
						{record.capabilitySummary?.sendMail
							? t(adminI18n.domainMailboxes.sendEnabled)
							: t(adminI18n.domainMailboxes.inboxOnly)}
					</Tag>
					<Tag
						color={record.capabilitySummary?.apiAccess ? "purple" : "default"}
					>
						{record.capabilitySummary?.apiAccess
							? t(adminI18n.domainMailboxes.apiPoolAssignable)
							: t(adminI18n.domainMailboxes.manualManaged)}
					</Tag>
				</Space>
			),
		},
		{
			title: t(adminI18n.domainMailboxes.batchTag),
			dataIndex: "batchTag",
			key: "batchTag",
			render: (value) => value || "-",
		},
		{
			title: t(adminI18n.domainMailboxes.owner),
			key: "ownerUser",
			render: (_, record) => record.ownerUser?.username || "-",
		},
		{
			title: t(adminI18n.domainMailboxes.inboundCount),
			dataIndex: "inboundMessageCount",
			key: "inboundMessageCount",
			render: (value) => value || 0,
		},
		{
			title: t(adminI18n.domainMailboxes.apiUsageCount),
			dataIndex: "apiUsageCount",
			key: "apiUsageCount",
			render: (value) => value || 0,
		},
		{
			title: t(adminI18n.common.status),
			dataIndex: "status",
			key: "status",
			render: (value) => (
				<Tag color={value === "ACTIVE" ? "success" : "default"}>
					{value === "ACTIVE"
						? t(domainMailboxesI18n.enabled)
						: value === "SUSPENDED"
							? t(domainMailboxesI18n.suspended)
							: t(adminI18n.common.disabled)}
				</Tag>
			),
		},
		{
			title: t(adminI18n.common.actions),
			key: "actions",
			render: (_, record) => (
				<Space wrap>
					<Button onClick={() => openMailboxModal(record)}>
						{t(adminI18n.common.edit)}
					</Button>
					<Popconfirm
						title={t(adminI18n.domainMailboxes.deleteMailboxConfirm, {
							address: record.address,
						})}
						onConfirm={() => void handleSingleDelete(record)}
					>
						<Button danger>{t(adminI18n.common.remove)}</Button>
					</Popconfirm>
				</Space>
			),
		},
	];
}

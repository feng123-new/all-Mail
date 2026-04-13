import { DeleteOutlined } from "@ant-design/icons";
import { Button, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { adminI18n } from "../../i18n/catalog/admin";
import type { TranslationInput } from "../../i18n/messages";
import {
	type OutboundMessageRecord,
	type SendConfigRecord,
	sendingConfigsI18n,
} from "./shared";

type TranslateFn = (
	input: TranslationInput,
	params?: Record<string, number | string>,
) => string;

interface CreateSendingConfigColumnsOptions {
	t: TranslateFn;
	deletingConfigId: number | null;
	deletingMessageId: string | null;
	handleDeleteConfig: (record: SendConfigRecord) => Promise<void> | void;
	handleDeleteMessage: (record: OutboundMessageRecord) => Promise<void> | void;
}

export function createSendingConfigColumns({
	t,
	deletingConfigId,
	deletingMessageId,
	handleDeleteConfig,
	handleDeleteMessage,
}: CreateSendingConfigColumnsOptions) {
	const configColumns: ColumnsType<SendConfigRecord> = [
		{
			title: t(adminI18n.sendingConfigs.domain),
			key: "domain",
			render: (_value, record) => record.domain?.name || "-",
		},
		{
			title: t(adminI18n.sendingConfigs.provider),
			dataIndex: "provider",
			key: "provider",
			render: (value) => t(value),
		},
		{
			title: t(adminI18n.sendingConfigs.defaultSender),
			dataIndex: "fromNameDefault",
			key: "fromNameDefault",
			render: (value) => value || "-",
		},
		{
			title: t(adminI18n.sendingConfigs.replyTo),
			dataIndex: "replyToDefault",
			key: "replyToDefault",
			render: (value) => value || "-",
		},
		{
			title: t(adminI18n.common.status),
			dataIndex: "status",
			key: "status",
			render: (value) => t(value),
		},
		{
			title: t(adminI18n.common.actions),
			key: "actions",
			width: 96,
			render: (_value, record) => (
				<Popconfirm
					title={t(sendingConfigsI18n.deleteConfigConfirm)}
					description={t(sendingConfigsI18n.deleteConfigDescription)}
					onConfirm={() => void handleDeleteConfig(record)}
				>
					<Button
						type="text"
						danger
						icon={<DeleteOutlined />}
						loading={deletingConfigId === record.id}
					/>
				</Popconfirm>
			),
		},
	];

	const messageColumns: ColumnsType<OutboundMessageRecord> = [
		{
			title: t(sendingConfigsI18n.senderDomain),
			key: "domain",
			render: (_value, record) => record.domain?.name || "-",
		},
		{
			title: t(sendingConfigsI18n.senderAddress),
			dataIndex: "fromAddress",
			key: "fromAddress",
		},
		{
			title: t(adminI18n.sendingConfigs.subject),
			dataIndex: "subject",
			key: "subject",
			render: (value) => value || t(sendingConfigsI18n.noSubject),
		},
		{
			title: t(adminI18n.common.status),
			dataIndex: "status",
			key: "status",
			render: (value) => t(value),
		},
		{
			title: t(adminI18n.sendingConfigs.providerId),
			dataIndex: "providerMessageId",
			key: "providerMessageId",
			render: (value) => value || "-",
		},
		{
			title: t(adminI18n.sendingConfigs.failureReason),
			dataIndex: "lastError",
			key: "lastError",
			render: (value) => value || "-",
		},
		{
			title: t(sendingConfigsI18n.time),
			dataIndex: "createdAt",
			key: "createdAt",
			render: (value) => new Date(value).toLocaleString(),
		},
		{
			title: t(adminI18n.common.actions),
			key: "actions",
			width: 96,
			render: (_value, record) => (
				<Popconfirm
					title={t(sendingConfigsI18n.deleteHistoryConfirm)}
					description={t(sendingConfigsI18n.deleteHistoryDescription)}
					onConfirm={() => void handleDeleteMessage(record)}
				>
					<Button
						type="text"
						danger
						icon={<DeleteOutlined />}
						loading={deletingMessageId === record.id}
					/>
				</Popconfirm>
			),
		},
	];

	return { configColumns, messageColumns };
}

import {
	DeleteOutlined,
	ReloadOutlined,
	SendOutlined,
} from "@ant-design/icons";
import { Button, Form, message, Popconfirm, Space, Table } from "antd";
import { type Key, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SurfaceCard } from "../../components";
import { sendingContract } from "../../contracts/admin/sending";
import { useI18n } from "../../i18n";
import { adminI18n } from "../../i18n/catalog/admin";
import { fullWidthStyle } from "../../styles/common";
import { requestData } from "../../utils/request";
import { createSendingConfigColumns } from "./columns";
import { ResendSetupGuide } from "./guide";
import { parseRecipientInput } from "./recipientInput";
import { SendTestMailModal } from "./send-modal";
import {
	type DomainOption,
	type MailboxOption,
	type OutboundMessageRecord,
	type SendConfigRecord,
	sendingConfigsI18n,
} from "./shared";

const SendingConfigsPage: React.FC = () => {
	const { t } = useI18n();
	const [configs, setConfigs] = useState<SendConfigRecord[]>([]);
	const [messages, setMessages] = useState<OutboundMessageRecord[]>([]);
	const [domains, setDomains] = useState<DomainOption[]>([]);
	const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [sendVisible, setSendVisible] = useState(false);
	const [sendLoading, setSendLoading] = useState(false);
	const [selectedMessageIds, setSelectedMessageIds] = useState<Key[]>([]);
	const [deletingConfigId, setDeletingConfigId] = useState<number | null>(null);
	const [deletingMessageId, setDeletingMessageId] = useState<string | null>(
		null,
	);
	const [batchDeletingMessages, setBatchDeletingMessages] = useState(false);
	const [form] = Form.useForm();

	const loadData = useCallback(async () => {
		setLoading(true);
		const [configResult, messageResult, domainResult, mailboxResult] =
			await Promise.all([
				requestData<{ list: SendConfigRecord[] }>(
					() => sendingContract.getConfigs(),
					t(sendingConfigsI18n.fetchConfigsFailed),
				),
				requestData<{ list: OutboundMessageRecord[] }>(
					() => sendingContract.getMessages({ page: 1, pageSize: 50 }),
					t(sendingConfigsI18n.fetchHistoryFailed),
				),
				requestData<{ list: DomainOption[] }>(
					() => sendingContract.getDomains({ page: 1, pageSize: 100 }),
					t(sendingConfigsI18n.fetchDomainsFailed),
					{ silent: true },
				),
				requestData<{ list: MailboxOption[] }>(
					() => sendingContract.getMailboxes({ page: 1, pageSize: 100 }),
					t(sendingConfigsI18n.fetchMailboxesFailed),
					{ silent: true },
				),
			]);
		setConfigs(configResult?.list || []);
		setMessages(messageResult?.list || []);
		setDomains((domainResult?.list || []).filter((item) => item.canSend));
		setMailboxes(
			(mailboxResult?.list || []).filter((item) => item.domain?.canSend),
		);
		setLoading(false);
	}, [t]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void loadData();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [loadData]);

	const handleSend = async (values: {
		domainId: number;
		mailboxId?: number;
		from: string;
		to: string;
		subject: string;
		text?: string;
		html?: string;
	}) => {
		const recipients = parseRecipientInput(values.to);
		setSendLoading(true);
		const result = await requestData(
			() =>
				sendingContract.send({
					domainId: values.domainId,
					mailboxId: values.mailboxId || undefined,
					from: values.from,
					to: recipients,
					subject: values.subject,
					text: values.text,
					html: values.html,
				}),
			t(sendingConfigsI18n.sendTestFailed),
		);
		if (result) {
			setSendVisible(false);
			form.resetFields();
			await loadData();
		}
		setSendLoading(false);
	};

	const handleDeleteConfig = useCallback(
		async (record: SendConfigRecord) => {
			setDeletingConfigId(record.id);
			const result = await requestData<{ deleted: boolean }>(
				() => sendingContract.deleteConfig(record.id),
				t(sendingConfigsI18n.deleteConfigFailed),
			);
			if (result?.deleted) {
				message.success(
					t(sendingConfigsI18n.deletedConfig, {
						domain: record.domain?.name || t(sendingConfigsI18n.currentDomain),
					}),
				);
				await loadData();
			}
			setDeletingConfigId(null);
		},
		[loadData, t],
	);

	const handleDeleteMessage = useCallback(
		async (record: OutboundMessageRecord) => {
			setDeletingMessageId(record.id);
			const result = await requestData<{ deleted: number }>(
				() => sendingContract.deleteMessage(record.id),
				t(sendingConfigsI18n.deleteHistoryFailed),
			);
			if (result) {
				message.success(
					t(sendingConfigsI18n.clearedHistory, { count: result.deleted }),
				);
				setSelectedMessageIds((prev) =>
					prev.filter((item) => item !== record.id),
				);
				await loadData();
			}
			setDeletingMessageId(null);
		},
		[loadData, t],
	);

	const handleBatchDeleteMessages = useCallback(async () => {
		if (selectedMessageIds.length === 0) {
			message.warning(t(sendingConfigsI18n.selectHistoryBeforeDelete));
			return;
		}

		setBatchDeletingMessages(true);
		const result = await requestData<{ deleted: number }>(
			() =>
				sendingContract.batchDeleteMessages(
					selectedMessageIds.map((item) => String(item)),
				),
			t(sendingConfigsI18n.batchDeleteHistoryFailed),
		);
		if (result) {
			message.success(
				t(sendingConfigsI18n.clearedHistory, { count: result.deleted }),
			);
			setSelectedMessageIds([]);
			await loadData();
		}
		setBatchDeletingMessages(false);
	}, [loadData, selectedMessageIds, t]);

	const { configColumns, messageColumns } = useMemo(
		() =>
			createSendingConfigColumns({
				t,
				deletingConfigId,
				deletingMessageId,
				handleDeleteConfig,
				handleDeleteMessage,
			}),
		[
			deletingConfigId,
			deletingMessageId,
			handleDeleteConfig,
			handleDeleteMessage,
			t,
		],
	);

	return (
		<div>
			<PageHeader
				title={t(adminI18n.sendingConfigs.title)}
				subtitle={t(adminI18n.sendingConfigs.subtitle)}
				extra={
					<Space wrap>
						<Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
							{t(adminI18n.common.refresh)}
						</Button>
						<Button
							type="primary"
							icon={<SendOutlined />}
							onClick={() => setSendVisible(true)}
						>
							{t(adminI18n.sendingConfigs.sendTestMail)}
						</Button>
					</Space>
				}
			/>
			<Space orientation="vertical" size="large" style={fullWidthStyle}>
				<ResendSetupGuide />
				{selectedMessageIds.length > 0 ? (
					<SurfaceCard tone="muted">
						<Space
							wrap
							style={{
								width: "100%",
								justifyContent: "space-between",
								gap: 12,
							}}
						>
							<Text type="secondary">
								{t(adminI18n.sendingConfigs.selectedHistoryCount, {
									count: selectedMessageIds.length,
								})}
							</Text>
							<Popconfirm
								title={t(sendingConfigsI18n.batchDeleteHistoryConfirm, {
									count: selectedMessageIds.length,
								})}
								description={t(
									sendingConfigsI18n.batchDeleteHistoryDescription,
								)}
								onConfirm={() => void handleBatchDeleteMessages()}
							>
								<Button
									danger
									loading={batchDeletingMessages}
									icon={<DeleteOutlined />}
								>
									{t(adminI18n.sendingConfigs.clearSelected, {
										count: selectedMessageIds.length,
									})}
								</Button>
							</Popconfirm>
						</Space>
					</SurfaceCard>
				) : null}
				<SurfaceCard title={t(adminI18n.sendingConfigs.configTitle)}>
					<Table
						rowKey="id"
						loading={loading}
						columns={configColumns}
						dataSource={configs}
						pagination={false}
						locale={{ emptyText: t(adminI18n.sendingConfigs.noConfigs) }}
					/>
				</SurfaceCard>
				<SurfaceCard title={t(adminI18n.sendingConfigs.historyTitle)}>
					<Table
						rowKey="id"
						loading={loading}
						columns={messageColumns}
						dataSource={messages}
						pagination={false}
						rowSelection={{
							selectedRowKeys: selectedMessageIds,
							onChange: setSelectedMessageIds,
						}}
						locale={{ emptyText: t(adminI18n.sendingConfigs.noHistory) }}
					/>
				</SurfaceCard>
			</Space>
			<SendTestMailModal
				open={sendVisible}
				loading={sendLoading}
				form={form}
				domains={domains}
				mailboxes={mailboxes}
				onCancel={() => setSendVisible(false)}
				onConfirm={() => form.submit()}
				onFinish={handleSend}
			/>
		</div>
	);
};

export default SendingConfigsPage;

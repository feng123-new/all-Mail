import { Form, Input, Modal, Select } from "antd";
import type { FormInstance } from "antd/es/form";
import { useI18n } from "../../i18n";
import { adminI18n } from "../../i18n/catalog/admin";
import { hasOnlyValidRecipients } from "./recipientInput";
import {
	type DomainOption,
	type MailboxOption,
	sendingConfigsI18n,
} from "./shared";

interface SendTestModalProps {
	open: boolean;
	loading: boolean;
	form: FormInstance;
	domains: DomainOption[];
	mailboxes: MailboxOption[];
	onCancel: () => void;
	onConfirm: () => void;
	onFinish: (values: {
		domainId: number;
		mailboxId?: number;
		from: string;
		to: string;
		subject: string;
		text?: string;
		html?: string;
	}) => void | Promise<void>;
}

export function SendTestMailModal({
	open,
	loading,
	form,
	domains,
	mailboxes,
	onCancel,
	onConfirm,
	onFinish,
}: SendTestModalProps) {
	const { t } = useI18n();

	return (
		<Modal
			title={t(adminI18n.sendingConfigs.sendTestMail)}
			open={open}
			onCancel={onCancel}
			onOk={onConfirm}
			confirmLoading={loading}
			destroyOnHidden
			width={720}
		>
			<Form form={form} layout="vertical" onFinish={onFinish}>
				<Form.Item
					name="domainId"
					label={t(adminI18n.sendingConfigs.domain)}
					rules={[
						{
							required: true,
							message: t(sendingConfigsI18n.selectDomainRequired),
						},
					]}
				>
					<Select
						options={domains.map((item) => ({
							value: item.id,
							label: item.name,
						}))}
					/>
				</Form.Item>
				<Form.Item name="mailboxId" label={t(sendingConfigsI18n.senderMailbox)}>
					<Select
						allowClear
						options={mailboxes.map((item) => ({
							value: item.id,
							label: item.address,
						}))}
					/>
				</Form.Item>
				<Form.Item
					name="from"
					label={t(sendingConfigsI18n.senderAddress)}
					rules={[
						{
							required: true,
							message: t(sendingConfigsI18n.senderAddressRequired),
						},
						{
							type: "email",
							message: t(sendingConfigsI18n.validEmailRequired),
						},
					]}
				>
					<Input placeholder="noreply@example.com" />
				</Form.Item>
				<Form.Item
					name="to"
					label={t(sendingConfigsI18n.recipients)}
					extra={t(sendingConfigsI18n.recipientsExtra)}
					rules={[
						{
							required: true,
							message: t(sendingConfigsI18n.recipientsRequired),
						},
						{
							validator: (_, value) => {
								const normalizedValue =
									typeof value === "string" ? value.trim() : "";
								if (!normalizedValue) {
									return Promise.reject(
										new Error(t(sendingConfigsI18n.recipientsRequired)),
									);
								}
								if (!hasOnlyValidRecipients(normalizedValue)) {
									return Promise.reject(
										new Error(t(sendingConfigsI18n.recipientsInvalid)),
									);
								}
								return Promise.resolve();
							},
						},
					]}
				>
					<Input.TextArea
						rows={3}
						placeholder={t(sendingConfigsI18n.recipientsPlaceholder)}
					/>
				</Form.Item>
				<Form.Item
					name="subject"
					label={t(adminI18n.sendingConfigs.subject)}
					rules={[
						{ required: true, message: t(sendingConfigsI18n.subjectRequired) },
					]}
				>
					<Input />
				</Form.Item>
				<Form.Item name="text" label={t(sendingConfigsI18n.textBody)}>
					<Input.TextArea rows={4} />
				</Form.Item>
				<Form.Item name="html" label={t(sendingConfigsI18n.htmlBody)}>
					<Input.TextArea rows={4} />
				</Form.Item>
			</Form>
		</Modal>
	);
}

import { Alert, Button, Empty, Form, Input, Modal, Select, Space, Spin, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { requestTemporaryGmail, type GmailAppPassword } from "../../api/gmailTemporary";
import { emailsContract } from "../../contracts/admin/emails";
import { useI18n } from "../../i18n";
import { defineMessage } from "../../i18n/messages";
import { fullWidthStyle, preWrapBreakWordStyle } from "../../styles/common";
import { renderSanitizedEmailHtml } from "../../utils/mailContent";
import { requestData } from "../../utils/request";
import GmailLoginDetailsDialog from "./GmailLoginDetailsDialog";
import GmailPasswordDialog from "./GmailPasswordDialog";
import { gmailWorkspaceI18n } from "./gmailWorkspaceMessages";
import { GMAIL_RECENT_MESSAGE_LIMIT, useGmailWorkspaceMail, type GmailFolder, type GmailMessage, type GmailMessageRow } from "./useGmailWorkspaceMail";
import "./GmailWorkspace.css";

const copy = {
	inbox: defineMessage("gmailWorkspace.inbox", "收件箱", "Inbox"),
	sent: defineMessage("gmailWorkspace.sent", "已发送", "Sent"),
	connect: defineMessage("gmailWorkspace.connect", "通过 Google 连接", "Connect with Google"),
	configure: defineMessage("gmailWorkspace.configure", "配置 Google OAuth", "Configure Google OAuth"),
	password: defineMessage("gmailWorkspace.password", "应用专用密码", "App password"),
	refresh: defineMessage("gmailWorkspace.refresh", "刷新", "Refresh"),
	account: defineMessage("gmailWorkspace.account", "Gmail 账号筛选", "Filter by Gmail account"),
	allAccounts: defineMessage("gmailWorkspace.allAccounts", "全部 Gmail 账号", "All Gmail accounts"),
	recent: defineMessage("gmailWorkspace.recent", "每个账号最多显示 {count} 封近期邮件。", "Shows up to {count} recent messages per account."),
	temporary: defineMessage("gmailWorkspace.temporary", "仅当前工作区", "Workspace only"),
	reconnect: defineMessage("gmailWorkspace.reconnect", "重新连接 {email}", "Reconnect {email}"),
	readOnly: defineMessage("gmailWorkspace.readOnly", "通过 Google 添加可发信账号前，请在 OAuth 配置中选择‘发件’权限。已有只读账号需要重新授权。", "For Gmail sending, select the Send profile in OAuth settings, then reconnect any read-only accounts."),
	authorizeFailed: defineMessage("gmailWorkspace.authorizeFailed", "无法启动 Google 授权。", "Could not start Google authorization."),
	invalidUrl: defineMessage("gmailWorkspace.invalidUrl", "Google 返回了无效的授权链接。", "Google returned an invalid authorization URL."),
	accountsFailed: defineMessage("gmailWorkspace.accountsFailed", "无法加载 Gmail 账号。", "Could not load Gmail accounts."),
	mailFailed: defineMessage("gmailWorkspace.mailFailed", "无法加载 {email} 的邮件。", "Could not load mail for {email}."),
	detailFailed: defineMessage("gmailWorkspace.detailFailed", "无法加载邮件详情。", "Could not load the message."),
	noAccounts: defineMessage("gmailWorkspace.noAccounts", "没有已启用的 Gmail 账号。", "No enabled Gmail accounts."),
	noMessages: defineMessage("gmailWorkspace.noMessages", "此文件夹没有邮件。", "No messages in this folder."),
	noSubject: defineMessage("gmailWorkspace.noSubject", "（无主题）", "(No subject)"),
	noBody: defineMessage("gmailWorkspace.noBody", "此邮件没有正文。", "This message has no body."),
	source: defineMessage("gmailWorkspace.source", "来源账号", "Source account"),
	compose: defineMessage("gmailWorkspace.compose", "写邮件", "Compose"),
	from: defineMessage("gmailWorkspace.from", "发件人", "From"),
	to: defineMessage("gmailWorkspace.to", "收件人", "To"),
	subject: defineMessage("gmailWorkspace.subject", "主题", "Subject"),
	body: defineMessage("gmailWorkspace.body", "正文", "Message"),
	send: defineMessage("gmailWorkspace.send", "发送", "Send"),
	sendFailed: defineMessage("gmailWorkspace.sendFailed", "发送邮件失败。", "Could not send the message."),
	sentNotice: defineMessage("gmailWorkspace.sentNotice", "邮件已发送。", "Message sent."),
	noSenders: defineMessage("gmailWorkspace.noSenders", "没有可发送邮件的 Gmail 账号。", "No Gmail account can send mail."),
	chooseSender: defineMessage("gmailWorkspace.chooseSender", "选择发件账号", "Choose a sender"),
	recipientRequired: defineMessage("gmailWorkspace.recipientRequired", "至少填写一个收件地址。", "Enter at least one recipient."),
	subjectRequired: defineMessage("gmailWorkspace.subjectRequired", "请填写主题。", "Enter a subject."),
	bodyRequired: defineMessage("gmailWorkspace.bodyRequired", "请填写正文。", "Enter a message."),
};

interface GmailWorkspaceProps {
	gmailConfigured: boolean;
	onConfigure: () => void;
	minimalScope?: boolean;
	authorizationRevision?: number;
	onSaved?: () => void;
}

type ComposeValues = { from: number | string; to: string; subject: string; text: string };

const silent = { silent: true };

export default function GmailWorkspace({
	gmailConfigured, onConfigure, minimalScope = false, authorizationRevision = 0, onSaved,
}: GmailWorkspaceProps) {
	const { t } = useI18n();
	const [folder, setFolder] = useState<GmailFolder>("INBOX");
	const [filter, setFilter] = useState<number | string>();
	const [passwordOpen, setPasswordOpen] = useState(false);
	const [loginDetailsOpen, setLoginDetailsOpen] = useState(false);
	const [temporary, setTemporary] = useState(() => new Map<string, GmailAppPassword>());
	const [accountsRevision, setAccountsRevision] = useState(0);
	const [mailRevision, setMailRevision] = useState(0);
	const [selected, setSelected] = useState<GmailMessageRow>();
	const [detail, setDetail] = useState<GmailMessage | null>();
	const [composeOpen, setComposeOpen] = useState(false);
	const [sending, setSending] = useState(false);
	const [sendFailed, setSendFailed] = useState(false);
	const [sentNotice, setSentNotice] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [connectError, setConnectError] = useState<typeof copy.authorizeFailed>();
	const { accounts, savedAccounts, accountLoadFailed, folderResult } = useGmailWorkspaceMail(
		folder, mailRevision, `${authorizationRevision}:${accountsRevision}`, temporary,
	);
	const senders = accounts?.filter((account) => account.capabilitySummary?.sendMail === true) ?? [];
	const loginAccounts = savedAccounts?.flatMap(({ id, email }) => typeof id === "number" ? [{ id, email }] : []) ?? [];

	useEffect(() => {
		if (!selected) return;
		const controller = new AbortController();
		const { account, message, uidValidity } = selected;
		const id = account.id;
		const credential = typeof id === "string" ? temporary.get(id) : undefined;
		void requestData<GmailMessage>(
			() => typeof id === "number"
				? emailsContract.viewMailDetail(id, selected.folder, message.id, controller.signal)
				: credential && uidValidity
					? requestTemporaryGmail(credential, { operation: "detail", mailbox: selected.folder, messageId: message.id, uidValidity }, controller.signal)
					: Promise.resolve(null),
			copy.detailFailed,
			silent,
		).then((result) => {
			if (!controller.signal.aborted) setDetail(result);
		});
		return () => controller.abort();
	}, [selected, temporary]);

	async function connectGoogle(emailId?: number) {
		if (!gmailConfigured || connecting) return;
		setConnecting(true);
		setConnectError(undefined);
		const result = await requestData<{ authUrl: string }>(
			() => emailsContract.startAuthorization("GMAIL", emailId === undefined ? {} : { emailId }),
			copy.authorizeFailed,
			silent,
		);
		if (!result) {
			setConnectError(copy.authorizeFailed);
		} else {
			const url = URL.parse(result.authUrl);
			if (url?.protocol === "https:" && url.host === "accounts.google.com" && !url.username && !url.password) {
				window.location.assign(url.href);
				return;
			}
			setConnectError(copy.invalidUrl);
		}
		setConnecting(false);
	}

	async function connectWithPassword(credential: GmailAppPassword, save: boolean) {
		if (accounts?.some((account) => account.email.toLowerCase() === credential.email && typeof account.id === "number")) return false;
		const connected = await requestData(
			() => requestTemporaryGmail(credential, { operation: "list", mailbox: "INBOX" }),
			copy.accountsFailed, silent,
		);
		if (!connected) return false;
		const id = `temporary:${credential.email}`;
		if (save) {
			const saved = await requestData(
				() => emailsContract.create({ provider: "GMAIL", authType: "APP_PASSWORD", ...credential }),
				copy.accountsFailed, silent,
			);
			if (!saved) return false;
			setTemporary((current) => {
				if (!current.has(id)) return current;
				const next = new Map(current);
				next.delete(id);
				return next;
			});
			onSaved?.();
		} else {
			setTemporary((current) => new Map(current).set(id, credential));
		}
		setFilter(undefined);
		setAccountsRevision((revision) => revision + 1);
		return true;
	}

	async function send(values: ComposeValues) {
		if (sending || !senders.some((account) => account.id === values.from)) return;
		setSending(true);
		setSendFailed(false);
		const id = values.from;
		const credential = typeof id === "string" ? temporary.get(id) : undefined;
		const payload = {
			to: values.to.split(/[,;\n]/).map((address) => address.trim()).filter(Boolean),
			subject: values.subject.trim(), text: values.text,
		};
		const result = await requestData(
			() => typeof id === "number"
				? emailsContract.sendMail(id, payload)
				: credential ? requestTemporaryGmail(credential, { operation: "send", message: payload }) : Promise.resolve(null),
			copy.sendFailed,
			silent,
		);
		setSending(false);
		if (!result) {
			setSendFailed(true);
			return;
		}
		setComposeOpen(false);
		setSentNotice(true);
		if (folder === "SENT") setMailRevision((revision) => revision + 1);
	}

	const rows = folderResult?.rows.filter((row) => filter === undefined || row.account.id === filter) ?? [];
	const mailbox = accounts?.length === 0 ? (
		<Empty description={t(copy.noAccounts)} />
	) : !folderResult ? (
		<Spin />
	) : (
		<Space orientation="vertical" style={fullWidthStyle}>
			{folderResult.failures.filter((account) => filter === undefined || account.id === filter).map((account) => (
				<Alert key={account.id} type="warning" showIcon title={t(copy.mailFailed, { email: account.email })} />
			))}
			{!folderResult.loading && !rows.length && !folderResult.failures.length && (
				<Empty description={t(copy.noMessages)} />
			)}
			{folderResult.loading && <Spin />}
			<ul className="gmail-workspace__messages">
			{rows.map((row) => (
				<li key={JSON.stringify([row.account.id, row.folder, row.message.id])}>
					<Space orientation="vertical" size={0}>
						<Button type="link" onClick={() => {
							setDetail(undefined);
							setSelected(row);
						}}>
							{row.message.subject || t(copy.noSubject)}
						</Button>
						<Space wrap>
							<Typography.Text className="gmail-workspace__text" type="secondary" aria-label={t(copy.source)}>{row.account.email}</Typography.Text>
							<Typography.Text className="gmail-workspace__text" type="secondary">{row.folder === "INBOX" ? row.message.from : row.message.to}</Typography.Text>
							{row.message.date && <Typography.Text type="secondary"><time dateTime={row.message.date}>{row.message.date}</time></Typography.Text>}
						</Space>
					</Space>
				</li>
			))}
			</ul>
		</Space>
	);

	return (
		<Space orientation="vertical" style={fullWidthStyle}>
			<Space wrap>
				{gmailConfigured ? (
					<Button type="primary" loading={connecting} onClick={() => void connectGoogle()}>{t(copy.connect)}</Button>
				) : (
					<Button onClick={onConfigure}>{t(copy.configure)}</Button>
				)}
				<Button onClick={() => setPasswordOpen(true)}>{t(copy.password)}</Button>
				{loginAccounts.length > 0 && <Button onClick={() => setLoginDetailsOpen(true)}>{t(gmailWorkspaceI18n.loginDetails)}</Button>}
				<Button onClick={() => setAccountsRevision((revision) => revision + 1)}>{t(copy.refresh)}</Button>
				<Button disabled={!senders.length} onClick={() => {
					setSendFailed(false);
					setSentNotice(false);
					setComposeOpen(true);
				}}>{t(copy.compose)}</Button>
			</Space>
			{gmailConfigured && minimalScope && (
				<Alert type="info" showIcon title={t(copy.readOnly)} action={<Button onClick={onConfigure}>{t(copy.configure)}</Button>} />
			)}
			{gmailConfigured && !minimalScope && accounts?.filter((account) =>
				account.authType === "GOOGLE_OAUTH" && (account.status === "ERROR" || !account.capabilitySummary?.sendMail),
			).map((account) => typeof account.id === "number" && (
				<Button className="gmail-workspace__reconnect" key={account.id} disabled={connecting} onClick={() => void connectGoogle(Number(account.id))}>
					{t(copy.reconnect, { email: account.email })}
				</Button>
			))}
			{accountLoadFailed && <Alert type="error" showIcon title={t(copy.accountsFailed)} />}
			{accounts?.length && !senders.length ? <Typography.Text type="secondary">{t(copy.noSenders)}</Typography.Text> : null}
			{connectError && <Alert type="error" showIcon title={t(connectError)} />}
			{sentNotice && <Alert type="success" showIcon title={t(copy.sentNotice)} />}
			{Boolean(accounts?.length) && (
				<>
					<Select
						aria-label={t(copy.account)} placeholder={t(copy.allAccounts)} showSearch allowClear
						style={fullWidthStyle} value={filter} onChange={setFilter} optionFilterProp="label"
						options={accounts?.map((account) => ({ value: account.id, label: typeof account.id === "number" ? account.email : `${account.email} (${t(copy.temporary)})` }))}
					/>
					<Typography.Text type="secondary">{t(copy.recent, { count: GMAIL_RECENT_MESSAGE_LIMIT })}</Typography.Text>
				</>
			)}
			<Tabs
				activeKey={folder}
				onChange={(key) => {
					setFolder(key === "SENT" ? "SENT" : "INBOX");
				}}
				animated={false}
				items={([
					["INBOX", copy.inbox],
					["SENT", copy.sent],
				] as const).map(([key, label]) => ({ key, label: t(label), children: key === folder ? mailbox : null }))}
			/>
			{passwordOpen && <GmailPasswordDialog onConnect={connectWithPassword} onClose={() => setPasswordOpen(false)} />}
			{loginDetailsOpen && loginAccounts.length > 0 && <GmailLoginDetailsDialog
				accounts={loginAccounts} initialId={typeof filter === "number" ? filter : undefined}
				onClose={() => setLoginDetailsOpen(false)}
			/>}
			{selected && <Modal
				open
				title={selected.message.subject || t(copy.noSubject)}
				onCancel={() => setSelected(undefined)}
				footer={null}
			>
				<Space orientation="vertical" style={fullWidthStyle}>
					<Typography.Text type="secondary">{t(copy.source)}: {selected.account.email}</Typography.Text>
					{detail === undefined ? <Spin /> : detail === null ? (
						<Alert type="error" showIcon title={t(copy.detailFailed)} />
					) : (
						<div style={preWrapBreakWordStyle}>{detail.text || (detail.html && renderSanitizedEmailHtml(detail.html)) || t(copy.noBody)}</div>
					)}
				</Space>
			</Modal>}
			{composeOpen && <Modal
				open
				title={t(copy.compose)}
				footer={null}
				destroyOnHidden
				closable={!sending}
				onCancel={() => { if (!sending) setComposeOpen(false); }}
			>
				<Form<ComposeValues>
					name="gmail-compose"
					layout="vertical"
					initialValues={{ from: senders.length === 1 ? senders[0].id : undefined }}
					onFinish={(values) => void send(values)}
					disabled={sending}
				>
					<Form.Item name="from" label={t(copy.from)} rules={[{ required: true, message: t(copy.chooseSender) }]}>
						<Select placeholder={t(copy.chooseSender)} options={senders.map((account) => ({ value: account.id, label: account.email }))} />
					</Form.Item>
					<Form.Item name="to" label={t(copy.to)} rules={[{ required: true, pattern: /[^\s,;]/, message: t(copy.recipientRequired) }]}>
						<Input />
					</Form.Item>
					<Form.Item name="subject" label={t(copy.subject)} rules={[{ required: true, whitespace: true, message: t(copy.subjectRequired) }]}>
						<Input maxLength={500} />
					</Form.Item>
					<Form.Item name="text" label={t(copy.body)} rules={[{ required: true, whitespace: true, message: t(copy.bodyRequired) }]}>
						<Input.TextArea />
					</Form.Item>
					<Space orientation="vertical" style={fullWidthStyle}>
						{sendFailed && <Alert type="error" showIcon title={t(copy.sendFailed)} />}
						<Form.Item noStyle shouldUpdate>
							{({ getFieldValue }) => (
								<Button type="primary" htmlType="submit" loading={sending} disabled={!senders.some((account) => account.id === getFieldValue("from"))}>
									{t(copy.send)}
								</Button>
							)}
						</Form.Item>
					</Space>
				</Form>
			</Modal>}
		</Space>
	);
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Drawer, Form, Input, List, Select, Segmented, Space, Spin, Tag, Typography, message as antdMessage } from 'antd';
import { mailboxPortalApi } from '../../../api';
import { requestData } from '../../../utils/request';
import { PageHeader } from '../../../components';
import { renderPlainTextWithLinks, renderSanitizedEmailHtml } from '../../../utils/mailContent';

const { Text, Paragraph } = Typography;
type MailFolder = 'inbox' | 'sent';

interface MailboxItem {
    id: number;
    address: string;
    displayName?: string | null;
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
    domain?: { id: number; name: string; canSend?: boolean; canReceive?: boolean };
}

interface MessageItem {
    id: string;
    fromAddress: string;
    subject?: string | null;
    textPreview?: string | null;
    htmlPreview?: string | null;
    verificationCode?: string | null;
    routeKind?: string | null;
    receivedAt: string;
    mailbox?: { id: number; address: string } | null;
    isRead: boolean;
}

interface SentMessageItem {
    id: string;
    fromAddress: string;
    toAddresses: string[];
    subject?: string | null;
    status: string;
    providerMessageId?: string | null;
    createdAt: string;
    mailbox?: { id: number; address: string } | null;
}

interface SendFormValues {
    to: string;
    subject: string;
    text: string;
}

const MailPortalInboxPage: React.FC = () => {
    const [folder, setFolder] = useState<MailFolder>('inbox');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [sentMessages, setSentMessages] = useState<SentMessageItem[]>([]);
    const [selectedMailboxId, setSelectedMailboxId] = useState<number | undefined>(undefined);
    const [selectedMessage, setSelectedMessage] = useState<Record<string, unknown> | null>(null);
    const [detailVisible, setDetailVisible] = useState(false);
    const [composeVisible, setComposeVisible] = useState(false);
    const [sending, setSending] = useState(false);
    const [form] = Form.useForm<SendFormValues>();

    const mailboxOptions = useMemo(() => mailboxes.map((item) => ({ value: item.id, label: item.address })), [mailboxes]);
    const selectedMailbox = useMemo(() => mailboxes.find((item) => item.id === selectedMailboxId), [mailboxes, selectedMailboxId]);
    const canSend = Boolean(selectedMailbox?.domain?.canSend);

    const loadMailboxes = useCallback(async () => {
        const result = await requestData<MailboxItem[]>(() => mailboxPortalApi.getMailboxes(), '获取邮箱列表失败');
        if (result) {
            setMailboxes(result);
            if (!selectedMailboxId && result[0]) {
                setSelectedMailboxId(result[0].id);
            }
        }
    }, [selectedMailboxId]);

    const loadInboxMessages = useCallback(async (mailboxId?: number) => {
        setLoading(true);
        const result = await requestData<{ list: MessageItem[] }>(() => mailboxPortalApi.getMessages({ mailboxId }), '获取消息列表失败');
        if (result) {
            setMessages(result.list);
        }
        setLoading(false);
    }, []);

    const loadSentMessages = useCallback(async (mailboxId?: number) => {
        if (!mailboxId) {
            setSentMessages([]);
            return;
        }
        setLoading(true);
        const result = await requestData<{ list: SentMessageItem[] }>(() => mailboxPortalApi.getSentMessages({ mailboxId }), '获取发件列表失败');
        if (result) {
            setSentMessages(result.list);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadMailboxes();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadMailboxes]);

    useEffect(() => {
        if (selectedMailboxId) {
            const timer = window.setTimeout(() => {
                if (folder === 'inbox') {
                    void loadInboxMessages(selectedMailboxId);
                } else {
                    void loadSentMessages(selectedMailboxId);
                }
            }, 0);
            return () => window.clearTimeout(timer);
        }
        return undefined;
    }, [folder, loadInboxMessages, loadSentMessages, selectedMailboxId]);

    const openInboxMessage = async (id: string) => {
        setDetailLoading(true);
        setDetailVisible(true);
        const result = await requestData<Record<string, unknown>>(() => mailboxPortalApi.getMessage(id), '获取消息详情失败');
        if (result) {
            setSelectedMessage(result);
        }
        setDetailLoading(false);
    };

    const openSentMessage = async (id: string) => {
        setDetailLoading(true);
        setDetailVisible(true);
        const result = await requestData<Record<string, unknown>>(() => mailboxPortalApi.getSentMessage(id), '获取发件详情失败');
        if (result) {
            setSelectedMessage(result);
        }
        setDetailLoading(false);
    };

    const handleSend = async (values: SendFormValues) => {
        if (!selectedMailboxId) {
            antdMessage.error('请先选择一个可发件邮箱');
            return;
        }

        const recipients = values.to
            .split(/[\n,;]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (recipients.length === 0) {
            antdMessage.error('请至少填写一个收件人');
            return;
        }

        setSending(true);
        const result = await requestData<Record<string, unknown>>(
            () => mailboxPortalApi.sendMessage({
                mailboxId: selectedMailboxId,
                to: recipients,
                subject: values.subject,
                text: values.text,
            }),
            '发送邮件失败'
        );
        setSending(false);

        if (!result) {
            return;
        }

        antdMessage.success('邮件发送成功');
        form.resetFields();
        setComposeVisible(false);
        setFolder('sent');
        await loadSentMessages(selectedMailboxId);
    };

    const renderMessageBody = () => {
        const htmlPreview = String(selectedMessage?.htmlPreview || selectedMessage?.htmlBody || '').trim();
        const textPreview = String(selectedMessage?.textPreview || selectedMessage?.textBody || '').trim();

        return (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {htmlPreview ? (
                    <Card size="small" title="HTML 内容">
                        <div>{renderSanitizedEmailHtml(htmlPreview)}</div>
                    </Card>
                ) : null}
                {textPreview ? (
                    <Card size="small" title={htmlPreview ? '文本内容' : '正文'}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderPlainTextWithLinks(textPreview)}</div>
                    </Card>
                ) : null}
                {!htmlPreview && !textPreview ? (
                    <Card size="small" title="正文">
                        <div>-</div>
                    </Card>
                ) : null}
            </Space>
        );
    };

    return (
        <div>
            <PageHeader
                title="收/发件箱"
                subtitle="按邮箱维度查看收件、发件，并且对可发件邮箱直接发送邮件。"
                extra={(
                    <Space wrap>
                        <Segmented<MailFolder>
                            value={folder}
                            onChange={(value) => setFolder(value)}
                            options={[
                                { label: '收件箱', value: 'inbox' },
                                { label: '发件箱', value: 'sent' },
                            ]}
                        />
                        <Select style={{ minWidth: 260 }} value={selectedMailboxId} onChange={setSelectedMailboxId} options={mailboxOptions} placeholder="选择邮箱" />
                        <Button type="primary" onClick={() => setComposeVisible(true)} disabled={!canSend || !selectedMailboxId}>写邮件</Button>
                    </Space>
                )}
            />
            {!canSend && folder === 'sent' ? <Alert style={{ marginBottom: 16 }} type="info" showIcon message="当前邮箱所属域名为收件专用域名，只能查看收件，不能发送邮件。" /> : null}
            <Card>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
                ) : (
                    folder === 'inbox' ? (
                        <List
                            itemLayout="vertical"
                            dataSource={messages}
                            locale={{ emptyText: '暂无收件邮件' }}
                            renderItem={(item) => (
                                <List.Item key={item.id} onClick={() => void openInboxMessage(item.id)} style={{ cursor: 'pointer' }}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                                        <Space wrap>
                                            <Text strong>{item.subject || '(无主题)'}</Text>
                                            {item.verificationCode ? <Tag color="magenta">验证码 {item.verificationCode}</Tag> : null}
                                            {item.routeKind ? <Tag>{item.routeKind}</Tag> : null}
                                        </Space>
                                        <Text type="secondary">来自 {item.fromAddress} · 送达 {item.mailbox?.address || '-'}</Text>
                                        <Paragraph ellipsis={{ rows: 2, expandable: false }} style={{ marginBottom: 0 }}>
                                            {item.textPreview || item.htmlPreview || '无预览'}
                                        </Paragraph>
                                        <Text type="secondary">{new Date(item.receivedAt).toLocaleString()}</Text>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    ) : (
                        <List
                            itemLayout="vertical"
                            dataSource={sentMessages}
                            locale={{ emptyText: canSend ? '暂无发件记录' : '当前邮箱不可发件' }}
                            renderItem={(item) => (
                                <List.Item key={item.id} onClick={() => void openSentMessage(item.id)} style={{ cursor: 'pointer' }}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                                        <Space wrap>
                                            <Text strong>{item.subject || '(无主题)'}</Text>
                                            <Tag color={item.status === 'SENT' ? 'green' : item.status === 'FAILED' ? 'red' : 'default'}>{item.status}</Tag>
                                        </Space>
                                        <Text type="secondary">发件人 {item.fromAddress} · 收件人 {item.toAddresses.join(', ') || '-'}</Text>
                                        <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    )
                )}
            </Card>
            <Drawer title={String(selectedMessage?.subject || '邮件详情')} open={detailVisible} onClose={() => setDetailVisible(false)} width={720}>
                {detailLoading ? <Spin /> : (
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        <Text><strong>发件人：</strong>{String(selectedMessage?.fromAddress || '-')}</Text>
                        <Text><strong>收件地址：</strong>{String(selectedMessage?.toAddress || selectedMessage?.toAddresses || '-')}</Text>
                        {folder === 'inbox' ? <Text><strong>命中路由：</strong>{String(selectedMessage?.routeKind || '-')}</Text> : null}
                        {folder === 'inbox' ? <Text><strong>验证码：</strong>{String(selectedMessage?.verificationCode || '-')}</Text> : null}
                        {folder === 'sent' ? <Text><strong>发送状态：</strong>{String(selectedMessage?.status || '-')}</Text> : null}
                        {folder === 'sent' ? <Text><strong>Provider Message ID：</strong>{String(selectedMessage?.providerMessageId || '-')}</Text> : null}
                        {renderMessageBody()}
                    </Space>
                )}
            </Drawer>
            <Drawer title={selectedMailbox ? `写邮件 · ${selectedMailbox.address}` : '写邮件'} open={composeVisible} onClose={() => setComposeVisible(false)} width={640} destroyOnHidden>
                <Form form={form} layout="vertical" onFinish={handleSend} initialValues={{ to: '', subject: '', text: '' }}>
                    {!canSend ? <Alert style={{ marginBottom: 16 }} type="warning" showIcon message="当前邮箱所属域名未开启发件能力，请切换到已允许发件的域名邮箱。" /> : null}
                    <Form.Item label="收件人" name="to" rules={[{ required: true, message: '请填写收件人' }]} extra="支持多个地址，使用逗号、分号或换行分隔。">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：alice@example.com, bob@example.com" />
                    </Form.Item>
                    <Form.Item label="主题" name="subject" rules={[{ required: true, message: '请填写主题' }]}>
                        <Input maxLength={500} placeholder="请输入邮件主题" />
                    </Form.Item>
                    <Form.Item label="正文" name="text" rules={[{ required: true, message: '请填写正文' }]}>
                        <Input.TextArea autoSize={{ minRows: 10, maxRows: 18 }} placeholder="请输入正文，正文里的链接会按普通邮件发送。" />
                    </Form.Item>
                    <Space>
                        <Button onClick={() => setComposeVisible(false)}>取消</Button>
                        <Button type="primary" htmlType="submit" loading={sending} disabled={!canSend || !selectedMailboxId}>发送</Button>
                    </Space>
                </Form>
            </Drawer>
        </div>
    );
};

export default MailPortalInboxPage;

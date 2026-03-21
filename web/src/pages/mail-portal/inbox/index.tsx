import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Drawer, Form, Input, List, Row, Segmented, Select, Space, Spin, Switch, Tag, Typography, message as antdMessage, Empty } from 'antd';
import { CopyOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import { mailboxPortalApi } from '../../../api';
import { requestData } from '../../../utils/request';
import { renderPlainTextWithLinks, renderSanitizedEmailHtml } from '../../../utils/mailContent';

const { Text, Paragraph, Title } = Typography;
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
    const [searchParams, setSearchParams] = useSearchParams();
    const [folder, setFolder] = useState<MailFolder>('inbox');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [sentMessages, setSentMessages] = useState<SentMessageItem[]>([]);
    const [selectedMailboxId, setSelectedMailboxId] = useState<number | undefined>(undefined);
    const [selectedMessage, setSelectedMessage] = useState<Record<string, unknown> | null>(null);
    const [detailVisible, setDetailVisible] = useState(false);
    const [composeVisible, setComposeVisible] = useState(() => searchParams.get('compose') === '1');
    const [sending, setSending] = useState(false);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [keyword, setKeyword] = useState('');
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

    const loadInboxMessages = useCallback(async (mailboxId?: number, unread: boolean = false) => {
        setLoading(true);
        const result = await requestData<{ list: MessageItem[] }>(() => mailboxPortalApi.getMessages({ mailboxId, unreadOnly: unread, page: 1, pageSize: 50 }), '获取消息列表失败');
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
        const result = await requestData<{ list: SentMessageItem[] }>(() => mailboxPortalApi.getSentMessages({ mailboxId, page: 1, pageSize: 50 }), '获取发件列表失败');
        if (result) {
            setSentMessages(result.list);
        }
        setLoading(false);
    }, []);

    const reloadCurrentFolder = useCallback(async () => {
        if (folder === 'inbox') {
            await loadInboxMessages(selectedMailboxId, unreadOnly);
        } else {
            await loadSentMessages(selectedMailboxId);
        }
    }, [folder, loadInboxMessages, loadSentMessages, selectedMailboxId, unreadOnly]);

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
                    void loadInboxMessages(selectedMailboxId, unreadOnly);
                } else {
                    void loadSentMessages(selectedMailboxId);
                }
            }, 0);
            return () => window.clearTimeout(timer);
        }
        return undefined;
    }, [folder, loadInboxMessages, loadSentMessages, selectedMailboxId, unreadOnly]);

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
        setSearchParams(() => new URLSearchParams());
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

    const filteredInboxMessages = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (!normalizedKeyword) {
            return messages;
        }
        return messages.filter((item) => [item.subject, item.fromAddress, item.textPreview, item.verificationCode, item.mailbox?.address]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedKeyword)));
    }, [keyword, messages]);

    const filteredSentMessages = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (!normalizedKeyword) {
            return sentMessages;
        }
        return sentMessages.filter((item) => [item.subject, item.fromAddress, item.toAddresses.join(','), item.mailbox?.address, item.status]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedKeyword)));
    }, [keyword, sentMessages]);

    const inboxStats = useMemo(() => ({
        total: messages.length,
        unread: messages.filter((item) => !item.isRead).length,
        withCode: messages.filter((item) => Boolean(item.verificationCode)).length,
    }), [messages]);

    const sentStats = useMemo(() => ({
        total: sentMessages.length,
        sent: sentMessages.filter((item) => item.status === 'SENT').length,
        failed: sentMessages.filter((item) => item.status === 'FAILED').length,
    }), [sentMessages]);

    const handleCopy = async (value: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(value);
            antdMessage.success(successMessage);
        } catch {
            antdMessage.error('复制失败，请手动复制');
        }
    };

    const listData = folder === 'inbox' ? filteredInboxMessages : filteredSentMessages;

    return (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <Card
                bordered={false}
                style={{
                    borderRadius: 24,
                    background: 'radial-gradient(circle at top left, rgba(88, 101, 242, 0.16), transparent 34%), linear-gradient(135deg, #ffffff 0%, #eef4ff 58%, #f8fbff 100%)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                }}
                styles={{ body: { padding: 28 } }}
            >
                <Row gutter={[20, 20]} align="middle">
                    <Col xs={24} xl={14}>
                        <Space direction="vertical" size={14} style={{ width: '100%' }}>
                            <Space wrap>
                                <Tag color="blue">Mail Workspace</Tag>
                                <Tag color="cyan">{folder === 'inbox' ? '收件视图' : '发件视图'}</Tag>
                                {selectedMailbox ? <Tag color={canSend ? 'success' : 'default'}>{canSend ? '可发件邮箱' : '仅收件邮箱'}</Tag> : null}
                            </Space>
                            <div>
                                <Title level={2} style={{ margin: 0 }}>{folder === 'inbox' ? '收件工作区' : '发件工作区'}</Title>
                                <Paragraph style={{ margin: '10px 0 0', color: '#475569' }}>
                                    按邮箱查看入站或发件记录，快速提取验证码、筛选未读、复制邮箱地址，并在允许发件时直接写邮件。
                                </Paragraph>
                            </div>
                            {selectedMailbox ? (
                                <Space wrap>
                                    <Tag color="processing">{selectedMailbox.address}</Tag>
                                    <Tag>{selectedMailbox.domain?.name || '-'}</Tag>
                                    <Tag color={selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
                                        {selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? `转发 ${selectedMailbox.forwardMode}` : '未转发'}
                                    </Tag>
                                </Space>
                            ) : null}
                        </Space>
                    </Col>
                    <Col xs={24} xl={10}>
                        <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                            <Segmented<MailFolder>
                                value={folder}
                                onChange={(value) => setFolder(value)}
                                options={[
                                    { label: '收件箱', value: 'inbox' },
                                    { label: '发件箱', value: 'sent' },
                                ]}
                            />
                            <Button icon={<ReloadOutlined />} onClick={() => void reloadCurrentFolder()}>刷新</Button>
                            <Button type="primary" icon={<SendOutlined />} onClick={() => setComposeVisible(true)} disabled={!canSend || !selectedMailboxId}>写邮件</Button>
                        </Space>
                    </Col>
                </Row>
            </Card>

            {!canSend && folder === 'sent' ? <Alert type="info" showIcon message="当前邮箱所属域名为收件专用域名，只能查看收件，不能发送邮件。" /> : null}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={7}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 22 } }}>
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>邮箱选择</Title>
                                    <Text type="secondary">先切换到目标邮箱，再处理收件、发件或验证码。</Text>
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>如果当前邮箱显示“仅收件”，右上角写邮件按钮会自动禁用；切换到可发件邮箱后即可发送。</Text>
                                <Select style={{ width: '100%' }} value={selectedMailboxId} onChange={setSelectedMailboxId} options={mailboxOptions} placeholder="选择邮箱" />
                                {selectedMailbox ? (
                                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                        <div>
                                            <Text type="secondary">当前邮箱</Text>
                                            <div style={{ fontWeight: 700, marginTop: 4 }}>{selectedMailbox.address}</div>
                                        </div>
                                        <div>
                                            <Text type="secondary">域名</Text>
                                            <div>{selectedMailbox.domain?.name || '-'}</div>
                                        </div>
                                        <Space wrap>
                                            <Tag color={canSend ? 'success' : 'default'}>{canSend ? '可发件' : '仅收件'}</Tag>
                                            <Tag color={selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? 'purple' : 'default'}>
                                                {selectedMailbox.forwardMode && selectedMailbox.forwardMode !== 'DISABLED' ? `转发 ${selectedMailbox.forwardMode}` : '未转发'}
                                            </Tag>
                                        </Space>
                                        <Button icon={<CopyOutlined />} onClick={() => void handleCopy(selectedMailbox.address, '邮箱地址已复制')}>复制邮箱地址</Button>
                                    </Space>
                                ) : null}
                            </Space>
                        </Card>

                        <Row gutter={[12, 12]}>
                            <Col span={12}>
                                <Card bordered={false} style={{ borderRadius: 20, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 18 } }}>
                                    <Text type="secondary">{folder === 'inbox' ? '当前消息数' : '发件记录'}</Text>
                                    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{folder === 'inbox' ? inboxStats.total : sentStats.total}</div>
                                </Card>
                            </Col>
                            <Col span={12}>
                                <Card bordered={false} style={{ borderRadius: 20, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 18 } }}>
                                    <Text type="secondary">{folder === 'inbox' ? '未读 / 验证码' : '成功 / 失败'}</Text>
                                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                                        {folder === 'inbox' ? `${inboxStats.unread} / ${inboxStats.withCode}` : `${sentStats.sent} / ${sentStats.failed}`}
                                    </div>
                                </Card>
                            </Col>
                        </Row>

                        <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 22 } }}>
                            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                <div>
                                    <Title level={5} style={{ margin: 0 }}>工作区过滤器</Title>
                                    <Text type="secondary">可以先缩窄范围，再打开详情。</Text>
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>关键词会同时匹配主题、发件人、验证码和邮箱地址；“只看未读”更适合快速处理新验证码。</Text>
                                {folder === 'inbox' ? (
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Text>只看未读</Text>
                                        <Switch checked={unreadOnly} onChange={setUnreadOnly} />
                                    </Space>
                                ) : null}
                                <Input
                                    prefix={<SearchOutlined />}
                                    value={keyword}
                                    onChange={(event) => setKeyword(event.target.value)}
                                    placeholder={folder === 'inbox' ? '按主题、发件人、验证码搜索' : '按主题、收件人、状态搜索'}
                                />
                            </Space>
                        </Card>
                    </Space>
                </Col>

                <Col xs={24} xl={17}>
                    <Card bordered={false} style={{ borderRadius: 24, border: '1px solid rgba(148, 163, 184, 0.18)' }} styles={{ body: { padding: 22 } }}>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: 56 }}><Spin /></div>
                        ) : listData.length === 0 ? (
                            <Empty description={folder === 'inbox' ? '暂无符合条件的收件邮件' : '暂无符合条件的发件记录'} />
                        ) : folder === 'inbox' ? (
                            <List
                                itemLayout="vertical"
                                dataSource={filteredInboxMessages}
                                renderItem={(item) => (
                                    <List.Item key={item.id} style={{ cursor: 'pointer' }} onClick={() => void openInboxMessage(item.id)}>
                                        <Space direction="vertical" style={{ width: '100%' }} size={6}>
                                            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                                                <Space wrap>
                                                    <Text strong>{item.subject || '(无主题)'}</Text>
                                                    {item.verificationCode ? <Tag color="magenta">验证码 {item.verificationCode}</Tag> : null}
                                                    {item.routeKind ? <Tag>{item.routeKind}</Tag> : null}
                                                    <Tag color={item.isRead ? 'default' : 'blue'}>{item.isRead ? '已读' : '未读'}</Tag>
                                                </Space>
                                                {item.verificationCode ? (
                                                    <Button
                                                        type="link"
                                                        icon={<CopyOutlined />}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            void handleCopy(item.verificationCode || '', '验证码已复制');
                                                        }}
                                                    >
                                                        复制验证码
                                                    </Button>
                                                ) : null}
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
                                dataSource={filteredSentMessages}
                                renderItem={(item) => (
                                    <List.Item key={item.id} style={{ cursor: 'pointer' }} onClick={() => void openSentMessage(item.id)}>
                                        <Space direction="vertical" style={{ width: '100%' }} size={6}>
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
                        )}
                    </Card>
                </Col>
            </Row>

            <Drawer title={String(selectedMessage?.subject || '邮件详情')} open={detailVisible} onClose={() => setDetailVisible(false)} width={760}>
                {detailLoading ? <Spin /> : (
                    <Space direction="vertical" style={{ width: '100%' }} size={14}>
                        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Text><strong>发件人：</strong>{String(selectedMessage?.fromAddress || '-')}</Text>
                            {folder === 'inbox' && String(selectedMessage?.verificationCode || '').trim() ? (
                                <Button icon={<CopyOutlined />} onClick={() => void handleCopy(String(selectedMessage?.verificationCode || ''), '验证码已复制')}>
                                    复制验证码
                                </Button>
                            ) : null}
                        </Space>
                        <Text><strong>收件地址：</strong>{String(selectedMessage?.toAddress || selectedMessage?.toAddresses || '-')}</Text>
                        {folder === 'inbox' ? <Text><strong>命中路由：</strong>{String(selectedMessage?.routeKind || '-')}</Text> : null}
                        {folder === 'inbox' ? <Text><strong>验证码：</strong>{String(selectedMessage?.verificationCode || '-')}</Text> : null}
                        {folder === 'sent' ? <Text><strong>发送状态：</strong>{String(selectedMessage?.status || '-')}</Text> : null}
                        {folder === 'sent' ? <Text><strong>Provider Message ID：</strong>{String(selectedMessage?.providerMessageId || '-')}</Text> : null}
                        {renderMessageBody()}
                    </Space>
                )}
            </Drawer>

            <Drawer
                title={selectedMailbox ? `写邮件 · ${selectedMailbox.address}` : '写邮件'}
                open={composeVisible}
                onClose={() => {
                    setComposeVisible(false);
                    setSearchParams(() => new URLSearchParams());
                }}
                width={680}
                destroyOnHidden
            >
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
        </Space>
    );
};

export default MailPortalInboxPage;

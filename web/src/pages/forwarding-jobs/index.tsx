import { ReloadOutlined } from '@ant-design/icons';
import { Button, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, SurfaceCard } from '../../components';
import { forwardingJobsContract } from '../../contracts/admin/forwardingJobs';
import { adminI18n } from '../../i18n/catalog/admin';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import {
  fullWidthStyle,
  preWrapBreakWordStyle,
  width160Style,
  width180Style,
  width220Style,
  width260Style,
} from '../../styles/common';
import { requestData } from '../../utils/request';

const { Link, Text } = Typography;
const { Search } = Input;

const forwardingJobsI18n = {
  fetchDomainsFailed: defineMessage('forwardingJobs.fetchDomainsFailed', '获取域名失败', 'Failed to load domains'),
  fetchMailboxesFailed: defineMessage('forwardingJobs.fetchMailboxesFailed', '获取邮箱失败', 'Failed to load mailboxes'),
  fetchListFailed: defineMessage('forwardingJobs.fetchListFailed', '获取转发任务失败', 'Failed to load forwarding jobs'),
  fetchDetailFailed: defineMessage('forwardingJobs.fetchDetailFailed', '获取转发任务详情失败', 'Failed to load forwarding job details'),
  requeueFailed: defineMessage('forwardingJobs.requeueFailed', '重新入队失败', 'Failed to requeue the forwarding job'),
  requeued: defineMessage('forwardingJobs.requeued', '转发任务已重新入队', 'Forwarding job requeued'),
  mailbox: defineMessage('forwardingJobs.mailbox', '邮箱', 'Mailbox'),
  noSubject: defineMessage('forwardingJobs.noSubject', '(无主题)', '(No subject)'),
  statusLabel: defineMessage('forwardingJobs.detail.statusLabel', '状态：', 'Status: '),
  modeLabel: defineMessage('forwardingJobs.detail.modeLabel', '模式：', 'Mode: '),
  targetAddressLabel: defineMessage('forwardingJobs.detail.targetAddressLabel', '目标地址：', 'Target address: '),
  attemptCountLabel: defineMessage('forwardingJobs.detail.attemptCountLabel', '尝试次数：', 'Attempt count: '),
  nextRetryLabel: defineMessage('forwardingJobs.detail.nextRetryLabel', '下次重试：', 'Next retry: '),
  processedAtLabel: defineMessage('forwardingJobs.detail.processedAtLabel', '处理时间：', 'Processed at: '),
  createdAtLabel: defineMessage('forwardingJobs.detail.createdAtLabel', '创建时间：', 'Created at: '),
  updatedAtLabel: defineMessage('forwardingJobs.detail.updatedAtLabel', '更新时间：', 'Updated at: '),
  providerMessageIdLabel: defineMessage('forwardingJobs.detail.providerMessageIdLabel', '服务商消息 ID：', 'Provider message ID: '),
  mailboxLabel: defineMessage('forwardingJobs.detail.mailboxLabel', '邮箱：', 'Mailbox: '),
  mailboxModeLabel: defineMessage('forwardingJobs.detail.mailboxModeLabel', '邮箱模式：', 'Mailbox mode: '),
  currentForwardingLabel: defineMessage('forwardingJobs.detail.currentForwardingLabel', '当前转发配置：', 'Current forwarding config: '),
  domainLabel: defineMessage('forwardingJobs.detail.domainLabel', '域名：', 'Domain: '),
  domainCapabilityLabel: defineMessage('forwardingJobs.detail.domainCapabilityLabel', '域名能力：', 'Domain capability: '),
  receiveEnabled: defineMessage('forwardingJobs.detail.receiveEnabled', '收件开启', 'Inbound enabled'),
  receiveDisabled: defineMessage('forwardingJobs.detail.receiveDisabled', '收件关闭', 'Inbound disabled'),
  sendEnabled: defineMessage('forwardingJobs.detail.sendEnabled', '发件开启', 'Sending enabled'),
  sendDisabled: defineMessage('forwardingJobs.detail.sendDisabled', '发件关闭', 'Sending disabled'),
  messageIdLabel: defineMessage('forwardingJobs.detail.messageIdLabel', '消息 ID：', 'Message ID: '),
  originalSenderLabel: defineMessage('forwardingJobs.detail.originalSenderLabel', '原始发件人：', 'Original sender: '),
  subjectLabel: defineMessage('forwardingJobs.detail.subjectLabel', '主题：', 'Subject: '),
  matchedAddressLabel: defineMessage('forwardingJobs.detail.matchedAddressLabel', '命中地址：', 'Matched address: '),
  finalAddressLabel: defineMessage('forwardingJobs.detail.finalAddressLabel', '最终地址：', 'Final address: '),
  routeTypeLabel: defineMessage('forwardingJobs.detail.routeTypeLabel', '路由类型：', 'Route type: '),
  portalVisibilityLabel: defineMessage('forwardingJobs.detail.portalVisibilityLabel', '门户可见性：', 'Portal visibility: '),
  receivedAtLabel: defineMessage('forwardingJobs.detail.receivedAtLabel', '接收时间：', 'Received at: '),
  contentPreviewLabel: defineMessage('forwardingJobs.detail.contentPreviewLabel', '内容预览：', 'Content preview: '),
  present: defineMessage('forwardingJobs.detail.present', '有', 'Yes'),
  absent: defineMessage('forwardingJobs.detail.absent', '无', 'No'),
  pending: defineMessage('forwardingJobs.status.pending', '待处理', 'Pending'),
  running: defineMessage('forwardingJobs.status.running', '处理中', 'Running'),
  sent: defineMessage('forwardingJobs.status.sent', '已发送', 'Sent'),
  failed: defineMessage('forwardingJobs.status.failed', '失败', 'Failed'),
  skipped: defineMessage('forwardingJobs.status.skipped', '已跳过', 'Skipped'),
  modeCopy: defineMessage('forwardingJobs.mode.copy', '保留副本并转发', 'Keep a copy and forward'),
  modeMove: defineMessage('forwardingJobs.mode.move', '转发后作为唯一副本', 'Forward and remove the original copy'),
} as const;

type ForwardingJobStatus = 'PENDING' | 'RUNNING' | 'SENT' | 'FAILED' | 'SKIPPED';
type ForwardingJobMode = 'COPY' | 'MOVE';

interface DomainOption {
  id: number;
  name: string;
}

interface MailboxOption {
  id: number;
  address: string;
}

interface ForwardingJobRow {
  id: string;
  inboundMessageId: string;
  mailboxId: number | null;
  domainId: number;
  mode: ForwardingJobMode;
  forwardTo: string;
  status: ForwardingJobStatus;
  attemptCount: number;
  providerMessageId?: string | null;
  nextAttemptAt?: string | null;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
  mailbox?: { id: number; address: string; provisioningMode: string } | null;
  domain?: { id: number; name: string; canSend: boolean; canReceive: boolean } | null;
  inboundMessage?: {
    id: string;
    fromAddress: string;
    subject?: string | null;
    matchedAddress: string;
    finalAddress: string;
    routeKind?: string | null;
    receivedAt: string;
    portalState: string;
  };
}

interface ForwardingJobDetail extends ForwardingJobRow {
  mailbox?: {
    id: number;
    address: string;
    provisioningMode: string;
    forwardMode: string;
    forwardTo?: string | null;
  } | null;
  inboundMessage?: ForwardingJobRow['inboundMessage'] & {
    hasTextPreview: boolean;
    hasHtmlPreview: boolean;
  };
}

const STATUS_OPTIONS: Array<{ value: ForwardingJobStatus; label: ReturnType<typeof defineMessage> }> = [
  { value: 'PENDING', label: forwardingJobsI18n.pending },
  { value: 'RUNNING', label: forwardingJobsI18n.running },
  { value: 'SENT', label: forwardingJobsI18n.sent },
  { value: 'FAILED', label: forwardingJobsI18n.failed },
  { value: 'SKIPPED', label: forwardingJobsI18n.skipped },
];

const MODE_OPTIONS: Array<{ value: ForwardingJobMode; label: ReturnType<typeof defineMessage> }> = [
  { value: 'COPY', label: forwardingJobsI18n.modeCopy },
  { value: 'MOVE', label: forwardingJobsI18n.modeMove },
];

function getStatusLabel(status: ForwardingJobStatus) {
  switch (status) {
    case 'PENDING':
      return forwardingJobsI18n.pending;
    case 'RUNNING':
      return forwardingJobsI18n.running;
    case 'SENT':
      return forwardingJobsI18n.sent;
    case 'FAILED':
      return forwardingJobsI18n.failed;
    case 'SKIPPED':
      return forwardingJobsI18n.skipped;
    default:
      return forwardingJobsI18n.pending;
  }
}

function getModeLabel(mode: ForwardingJobMode) {
  return mode === 'COPY' ? forwardingJobsI18n.modeCopy : forwardingJobsI18n.modeMove;
}

function getStatusColor(status: ForwardingJobStatus) {
  switch (status) {
    case 'PENDING':
      return 'blue';
    case 'RUNNING':
      return 'processing';
    case 'SENT':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'SKIPPED':
      return 'default';
    default:
      return 'default';
  }
}

function getModeColor(mode: ForwardingJobMode) {
  return mode === 'COPY' ? 'purple' : 'geekblue';
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

const ForwardingJobsPage: FC = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobs, setJobs] = useState<ForwardingJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<ForwardingJobStatus | undefined>();
  const [mode, setMode] = useState<ForwardingJobMode | undefined>();
  const [domainId, setDomainId] = useState<number | undefined>();
  const [mailboxId, setMailboxId] = useState<number | undefined>();
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>();
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [detail, setDetail] = useState<ForwardingJobDetail | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    const [domainResult, mailboxResult] = await Promise.all([
      requestData<{ list: DomainOption[] }>(() => forwardingJobsContract.getDomains({ page: 1, pageSize: 100 }), t(forwardingJobsI18n.fetchDomainsFailed), { silent: true }),
      requestData<{ list: MailboxOption[] }>(() => forwardingJobsContract.getMailboxes({ page: 1, pageSize: 100 }), t(forwardingJobsI18n.fetchMailboxesFailed), { silent: true }),
    ]);
    setDomains(domainResult?.list || []);
    setMailboxes(mailboxResult?.list || []);
  }, [t]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const result = await requestData<{ list: ForwardingJobRow[]; total: number; page: number; pageSize: number }>(
      () => forwardingJobsContract.getList({ page, pageSize, status, mode, domainId, mailboxId, keyword }),
      t(forwardingJobsI18n.fetchListFailed)
    );
    if (result) {
      setJobs(result.list);
      setTotal(result.total);
      setPage(result.page);
      setPageSize(result.pageSize);
    }
    setLoading(false);
  }, [domainId, keyword, mailboxId, mode, page, pageSize, status, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOptions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadJobs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const result = await requestData<ForwardingJobDetail>(() => forwardingJobsContract.getById(id), t(forwardingJobsI18n.fetchDetailFailed));
    if (result) {
      setDetail(result);
      setDrawerVisible(true);
    }
    setDetailLoading(false);
  }, [t]);

  const handleRequeue = useCallback(async (id: string) => {
    setRequeueingId(id);
    const result = await requestData(() => forwardingJobsContract.requeue(id), t(forwardingJobsI18n.requeueFailed));
    if (result) {
      message.success(t(forwardingJobsI18n.requeued));
      await loadJobs();
      if (drawerVisible && detail?.id === id) {
        await openDetail(id);
      }
    }
    setRequeueingId(null);
  }, [detail?.id, drawerVisible, loadJobs, openDetail, t]);

  const columns: ColumnsType<ForwardingJobRow> = useMemo(() => [
    {
      title: t(adminI18n.forwardingJobs.jobId),
      dataIndex: 'id',
      key: 'id',
      width: 180,
      render: (value: string, record) => (
        <Space size={8}>
          <Link onClick={() => void openDetail(record.id)}>{value}</Link>
          <Text copyable={{ text: value }} />
        </Space>
      ),
    },
    {
      title: t(adminI18n.common.status),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: ForwardingJobStatus) => <Tag color={getStatusColor(value)}>{t(getStatusLabel(value))}</Tag>,
    },
    {
      title: t(adminI18n.forwardingJobs.mode),
      dataIndex: 'mode',
      key: 'mode',
      width: 100,
      render: (value: ForwardingJobMode) => <Tag color={getModeColor(value)}>{t(getModeLabel(value))}</Tag>,
    },
    {
      title: t(adminI18n.forwardingJobs.target),
      dataIndex: 'forwardTo',
      key: 'forwardTo',
      width: 220,
      ellipsis: true,
    },
    {
      title: t(adminI18n.sendingConfigs.domain),
      key: 'domain',
      width: 160,
      render: (_value, record) => record.domain?.name || '-',
    },
    {
      title: t(forwardingJobsI18n.mailbox),
      key: 'mailbox',
      width: 220,
      render: (_value, record) => record.mailbox?.address || '-',
    },
    {
      title: t(adminI18n.forwardingJobs.originalSender),
      key: 'fromAddress',
      width: 220,
      ellipsis: true,
      render: (_value, record) => record.inboundMessage?.fromAddress || '-',
    },
    {
      title: t(adminI18n.sendingConfigs.subject),
      key: 'subject',
      ellipsis: true,
      render: (_value, record) => record.inboundMessage?.subject || t(forwardingJobsI18n.noSubject),
    },
    {
      title: t(adminI18n.forwardingJobs.attemptCount),
      dataIndex: 'attemptCount',
      key: 'attemptCount',
      width: 100,
      align: 'right',
    },
    {
      title: t(adminI18n.forwardingJobs.nextRetry),
      dataIndex: 'nextAttemptAt',
      key: 'nextAttemptAt',
      width: 180,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: t(adminI18n.forwardingJobs.processedAt),
      dataIndex: 'processedAt',
      key: 'processedAt',
      width: 180,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: t(adminI18n.common.createdAt),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t(adminI18n.common.actions),
      key: 'actions',
      width: 140,
      render: (_value, record) => (
        record.status === 'FAILED' || record.status === 'SKIPPED' ? (
          <Popconfirm
            title={t(adminI18n.forwardingJobs.requeueConfirm)}
            description={t(adminI18n.forwardingJobs.requeueDescription)}
            onConfirm={() => void handleRequeue(record.id)}
          >
            <Button loading={requeueingId === record.id}>{t(adminI18n.forwardingJobs.requeue)}</Button>
          </Popconfirm>
        ) : <Typography.Text type="secondary">-</Typography.Text>
      ),
    },
  ], [handleRequeue, openDetail, requeueingId, t]);

  return (
    <div>
      <PageHeader
        title={t(adminI18n.forwardingJobs.title)}
        subtitle={t(adminI18n.forwardingJobs.subtitle)}
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder={t(adminI18n.forwardingJobs.filterStatus)}
              style={width160Style}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={STATUS_OPTIONS.map((item) => ({ ...item, label: t(item.label) }))}
            />
            <Select
              allowClear
              placeholder={t(adminI18n.forwardingJobs.filterMode)}
              style={width160Style}
              value={mode}
              onChange={(value) => {
                setMode(value);
                setPage(1);
              }}
              options={MODE_OPTIONS.map((item) => ({ ...item, label: t(item.label) }))}
            />
            <Select
              allowClear
              placeholder={t(adminI18n.forwardingJobs.filterDomain)}
              style={width180Style}
              value={domainId}
              onChange={(value) => {
                setDomainId(value);
                setPage(1);
              }}
              options={domains.map((item) => ({ value: item.id, label: item.name }))}
            />
            <Select
              allowClear
              placeholder={t(adminI18n.forwardingJobs.filterMailbox)}
              style={width220Style}
              value={mailboxId}
              onChange={(value) => {
                setMailboxId(value);
                setPage(1);
              }}
              options={mailboxes.map((item) => ({ value: item.id, label: item.address }))}
            />
            <Search
              allowClear
              placeholder={t(adminI18n.forwardingJobs.search)}
              style={width260Style}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => {
                const nextKeyword = value.trim();
                setKeyword(nextKeyword || undefined);
                setKeywordInput(value);
                setPage(1);
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void loadJobs()}>
              {t(adminI18n.common.refresh)}
            </Button>
          </Space>
        }
      />

      <SurfaceCard>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={jobs}
          scroll={{ x: 1800 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (value) => t(adminI18n.common.totalCount, { count: value }),
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: t(adminI18n.forwardingJobs.empty) }}
        />
      </SurfaceCard>

      <Drawer
        title={`${t(adminI18n.forwardingJobs.title)} ${detail?.id || ''}`}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setDetail(null);
        }}
        size={760}
        loading={detailLoading}
      >
        <Space orientation="vertical" style={fullWidthStyle} size={16}>
          <SurfaceCard size="small" title={t(adminI18n.forwardingJobs.statusCard)} tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>{t(forwardingJobsI18n.statusLabel)}</strong><Tag color={detail?.status ? getStatusColor(detail.status) : 'default'}>{detail?.status ? t(getStatusLabel(detail.status)) : '-'}</Tag></Text>
              <Text><strong>{t(forwardingJobsI18n.modeLabel)}</strong>{detail?.mode ? <Tag color={getModeColor(detail.mode)}>{t(getModeLabel(detail.mode))}</Tag> : '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.targetAddressLabel)}</strong>{detail?.forwardTo || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.attemptCountLabel)}</strong>{detail?.attemptCount ?? '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.providerMessageIdLabel)}</strong>{detail?.providerMessageId || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.nextRetryLabel)}</strong>{formatDateTime(detail?.nextAttemptAt)}</Text>
              <Text><strong>{t(forwardingJobsI18n.processedAtLabel)}</strong>{formatDateTime(detail?.processedAt)}</Text>
              <Text><strong>{t(forwardingJobsI18n.createdAtLabel)}</strong>{formatDateTime(detail?.createdAt)}</Text>
              <Text><strong>{t(forwardingJobsI18n.updatedAtLabel)}</strong>{formatDateTime(detail?.updatedAt)}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title={t(adminI18n.forwardingJobs.mailboxContext)} tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>{t(forwardingJobsI18n.mailboxLabel)}</strong>{detail?.mailbox?.address || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.mailboxModeLabel)}</strong>{detail?.mailbox?.provisioningMode || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.currentForwardingLabel)}</strong>{detail?.mailbox ? `${detail.mailbox.forwardMode ? t(getModeLabel(detail.mailbox.forwardMode as ForwardingJobMode)) : '-'} / ${detail.mailbox.forwardTo || '-'}` : '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.domainLabel)}</strong>{detail?.domain?.name || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.domainCapabilityLabel)}</strong>{detail?.domain ? `${detail.domain.canReceive ? t(forwardingJobsI18n.receiveEnabled) : t(forwardingJobsI18n.receiveDisabled)} / ${detail.domain.canSend ? t(forwardingJobsI18n.sendEnabled) : t(forwardingJobsI18n.sendDisabled)}` : '-'}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title={t(adminI18n.forwardingJobs.inboundContext)} tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>{t(forwardingJobsI18n.messageIdLabel)}</strong>{detail?.inboundMessageId || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.originalSenderLabel)}</strong>{detail?.inboundMessage?.fromAddress || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.subjectLabel)}</strong>{detail?.inboundMessage?.subject || t(forwardingJobsI18n.noSubject)}</Text>
              <Text><strong>{t(forwardingJobsI18n.matchedAddressLabel)}</strong>{detail?.inboundMessage?.matchedAddress || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.finalAddressLabel)}</strong>{detail?.inboundMessage?.finalAddress || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.routeTypeLabel)}</strong>{detail?.inboundMessage?.routeKind || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.portalVisibilityLabel)}</strong>{detail?.inboundMessage?.portalState || '-'}</Text>
              <Text><strong>{t(forwardingJobsI18n.receivedAtLabel)}</strong>{formatDateTime(detail?.inboundMessage?.receivedAt)}</Text>
              <Text><strong>{t(forwardingJobsI18n.contentPreviewLabel)}</strong>{detail?.inboundMessage ? `text=${detail.inboundMessage.hasTextPreview ? t(forwardingJobsI18n.present) : t(forwardingJobsI18n.absent)}, html=${detail.inboundMessage.hasHtmlPreview ? t(forwardingJobsI18n.present) : t(forwardingJobsI18n.absent)}` : '-'}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title={t(adminI18n.forwardingJobs.diagnostics)} tone="muted">
            <div style={preWrapBreakWordStyle}>{detail?.lastError || '-'}</div>
          </SurfaceCard>
        </Space>
      </Drawer>
    </div>
  );
};

export default ForwardingJobsPage;

import { ReloadOutlined } from '@ant-design/icons';
import { Button, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, SurfaceCard } from '../../components';
import { forwardingJobsContract } from '../../contracts/admin/forwardingJobs';
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

const STATUS_OPTIONS: Array<{ value: ForwardingJobStatus; label: string }> = [
  { value: 'PENDING', label: 'PENDING' },
  { value: 'RUNNING', label: 'RUNNING' },
  { value: 'SENT', label: 'SENT' },
  { value: 'FAILED', label: 'FAILED' },
  { value: 'SKIPPED', label: 'SKIPPED' },
];

const MODE_OPTIONS: Array<{ value: ForwardingJobMode; label: string }> = [
  { value: 'COPY', label: 'COPY' },
  { value: 'MOVE', label: 'MOVE' },
];

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
      requestData<{ list: DomainOption[] }>(() => forwardingJobsContract.getDomains({ page: 1, pageSize: 100 }), '获取域名失败', { silent: true }),
      requestData<{ list: MailboxOption[] }>(() => forwardingJobsContract.getMailboxes({ page: 1, pageSize: 100 }), '获取邮箱失败', { silent: true }),
    ]);
    setDomains(domainResult?.list || []);
    setMailboxes(mailboxResult?.list || []);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const result = await requestData<{ list: ForwardingJobRow[]; total: number; page: number; pageSize: number }>(
      () => forwardingJobsContract.getList({ page, pageSize, status, mode, domainId, mailboxId, keyword }),
      '获取转发任务失败'
    );
    if (result) {
      setJobs(result.list);
      setTotal(result.total);
      setPage(result.page);
      setPageSize(result.pageSize);
    }
    setLoading(false);
  }, [domainId, keyword, mailboxId, mode, page, pageSize, status]);

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
    const result = await requestData<ForwardingJobDetail>(() => forwardingJobsContract.getById(id), '获取转发任务详情失败');
    if (result) {
      setDetail(result);
      setDrawerVisible(true);
    }
    setDetailLoading(false);
  }, []);

  const handleRequeue = useCallback(async (id: string) => {
    setRequeueingId(id);
    const result = await requestData(() => forwardingJobsContract.requeue(id), '重新入队失败');
    if (result) {
      message.success('转发任务已重新入队');
      await loadJobs();
      if (drawerVisible && detail?.id === id) {
        await openDetail(id);
      }
    }
    setRequeueingId(null);
  }, [detail?.id, drawerVisible, loadJobs, openDetail]);

  const columns: ColumnsType<ForwardingJobRow> = useMemo(() => [
    {
      title: 'Job ID',
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: ForwardingJobStatus) => <Tag color={getStatusColor(value)}>{value}</Tag>,
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 100,
      render: (value: ForwardingJobMode) => <Tag color={getModeColor(value)}>{value}</Tag>,
    },
    {
      title: '目标地址',
      dataIndex: 'forwardTo',
      key: 'forwardTo',
      width: 220,
      ellipsis: true,
    },
    {
      title: '域名',
      key: 'domain',
      width: 160,
      render: (_value, record) => record.domain?.name || '-',
    },
    {
      title: '邮箱',
      key: 'mailbox',
      width: 220,
      render: (_value, record) => record.mailbox?.address || '-',
    },
    {
      title: '原始发件人',
      key: 'fromAddress',
      width: 220,
      ellipsis: true,
      render: (_value, record) => record.inboundMessage?.fromAddress || '-',
    },
    {
      title: '主题',
      key: 'subject',
      ellipsis: true,
      render: (_value, record) => record.inboundMessage?.subject || '(无主题)',
    },
    {
      title: '尝试次数',
      dataIndex: 'attemptCount',
      key: 'attemptCount',
      width: 100,
      align: 'right',
    },
    {
      title: '下次重试',
      dataIndex: 'nextAttemptAt',
      key: 'nextAttemptAt',
      width: 180,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: '处理时间',
      dataIndex: 'processedAt',
      key: 'processedAt',
      width: 180,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_value, record) => (
        record.status === 'FAILED' || record.status === 'SKIPPED' ? (
          <Popconfirm
            title="确定重新入队这条转发任务吗？"
            description="任务会重置为待处理状态，并重新进入转发执行循环。"
            onConfirm={() => void handleRequeue(record.id)}
          >
            <Button loading={requeueingId === record.id}>重新入队</Button>
          </Popconfirm>
        ) : <Typography.Text type="secondary">-</Typography.Text>
      ),
    },
  ], [handleRequeue, openDetail, requeueingId]);

  return (
    <div>
      <PageHeader
        title="转发任务"
        subtitle="查看 forwarding job 状态、失败原因、重试时间和关联入站上下文，并可把失败/跳过任务重新送回执行队列。"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="筛选状态"
              style={width160Style}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
            />
            <Select
              allowClear
              placeholder="筛选模式"
              style={width160Style}
              value={mode}
              onChange={(value) => {
                setMode(value);
                setPage(1);
              }}
              options={MODE_OPTIONS}
            />
            <Select
              allowClear
              placeholder="筛选域名"
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
              placeholder="筛选邮箱"
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
              placeholder="搜索目标地址 / 发件人 / 主题"
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
              刷新
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
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: '暂无转发任务' }}
        />
      </SurfaceCard>

      <Drawer
        title={`转发任务 ${detail?.id || ''}`}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setDetail(null);
        }}
        size={760}
        loading={detailLoading}
      >
        <Space orientation="vertical" style={fullWidthStyle} size={16}>
          <SurfaceCard size="small" title="任务状态" tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>状态：</strong><Tag color={detail?.status ? getStatusColor(detail.status) : 'default'}>{detail?.status || '-'}</Tag></Text>
              <Text><strong>模式：</strong>{detail?.mode ? <Tag color={getModeColor(detail.mode)}>{detail.mode}</Tag> : '-'}</Text>
              <Text><strong>目标地址：</strong>{detail?.forwardTo || '-'}</Text>
              <Text><strong>尝试次数：</strong>{detail?.attemptCount ?? '-'}</Text>
              <Text><strong>Provider Message ID：</strong>{detail?.providerMessageId || '-'}</Text>
              <Text><strong>下次重试：</strong>{formatDateTime(detail?.nextAttemptAt)}</Text>
              <Text><strong>处理时间：</strong>{formatDateTime(detail?.processedAt)}</Text>
              <Text><strong>创建时间：</strong>{formatDateTime(detail?.createdAt)}</Text>
              <Text><strong>更新时间：</strong>{formatDateTime(detail?.updatedAt)}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title="邮箱与域名上下文" tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>邮箱：</strong>{detail?.mailbox?.address || '-'}</Text>
              <Text><strong>邮箱模式：</strong>{detail?.mailbox?.provisioningMode || '-'}</Text>
              <Text><strong>当前转发配置：</strong>{detail?.mailbox ? `${detail.mailbox.forwardMode} / ${detail.mailbox.forwardTo || '-'}` : '-'}</Text>
              <Text><strong>域名：</strong>{detail?.domain?.name || '-'}</Text>
              <Text><strong>域名能力：</strong>{detail?.domain ? `收件 ${detail.domain.canReceive ? '开启' : '关闭'} / 发件 ${detail.domain.canSend ? '开启' : '关闭'}` : '-'}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title="关联入站消息" tone="muted">
            <Space orientation="vertical" style={fullWidthStyle}>
              <Text><strong>消息 ID：</strong>{detail?.inboundMessageId || '-'}</Text>
              <Text><strong>原始发件人：</strong>{detail?.inboundMessage?.fromAddress || '-'}</Text>
              <Text><strong>主题：</strong>{detail?.inboundMessage?.subject || '(无主题)'}</Text>
              <Text><strong>命中地址：</strong>{detail?.inboundMessage?.matchedAddress || '-'}</Text>
              <Text><strong>最终地址：</strong>{detail?.inboundMessage?.finalAddress || '-'}</Text>
              <Text><strong>路由类型：</strong>{detail?.inboundMessage?.routeKind || '-'}</Text>
              <Text><strong>门户可见性：</strong>{detail?.inboundMessage?.portalState || '-'}</Text>
              <Text><strong>接收时间：</strong>{formatDateTime(detail?.inboundMessage?.receivedAt)}</Text>
              <Text><strong>内容预览：</strong>{detail?.inboundMessage ? `text=${detail.inboundMessage.hasTextPreview ? 'yes' : 'no'}, html=${detail.inboundMessage.hasHtmlPreview ? 'yes' : 'no'}` : '-'}</Text>
            </Space>
          </SurfaceCard>

          <SurfaceCard size="small" title="失败 / 跳过诊断" tone="muted">
            <div style={preWrapBreakWordStyle}>{detail?.lastError || '-'}</div>
          </SurfaceCard>
        </Space>
      </Drawer>
    </div>
  );
};

export default ForwardingJobsPage;

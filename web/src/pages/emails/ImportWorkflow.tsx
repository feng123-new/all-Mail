import {
  CheckCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  InboxOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  type EmailAuthType,
  type EmailProvider,
  getProviderImportTemplates,
} from '../../constants/providers';
import { emailsContract } from '../../contracts/admin/emails';
import { useI18n } from '../../i18n';
import {
  getAuthTypeLabelMessage,
  getProviderLabelMessage,
} from '../../i18n/catalog/providers';
import { defineMessage, type TranslationInput } from '../../i18n/messages';
import { getErrorMessage } from '../../utils/error';
import {
  buildFailedImportContent,
  buildImportPreview,
  type ImportFailureRow,
  type ImportPreviewIssueCode,
  type ImportPreviewRow,
  parseServerImportFailures,
} from './importPreview';

const { Text, Title } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

const importWorkflowI18n = {
  title: defineMessage('emails.import.workflow.title', '批量导入邮箱', 'Import mailboxes'),
  stepInput: defineMessage('emails.import.workflow.step.input', '输入数据', 'Input'),
  stepPreview: defineMessage('emails.import.workflow.step.preview', '校验预览', 'Preview'),
  stepResult: defineMessage('emails.import.workflow.step.result', '导入结果', 'Result'),
  securityTitle: defineMessage(
    'emails.import.workflow.securityTitle',
    '凭据只用于本次导入，预览默认隐藏敏感字段',
    'Credentials are used only for this import and are masked in preview',
  ),
  securityDescription: defineMessage(
    'emails.import.workflow.securityDescription',
    '关闭窗口后会清除文本。应用专用密码、Client Secret、Refresh Token 和账号登录密码不会在预览或错误报告中明文重复展示。',
    'Closing the workflow clears the text. App passwords, client secrets, refresh tokens, and mailbox login passwords are not repeated in plain text in previews or error reports.',
  ),
  settingsHeading: defineMessage(
    'emails.import.workflow.settingsHeading',
    '导入设置',
    'Import settings',
  ),
  separatorLabel: defineMessage(
    'emails.import.workflow.separatorLabel',
    '字段分隔符',
    'Field separator',
  ),
  separatorPlaceholder: defineMessage(
    'emails.import.workflow.separatorPlaceholder',
    '例如：----',
    'For example: ----',
  ),
  groupLabel: defineMessage(
    'emails.import.workflow.groupLabel',
    '目标分组（可选）',
    'Target group (optional)',
  ),
  groupPlaceholder: defineMessage(
    'emails.import.workflow.groupPlaceholder',
    '不指定分组',
    'Leave ungrouped',
  ),
  uploadText: defineMessage(
    'emails.import.workflow.uploadText',
    '拖入 TXT / CSV，或点击选择文件',
    'Drop a TXT / CSV file here, or click to choose one',
  ),
  uploadHint: defineMessage(
    'emails.import.workflow.uploadHint',
    '文件只在浏览器中读取，不会在预览前上传。',
    'The file is read in the browser and is not uploaded before preview.',
  ),
  fileParsed: defineMessage(
    'emails.import.workflow.fileParsed',
    '已读取 {count} 行数据',
    'Read {count} data rows',
  ),
  fileReadFailed: defineMessage(
    'emails.import.workflow.fileReadFailed',
    '无法读取该文件，请确认它是 UTF-8 文本文件',
    'Could not read the file. Confirm that it is a UTF-8 text file.',
  ),
  contentLabel: defineMessage(
    'emails.import.workflow.contentLabel',
    '邮箱数据',
    'Mailbox data',
  ),
  contentHint: defineMessage(
    'emails.import.workflow.contentHint',
    '每行一个邮箱。可以混合 Outlook、Gmail、QQ、Mail.com 与自定义 IMAP / SMTP 格式。',
    'Use one mailbox per line. Outlook, Gmail, QQ, Mail.com, and custom IMAP / SMTP formats can be mixed.',
  ),
  formatExamples: defineMessage(
    'emails.import.workflow.formatExamples',
    '查看支持格式与示例',
    'View supported formats and examples',
  ),
  recommendedFormats: defineMessage(
    'emails.import.workflow.recommendedFormats',
    '常用格式',
    'Common formats',
  ),
  additionalFormats: defineMessage(
    'emails.import.workflow.additionalFormats',
    '其他兼容格式',
    'Additional compatible formats',
  ),
  previewEmpty: defineMessage(
    'emails.import.workflow.previewEmpty',
    '请先输入或上传邮箱数据',
    'Enter or upload mailbox data first',
  ),
  separatorEmpty: defineMessage(
    'emails.import.workflow.separatorEmpty',
    '请输入字段分隔符',
    'Enter a field separator',
  ),
  previewTitle: defineMessage(
    'emails.import.workflow.previewTitle',
    '格式预检完成',
    'Format preview complete',
  ),
  previewDescription: defineMessage(
    'emails.import.workflow.previewDescription',
    '前端预检用于提前发现明显格式问题；只有可导入行会被提交，服务端仍会执行最终解析、加密和校验。',
    'The browser preview catches obvious format issues early. Only importable rows are submitted, and the server still performs final parsing, encryption, and validation.',
  ),
  totalLines: defineMessage(
    'emails.import.workflow.metric.total',
    '总行数',
    'Total rows',
  ),
  importableLines: defineMessage(
    'emails.import.workflow.metric.importable',
    '可导入',
    'Importable',
  ),
  warningLines: defineMessage(
    'emails.import.workflow.metric.warning',
    '需服务端确认',
    'Server review',
  ),
  errorLines: defineMessage(
    'emails.import.workflow.metric.error',
    '需修正',
    'Needs fixes',
  ),
  providerCount: defineMessage(
    'emails.import.workflow.metric.providers',
    '供应商',
    'Providers',
  ),
  lineLabel: defineMessage(
    'emails.import.workflow.lineLabel',
    '第 {line} 行',
    'Line {line}',
  ),
  unknownMailbox: defineMessage(
    'emails.import.workflow.unknownMailbox',
    '未识别邮箱',
    'Unrecognized mailbox',
  ),
  unknownProvider: defineMessage(
    'emails.import.workflow.unknownProvider',
    '待服务端识别',
    'Server detection',
  ),
  unknownAuthType: defineMessage(
    'emails.import.workflow.unknownAuthType',
    '待确认',
    'To be confirmed',
  ),
  ready: defineMessage('emails.import.workflow.ready', '可导入', 'Ready'),
  warning: defineMessage(
    'emails.import.workflow.warning',
    '需确认',
    'Review',
  ),
  error: defineMessage('emails.import.workflow.error', '需修正', 'Fix required'),
  issueInvalidEmail: defineMessage(
    'emails.import.workflow.issue.invalidEmail',
    '邮箱地址格式无效',
    'The mailbox address is invalid',
  ),
  issueMissingFields: defineMessage(
    'emails.import.workflow.issue.missingFields',
    '缺少该格式要求的凭据或服务器字段',
    'Required credentials or server fields are missing',
  ),
  issueUnknownFormat: defineMessage(
    'emails.import.workflow.issue.unknownFormat',
    '前端无法确定格式，将交给服务端做最终识别',
    'The browser cannot determine the format; the server will make the final decision',
  ),
  issueDuplicateEmail: defineMessage(
    'emails.import.workflow.issue.duplicateEmail',
    '本批次中存在重复邮箱，请保留一行',
    'This mailbox is duplicated in the batch. Keep one row.',
  ),
  cancel: defineMessage('emails.import.workflow.cancel', '取消', 'Cancel'),
  back: defineMessage('emails.import.workflow.back', '返回修改', 'Back to edit'),
  generatePreview: defineMessage(
    'emails.import.workflow.generatePreview',
    '生成预览',
    'Generate preview',
  ),
  submitCount: defineMessage(
    'emails.import.workflow.submitCount',
    '导入 {count} 个有效邮箱',
    'Import {count} valid mailboxes',
  ),
  submitting: defineMessage(
    'emails.import.workflow.submitting',
    '正在安全导入…',
    'Importing securely…',
  ),
  noImportableRows: defineMessage(
    'emails.import.workflow.noImportableRows',
    '当前没有可提交的邮箱，请先修正错误行',
    'There are no importable mailboxes. Fix the invalid rows first.',
  ),
  successTitle: defineMessage(
    'emails.import.workflow.result.successTitle',
    '邮箱导入完成',
    'Mailbox import complete',
  ),
  partialTitle: defineMessage(
    'emails.import.workflow.result.partialTitle',
    '导入完成，但仍有数据需要处理',
    'Import complete with rows that still need attention',
  ),
  resultDescription: defineMessage(
    'emails.import.workflow.result.description',
    '成功写入 {successCount} 条；本地预检跳过 {localCount} 条；服务端拒绝 {serverCount} 条。',
    '{successCount} rows were saved; {localCount} were skipped by preview; {serverCount} were rejected by the server.',
  ),
  successMetric: defineMessage(
    'emails.import.workflow.result.successMetric',
    '成功写入',
    'Saved',
  ),
  localRejectedMetric: defineMessage(
    'emails.import.workflow.result.localRejectedMetric',
    '预检跳过',
    'Preview skipped',
  ),
  serverRejectedMetric: defineMessage(
    'emails.import.workflow.result.serverRejectedMetric',
    '服务端拒绝',
    'Server rejected',
  ),
  failuresHeading: defineMessage(
    'emails.import.workflow.result.failuresHeading',
    '失败与待修正行',
    'Failed rows and required fixes',
  ),
  localSource: defineMessage(
    'emails.import.workflow.result.localSource',
    '预检',
    'Preview',
  ),
  serverSource: defineMessage(
    'emails.import.workflow.result.serverSource',
    '服务端',
    'Server',
  ),
  serverGenericFailure: defineMessage(
    'emails.import.workflow.result.serverGenericFailure',
    '服务端拒绝了该行，请检查凭据完整性和供应商要求',
    'The server rejected this row. Check credential completeness and provider requirements.',
  ),
  serverFailureWithDetail: defineMessage(
    'emails.import.workflow.result.serverFailureWithDetail',
    '服务端校验失败：{detail}',
    'Server validation failed: {detail}',
  ),
  downloadFailed: defineMessage(
    'emails.import.workflow.result.downloadFailed',
    '下载失败行',
    'Download failed rows',
  ),
  editFailed: defineMessage(
    'emails.import.workflow.result.editFailed',
    '仅编辑失败行',
    'Edit failed rows only',
  ),
  finish: defineMessage('emails.import.workflow.finish', '完成', 'Done'),
  noFailedContent: defineMessage(
    'emails.import.workflow.noFailedContent',
    '没有可下载的失败原始行',
    'No failed source rows are available to download',
  ),
  importFailed: defineMessage(
    'emails.import.workflow.importFailed',
    '导入失败',
    'Import failed',
  ),
} as const;

const ISSUE_MESSAGES: Record<ImportPreviewIssueCode, TranslationInput> = {
  invalid_email: importWorkflowI18n.issueInvalidEmail,
  missing_required_fields: importWorkflowI18n.issueMissingFields,
  unknown_format: importWorkflowI18n.issueUnknownFormat,
  duplicate_email: importWorkflowI18n.issueDuplicateEmail,
};

interface ImportGroupOption {
  id: number;
  name: string;
}

interface MailImportWorkflowProps {
  open: boolean;
  groups: ImportGroupOption[];
  onClose: () => void;
  onImported: () => void | Promise<void>;
}

interface ImportExecutionResult {
  successCount: number;
  localRejectedCount: number;
  serverRejectedCount: number;
  failures: ImportFailureRow[];
}

const workflowStyles = {
  body: {
    display: 'grid',
    gap: 18,
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  field: {
    display: 'grid',
    gap: 7,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 10,
  },
  metric: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '12px 14px',
    background: '#f8fafc',
    display: 'grid',
    gap: 4,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 1.1,
    fontWeight: 720,
    color: '#0f172a',
  },
  rowList: {
    display: 'grid',
    gap: 10,
    maxHeight: 430,
    overflowY: 'auto' as const,
    paddingRight: 4,
  },
  previewRow: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 12,
    background: '#fff',
    display: 'grid',
    gap: 9,
  },
  rowHeader: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  maskedLine: {
    display: 'block',
    width: '100%',
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    padding: '8px 10px',
    borderRadius: 8,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },
  footer: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    gap: 10,
  },
  footerGroup: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
} as const;

function countNonEmptyLines(content: string): number {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim()).length;
}

function importableRows(rows: ImportPreviewRow[]): ImportPreviewRow[] {
  return rows.filter((row) => row.severity !== 'error');
}

const MailImportWorkflow: FC<MailImportWorkflowProps> = ({
  open,
  groups,
  onClose,
  onImported,
}) => {
  const { t } = useI18n();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [content, setContent] = useState('');
  const [separator, setSeparator] = useState('----');
  const [groupId, setGroupId] = useState<number | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [executionResult, setExecutionResult] =
    useState<ImportExecutionResult | null>(null);

  const templates = useMemo(
    () => getProviderImportTemplates(separator || '----'),
    [separator],
  );
  const preview = useMemo(
    () => buildImportPreview(content, separator),
    [content, separator],
  );
  const readyRows = useMemo(() => importableRows(preview.rows), [preview.rows]);
  const groupOptions = useMemo(
    () => groups.map((group) => ({ value: group.id, label: group.name })),
    [groups],
  );

  const resetWorkflow = useCallback(() => {
    setStep(0);
    setContent('');
    setSeparator('----');
    setGroupId(undefined);
    setSubmitting(false);
    setExecutionResult(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetWorkflow();
    }
  }, [open, resetWorkflow]);

  const closeWorkflow = useCallback(() => {
    if (submitting) {
      return;
    }
    resetWorkflow();
    onClose();
  }, [onClose, resetWorkflow, submitting]);

  const issueLabel = useCallback(
    (issueCode?: ImportPreviewIssueCode) =>
      issueCode ? t(ISSUE_MESSAGES[issueCode]) : '',
    [t],
  );

  const providerLabel = useCallback(
    (row: ImportPreviewRow) =>
      row.provider === 'UNKNOWN'
        ? t(importWorkflowI18n.unknownProvider)
        : t(getProviderLabelMessage(row.provider as EmailProvider)),
    [t],
  );

  const authTypeLabel = useCallback(
    (row: ImportPreviewRow) =>
      row.authType === 'UNKNOWN'
        ? t(importWorkflowI18n.unknownAuthType)
        : t(getAuthTypeLabelMessage(row.authType as EmailAuthType)),
    [t],
  );

  const statusMeta = useCallback(
    (row: ImportPreviewRow) => {
      if (row.severity === 'error') {
        return { color: 'error', label: t(importWorkflowI18n.error) };
      }
      if (row.severity === 'warning') {
        return { color: 'warning', label: t(importWorkflowI18n.warning) };
      }
      return { color: 'success', label: t(importWorkflowI18n.ready) };
    },
    [t],
  );

  const handleFileUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileContent = event.target?.result;
        if (typeof fileContent !== 'string') {
          message.error(t(importWorkflowI18n.fileReadFailed));
          return;
        }
        const normalizedContent = fileContent.replace(/\r\n/g, '\n').trim();
        setContent(normalizedContent);
        message.success(
          t(importWorkflowI18n.fileParsed, {
            count: countNonEmptyLines(normalizedContent),
          }),
        );
      };
      reader.onerror = () => message.error(t(importWorkflowI18n.fileReadFailed));
      reader.readAsText(file);
      return false;
    },
    [t],
  );

  const handleGeneratePreview = useCallback(() => {
    if (!content.trim()) {
      message.warning(t(importWorkflowI18n.previewEmpty));
      return;
    }
    if (!separator.trim()) {
      message.warning(t(importWorkflowI18n.separatorEmpty));
      return;
    }
    setStep(1);
  }, [content, separator, t]);

  const describeServerFailure = useCallback(
    (detail: string) => {
      const normalized = detail.toLowerCase();
      if (normalized.includes('email') && normalized.includes('invalid')) {
        return t(importWorkflowI18n.issueInvalidEmail);
      }
      if (normalized.includes('missing required')) {
        return t(importWorkflowI18n.issueMissingFields);
      }
      return t(importWorkflowI18n.serverFailureWithDetail, { detail });
    },
    [t],
  );

  const handleImport = useCallback(async () => {
    if (readyRows.length === 0) {
      message.warning(t(importWorkflowI18n.noImportableRows));
      return;
    }

    const submittedContent = readyRows.map((row) => row.raw).join('\n');
    const localFailures: ImportFailureRow[] = preview.rows
      .filter((row) => row.severity === 'error')
      .map((row) => ({
        lineNumber: row.lineNumber,
        raw: row.raw,
        message: issueLabel(row.issueCode),
        source: 'preview',
        issueCode: row.issueCode,
      }));

    setSubmitting(true);
    try {
      const response = await emailsContract.import(
        submittedContent,
        separator.trim(),
        groupId,
      );
      if (response.code !== 200) {
        message.error(t(importWorkflowI18n.importFailed));
        return;
      }

      const payload = response.data as
        | { success?: number; failed?: number; errors?: string[] }
        | undefined;
      const successCount = payload?.success ?? 0;
      const serverRejectedCount = payload?.failed ?? 0;
      const serverFailures = parseServerImportFailures(
        Array.isArray(payload?.errors) ? payload.errors : [],
        readyRows,
      ).map((failure) => ({
        ...failure,
        message: describeServerFailure(failure.message),
      }));

      for (let index = serverFailures.length; index < serverRejectedCount; index += 1) {
        serverFailures.push({
          lineNumber: null,
          raw: null,
          message: t(importWorkflowI18n.serverGenericFailure),
          source: 'server',
        });
      }

      setExecutionResult({
        successCount,
        localRejectedCount: localFailures.length,
        serverRejectedCount,
        failures: [...localFailures, ...serverFailures],
      });
      setStep(2);
      await onImported();
    } catch (error: unknown) {
      message.error(
        getErrorMessage(error, t(importWorkflowI18n.importFailed)),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    describeServerFailure,
    groupId,
    issueLabel,
    onImported,
    preview.rows,
    readyRows,
    separator,
    t,
  ]);

  const downloadFailedRows = useCallback(() => {
    const failedContent = buildFailedImportContent(executionResult?.failures || []);
    if (!failedContent) {
      message.info(t(importWorkflowI18n.noFailedContent));
      return;
    }
    const blob = new Blob([failedContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'all-mail-import-failed-rows.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [executionResult?.failures, t]);

  const editFailedRows = useCallback(() => {
    const failedContent = buildFailedImportContent(executionResult?.failures || []);
    if (!failedContent) {
      message.info(t(importWorkflowI18n.noFailedContent));
      return;
    }
    setContent(failedContent);
    setExecutionResult(null);
    setStep(0);
  }, [executionResult?.failures, t]);

  const metric = (label: string, value: number): ReactNode => (
    <div style={workflowStyles.metric}>
      <Text type="secondary">{label}</Text>
      <span style={workflowStyles.metricValue}>{value}</span>
    </div>
  );

  const renderInputStep = () => (
    <div style={workflowStyles.body} className="mail-import-workflow__input">
      <Alert
        showIcon
        type="info"
        title={t(importWorkflowI18n.securityTitle)}
        description={t(importWorkflowI18n.securityDescription)}
      />

      <div>
        <Title level={5} style={{ margin: '0 0 10px' }}>
          {t(importWorkflowI18n.settingsHeading)}
        </Title>
        <div style={workflowStyles.settingsGrid}>
          <label style={workflowStyles.field}>
            <Text strong>{t(importWorkflowI18n.separatorLabel)}</Text>
            <Input
              value={separator}
              onChange={(event) => setSeparator(event.target.value)}
              placeholder={t(importWorkflowI18n.separatorPlaceholder)}
            />
          </label>
          <label style={workflowStyles.field}>
            <Text strong>{t(importWorkflowI18n.groupLabel)}</Text>
            <Select
              allowClear
              value={groupId}
              options={groupOptions}
              placeholder={t(importWorkflowI18n.groupPlaceholder)}
              onChange={(value: number | undefined) => setGroupId(value)}
            />
          </label>
        </div>
      </div>

      <Dragger
        beforeUpload={handleFileUpload}
        showUploadList={false}
        maxCount={1}
        accept=".txt,.csv,text/plain,text/csv"
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{t(importWorkflowI18n.uploadText)}</p>
        <p className="ant-upload-hint">{t(importWorkflowI18n.uploadHint)}</p>
      </Dragger>

      <label style={workflowStyles.field}>
        <Space wrap style={{ justifyContent: 'space-between' }}>
          <span>
            <Text strong>{t(importWorkflowI18n.contentLabel)}</Text>
            <br />
            <Text type="secondary">{t(importWorkflowI18n.contentHint)}</Text>
          </span>
          {content.trim() ? (
            <Tag color="processing">
              {t(importWorkflowI18n.totalLines)}：{countNonEmptyLines(content)}
            </Tag>
          ) : null}
        </Space>
        <TextArea
          className="mail-import-workflow__textarea"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          autoSize={{ minRows: isMobile ? 11 : 9, maxRows: 18 }}
          placeholder={templates.slice(0, 4).join('\n')}
          spellCheck={false}
        />
      </label>

      <Collapse
        ghost
        items={[
          {
            key: 'format-examples',
            label: t(importWorkflowI18n.formatExamples),
            children: (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <Text strong>{t(importWorkflowI18n.recommendedFormats)}</Text>
                  <Space orientation="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                    {templates.slice(0, 3).map((template) => (
                      <Text key={template} code style={workflowStyles.maskedLine}>
                        {template}
                      </Text>
                    ))}
                  </Space>
                </div>
                <div>
                  <Text strong>{t(importWorkflowI18n.additionalFormats)}</Text>
                  <Space orientation="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                    {templates.slice(3).map((template) => (
                      <Text key={template} code style={workflowStyles.maskedLine}>
                        {template}
                      </Text>
                    ))}
                  </Space>
                </div>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );

  const renderPreviewStep = () => (
    <div style={workflowStyles.body} className="mail-import-workflow__preview">
      <Alert
        showIcon
        type={preview.errorCount > 0 ? 'warning' : 'success'}
        title={t(importWorkflowI18n.previewTitle)}
        description={t(importWorkflowI18n.previewDescription)}
      />
      <div style={workflowStyles.summaryGrid}>
        {metric(t(importWorkflowI18n.totalLines), preview.totalCount)}
        {metric(t(importWorkflowI18n.importableLines), readyRows.length)}
        {metric(t(importWorkflowI18n.warningLines), preview.warningCount)}
        {metric(t(importWorkflowI18n.errorLines), preview.errorCount)}
        {metric(t(importWorkflowI18n.providerCount), preview.providerCount)}
      </div>
      <div style={workflowStyles.rowList}>
        {preview.rows.map((row) => {
          const status = statusMeta(row);
          return (
            <div
              key={`${row.lineNumber}-${row.raw}`}
              style={workflowStyles.previewRow}
              className={`mail-import-workflow__row mail-import-workflow__row--${row.severity}`}
            >
              <div style={workflowStyles.rowHeader}>
                <Space wrap>
                  <Tag color={status.color}>{status.label}</Tag>
                  <Text strong>
                    {t(importWorkflowI18n.lineLabel, { line: row.lineNumber })}
                  </Text>
                  <Text>{row.email || t(importWorkflowI18n.unknownMailbox)}</Text>
                </Space>
                <Space wrap>
                  <Tag color="blue">{providerLabel(row)}</Tag>
                  <Tag>{authTypeLabel(row)}</Tag>
                </Space>
              </div>
              <Text code style={workflowStyles.maskedLine}>
                {row.masked}
              </Text>
              {row.issueCode ? (
                <Text type={row.severity === 'error' ? 'danger' : 'warning'}>
                  {row.severity === 'error' ? <WarningOutlined /> : null}{' '}
                  {issueLabel(row.issueCode)}
                </Text>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderResultStep = () => {
    const result = executionResult;
    if (!result) {
      return null;
    }
    const hasFailures = result.failures.length > 0;
    return (
      <div style={workflowStyles.body} className="mail-import-workflow__result">
        <Alert
          showIcon
          type={hasFailures ? 'warning' : 'success'}
          icon={hasFailures ? <WarningOutlined /> : <CheckCircleOutlined />}
          title={
            hasFailures
              ? t(importWorkflowI18n.partialTitle)
              : t(importWorkflowI18n.successTitle)
          }
          description={t(importWorkflowI18n.resultDescription, {
            successCount: result.successCount,
            localCount: result.localRejectedCount,
            serverCount: result.serverRejectedCount,
          })}
        />
        <div style={workflowStyles.summaryGrid}>
          {metric(t(importWorkflowI18n.successMetric), result.successCount)}
          {metric(
            t(importWorkflowI18n.localRejectedMetric),
            result.localRejectedCount,
          )}
          {metric(
            t(importWorkflowI18n.serverRejectedMetric),
            result.serverRejectedCount,
          )}
        </div>
        {hasFailures ? (
          <div>
            <Title level={5} style={{ margin: '0 0 10px' }}>
              {t(importWorkflowI18n.failuresHeading)}
            </Title>
            <div style={workflowStyles.rowList}>
              {result.failures.map((failure, index) => (
                <div
                  key={`${failure.source}-${failure.lineNumber ?? 'unknown'}-${index}`}
                  style={workflowStyles.previewRow}
                >
                  <Space wrap>
                    <Tag color={failure.source === 'preview' ? 'warning' : 'error'}>
                      {failure.source === 'preview'
                        ? t(importWorkflowI18n.localSource)
                        : t(importWorkflowI18n.serverSource)}
                    </Tag>
                    {failure.lineNumber ? (
                      <Text strong>
                        {t(importWorkflowI18n.lineLabel, {
                          line: failure.lineNumber,
                        })}
                      </Text>
                    ) : null}
                    <Text type="danger">{failure.message}</Text>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const workflowBody = (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Steps
        size="small"
        current={step}
        responsive={false}
        items={[
          { title: t(importWorkflowI18n.stepInput) },
          { title: t(importWorkflowI18n.stepPreview) },
          { title: t(importWorkflowI18n.stepResult) },
        ]}
      />
      {step === 0
        ? renderInputStep()
        : step === 1
          ? renderPreviewStep()
          : renderResultStep()}
    </Space>
  );

  const workflowFooter = (
    <div style={workflowStyles.footer}>
      <div style={workflowStyles.footerGroup}>
        {step === 0 ? (
          <Button onClick={closeWorkflow}>{t(importWorkflowI18n.cancel)}</Button>
        ) : null}
        {step === 1 ? (
          <Button onClick={() => setStep(0)}>{t(importWorkflowI18n.back)}</Button>
        ) : null}
        {step === 2 && executionResult?.failures.length ? (
          <>
            <Button icon={<DownloadOutlined />} onClick={downloadFailedRows}>
              {t(importWorkflowI18n.downloadFailed)}
            </Button>
            <Button icon={<EditOutlined />} onClick={editFailedRows}>
              {t(importWorkflowI18n.editFailed)}
            </Button>
          </>
        ) : null}
      </div>
      <div style={workflowStyles.footerGroup}>
        {step === 0 ? (
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={handleGeneratePreview}
          >
            {t(importWorkflowI18n.generatePreview)}
          </Button>
        ) : null}
        {step === 1 ? (
          <Button
            type="primary"
            loading={submitting}
            disabled={readyRows.length === 0}
            onClick={() => void handleImport()}
          >
            {submitting
              ? t(importWorkflowI18n.submitting)
              : t(importWorkflowI18n.submitCount, { count: readyRows.length })}
          </Button>
        ) : null}
        {step === 2 ? (
          <Button type="primary" onClick={closeWorkflow}>
            {t(importWorkflowI18n.finish)}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        title={t(importWorkflowI18n.title)}
        open={open}
        onClose={closeWorkflow}
        placement="right"
        width="100%"
        destroyOnHidden
        maskClosable={!submitting}
        closable={!submitting}
        footer={workflowFooter}
        styles={{
          body: { padding: 16, overflowY: 'auto' },
          footer: { padding: 12 },
        }}
        className="mail-import-workflow mail-import-workflow--mobile"
      >
        {workflowBody}
      </Drawer>
    );
  }

  return (
    <Modal
      title={t(importWorkflowI18n.title)}
      open={open}
      onCancel={closeWorkflow}
      footer={workflowFooter}
      width={880}
      destroyOnHidden
      maskClosable={!submitting}
      closable={!submitting}
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
      className="mail-import-workflow mail-import-workflow--desktop"
    >
      {workflowBody}
    </Modal>
  );
};

export default MailImportWorkflow;

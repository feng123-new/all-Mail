import {
  ApiOutlined,
  FileProtectOutlined,
  HistoryOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { defineMessage, type TranslationInput } from '../i18n/messages';
import { StatusBadge, type StatusTone } from './DataWorkspace';
import './ControlBoundaryContext.css';

export type ControlBoundarySurface =
  | 'api-keys'
  | 'api-docs'
  | 'audit'
  | 'admins'
  | 'settings';

const controlBoundaryI18n = {
  apiKeysTitle: defineMessage('controlBoundary.apiKeys.title', '自动化访问边界', 'Automation access boundary'),
  apiKeysDescription: defineMessage(
    'controlBoundary.apiKeys.description',
    '访问密钥必须明确权限、资源范围和速率边界；密钥值只在创建时展示一次，后续操作以使用记录和审计证据为准。',
    'API keys must have explicit permissions, resource scope, and rate boundaries. Secret values are shown once at creation; later review relies on usage and audit evidence.',
  ),
  apiDocsTitle: defineMessage('controlBoundary.apiDocs.title', '稳定调用契约', 'Stable API contract'),
  apiDocsDescription: defineMessage(
    'controlBoundary.apiDocs.description',
    'control plane API 使用固定路由、认证边界、请求 ID 和错误语义；集成代码不应依赖页面文案或未记录的兼容路径。',
    'The control-plane API uses stable routes, authentication boundaries, request IDs, and error semantics. Integrations must not depend on page copy or undocumented compatibility paths.',
  ),
  auditTitle: defineMessage('controlBoundary.audit.title', '可追溯审计证据', 'Traceable audit evidence'),
  auditDescription: defineMessage(
    'controlBoundary.audit.description',
    '审计视图围绕操作者、动作、请求 ID、响应状态和耗时组织；敏感值不会作为日志标签或列表内容暴露。',
    'Audit views are organized around actor, action, request ID, response status, and latency. Sensitive values are never exposed as log labels or list content.',
  ),
  adminsTitle: defineMessage('controlBoundary.admins.title', '管理员安全边界', 'Administrator security boundary'),
  adminsDescription: defineMessage(
    'controlBoundary.admins.description',
    '角色、二次验证和会话版本共同决定后台访问；密码、角色或安全设置变化后，旧会话必须能够被撤销。',
    'Role, two-factor verification, and session version jointly govern administrator access. Password, role, or security changes must be able to revoke older sessions.',
  ),
  settingsTitle: defineMessage('controlBoundary.settings.title', '系统安全设置', 'System security settings'),
  settingsDescription: defineMessage(
    'controlBoundary.settings.description',
    '系统设置优先处理当前账号安全和明确的运行默认值；任何敏感变更都必须经过权限、确认与服务端验证。',
    'System settings prioritize account security and explicit runtime defaults. Every sensitive change must pass authorization, confirmation, and server-side validation.',
  ),
  permissions: defineMessage('controlBoundary.signal.permissions', '显式权限', 'Explicit permissions'),
  resourceScope: defineMessage('controlBoundary.signal.resourceScope', '资源范围', 'Resource scope'),
  rateUsage: defineMessage('controlBoundary.signal.rateUsage', '速率与使用记录', 'Rate & usage'),
  auth: defineMessage('controlBoundary.signal.auth', '认证方式', 'Authentication'),
  requestId: defineMessage('controlBoundary.signal.requestId', 'Request ID', 'Request ID'),
  errors: defineMessage('controlBoundary.signal.errors', '错误语义', 'Error semantics'),
  actor: defineMessage('controlBoundary.signal.actor', '操作者', 'Actor'),
  response: defineMessage('controlBoundary.signal.response', '响应与耗时', 'Response & latency'),
  secretSafe: defineMessage('controlBoundary.signal.secretSafe', '敏感值不入日志', 'Secrets excluded'),
  role: defineMessage('controlBoundary.signal.role', '角色边界', 'Role boundary'),
  twoFactor: defineMessage('controlBoundary.signal.twoFactor', '2FA', '2FA'),
  revocation: defineMessage('controlBoundary.signal.revocation', '会话撤销', 'Session revocation'),
  password: defineMessage('controlBoundary.signal.password', '密码安全', 'Password security'),
  defaults: defineMessage('controlBoundary.signal.defaults', '运行默认值', 'Runtime defaults'),
  confirmation: defineMessage('controlBoundary.signal.confirmation', '敏感操作确认', 'Sensitive-action confirmation'),
} as const;

interface BoundarySignal {
  key: string;
  label: TranslationInput;
  tone: StatusTone;
}

interface BoundaryDefinition {
  title: TranslationInput;
  description: TranslationInput;
  icon: ReactNode;
  signals: BoundarySignal[];
}

const boundaryDefinitions: Record<ControlBoundarySurface, BoundaryDefinition> = {
  'api-keys': {
    title: controlBoundaryI18n.apiKeysTitle,
    description: controlBoundaryI18n.apiKeysDescription,
    icon: <KeyOutlined />,
    signals: [
      { key: 'permissions', label: controlBoundaryI18n.permissions, tone: 'info' },
      { key: 'scope', label: controlBoundaryI18n.resourceScope, tone: 'default' },
      { key: 'usage', label: controlBoundaryI18n.rateUsage, tone: 'success' },
    ],
  },
  'api-docs': {
    title: controlBoundaryI18n.apiDocsTitle,
    description: controlBoundaryI18n.apiDocsDescription,
    icon: <ApiOutlined />,
    signals: [
      { key: 'auth', label: controlBoundaryI18n.auth, tone: 'info' },
      { key: 'request-id', label: controlBoundaryI18n.requestId, tone: 'default' },
      { key: 'errors', label: controlBoundaryI18n.errors, tone: 'warning' },
    ],
  },
  audit: {
    title: controlBoundaryI18n.auditTitle,
    description: controlBoundaryI18n.auditDescription,
    icon: <HistoryOutlined />,
    signals: [
      { key: 'actor', label: controlBoundaryI18n.actor, tone: 'default' },
      { key: 'request-id', label: controlBoundaryI18n.requestId, tone: 'info' },
      { key: 'response', label: controlBoundaryI18n.response, tone: 'success' },
      { key: 'secret-safe', label: controlBoundaryI18n.secretSafe, tone: 'default' },
    ],
  },
  admins: {
    title: controlBoundaryI18n.adminsTitle,
    description: controlBoundaryI18n.adminsDescription,
    icon: <TeamOutlined />,
    signals: [
      { key: 'role', label: controlBoundaryI18n.role, tone: 'info' },
      { key: '2fa', label: controlBoundaryI18n.twoFactor, tone: 'success' },
      { key: 'revocation', label: controlBoundaryI18n.revocation, tone: 'warning' },
    ],
  },
  settings: {
    title: controlBoundaryI18n.settingsTitle,
    description: controlBoundaryI18n.settingsDescription,
    icon: <SettingOutlined />,
    signals: [
      { key: 'password', label: controlBoundaryI18n.password, tone: 'success' },
      { key: 'defaults', label: controlBoundaryI18n.defaults, tone: 'default' },
      { key: 'confirmation', label: controlBoundaryI18n.confirmation, tone: 'warning' },
    ],
  },
};

interface ControlBoundaryContextProps {
  surface: ControlBoundarySurface;
}

const ControlBoundaryContext = ({ surface }: ControlBoundaryContextProps) => {
  const { t } = useI18n();
  const definition = boundaryDefinitions[surface];
  const fallbackIcon = surface === 'admins' ? <SafetyCertificateOutlined /> : <FileProtectOutlined />;

  return (
    <section className="control-boundary" aria-label={t(definition.title)}>
      <div className="control-boundary__copy">
        <div className="control-boundary__title-row">
          <span className="control-boundary__icon" aria-hidden="true">
            {definition.icon || fallbackIcon}
          </span>
          <span className="control-boundary__title">{t(definition.title)}</span>
        </div>
        <span className="control-boundary__description">{t(definition.description)}</span>
      </div>
      <div className="control-boundary__signals">
        {definition.signals.map((signal) => (
          <StatusBadge key={signal.key} tone={signal.tone}>{t(signal.label)}</StatusBadge>
        ))}
      </div>
    </section>
  );
};

export default ControlBoundaryContext;

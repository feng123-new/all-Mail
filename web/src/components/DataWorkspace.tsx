import type { FC, ReactNode } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import './DataWorkspace.css';
import './ExternalMailboxTable.css';

export type WorkspaceKind =
  | 'overview'
  | 'resource'
  | 'flow'
  | 'automation'
  | 'system'
  | 'portal';

export type StatusTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

interface WorkspaceFrameProps {
  children: ReactNode;
  kind: WorkspaceKind;
  className?: string;
}

export const WorkspaceFrame: FC<WorkspaceFrameProps> = ({ children, kind, className }) => (
  <div
    className={[
      'workspace-frame',
      `workspace-frame--${kind}`,
      className,
    ].filter(Boolean).join(' ')}
    data-workspace={kind}
  >
    {children}
  </div>
);

interface DataToolbarProps {
  filters?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export const DataToolbar: FC<DataToolbarProps> = ({ filters, actions, meta, className }) => (
  <div className={['data-toolbar', className].filter(Boolean).join(' ')}>
    {filters ? <div className="data-toolbar__filters">{filters}</div> : <span />}
    {meta ? <div className="data-toolbar__meta">{meta}</div> : null}
    {actions ? <div className="data-toolbar__actions">{actions}</div> : null}
  </div>
);

interface StatusBadgeProps {
  children: ReactNode;
  icon?: ReactNode;
  tone?: StatusTone;
  className?: string;
}

export const StatusBadge: FC<StatusBadgeProps> = ({
  children,
  icon,
  tone = 'default',
  className,
}) => (
  <span
    className={['status-badge', className].filter(Boolean).join(' ')}
    data-tone={tone}
  >
    {icon ? <span aria-hidden="true">{icon}</span> : null}
    <span>{children}</span>
  </span>
);

interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export const SectionHeading: FC<SectionHeadingProps> = ({
  title,
  description,
  actions,
  className,
}) => (
  <div className={['section-heading', className].filter(Boolean).join(' ')}>
    <div className="section-heading__copy">
      <div className="section-heading__title">{title}</div>
      {description ? <div className="section-heading__description">{description}</div> : null}
    </div>
    {actions ? <div className="section-heading__actions">{actions}</div> : null}
  </div>
);

interface WorkspaceEmptyProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export const WorkspaceEmpty: FC<WorkspaceEmptyProps> = ({
  title,
  description,
  action,
  icon = <InboxOutlined />,
  className,
}) => (
  <div className={['workspace-empty', className].filter(Boolean).join(' ')}>
    <div className="workspace-empty__body">
      <span className="workspace-empty__icon" aria-hidden="true">{icon}</span>
      <div className="workspace-empty__title">{title}</div>
      {description ? <div className="workspace-empty__description">{description}</div> : null}
      {action ? <div className="workspace-empty__action">{action}</div> : null}
    </div>
  </div>
);

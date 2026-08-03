import type { FC, ReactNode } from 'react';
import type { MailFlowState } from './MailFlowContext';
import { StatusBadge, type StatusTone } from './DataWorkspace';

export function getMailFlowStateTone(state: MailFlowState): StatusTone {
  switch (state) {
    case 'STORED':
    case 'READY':
    case 'SENT':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'RECEIVED':
    case 'ROUTED':
    case 'RUNNING':
      return 'info';
    case 'FAILED':
      return 'danger';
    case 'SKIPPED':
    default:
      return 'default';
  }
}

interface MailFlowStatusBadgeProps {
  state: MailFlowState;
  children: ReactNode;
}

const MailFlowStatusBadge: FC<MailFlowStatusBadgeProps> = ({ state, children }) => (
  <StatusBadge tone={getMailFlowStateTone(state)}>{children}</StatusBadge>
);

export default MailFlowStatusBadge;

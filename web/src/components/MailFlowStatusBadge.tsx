import type { FC, ReactNode } from 'react';
import { StatusBadge } from './DataWorkspace';
import { getMailFlowStateTone, type MailFlowState } from './mailFlow';

interface MailFlowStatusBadgeProps {
  state: MailFlowState;
  children: ReactNode;
}

const MailFlowStatusBadge: FC<MailFlowStatusBadgeProps> = ({ state, children }) => (
  <StatusBadge tone={getMailFlowStateTone(state)}>{children}</StatusBadge>
);

export default MailFlowStatusBadge;

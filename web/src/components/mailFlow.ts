import type { StatusTone } from './DataWorkspace';

export type MailFlowSurface = 'inbound' | 'forwarding' | 'outbound';
export type MailFlowState =
  | 'RECEIVED'
  | 'ROUTED'
  | 'STORED'
  | 'PENDING'
  | 'RUNNING'
  | 'READY'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED';

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

import { requestPatch, requestPost } from './core';

export interface GmailLoginDetails {
  password?: string;
  notes?: string;
  code: string | null;
  codeExpiresAt: string | null;
  serverTime: string;
}

export interface GmailLoginEdits {
  password?: string;
  totpSecret?: string;
  notes?: string;
}

export const readGmailLoginDetails = (id: number, email: string, grantToken: string, codeOnly: boolean, signal: AbortSignal) =>
  requestPost<GmailLoginDetails>(`/admin/emails/${id}/login-details`,
    codeOnly ? { grantToken, email, codeOnly } : { grantToken, email }, { signal });

export const updateGmailLoginDetails = (id: number, email: string, grantToken: string, edits: GmailLoginEdits, signal: AbortSignal) =>
  requestPatch<{ updated: true }>(`/admin/emails/${id}/login-details`, { grantToken, email, ...edits }, { signal });

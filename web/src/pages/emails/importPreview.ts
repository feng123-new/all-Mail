import type { EmailAuthType, EmailProvider } from '../../constants/providers';

export type ImportPreviewSeverity = 'ready' | 'warning' | 'error';
export type ImportPreviewProvider = EmailProvider | 'UNKNOWN';
export type ImportPreviewAuthType = EmailAuthType | 'UNKNOWN';
export type ImportPreviewIssueCode =
  | 'invalid_email'
  | 'missing_required_fields'
  | 'unknown_format'
  | 'duplicate_email';

export interface ImportPreviewRow {
  lineNumber: number;
  raw: string;
  masked: string;
  email: string | null;
  provider: ImportPreviewProvider;
  authType: ImportPreviewAuthType;
  severity: ImportPreviewSeverity;
  issueCode?: ImportPreviewIssueCode;
}

export interface ImportPreviewSummary {
  rows: ImportPreviewRow[];
  totalCount: number;
  readyCount: number;
  warningCount: number;
  errorCount: number;
  providerCount: number;
}

export interface ImportFailureRow {
  lineNumber: number | null;
  raw: string | null;
  message: string;
  source: 'preview' | 'server';
  issueCode?: ImportPreviewIssueCode;
}

interface TokenProfile {
  provider: EmailProvider;
  authType: EmailAuthType;
  emailIndex: number;
  requiredIndexes: number[];
  visibleIndexes: number[];
}

const TOKEN_PROFILES: Record<string, TokenProfile> = {
  OUTLOOK_OAUTH: {
    provider: 'OUTLOOK',
    authType: 'MICROSOFT_OAUTH',
    emailIndex: 1,
    requiredIndexes: [1, 2, 4],
    visibleIndexes: [0, 1, 2],
  },
  GMAIL_OAUTH: {
    provider: 'GMAIL',
    authType: 'GOOGLE_OAUTH',
    emailIndex: 1,
    requiredIndexes: [1, 2, 4],
    visibleIndexes: [0, 1, 2],
  },
  GMAIL_APP_PASSWORD: appPasswordProfile('GMAIL'),
  QQ_IMAP_SMTP: appPasswordProfile('QQ'),
  NETEASE_163_IMAP_SMTP: appPasswordProfile('NETEASE_163'),
  NETEASE_126_IMAP_SMTP: appPasswordProfile('NETEASE_126'),
  ICLOUD_IMAP_SMTP: appPasswordProfile('ICLOUD'),
  YAHOO_IMAP_SMTP: appPasswordProfile('YAHOO'),
  ZOHO_IMAP_SMTP: appPasswordProfile('ZOHO'),
  ALIYUN_IMAP_SMTP: appPasswordProfile('ALIYUN'),
  AMAZON_WORKMAIL_IMAP_SMTP: appPasswordProfile('AMAZON_WORKMAIL'),
  FASTMAIL_IMAP_SMTP: appPasswordProfile('FASTMAIL'),
  AOL_IMAP_SMTP: appPasswordProfile('AOL'),
  GMX_IMAP_SMTP: appPasswordProfile('GMX'),
  MAILCOM_IMAP_SMTP: appPasswordProfile('MAILCOM'),
  YANDEX_IMAP_SMTP: appPasswordProfile('YANDEX'),
  CUSTOM_IMAP_SMTP: {
    provider: 'CUSTOM_IMAP_SMTP',
    authType: 'APP_PASSWORD',
    emailIndex: 1,
    requiredIndexes: [1, 2, 3, 4, 6, 7],
    visibleIndexes: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
};

const DOMAIN_PROFILES: Record<
  string,
  { provider: EmailProvider; authType: EmailAuthType }
> = {
  'outlook.com': { provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH' },
  'hotmail.com': { provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH' },
  'live.com': { provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH' },
  'msn.com': { provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH' },
  'gmail.com': { provider: 'GMAIL', authType: 'APP_PASSWORD' },
  'qq.com': { provider: 'QQ', authType: 'APP_PASSWORD' },
  '163.com': { provider: 'NETEASE_163', authType: 'APP_PASSWORD' },
  '126.com': { provider: 'NETEASE_126', authType: 'APP_PASSWORD' },
  'icloud.com': { provider: 'ICLOUD', authType: 'APP_PASSWORD' },
  'me.com': { provider: 'ICLOUD', authType: 'APP_PASSWORD' },
  'mac.com': { provider: 'ICLOUD', authType: 'APP_PASSWORD' },
  'yahoo.com': { provider: 'YAHOO', authType: 'APP_PASSWORD' },
  'zoho.com': { provider: 'ZOHO', authType: 'APP_PASSWORD' },
  'aliyun.com': { provider: 'ALIYUN', authType: 'APP_PASSWORD' },
  'fastmail.com': { provider: 'FASTMAIL', authType: 'APP_PASSWORD' },
  'aol.com': { provider: 'AOL', authType: 'APP_PASSWORD' },
  'gmx.com': { provider: 'GMX', authType: 'APP_PASSWORD' },
  'mail.com': { provider: 'MAILCOM', authType: 'APP_PASSWORD' },
  'yandex.com': { provider: 'YANDEX', authType: 'APP_PASSWORD' },
  'yandex.ru': { provider: 'YANDEX', authType: 'APP_PASSWORD' },
  'ya.ru': { provider: 'YANDEX', authType: 'APP_PASSWORD' },
};

function appPasswordProfile(provider: EmailProvider): TokenProfile {
  return {
    provider,
    authType: 'APP_PASSWORD',
    emailIndex: 1,
    requiredIndexes: [1, 2],
    visibleIndexes: [0, 1],
  };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function inferDomainProfile(email: string) {
  const domain = email.toLowerCase().split('@')[1] || '';
  return DOMAIN_PROFILES[domain];
}

function maskParts(
  parts: string[],
  visibleIndexes: number[],
  separator: string,
): string {
  const visible = new Set(visibleIndexes);
  return parts
    .map((part, index) => {
      if (visible.has(index) || !part) {
        return part;
      }
      return '••••••';
    })
    .join(separator);
}

function parseTokenizedLine(
  lineNumber: number,
  raw: string,
  parts: string[],
  profile: TokenProfile,
  separator: string,
): ImportPreviewRow {
  const email = parts[profile.emailIndex]?.trim() || null;
  const missingRequired = profile.requiredIndexes.some(
    (index) => !parts[index]?.trim(),
  );

  if (!email || !isEmail(email)) {
    return {
      lineNumber,
      raw,
      masked: maskParts(parts, profile.visibleIndexes, separator),
      email,
      provider: profile.provider,
      authType: profile.authType,
      severity: 'error',
      issueCode: 'invalid_email',
    };
  }

  if (missingRequired) {
    return {
      lineNumber,
      raw,
      masked: maskParts(parts, profile.visibleIndexes, separator),
      email,
      provider: profile.provider,
      authType: profile.authType,
      severity: 'error',
      issueCode: 'missing_required_fields',
    };
  }

  return {
    lineNumber,
    raw,
    masked: maskParts(parts, profile.visibleIndexes, separator),
    email,
    provider: profile.provider,
    authType: profile.authType,
    severity: 'ready',
  };
}

function parseEmailFirstLine(
  lineNumber: number,
  raw: string,
  parts: string[],
  separator: string,
): ImportPreviewRow {
  const email = parts[0]?.trim() || null;
  if (!email || !isEmail(email)) {
    return {
      lineNumber,
      raw,
      masked: maskParts(parts, [0], separator),
      email,
      provider: 'UNKNOWN',
      authType: 'UNKNOWN',
      severity: 'error',
      issueCode: 'invalid_email',
    };
  }

  const inferred = inferDomainProfile(email);
  if (!inferred) {
    return {
      lineNumber,
      raw,
      masked: maskParts(parts, [0], separator),
      email,
      provider: 'UNKNOWN',
      authType: 'UNKNOWN',
      severity: 'warning',
      issueCode: 'unknown_format',
    };
  }

  const requiredIndexes =
    inferred.authType === 'MICROSOFT_OAUTH'
      ? parts.length >= 4
        ? [1, 2, 3]
        : [1, 2]
      : [1];
  const missingRequired = requiredIndexes.some((index) => !parts[index]?.trim());

  return {
    lineNumber,
    raw,
    masked: maskParts(parts, [0], separator),
    email,
    provider: inferred.provider,
    authType: inferred.authType,
    severity: missingRequired ? 'error' : 'ready',
    issueCode: missingRequired ? 'missing_required_fields' : undefined,
  };
}

function parseImportLine(
  lineNumber: number,
  raw: string,
  separator: string,
): ImportPreviewRow {
  const parts = raw.split(separator).map((part) => part.trim());
  const token = parts[0]?.toUpperCase() || '';
  const tokenProfile = TOKEN_PROFILES[token];
  if (tokenProfile) {
    return parseTokenizedLine(
      lineNumber,
      raw,
      parts,
      tokenProfile,
      separator,
    );
  }
  if (parts[0]?.includes('@')) {
    return parseEmailFirstLine(lineNumber, raw, parts, separator);
  }
  return {
    lineNumber,
    raw,
    masked: maskParts(parts, [], separator),
    email: null,
    provider: 'UNKNOWN',
    authType: 'UNKNOWN',
    severity: 'error',
    issueCode: 'unknown_format',
  };
}

export function buildImportPreview(
  content: string,
  separator: string,
): ImportPreviewSummary {
  const normalizedSeparator = separator.trim();
  if (!normalizedSeparator) {
    return {
      rows: [],
      totalCount: 0,
      readyCount: 0,
      warningCount: 0,
      errorCount: 0,
      providerCount: 0,
    };
  }

  const rows = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw, index) => ({ raw: raw.trim(), lineNumber: index + 1 }))
    .filter(({ raw }) => Boolean(raw))
    .map(({ raw, lineNumber }) =>
      parseImportLine(lineNumber, raw, normalizedSeparator),
    );

  const firstLineByEmail = new Map<string, number>();
  for (const row of rows) {
    if (!row.email || row.severity === 'error') {
      continue;
    }
    const normalizedEmail = row.email.toLowerCase();
    if (firstLineByEmail.has(normalizedEmail)) {
      row.severity = 'error';
      row.issueCode = 'duplicate_email';
      continue;
    }
    firstLineByEmail.set(normalizedEmail, row.lineNumber);
  }

  const providers = new Set(
    rows
      .filter((row) => row.provider !== 'UNKNOWN')
      .map((row) => row.provider),
  );

  return {
    rows,
    totalCount: rows.length,
    readyCount: rows.filter((row) => row.severity === 'ready').length,
    warningCount: rows.filter((row) => row.severity === 'warning').length,
    errorCount: rows.filter((row) => row.severity === 'error').length,
    providerCount: providers.size,
  };
}

export function parseServerImportFailures(
  errors: string[],
  submittedRows: ImportPreviewRow[],
): ImportFailureRow[] {
  return errors.map((error) => {
    const match = error.match(/^line\s+(\d+)\s*:\s*(.+)$/i);
    if (!match) {
      return {
        lineNumber: null,
        raw: null,
        message: error,
        source: 'server',
      };
    }
    const submittedLineNumber = Number(match[1]);
    const sourceRow = submittedRows[submittedLineNumber - 1];
    return {
      lineNumber: sourceRow?.lineNumber ?? null,
      raw: sourceRow?.raw ?? null,
      message: match[2],
      source: 'server',
    };
  });
}

export function buildFailedImportContent(failures: ImportFailureRow[]): string {
  const seen = new Set<string>();
  return failures
    .filter((failure): failure is ImportFailureRow & { raw: string } =>
      Boolean(failure.raw),
    )
    .sort((left, right) => (left.lineNumber ?? 0) - (right.lineNumber ?? 0))
    .map((failure) => failure.raw)
    .filter((raw) => {
      if (seen.has(raw)) {
        return false;
      }
      seen.add(raw);
      return true;
    })
    .join('\n');
}

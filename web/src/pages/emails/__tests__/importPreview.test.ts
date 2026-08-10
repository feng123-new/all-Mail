import { describe, expect, it } from 'vitest';
import {
  buildFailedImportContent,
  buildImportPreview,
  parseServerImportFailures,
} from '../importPreview';

const separator = '----';

const mixedContent = [
  'audit@hotmail.com----mailbox-password----11111111-2222-3333-4444-555555555555----M.audit-refresh-token',
  'GMAIL_OAUTH----audit@gmail.com----audit.apps.googleusercontent.com----client-secret----1//refresh-token----gmail-login-password',
  'QQ_IMAP_SMTP----audit@qq.com----qq-app-password----qq-login-password',
  'MAILCOM_IMAP_SMTP----audit@mail.com----mailcom-app-password----mailcom-login-password',
  'CUSTOM_IMAP_SMTP----audit@example.test----custom-app-password----imap.example.test----993----true----smtp.example.test----465----true----INBOX----Spam----Sent----custom-login-password',
  'not-an-email----bad-password',
  'GMAIL_OAUTH----broken@gmail.com----client-only',
].join('\n');

describe('buildImportPreview', () => {
  it('separates importable and invalid mixed-provider rows while masking credentials', () => {
    const preview = buildImportPreview(mixedContent, separator);

    expect(preview.totalCount).toBe(7);
    expect(preview.readyCount).toBe(5);
    expect(preview.warningCount).toBe(0);
    expect(preview.errorCount).toBe(2);
    expect(preview.providerCount).toBe(5);

    const gmail = preview.rows[1];
    expect(gmail.provider).toBe('GMAIL');
    expect(gmail.authType).toBe('GOOGLE_OAUTH');
    expect(gmail.masked).toContain('audit.apps.googleusercontent.com');
    expect(gmail.masked).not.toContain('client-secret');
    expect(gmail.masked).not.toContain('1//refresh-token');
    expect(gmail.masked).not.toContain('gmail-login-password');

    const custom = preview.rows[4];
    expect(custom.provider).toBe('CUSTOM_IMAP_SMTP');
    expect(custom.masked).toContain('imap.example.test');
    expect(custom.masked).not.toContain('custom-app-password');
    expect(custom.masked).not.toContain('custom-login-password');
  });

  it('marks later duplicate mailboxes as invalid before submission', () => {
    const preview = buildImportPreview(
      [
        'QQ_IMAP_SMTP----same@qq.com----first-password',
        'QQ_IMAP_SMTP----same@qq.com----second-password',
      ].join('\n'),
      separator,
    );

    expect(preview.readyCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[1].issueCode).toBe('duplicate_email');
  });

  it('keeps unknown email-first providers as server-review warnings', () => {
    const preview = buildImportPreview(
      'operator@company.example----app-password',
      separator,
    );

    expect(preview.warningCount).toBe(1);
    expect(preview.rows[0].provider).toBe('UNKNOWN');
    expect(preview.rows[0].issueCode).toBe('unknown_format');
  });

  it('preserves the configured separator in masked previews', () => {
    const preview = buildImportPreview(
      'QQ_IMAP_SMTP|audit@qq.com|secret-value',
      '|',
    );

    expect(preview.rows[0].masked).toBe('QQ_IMAP_SMTP|audit@qq.com|••••••');
  });
});

describe('server import failure mapping', () => {
  it('maps filtered server line numbers back to original source lines', () => {
    const preview = buildImportPreview(mixedContent, separator);
    const submittedRows = preview.rows.filter((row) => row.severity !== 'error');
    const failures = parseServerImportFailures(
      ['line 2: refresh token expired'],
      submittedRows,
    );

    expect(failures).toEqual([
      {
        lineNumber: 2,
        raw: mixedContent.split('\n')[1],
        message: 'refresh token expired',
        source: 'server',
      },
    ]);
  });

  it('builds a deduplicated failed-row download payload', () => {
    const failures = [
      {
        lineNumber: 4,
        raw: 'row-four',
        message: 'failed',
        source: 'server' as const,
      },
      {
        lineNumber: 2,
        raw: 'row-two',
        message: 'failed',
        source: 'preview' as const,
      },
      {
        lineNumber: 4,
        raw: 'row-four',
        message: 'failed again',
        source: 'server' as const,
      },
    ];

    expect(buildFailedImportContent(failures)).toBe('row-two\nrow-four');
  });
});

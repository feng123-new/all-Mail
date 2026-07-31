#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if new and new in content:
        return
    if old not in content:
        raise SystemExit(f"missing marker in {path}: {old[:140]!r}")
    target.write_text(content.replace(old, new, 1), encoding="utf-8")


replace(
    "core/internal/businessapi/mail_provider_types.go",
    'import (\n\t"encoding/json"',
    'import (\n\t"context"\n\t"encoding/json"',
)
replace(
    "core/internal/businessapi/mail_provider_types.go",
    '''type mailProvider interface {
\tFetch(ctx providerContext, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error)
\tDelete(ctx providerContext, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error)
\tClear(ctx providerContext, account mailAccountCredentials, mailbox string) (providerDeleteResult, error)
\tSend(ctx providerContext, account mailAccountCredentials, input providerSendInput) (providerSendResult, error)
}

type providerContext interface {
\tDone() <-chan struct{}
\tErr() error
\tDeadline() (time.Time, bool)
\tValue(any) any
}
''',
    '''type mailProvider interface {
\tFetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error)
\tDelete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error)
\tClear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error)
\tSend(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error)
}
''',
)
replace(
    "core/internal/businessapi/mail_provider_types.go",
    '\t"time"\n',
    '',
)

replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    'import (\n\t"bytes"',
    'import (\n\t"bytes"\n\t"context"',
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '\t"net/smtp"\n',
    '\t"net/smtp"\n\t"net/textproto"\n',
)
for method in ("Fetch", "Delete", "Clear", "Send"):
    replace(
        "core/internal/businessapi/mail_provider_imap_smtp.go",
        f"func (imapSMTPProvider) {method}(ctx providerContext,",
        f"func (imapSMTPProvider) {method}(ctx context.Context,",
    )
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    "func connectIMAP(ctx providerContext,",
    "func connectIMAP(ctx context.Context,",
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '''\tif deadline, ok := ctx.Deadline(); ok {
\t\t_ = client.SetDeadline(deadline)
\t}
''',
    '',
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '''\ttextHeaders := make(map[string][]string)
\ttextHeaders["Content-Type"] = []string{"text/plain; charset=UTF-8"}
''',
    '''\ttextHeaders := make(textproto.MIMEHeader)
\ttextHeaders.Set("Content-Type", "text/plain; charset=UTF-8")
''',
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '''\thtmlHeaders := make(map[string][]string)
\thtmlHeaders["Content-Type"] = []string{"text/html; charset=UTF-8"}
''',
    '''\thtmlHeaders := make(textproto.MIMEHeader)
\thtmlHeaders.Set("Content-Type", "text/html; charset=UTF-8")
''',
)

replace(
    "core/internal/businessapi/server.go",
    '''\treplayProtector    ReplayProtector
\tnow                func() time.Time
''',
    '''\treplayProtector    ReplayProtector
\tproviderHTTPClient *http.Client
\tnow                func() time.Time
''',
)

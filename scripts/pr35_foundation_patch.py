#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if new in content:
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
	Fetch(ctx providerContext, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error)
	Delete(ctx providerContext, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error)
	Clear(ctx providerContext, account mailAccountCredentials, mailbox string) (providerDeleteResult, error)
	Send(ctx providerContext, account mailAccountCredentials, input providerSendInput) (providerSendResult, error)
}

type providerContext interface {
	Done() <-chan struct{}
	Err() error
	Deadline() (time.Time, bool)
	Value(any) any
}
''',
    '''type mailProvider interface {
	Fetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error)
	Delete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error)
	Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error)
	Send(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error)
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
    '''	if deadline, ok := ctx.Deadline(); ok {
		_ = client.SetDeadline(deadline)
	}
''',
    '',
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '''	textHeaders := make(map[string][]string)
	textHeaders["Content-Type"] = []string{"text/plain; charset=UTF-8"}
''',
    '''	textHeaders := make(textproto.MIMEHeader)
	textHeaders.Set("Content-Type", "text/plain; charset=UTF-8")
''',
)
replace(
    "core/internal/businessapi/mail_provider_imap_smtp.go",
    '''	htmlHeaders := make(map[string][]string)
	htmlHeaders["Content-Type"] = []string{"text/html; charset=UTF-8"}
''',
    '''	htmlHeaders := make(textproto.MIMEHeader)
	htmlHeaders.Set("Content-Type", "text/html; charset=UTF-8")
''',
)

replace(
    "core/internal/businessapi/server.go",
    '''	replayProtector    ReplayProtector
	now                func() time.Time
''',
    '''	replayProtector    ReplayProtector
	providerHTTPClient *http.Client
	now                func() time.Time
''',
)

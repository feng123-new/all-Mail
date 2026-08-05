package businessapi

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	imap "github.com/emersion/go-imap"
	imapclient "github.com/emersion/go-imap/client"
	gomail "github.com/emersion/go-message/mail"
	"github.com/emersion/go-sasl"
)

const microsoftIMAPScope = "https://outlook.office.com/IMAP.AccessAsUser.All"

type imapSMTPProvider struct {
	server *Server
}

func (p imapSMTPProvider) Fetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error) {
	client, folder, err := p.connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerFetchResult{}, err
	}
	defer client.Logout()
	selected, err := client.Select(folder, false)
	if err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_SELECT_FAILED", err)
	}
	if selected.Messages == 0 {
		return providerFetchResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Messages: []providerMessage{}, Method: "IMAP", Provider: account.Provider}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	start := uint32(1)
	if selected.Messages > uint32(limit) {
		start = selected.Messages - uint32(limit) + 1
	}
	sequence := new(imap.SeqSet)
	sequence.AddRange(start, selected.Messages)
	section := &imap.BodySectionName{Peek: true}
	items := []imap.FetchItem{imap.FetchEnvelope, imap.FetchUid, section.FetchItem()}
	messages := make(chan *imap.Message, limit)
	errCh := make(chan error, 1)
	go func() { errCh <- client.Fetch(sequence, items, messages) }()
	result := make([]providerMessage, 0, limit)
	var lastUID uint32
	for message := range messages {
		if message == nil {
			continue
		}
		if message.Uid > lastUID {
			lastUID = message.Uid
		}
		item := providerMessage{ID: fmt.Sprintf("uid:%d", message.Uid)}
		if message.Envelope != nil {
			item.Subject = message.Envelope.Subject
			item.Date = message.Envelope.Date.UTC().Format(time.RFC3339Nano)
			item.From = formatIMAPAddresses(message.Envelope.From)
			item.To = formatIMAPAddresses(message.Envelope.To)
		}
		if body := message.GetBody(section); body != nil {
			text, html := parseIMAPBody(body)
			item.Text, item.HTML = text, html
		}
		result = append(result, item)
	}
	if err := <-errCh; err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	reverseProviderMessages(result)
	return providerFetchResult{
		Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Count: len(result), Messages: result,
		MailboxCheckpoint: map[string]any{"uidValidity": selected.UidValidity, "lastUid": lastUID},
		Method:            "IMAP", Provider: account.Provider,
	}, nil
}

func (p imapSMTPProvider) ListSummaries(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerSummaryResult, error) {
	client, folder, err := p.connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerSummaryResult{}, err
	}
	defer client.Logout()
	selected, err := client.Select(folder, false)
	if err != nil {
		return providerSummaryResult{}, providerFailure("MAILBOX_SELECT_FAILED", err)
	}
	if selected.Messages == 0 {
		return providerSummaryResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Messages: []providerMessageSummary{}, Method: "IMAP", Provider: account.Provider}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	start := uint32(1)
	if selected.Messages > uint32(limit) {
		start = selected.Messages - uint32(limit) + 1
	}
	sequence := new(imap.SeqSet)
	sequence.AddRange(start, selected.Messages)
	messages := make(chan *imap.Message, limit)
	errCh := make(chan error, 1)
	go func() { errCh <- client.Fetch(sequence, []imap.FetchItem{imap.FetchEnvelope, imap.FetchUid}, messages) }()
	result := make([]providerMessageSummary, 0, limit)
	var lastUID uint32
	for message := range messages {
		if message == nil {
			continue
		}
		if message.Uid > lastUID {
			lastUID = message.Uid
		}
		item := providerMessageSummary{ID: fmt.Sprintf("uid:%d", message.Uid)}
		if message.Envelope != nil {
			item.Subject = message.Envelope.Subject
			item.Date = message.Envelope.Date.UTC().Format(time.RFC3339Nano)
			item.From = formatIMAPAddresses(message.Envelope.From)
			item.To = formatIMAPAddresses(message.Envelope.To)
		}
		result = append(result, item)
	}
	if err := <-errCh; err != nil {
		return providerSummaryResult{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	reverseProviderSummaries(result)
	return providerSummaryResult{
		Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Count: len(result), Messages: result,
		MailboxCheckpoint: map[string]any{"uidValidity": selected.UidValidity, "lastUid": lastUID},
		Method:            "IMAP", Provider: account.Provider,
	}, nil
}

func (p imapSMTPProvider) GetMessage(ctx context.Context, account mailAccountCredentials, mailbox, messageID string) (providerMessage, error) {
	uid, err := parseProviderUID(messageID)
	if err != nil {
		return providerMessage{}, validationError("messageId must contain an IMAP UID value")
	}
	client, folder, err := p.connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerMessage{}, err
	}
	defer client.Logout()
	stopCancellation := context.AfterFunc(ctx, func() { _ = client.Terminate() })
	defer stopCancellation()
	selected, err := client.Select(folder, false)
	if err != nil {
		return providerMessage{}, providerFailure("MAILBOX_SELECT_FAILED", err)
	}
	if expected, ok := mailboxUIDValidity(account.MailboxStatus, mailbox); ok && selected.UidValidity != 0 && expected != selected.UidValidity {
		return providerMessage{}, &requestError{Status: http.StatusConflict, Code: "IMAP_MAILBOX_RESYNC_REQUIRED"}
	}
	uidSet := new(imap.SeqSet)
	uidSet.AddNum(uid)
	section := &imap.BodySectionName{Peek: true}
	messages := make(chan *imap.Message, 1)
	errCh := make(chan error, 1)
	go func() {
		errCh <- client.UidFetch(uidSet, []imap.FetchItem{imap.FetchEnvelope, imap.FetchUid, section.FetchItem()}, messages)
	}()
	var result *providerMessage
	for message := range messages {
		if message == nil || message.Uid != uid {
			continue
		}
		item := providerMessage{ID: fmt.Sprintf("uid:%d", message.Uid)}
		if message.Envelope != nil {
			item.Subject = message.Envelope.Subject
			item.Date = message.Envelope.Date.UTC().Format(time.RFC3339Nano)
			item.From = formatIMAPAddresses(message.Envelope.From)
			item.To = formatIMAPAddresses(message.Envelope.To)
		}
		if body := message.GetBody(section); body != nil {
			item.Text, item.HTML = parseIMAPBody(body)
		}
		result = &item
	}
	if err := <-errCh; err != nil {
		return providerMessage{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	if result == nil {
		return providerMessage{}, &requestError{Status: http.StatusNotFound, Code: "MAIL_MESSAGE_NOT_FOUND"}
	}
	return *result, nil
}

func (p imapSMTPProvider) Delete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	client, folder, err := p.connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerDeleteResult{}, err
	}
	defer client.Logout()
	selected, err := client.Select(folder, false)
	if err != nil {
		return providerDeleteResult{}, providerFailure("MAILBOX_SELECT_FAILED", err)
	}
	if expected, ok := mailboxUIDValidity(account.MailboxStatus, mailbox); ok && selected.UidValidity != 0 && expected != selected.UidValidity {
		return providerDeleteResult{}, &requestError{Status: http.StatusConflict, Code: "IMAP_MAILBOX_RESYNC_REQUIRED"}
	}
	uidSet := new(imap.SeqSet)
	for _, id := range messageIDs {
		uid, err := parseProviderUID(id)
		if err != nil {
			return providerDeleteResult{}, validationError("messageIds must contain IMAP UID values")
		}
		uidSet.AddNum(uid)
	}
	if len(messageIDs) == 0 {
		return providerDeleteResult{
			Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder,
			MailboxCheckpoint: map[string]any{"uidValidity": selected.UidValidity}, Method: "IMAP", Provider: account.Provider,
		}, nil
	}
	operation := imap.FormatFlagsOp(imap.AddFlags, true)
	if err := client.UidStore(uidSet, operation, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
	}
	if err := client.Expunge(nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
	}
	return providerDeleteResult{
		Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, DeletedCount: len(messageIDs), Message: "messages deleted",
		MailboxCheckpoint: map[string]any{"uidValidity": selected.UidValidity}, Method: "IMAP", Provider: account.Provider,
	}, nil
}

func mailboxUIDValidity(status map[string]any, mailbox string) (uint32, bool) {
	if status == nil {
		return 0, false
	}
	key := strings.TrimSpace(mailbox)
	if strings.EqualFold(key, "junk") || strings.EqualFold(key, "spam") {
		key = "Junk"
	} else if strings.EqualFold(key, "sent") {
		key = "SENT"
	} else {
		key = "INBOX"
	}
	state, ok := status[key].(map[string]any)
	if !ok {
		return 0, false
	}
	var value uint64
	switch raw := state["uidValidity"].(type) {
	case float64:
		if raw <= 0 || raw != float64(uint64(raw)) {
			return 0, false
		}
		value = uint64(raw)
	case int:
		if raw <= 0 {
			return 0, false
		}
		value = uint64(raw)
	case int64:
		if raw <= 0 {
			return 0, false
		}
		value = uint64(raw)
	case uint32:
		value = uint64(raw)
	case uint64:
		value = raw
	default:
		return 0, false
	}
	if value == 0 || value > uint64(^uint32(0)) {
		return 0, false
	}
	return uint32(value), true
}

func (p imapSMTPProvider) Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	client, folder, err := p.connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerDeleteResult{}, err
	}
	defer client.Logout()
	selected, err := client.Select(folder, false)
	if err != nil {
		return providerDeleteResult{}, providerFailure("MAILBOX_SELECT_FAILED", err)
	}
	if selected.Messages == 0 {
		return providerDeleteResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Method: "IMAP", Provider: account.Provider}, nil
	}
	sequence := new(imap.SeqSet)
	sequence.AddRange(1, selected.Messages)
	operation := imap.FormatFlagsOp(imap.AddFlags, true)
	if err := client.Store(sequence, operation, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAILBOX_CLEAR_FAILED", err)
	}
	if err := client.Expunge(nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAILBOX_CLEAR_FAILED", err)
	}
	return providerDeleteResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, DeletedCount: int(selected.Messages), Message: "mailbox cleared", Method: "IMAP", Provider: account.Provider}, nil
}

func (p imapSMTPProvider) Send(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
	config := account.ProviderConfig
	if config.SMTPHost == "" || config.SMTPPort <= 0 {
		return providerSendResult{}, providerFailure("SMTP_NOT_CONFIGURED", fmt.Errorf("SMTP host or port is missing"))
	}
	password := account.Password
	if password == "" {
		return providerSendResult{}, providerFailure("EMAIL_CREDENTIAL_MISSING", fmt.Errorf("application password is missing"))
	}
	address := net.JoinHostPort(config.SMTPHost, strconv.Itoa(config.SMTPPort))
	secure := config.SMTPSecure != nil && *config.SMTPSecure
	connection, err := p.server.dialProviderContext(ctx, "tcp", address)
	if err != nil {
		return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
	}
	if err := setProviderConnectionDeadline(ctx, connection); err != nil {
		connection.Close()
		return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
	}
	var client *smtp.Client
	if secure {
		tlsConnection := tls.Client(connection, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.SMTPHost})
		if err := tlsConnection.HandshakeContext(ctx); err != nil {
			connection.Close()
			return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
		}
		client, err = smtp.NewClient(tlsConnection, config.SMTPHost)
		if err != nil {
			tlsConnection.Close()
			return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
		}
	} else {
		client, err = smtp.NewClient(connection, config.SMTPHost)
		if err != nil {
			connection.Close()
			return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
		}
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.SMTPHost}); err != nil {
				client.Close()
				return providerSendResult{}, providerFailure("SMTP_TLS_FAILED", err)
			}
		}
	}
	defer client.Close()
	if ok, _ := client.Extension("AUTH"); ok {
		if err := client.Auth(smtp.PlainAuth("", account.Email, password, config.SMTPHost)); err != nil {
			return providerSendResult{}, providerFailure("SMTP_AUTH_FAILED", err)
		}
	}
	if err := client.Mail(account.Email); err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	for _, recipient := range input.To {
		if err := client.Rcpt(recipient); err != nil {
			return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
		}
	}
	writer, err := client.Data()
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	message, err := buildSMTPMessage(input)
	if err != nil {
		writer.Close()
		return providerSendResult{}, err
	}
	if _, err := writer.Write(message); err != nil {
		writer.Close()
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	if err := writer.Close(); err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	if err := client.Quit(); err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	return providerSendResult{Provider: account.Provider, Method: "SMTP", Accepted: append([]string(nil), input.To...)}, nil
}

func (p imapSMTPProvider) connectIMAP(ctx context.Context, account mailAccountCredentials, mailbox string) (*imapclient.Client, string, error) {
	config := account.ProviderConfig
	if config.IMAPHost == "" || config.IMAPPort <= 0 {
		return nil, "", providerFailure("IMAP_NOT_CONFIGURED", fmt.Errorf("IMAP host or port is missing"))
	}
	address := net.JoinHostPort(config.IMAPHost, strconv.Itoa(config.IMAPPort))
	connection, err := p.server.dialProviderContext(ctx, "tcp", address)
	if err != nil {
		return nil, "", providerFailure("IMAP_CONNECT_FAILED", err)
	}
	if err := setProviderConnectionDeadline(ctx, connection); err != nil {
		connection.Close()
		return nil, "", providerFailure("IMAP_CONNECT_FAILED", err)
	}
	if config.IMAPTLS == nil || *config.IMAPTLS {
		tlsConnection := tls.Client(connection, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.IMAPHost})
		if err := tlsConnection.HandshakeContext(ctx); err != nil {
			connection.Close()
			return nil, "", providerFailure("IMAP_CONNECT_FAILED", err)
		}
		connection = tlsConnection
	}
	client, err := imapclient.New(connection)
	if err != nil {
		connection.Close()
		return nil, "", providerFailure("IMAP_CONNECT_FAILED", err)
	}
	var authErr error
	if account.AuthType == "GOOGLE_OAUTH" || account.AuthType == "MICROSOFT_OAUTH" {
		if p.server == nil {
			client.Close()
			return nil, "", providerFailure("OAUTH_TOKEN_REFRESH_FAILED", fmt.Errorf("OAuth provider client is unavailable"))
		}
		var token string
		if account.AuthType == "MICROSOFT_OAUTH" {
			token, err = p.server.refreshProviderAccessToken(ctx, account, microsoftIMAPScope)
		} else {
			token, err = p.server.refreshProviderAccessToken(ctx, account)
		}
		if err != nil {
			client.Close()
			return nil, "", err
		}
		authErr = client.Authenticate(&xoauth2SASLClient{username: account.Email, accessToken: token})
	} else {
		password := account.Password
		if password == "" {
			client.Close()
			return nil, "", providerFailure("EMAIL_CREDENTIAL_MISSING", fmt.Errorf("application password is missing"))
		}
		authErr = client.Login(account.Email, password)
	}
	if authErr != nil {
		client.Close()
		return nil, "", providerFailure("IMAP_AUTH_FAILED", authErr)
	}
	return client, mailboxFolder(config, mailbox), nil
}

type xoauth2SASLClient struct {
	username    string
	accessToken string
	started     bool
}

var _ sasl.Client = (*xoauth2SASLClient)(nil)

func (client *xoauth2SASLClient) Start() (string, []byte, error) {
	client.started = true
	response := "user=" + client.username + "\x01auth=Bearer " + client.accessToken + "\x01\x01"
	return "XOAUTH2", []byte(response), nil
}

func (client *xoauth2SASLClient) Next(_ []byte) ([]byte, error) {
	if !client.started {
		return nil, fmt.Errorf("XOAUTH2 exchange has not started")
	}
	return []byte{}, nil
}

func setProviderConnectionDeadline(ctx context.Context, connection net.Conn) error {
	deadline := time.Now().Add(20 * time.Second)
	if contextDeadline, ok := ctx.Deadline(); ok {
		deadline = contextDeadline
	}
	return connection.SetDeadline(deadline)
}

func parseIMAPBody(reader io.Reader) (string, string) {
	messageReader, err := gomail.CreateReader(reader)
	if err != nil {
		content, _ := io.ReadAll(io.LimitReader(reader, 2<<20))
		return string(content), ""
	}
	defer messageReader.Close()
	var textBody, htmlBody string
	for {
		part, err := messageReader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		inline, ok := part.Header.(*gomail.InlineHeader)
		if !ok {
			continue
		}
		mediaType, _, _ := inline.ContentType()
		content, _ := io.ReadAll(io.LimitReader(part.Body, 2<<20))
		switch strings.ToLower(mediaType) {
		case "text/plain":
			if textBody == "" {
				textBody = string(content)
			}
		case "text/html":
			if htmlBody == "" {
				htmlBody = string(content)
			}
		}
	}
	return textBody, htmlBody
}

func formatIMAPAddresses(addresses []*imap.Address) string {
	result := make([]string, 0, len(addresses))
	for _, address := range addresses {
		if address == nil {
			continue
		}
		email := address.MailboxName + "@" + address.HostName
		if address.PersonalName != "" {
			result = append(result, (&mail.Address{Name: address.PersonalName, Address: email}).String())
		} else {
			result = append(result, email)
		}
	}
	return strings.Join(result, ", ")
}

func reverseProviderMessages(messages []providerMessage) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}

func reverseProviderSummaries(messages []providerMessageSummary) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}

func parseProviderUID(value string) (uint32, error) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "uid:")
	value = strings.TrimPrefix(value, "imap:")
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil || parsed == 0 {
		return 0, fmt.Errorf("invalid IMAP UID")
	}
	return uint32(parsed), nil
}

func buildSMTPMessage(input providerSendInput) ([]byte, error) {
	var buffer bytes.Buffer
	from := input.FromEmail
	if input.FromName != "" {
		from = (&mail.Address{Name: input.FromName, Address: input.FromEmail}).String()
	}
	fmt.Fprintf(&buffer, "From: %s\r\n", from)
	fmt.Fprintf(&buffer, "To: %s\r\n", strings.Join(input.To, ", "))
	fmt.Fprintf(&buffer, "Subject: %s\r\n", mime.QEncoding.Encode("UTF-8", input.Subject))
	fmt.Fprintf(&buffer, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprint(&buffer, "MIME-Version: 1.0\r\n")
	if input.HTML == "" {
		fmt.Fprint(&buffer, "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
		buffer.WriteString(input.Text)
		return buffer.Bytes(), nil
	}
	multipartWriter := multipart.NewWriter(&buffer)
	boundary := multipartWriter.Boundary()
	fmt.Fprintf(&buffer, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
	textHeaders := make(textproto.MIMEHeader)
	textHeaders.Set("Content-Type", "text/plain; charset=UTF-8")
	textPart, err := multipartWriter.CreatePart(textHeaders)
	if err != nil {
		return nil, err
	}
	_, _ = textPart.Write([]byte(input.Text))
	htmlHeaders := make(textproto.MIMEHeader)
	htmlHeaders.Set("Content-Type", "text/html; charset=UTF-8")
	htmlPart, err := multipartWriter.CreatePart(htmlHeaders)
	if err != nil {
		return nil, err
	}
	_, _ = htmlPart.Write([]byte(input.HTML))
	if err := multipartWriter.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func providerFailure(code string, err error) error {
	return &requestError{Status: 502, Code: code, Cause: err}
}

package businessapi

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	imap "github.com/emersion/go-imap"
	imapclient "github.com/emersion/go-imap/client"
	gomail "github.com/emersion/go-message/mail"
)

type imapSMTPProvider struct{}

func (imapSMTPProvider) Fetch(ctx providerContext, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error) {
	client, folder, err := connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerFetchResult{}, err
	}
	defer client.Logout()
	selected, err := client.Select(folder, true)
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
		Method: "IMAP", Provider: account.Provider,
	}, nil
}

func (imapSMTPProvider) Delete(ctx providerContext, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	client, folder, err := connectIMAP(ctx, account, mailbox)
	if err != nil {
		return providerDeleteResult{}, err
	}
	defer client.Logout()
	if _, err := client.Select(folder, false); err != nil {
		return providerDeleteResult{}, providerFailure("MAILBOX_SELECT_FAILED", err)
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
		return providerDeleteResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Method: "IMAP", Provider: account.Provider}, nil
	}
	operation := imap.FormatFlagsOp(imap.AddFlags, true)
	if err := client.UidStore(uidSet, operation, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
	}
	if err := client.Expunge(nil); err != nil {
		return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
	}
	return providerDeleteResult{Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, DeletedCount: len(messageIDs), Message: "messages deleted", Method: "IMAP", Provider: account.Provider}, nil
}

func (imapSMTPProvider) Clear(ctx providerContext, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	client, folder, err := connectIMAP(ctx, account, mailbox)
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

func (imapSMTPProvider) Send(ctx providerContext, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
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
	var client *smtp.Client
	if secure {
		dialer := &net.Dialer{Timeout: 20 * time.Second}
		connection, err := tls.DialWithDialer(dialer, "tcp", address, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.SMTPHost})
		if err != nil {
			return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
		}
		client, err = smtp.NewClient(connection, config.SMTPHost)
		if err != nil {
			connection.Close()
			return providerSendResult{}, providerFailure("SMTP_CONNECT_FAILED", err)
		}
	} else {
		var err error
		client, err = smtp.Dial(address)
		if err != nil {
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

func connectIMAP(ctx providerContext, account mailAccountCredentials, mailbox string) (*imapclient.Client, string, error) {
	config := account.ProviderConfig
	if config.IMAPHost == "" || config.IMAPPort <= 0 {
		return nil, "", providerFailure("IMAP_NOT_CONFIGURED", fmt.Errorf("IMAP host or port is missing"))
	}
	password := account.Password
	if password == "" {
		return nil, "", providerFailure("EMAIL_CREDENTIAL_MISSING", fmt.Errorf("application password is missing"))
	}
	address := net.JoinHostPort(config.IMAPHost, strconv.Itoa(config.IMAPPort))
	var client *imapclient.Client
	var err error
	if config.IMAPTLS == nil || *config.IMAPTLS {
		client, err = imapclient.DialTLS(address, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.IMAPHost})
	} else {
		client, err = imapclient.Dial(address)
	}
	if err != nil {
		return nil, "", providerFailure("IMAP_CONNECT_FAILED", err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = client.SetDeadline(deadline)
	}
	if err := client.Login(account.Email, password); err != nil {
		client.Close()
		return nil, "", providerFailure("IMAP_AUTH_FAILED", err)
	}
	return client, mailboxFolder(config, mailbox), nil
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

func parseProviderUID(value string) (uint32, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "uid:"))
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
	textHeaders := make(map[string][]string)
	textHeaders["Content-Type"] = []string{"text/plain; charset=UTF-8"}
	textPart, err := multipartWriter.CreatePart(textHeaders)
	if err != nil {
		return nil, err
	}
	_, _ = textPart.Write([]byte(input.Text))
	htmlHeaders := make(map[string][]string)
	htmlHeaders["Content-Type"] = []string{"text/html; charset=UTF-8"}
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

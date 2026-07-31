package businessapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"
)

type gmailMailProvider struct {
	server *Server
}

func (p gmailMailProvider) Fetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerFetchResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	label := gmailLabel(mailbox)
	endpoint := fmt.Sprintf(
		"https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=%s&maxResults=%d",
		url.QueryEscape(label),
		limit,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_REQUEST_INVALID", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := p.server.providerClient().Do(request)
	if err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerFetchResult{}, providerHTTPFailure("MAILBOX_FETCH_FAILED", response)
	}
	var list gmailMessageList
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&list); err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_RESPONSE_INVALID", err)
	}
	messages := make([]providerMessage, 0, len(list.Messages))
	for _, reference := range list.Messages {
		message, err := p.getMessage(ctx, token, reference.ID)
		if err != nil {
			return providerFetchResult{}, err
		}
		messages = append(messages, message)
	}
	return providerFetchResult{
		Email:           account.Email,
		Mailbox:         mailbox,
		ResolvedMailbox: label,
		Count:           len(messages),
		Messages:        messages,
		Method:          "GMAIL_API",
		Provider:        account.Provider,
	}, nil
}

func (p gmailMailProvider) Delete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	for _, messageID := range messageIDs {
		if strings.TrimSpace(messageID) == "" {
			return providerDeleteResult{}, validationError("messageIds must contain non-empty values")
		}
		endpoint := "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + url.PathEscape(messageID)
		request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
		if err != nil {
			return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := p.server.providerClient().Do(request)
		if err != nil {
			return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			deletionErr := providerHTTPFailure("MAIL_DELETE_FAILED", response)
			response.Body.Close()
			return providerDeleteResult{}, deletionErr
		}
		response.Body.Close()
	}
	return providerDeleteResult{
		Email:        account.Email,
		Mailbox:      mailbox,
		DeletedCount: len(messageIDs),
		Message:      "messages deleted",
		Method:       "GMAIL_API",
		Provider:     account.Provider,
	}, nil
}

func (p gmailMailProvider) Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	result, err := p.Fetch(ctx, account, mailbox, 100)
	if err != nil {
		return providerDeleteResult{}, err
	}
	ids := make([]string, 0, len(result.Messages))
	for _, message := range result.Messages {
		ids = append(ids, message.ID)
	}
	return p.Delete(ctx, account, mailbox, ids)
}

func (p gmailMailProvider) Send(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerSendResult{}, err
	}
	message, err := buildSMTPMessage(input)
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	payload, err := json.Marshal(map[string]string{"raw": base64.RawURLEncoding.EncodeToString(message)})
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", bytes.NewReader(payload))
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := p.server.providerClient().Do(request)
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerSendResult{}, providerHTTPFailure("MAIL_SEND_FAILED", response)
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil && err != io.EOF {
		return providerSendResult{}, providerFailure("MAIL_SEND_RESPONSE_INVALID", err)
	}
	var providerMessageID *string
	if result.ID != "" {
		providerMessageID = &result.ID
	}
	return providerSendResult{
		Provider:          account.Provider,
		Method:            "GMAIL_API",
		ProviderMessageID: providerMessageID,
		Accepted:          append([]string(nil), input.To...),
	}, nil
}

func (p gmailMailProvider) getMessage(ctx context.Context, token, id string) (providerMessage, error) {
	endpoint := "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + url.PathEscape(id) + "?format=full"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return providerMessage{}, providerFailure("MAILBOX_REQUEST_INVALID", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := p.server.providerClient().Do(request)
	if err != nil {
		return providerMessage{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerMessage{}, providerHTTPFailure("MAILBOX_FETCH_FAILED", response)
	}
	var payload gmailMessagePayload
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return providerMessage{}, providerFailure("MAILBOX_RESPONSE_INVALID", err)
	}
	headers := make(map[string]string)
	for _, header := range payload.Payload.Headers {
		headers[strings.ToLower(header.Name)] = header.Value
	}
	text, html := gmailPayloadBodies(payload.Payload)
	date := headers["date"]
	if parsed, err := mail.ParseDate(date); err == nil {
		date = parsed.UTC().Format(time.RFC3339Nano)
	}
	return providerMessage{
		ID:      payload.ID,
		From:    headers["from"],
		To:      headers["to"],
		Subject: headers["subject"],
		Text:    text,
		HTML:    html,
		Date:    date,
	}, nil
}

type gmailMessageList struct {
	Messages []struct {
		ID string `json:"id"`
	} `json:"messages"`
}

type gmailMessagePayload struct {
	ID      string    `json:"id"`
	Payload gmailPart `json:"payload"`
}

type gmailPart struct {
	MimeType string `json:"mimeType"`
	Headers  []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"headers"`
	Body struct {
		Data string `json:"data"`
	} `json:"body"`
	Parts []gmailPart `json:"parts"`
}

func gmailPayloadBodies(part gmailPart) (string, string) {
	decode := func(value string) string {
		content, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil {
			content, _ = base64.URLEncoding.DecodeString(value)
		}
		return string(content)
	}
	var text, html string
	var visit func(gmailPart)
	visit = func(candidate gmailPart) {
		switch strings.ToLower(candidate.MimeType) {
		case "text/plain":
			if text == "" {
				text = decode(candidate.Body.Data)
			}
		case "text/html":
			if html == "" {
				html = decode(candidate.Body.Data)
			}
		}
		for _, child := range candidate.Parts {
			visit(child)
		}
	}
	visit(part)
	return text, html
}

func gmailLabel(mailbox string) string {
	switch strings.ToLower(strings.TrimSpace(mailbox)) {
	case "junk", "spam":
		return "SPAM"
	case "sent":
		return "SENT"
	default:
		return "INBOX"
	}
}

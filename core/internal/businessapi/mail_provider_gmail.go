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
	response, err := p.server.doProviderRequest(account, request)
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
		message, err := p.getMessage(ctx, token, reference.ID, account)
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
	return p.deleteWithToken(ctx, token, account, mailbox, messageIDs)
}

func (p gmailMailProvider) deleteWithToken(ctx context.Context, token string, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	for _, messageID := range messageIDs {
		if strings.TrimSpace(messageID) == "" {
			return providerDeleteResult{}, validationError("messageIds must contain non-empty values")
		}
		endpoint := "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + url.PathEscape(messageID) + "/trash"
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
		if err != nil {
			return providerDeleteResult{}, providerFailure("MAIL_DELETE_FAILED", err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := p.server.doProviderRequest(account, request)
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
		Message:      "messages trashed",
		Method:       "GMAIL_API",
		Provider:     account.Provider,
	}, nil
}

func (p gmailMailProvider) Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	ids, err := p.listMessageIDs(ctx, token, mailbox, account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	return p.deleteWithToken(ctx, token, account, mailbox, ids)
}

func (p gmailMailProvider) listMessageIDs(ctx context.Context, token, mailbox string, account mailAccountCredentials) ([]string, error) {
	label := gmailLabel(mailbox)
	pageToken := ""
	ids := make([]string, 0, 500)
	seenPageTokens := make(map[string]struct{})
	for {
		endpoint := fmt.Sprintf(
			"https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=%s&maxResults=500",
			url.QueryEscape(label),
		)
		if pageToken != "" {
			endpoint += "&pageToken=" + url.QueryEscape(pageToken)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, providerFailure("MAILBOX_REQUEST_INVALID", err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := p.server.doProviderRequest(account, request)
		if err != nil {
			return nil, providerFailure("MAILBOX_FETCH_FAILED", err)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			providerErr := providerHTTPFailure("MAILBOX_FETCH_FAILED", response)
			response.Body.Close()
			return nil, providerErr
		}
		var page gmailMessageList
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&page)
		response.Body.Close()
		if decodeErr != nil {
			return nil, providerFailure("MAILBOX_RESPONSE_INVALID", decodeErr)
		}
		for _, message := range page.Messages {
			if strings.TrimSpace(message.ID) == "" {
				return nil, providerFailure("MAILBOX_RESPONSE_INVALID", fmt.Errorf("Gmail message id is missing"))
			}
			ids = append(ids, message.ID)
		}
		if page.NextPageToken == "" {
			return ids, nil
		}
		if _, duplicate := seenPageTokens[page.NextPageToken]; duplicate {
			return nil, providerFailure("MAILBOX_RESPONSE_INVALID", fmt.Errorf("Gmail pagination token repeated"))
		}
		seenPageTokens[page.NextPageToken] = struct{}{}
		pageToken = page.NextPageToken
	}
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
	response, err := p.server.doProviderRequest(account, request)
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

func (p gmailMailProvider) getMessage(ctx context.Context, token, id string, account mailAccountCredentials) (providerMessage, error) {
	endpoint := "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + url.PathEscape(id) + "?format=full"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return providerMessage{}, providerFailure("MAILBOX_REQUEST_INVALID", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := p.server.doProviderRequest(account, request)
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
	NextPageToken string `json:"nextPageToken"`
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

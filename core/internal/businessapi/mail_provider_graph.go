package businessapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
)

type graphMailProvider struct {
	server *Server
}

func (p graphMailProvider) Fetch(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerFetchResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerFetchResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	folder := graphFolder(mailbox)
	endpoint := fmt.Sprintf(
		"https://graph.microsoft.com/v1.0/me/mailFolders/%s/messages?$top=%d&$orderby=receivedDateTime%%20desc&$select=id,subject,bodyPreview,body,from,toRecipients,receivedDateTime",
		url.PathEscape(folder),
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
	var payload graphMessageList
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return providerFetchResult{}, providerFailure("MAILBOX_RESPONSE_INVALID", err)
	}
	messages := make([]providerMessage, 0, len(payload.Value))
	for _, item := range payload.Value {
		messages = append(messages, graphProviderMessage(item))
	}
	return providerFetchResult{
		Email:           account.Email,
		Mailbox:         mailbox,
		ResolvedMailbox: folder,
		Count:           len(messages),
		Messages:        messages,
		Method:          "GRAPH_API",
		Provider:        account.Provider,
	}, nil
}

func (p graphMailProvider) ListSummaries(ctx context.Context, account mailAccountCredentials, mailbox string, limit int) (providerSummaryResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerSummaryResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	folder := graphFolder(mailbox)
	endpoint := fmt.Sprintf(
		"https://graph.microsoft.com/v1.0/me/mailFolders/%s/messages?$top=%d&$orderby=receivedDateTime%%20desc&$select=id,subject,from,toRecipients,receivedDateTime",
		url.PathEscape(folder),
		limit,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return providerSummaryResult{}, providerFailure("MAILBOX_REQUEST_INVALID", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := p.server.doProviderRequest(account, request)
	if err != nil {
		return providerSummaryResult{}, providerFailure("MAILBOX_FETCH_FAILED", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerSummaryResult{}, providerHTTPFailure("MAILBOX_FETCH_FAILED", response)
	}
	var payload graphMessageList
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return providerSummaryResult{}, providerFailure("MAILBOX_RESPONSE_INVALID", err)
	}
	messages := make([]providerMessageSummary, 0, len(payload.Value))
	for _, item := range payload.Value {
		messages = append(messages, graphMessageSummary(item))
	}
	return providerSummaryResult{
		Email: account.Email, Mailbox: mailbox, ResolvedMailbox: folder, Count: len(messages), Messages: messages,
		Method: "GRAPH_API", Provider: account.Provider,
	}, nil
}

func (p graphMailProvider) GetMessage(ctx context.Context, account mailAccountCredentials, _ string, messageID string) (providerMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return providerMessage{}, validationError("messageId must contain a non-empty value")
	}
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerMessage{}, err
	}
	endpoint := "https://graph.microsoft.com/v1.0/me/messages/" + url.PathEscape(messageID) + "?$select=id,subject,bodyPreview,body,from,toRecipients,receivedDateTime"
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
	if response.StatusCode == http.StatusNotFound {
		return providerMessage{}, &requestError{Status: http.StatusNotFound, Code: "MAIL_MESSAGE_NOT_FOUND"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerMessage{}, providerHTTPFailure("MAILBOX_FETCH_FAILED", response)
	}
	var payload graphMessage
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return providerMessage{}, providerFailure("MAILBOX_RESPONSE_INVALID", err)
	}
	return graphProviderMessage(payload), nil
}

func (p graphMailProvider) Delete(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	return p.deleteWithToken(ctx, token, account, mailbox, messageIDs)
}

func (p graphMailProvider) deleteWithToken(ctx context.Context, token string, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	for _, messageID := range messageIDs {
		if strings.TrimSpace(messageID) == "" {
			return providerDeleteResult{}, validationError("messageIds must contain non-empty values")
		}
		endpoint := "https://graph.microsoft.com/v1.0/me/messages/" + url.PathEscape(messageID)
		request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
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
		Message:      "messages deleted",
		Method:       "GRAPH_API",
		Provider:     account.Provider,
	}, nil
}

func (p graphMailProvider) Clear(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
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

func (p graphMailProvider) listMessageIDs(ctx context.Context, token, mailbox string, account mailAccountCredentials) ([]string, error) {
	folder := graphFolder(mailbox)
	endpoint := fmt.Sprintf(
		"https://graph.microsoft.com/v1.0/me/mailFolders/%s/messages?$top=500&$select=id",
		url.PathEscape(folder),
	)
	ids := make([]string, 0, 500)
	seenLinks := make(map[string]struct{})
	for endpoint != "" {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, providerFailure("MAILBOX_REQUEST_INVALID", err)
		}
		if request.URL.Scheme != "https" || request.URL.Host != "graph.microsoft.com" {
			return nil, providerFailure("MAILBOX_RESPONSE_INVALID", fmt.Errorf("Graph pagination URL is invalid"))
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
		var page graphMessageList
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&page)
		response.Body.Close()
		if decodeErr != nil {
			return nil, providerFailure("MAILBOX_RESPONSE_INVALID", decodeErr)
		}
		for _, message := range page.Value {
			if strings.TrimSpace(message.ID) == "" {
				return nil, providerFailure("MAILBOX_RESPONSE_INVALID", fmt.Errorf("Graph message id is missing"))
			}
			ids = append(ids, message.ID)
		}
		endpoint = strings.TrimSpace(page.NextLink)
		if endpoint != "" {
			if _, duplicate := seenLinks[endpoint]; duplicate {
				return nil, providerFailure("MAILBOX_RESPONSE_INVALID", fmt.Errorf("Graph pagination link repeated"))
			}
			seenLinks[endpoint] = struct{}{}
		}
	}
	return ids, nil
}

func (p graphMailProvider) Send(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
	token, err := p.server.refreshProviderAccessToken(ctx, account)
	if err != nil {
		return providerSendResult{}, err
	}
	contentType := "Text"
	content := input.Text
	if input.HTML != "" {
		contentType = "HTML"
		content = input.HTML
	}
	payload := map[string]any{
		"message": map[string]any{
			"subject":      input.Subject,
			"body":         map[string]string{"contentType": contentType, "content": content},
			"toRecipients": graphRecipients(input.To),
		},
		"saveToSentItems": true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return providerSendResult{}, providerFailure("MAIL_SEND_FAILED", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://graph.microsoft.com/v1.0/me/sendMail", bytes.NewReader(body))
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
	return providerSendResult{
		Provider: account.Provider,
		Method:   "GRAPH_API",
		Accepted: append([]string(nil), input.To...),
	}, nil
}

type graphMessageList struct {
	NextLink string         `json:"@odata.nextLink"`
	Value    []graphMessage `json:"value"`
}

type graphMessage struct {
	ID               string `json:"id"`
	Subject          string `json:"subject"`
	BodyPreview      string `json:"bodyPreview"`
	ReceivedDateTime string `json:"receivedDateTime"`
	Body             struct {
		ContentType string `json:"contentType"`
		Content     string `json:"content"`
	} `json:"body"`
	From struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"from"`
	ToRecipients []struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"toRecipients"`
}

func graphMessageSummary(item graphMessage) providerMessageSummary {
	to := make([]string, 0, len(item.ToRecipients))
	for _, recipient := range item.ToRecipients {
		to = append(to, formatGraphAddress(recipient.EmailAddress.Name, recipient.EmailAddress.Address))
	}
	return providerMessageSummary{
		ID: item.ID, From: formatGraphAddress(item.From.EmailAddress.Name, item.From.EmailAddress.Address),
		To: strings.Join(to, ", "), Subject: item.Subject, Date: item.ReceivedDateTime,
	}
}

func graphProviderMessage(item graphMessage) providerMessage {
	summary := graphMessageSummary(item)
	message := providerMessage{
		ID: summary.ID, From: summary.From, To: summary.To, Subject: summary.Subject,
		Text: item.BodyPreview, Date: summary.Date,
	}
	if strings.EqualFold(item.Body.ContentType, "html") {
		message.HTML = item.Body.Content
	} else if item.Body.Content != "" {
		message.Text = item.Body.Content
	}
	return message
}

func graphFolder(mailbox string) string {
	switch strings.ToLower(strings.TrimSpace(mailbox)) {
	case "junk", "spam":
		return "junkemail"
	case "sent":
		return "sentitems"
	default:
		return "inbox"
	}
}

func formatGraphAddress(name, address string) string {
	address = strings.TrimSpace(address)
	if address == "" {
		return ""
	}
	if strings.TrimSpace(name) == "" {
		return address
	}
	return (&mail.Address{Name: name, Address: address}).String()
}

func graphRecipients(values []string) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, map[string]any{"emailAddress": map[string]string{"address": value}})
	}
	return result
}

package businessapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

const (
	providerModeGraph = "GRAPH_API"
	providerModeGmail = "GMAIL_API"
	providerModeIMAP  = "IMAP"
)

func (s *Server) providerForAccount(account mailAccountCredentials) (mailProvider, error) {
	switch account.AuthType {
	case "MICROSOFT_OAUTH":
		if account.Provider != "OUTLOOK" {
			return nil, validationError("MICROSOFT_OAUTH requires OUTLOOK provider")
		}
		return graphMailProvider{server: s}, nil
	case "GOOGLE_OAUTH":
		if account.Provider != "GMAIL" {
			return nil, validationError("GOOGLE_OAUTH requires GMAIL provider")
		}
		return gmailMailProvider{server: s}, nil
	case "APP_PASSWORD":
		return imapSMTPProvider{server: s}, nil
	default:
		return nil, validationError("unsupported mail authentication type")
	}
}

func (s *Server) fetchAccountMailbox(ctx context.Context, account mailAccountCredentials, mailbox string, limit int, markAsSeen bool) (providerFetchResult, error) {
	modes, err := mailAccountFetchModes(account)
	if err != nil {
		return providerFetchResult{}, err
	}
	var result providerFetchResult
	var fetchErr error
	for _, mode := range modes {
		provider := s.providerForMode(mode)
		result, fetchErr = provider.Fetch(ctx, account, mailbox, limit)
		if fetchErr == nil {
			break
		}
	}
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerFetchResult{}, storeErr
	}
	databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if fetchErr != nil {
		_ = store.updateMailAccountHealth(databaseCtx, account.ID, false, boundedProviderError(fetchErr))
		return providerFetchResult{}, fetchErr
	}
	if _, err := store.updateMailboxSyncState(databaseCtx, account.ID, mailbox, result.Messages, result.MailboxCheckpoint, markAsSeen); err != nil {
		return providerFetchResult{}, err
	}
	if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
		return providerFetchResult{}, err
	}
	return result, nil
}

func (s *Server) listAccountMailboxSummaries(ctx context.Context, account mailAccountCredentials, mailbox string, limit int, markAsSeen bool) (providerSummaryResult, error) {
	modes, err := mailAccountFetchModes(account)
	if err != nil {
		return providerSummaryResult{}, err
	}
	var result providerSummaryResult
	var fetchErr error
	for _, mode := range modes {
		reader := s.mailboxReaderForMode(mode)
		result, fetchErr = reader.ListSummaries(ctx, account, mailbox, limit)
		if fetchErr == nil {
			break
		}
	}
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerSummaryResult{}, storeErr
	}
	databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if fetchErr != nil {
		_ = store.updateMailAccountHealth(databaseCtx, account.ID, false, boundedProviderError(fetchErr))
		return providerSummaryResult{}, fetchErr
	}
	syncMessages := make([]providerMessage, 0, len(result.Messages))
	for _, message := range result.Messages {
		syncMessages = append(syncMessages, providerMessage{
			ID: message.ID, From: message.From, To: message.To, Subject: message.Subject, Date: message.Date,
		})
	}
	if _, err := store.updateMailboxSyncState(databaseCtx, account.ID, mailbox, syncMessages, result.MailboxCheckpoint, markAsSeen); err != nil {
		return providerSummaryResult{}, err
	}
	if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
		return providerSummaryResult{}, err
	}
	return result, nil
}

func (s *Server) getAccountMailboxMessage(ctx context.Context, account mailAccountCredentials, mailbox, messageID string) (providerMessage, error) {
	mode, err := mailAccountDeleteMode(account, []string{messageID})
	if err != nil {
		return providerMessage{}, err
	}
	return s.mailboxReaderForMode(mode).GetMessage(ctx, account, mailbox, messageID)
}

func (s *Server) deleteAccountMessages(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	mode, err := mailAccountDeleteMode(account, messageIDs)
	if err != nil {
		return providerDeleteResult{}, err
	}
	provider := s.providerForMode(mode)
	result, err := provider.Delete(ctx, account, mailbox, messageIDs)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerDeleteResult{}, storeErr
	}
	databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if err != nil {
		_ = store.updateMailAccountHealth(databaseCtx, account.ID, false, boundedProviderError(err))
		return providerDeleteResult{}, err
	}
	if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
		return providerDeleteResult{}, err
	}
	return result, nil
}

func (s *Server) clearAccountMailbox(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	if !mailAccountSupportsClear(account) {
		return providerDeleteResult{}, &requestError{Status: http.StatusBadRequest, Code: "MAILBOX_CLEAR_UNSUPPORTED"}
	}
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	result, err := provider.Clear(ctx, account, mailbox)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerDeleteResult{}, storeErr
	}
	databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if err != nil {
		_ = store.updateMailAccountHealth(databaseCtx, account.ID, false, boundedProviderError(err))
		return providerDeleteResult{}, err
	}
	if _, err := store.clearMailboxSyncState(databaseCtx, account.ID, mailbox); err != nil {
		return providerDeleteResult{}, err
	}
	if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
		return providerDeleteResult{}, err
	}
	return result, nil
}

func (s *Server) providerForMode(mode string) mailProvider {
	switch mode {
	case providerModeGraph:
		return graphMailProvider{server: s}
	case providerModeGmail:
		return gmailMailProvider{server: s}
	default:
		return imapSMTPProvider{server: s}
	}
}

func (s *Server) mailboxReaderForMode(mode string) providerMailboxReader {
	switch mode {
	case providerModeGraph:
		return graphMailProvider{server: s}
	case providerModeGmail:
		return gmailMailProvider{server: s}
	default:
		return imapSMTPProvider{server: s}
	}
}

func mailAccountFetchModes(account mailAccountCredentials) ([]string, error) {
	switch account.AuthType {
	case "APP_PASSWORD":
		return []string{providerModeIMAP}, nil
	case "GOOGLE_OAUTH":
		if account.Provider != "GMAIL" {
			return nil, validationError("GOOGLE_OAUTH requires GMAIL provider")
		}
		switch strings.ToUpper(strings.TrimSpace(account.ProviderConfig.ReadMode)) {
		case "IMAP":
			return []string{providerModeIMAP}, nil
		case "AUTO":
			return []string{providerModeGmail, providerModeIMAP}, nil
		default:
			return []string{providerModeGmail}, nil
		}
	case "MICROSOFT_OAUTH":
		if account.Provider != "OUTLOOK" {
			return nil, validationError("MICROSOFT_OAUTH requires OUTLOOK provider")
		}
		mode := strings.ToUpper(strings.TrimSpace(account.ProviderConfig.ReadMode))
		switch mode {
		case "GRAPH_API":
			mode = "GRAPH_ONLY"
		case "IMAP":
			mode = "IMAP_ONLY"
		case "", "AUTO":
			mode = strings.ToUpper(strings.TrimSpace(account.FetchStrategy))
			if !hasOAuthScope(account.ProviderConfig.OAuthScopes, microsoftIMAPScope) {
				mode = "GRAPH_ONLY"
			}
		}
		switch mode {
		case "GRAPH_ONLY":
			return []string{providerModeGraph}, nil
		case "IMAP_ONLY":
			return []string{providerModeIMAP}, nil
		case "IMAP_FIRST":
			return []string{providerModeIMAP, providerModeGraph}, nil
		default:
			return []string{providerModeGraph, providerModeIMAP}, nil
		}
	default:
		return nil, validationError("unsupported mail authentication type")
	}
}

func mailAccountDeleteMode(account mailAccountCredentials, messageIDs []string) (string, error) {
	if account.AuthType == "APP_PASSWORD" {
		return providerModeIMAP, nil
	}
	if allIMAPMessageIDs(messageIDs) {
		return providerModeIMAP, nil
	}
	if account.AuthType == "GOOGLE_OAUTH" && account.Provider == "GMAIL" {
		if strings.EqualFold(account.ProviderConfig.ReadMode, "IMAP") {
			return providerModeIMAP, nil
		}
		return providerModeGmail, nil
	}
	if account.AuthType == "MICROSOFT_OAUTH" && account.Provider == "OUTLOOK" {
		modes, err := mailAccountFetchModes(account)
		if err != nil {
			return "", err
		}
		if len(modes) == 1 && modes[0] == providerModeIMAP {
			return providerModeIMAP, nil
		}
		return providerModeGraph, nil
	}
	return "", validationError("mail provider and authentication type are incompatible")
}

func allIMAPMessageIDs(messageIDs []string) bool {
	if len(messageIDs) == 0 {
		return false
	}
	for _, messageID := range messageIDs {
		value := strings.ToLower(strings.TrimSpace(messageID))
		if !strings.HasPrefix(value, "uid:") && !strings.HasPrefix(value, "imap:") {
			return false
		}
	}
	return true
}

func mailAccountSupportsClear(account mailAccountCredentials) bool {
	switch account.AuthType {
	case "GOOGLE_OAUTH":
		return account.Provider == "GMAIL"
	case "MICROSOFT_OAUTH":
		modes, err := mailAccountFetchModes(account)
		return err == nil && len(modes) > 0 && modes[0] == providerModeGraph &&
			hasMicrosoftGraphScope(account.ProviderConfig.OAuthScopes, "Mail.ReadWrite")
	default:
		return false
	}
}

func mailAccountSupportsSend(account mailAccountCredentials) bool {
	if account.AuthType != "MICROSOFT_OAUTH" || account.Provider != "OUTLOOK" {
		return true
	}
	modes, err := mailAccountFetchModes(account)
	return err == nil && len(modes) > 0 && modes[0] == providerModeGraph &&
		hasMicrosoftGraphScope(account.ProviderConfig.OAuthScopes, "Mail.Send")
}

func hasOAuthScope(scopes, expected string) bool {
	for _, scope := range strings.Fields(scopes) {
		if strings.EqualFold(scope, expected) {
			return true
		}
	}
	return false
}

func hasMicrosoftGraphScope(scopes, expected string) bool {
	for _, scope := range strings.Fields(scopes) {
		normalized := strings.TrimSuffix(strings.TrimSpace(scope), "/")
		if strings.EqualFold(normalized, expected) || strings.EqualFold(normalized, "https://graph.microsoft.com/"+expected) {
			return true
		}
	}
	return false
}

func (s *Server) sendAccountMessage(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
	if !mailAccountSupportsSend(account) {
		return providerSendResult{}, &requestError{Status: http.StatusBadRequest, Code: "MAIL_SEND_UNSUPPORTED"}
	}
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerSendResult{}, err
	}
	result, err := provider.Send(ctx, account, input)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerSendResult{}, storeErr
	}
	databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if err != nil {
		_ = store.updateMailAccountHealth(databaseCtx, account.ID, false, boundedProviderError(err))
		return providerSendResult{}, err
	}
	if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
		return providerSendResult{}, err
	}
	return result, nil
}

func boundedProviderError(err error) string {
	value := strings.TrimSpace(fmt.Sprint(err))
	if len(value) > 2000 {
		value = value[:2000]
	}
	return value
}

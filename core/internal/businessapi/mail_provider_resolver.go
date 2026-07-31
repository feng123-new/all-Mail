package businessapi

import (
	"context"
	"fmt"
	"strings"
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
		return imapSMTPProvider{}, nil
	default:
		return nil, validationError("unsupported mail authentication type")
	}
}

func (s *Server) fetchAccountMailbox(ctx context.Context, account mailAccountCredentials, mailbox string, limit int, markAsSeen bool) (providerFetchResult, error) {
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerFetchResult{}, err
	}
	result, err := provider.Fetch(ctx, account, mailbox, limit)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerFetchResult{}, storeErr
	}
	if err != nil {
		_ = store.updateMailAccountHealth(ctx, account.ID, false, boundedProviderError(err))
		return providerFetchResult{}, err
	}
	if _, err := store.updateMailboxSyncState(ctx, account.ID, mailbox, result.Messages, result.MailboxCheckpoint, markAsSeen); err != nil {
		return providerFetchResult{}, err
	}
	if err := store.updateMailAccountHealth(ctx, account.ID, true, ""); err != nil {
		return providerFetchResult{}, err
	}
	return result, nil
}

func (s *Server) deleteAccountMessages(ctx context.Context, account mailAccountCredentials, mailbox string, messageIDs []string) (providerDeleteResult, error) {
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	result, err := provider.Delete(ctx, account, mailbox, messageIDs)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerDeleteResult{}, storeErr
	}
	if err != nil {
		_ = store.updateMailAccountHealth(ctx, account.ID, false, boundedProviderError(err))
		return providerDeleteResult{}, err
	}
	if err := store.updateMailAccountHealth(ctx, account.ID, true, ""); err != nil {
		return providerDeleteResult{}, err
	}
	return result, nil
}

func (s *Server) clearAccountMailbox(ctx context.Context, account mailAccountCredentials, mailbox string) (providerDeleteResult, error) {
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerDeleteResult{}, err
	}
	result, err := provider.Clear(ctx, account, mailbox)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerDeleteResult{}, storeErr
	}
	if err != nil {
		_ = store.updateMailAccountHealth(ctx, account.ID, false, boundedProviderError(err))
		return providerDeleteResult{}, err
	}
	if _, err := store.clearMailboxSyncState(ctx, account.ID, mailbox); err != nil {
		return providerDeleteResult{}, err
	}
	if err := store.updateMailAccountHealth(ctx, account.ID, true, ""); err != nil {
		return providerDeleteResult{}, err
	}
	return result, nil
}

func (s *Server) sendAccountMessage(ctx context.Context, account mailAccountCredentials, input providerSendInput) (providerSendResult, error) {
	provider, err := s.providerForAccount(account)
	if err != nil {
		return providerSendResult{}, err
	}
	result, err := provider.Send(ctx, account, input)
	store, storeErr := s.managementStore()
	if storeErr != nil {
		return providerSendResult{}, storeErr
	}
	if err != nil {
		_ = store.updateMailAccountHealth(ctx, account.ID, false, boundedProviderError(err))
		return providerSendResult{}, err
	}
	if err := store.updateMailAccountHealth(ctx, account.ID, true, ""); err != nil {
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

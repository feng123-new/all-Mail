package businessapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

const (
	maxIngressJSONBodyBytes = 1 << 20
	maxIngressHeaders       = 200
	maxIngressAttachments   = 100
)

type IngressAttachment struct {
	Filename    *string `json:"filename,omitempty"`
	ContentType *string `json:"contentType,omitempty"`
	Size        *int64  `json:"size,omitempty"`
	ObjectKey   *string `json:"objectKey,omitempty"`
}

type IngressMessage struct {
	MessageID     *string             `json:"messageId,omitempty"`
	Subject       *string             `json:"subject,omitempty"`
	TextPreview   *string             `json:"textPreview,omitempty"`
	HTMLPreview   *string             `json:"htmlPreview,omitempty"`
	Headers       map[string]*string  `json:"headers,omitempty"`
	Attachments   []IngressAttachment `json:"attachments,omitempty"`
	RawObjectKey  *string             `json:"rawObjectKey,omitempty"`
	StorageStatus string              `json:"storageStatus,omitempty"`
}

type IngressReceiveInput struct {
	Provider    string `json:"provider"`
	DeliveryKey string `json:"deliveryKey"`
	ReceivedAt  string `json:"receivedAt"`
	Envelope    struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"envelope"`
	Routing struct {
		Domain         string `json:"domain"`
		LocalPart      string `json:"localPart"`
		MatchedAddress string `json:"matchedAddress"`
	} `json:"routing"`
	Message      IngressMessage `json:"message"`
	ReceivedTime time.Time      `json:"-"`
}

type IngressEndpoint struct {
	ID                     int64
	DomainID               *int64
	DomainName             *string
	KeyID                  string
	Name                   string
	Status                 string
	SigningSecretEncrypted string
}

type IngressResult struct {
	Accepted  bool   `json:"accepted"`
	Duplicate bool   `json:"duplicate"`
	Route     string `json:"route"`
	DomainID  int64  `json:"domainId"`
	MailboxID int64  `json:"mailboxId"`
	MessageID string `json:"messageId"`
}

type IngressStore interface {
	FindIngressEndpoint(context.Context, string) (IngressEndpoint, error)
	ReceiveIngress(context.Context, IngressReceiveInput, IngressEndpoint) (IngressResult, error)
}

type ReplayProtector interface {
	Reserve(context.Context, string, string, time.Duration) (bool, error)
	Release(context.Context, string, string) error
}

type allowAllReplayProtector struct{}

func (allowAllReplayProtector) Reserve(context.Context, string, string, time.Duration) (bool, error) {
	return true, nil
}
func (allowAllReplayProtector) Release(context.Context, string, string) error { return nil }

func (s *Server) registerIngressRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /ingress/domain-mail/receive", s.receiveIngress)
}

func (s *Server) receiveIngress(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	store := s.ingressStore
	if store == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "INGRESS_STORE_UNAVAILABLE"})
		return
	}
	if s.replayProtector == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "INGRESS_REPLAY_BACKEND_UNAVAILABLE"})
		return
	}

	rawBody, err := readIngressBody(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	keyID := strings.TrimSpace(r.Header.Get("X-Ingress-Key-Id"))
	timestamp := strings.TrimSpace(r.Header.Get("X-Ingress-Timestamp"))
	signature := strings.TrimSpace(r.Header.Get("X-Ingress-Signature"))
	if keyID == "" || timestamp == "" || signature == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INGRESS_SIGNATURE_REQUIRED"})
		return
	}
	if len(keyID) > 64 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INGRESS_SIGNATURE_INVALID"})
		return
	}

	timestampSeconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INGRESS_SIGNATURE_INVALID"})
		return
	}
	signedAt := time.Unix(timestampSeconds, 0)
	if durationAbs(s.now().Sub(signedAt)) > s.cfg.IngressAllowedSkew {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INGRESS_SIGNATURE_EXPIRED"})
		return
	}

	endpoint, err := store.FindIngressEndpoint(ctx, keyID)
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "INGRESS_ENDPOINT_DISABLED"})
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "load ingress endpoint", err)
		return
	}
	if endpoint.Status != "ACTIVE" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "INGRESS_ENDPOINT_DISABLED"})
		return
	}
	if endpoint.SigningSecretEncrypted == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "INGRESS_NOT_CONFIGURED"})
		return
	}

	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, endpoint.SigningSecretEncrypted)
	if err != nil {
		s.writeRequestError(w, r, &requestError{
			Status: http.StatusInternalServerError,
			Code:   "INGRESS_CONFIGURATION_INVALID",
			Cause:  err,
		})
		return
	}
	if !verifyIngressSignature(secret, timestamp, r.Method, r.URL.Path, rawBody, signature) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INGRESS_SIGNATURE_INVALID"})
		return
	}

	var input IngressReceiveInput
	if err := json.Unmarshal(rawBody, &input); err != nil {
		s.writeRequestError(w, r, validationError("request body must match the ingress JSON contract"))
		return
	}
	if err := normalizeAndValidateIngress(&input); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if endpoint.DomainName != nil && !strings.EqualFold(strings.TrimSpace(*endpoint.DomainName), input.Routing.Domain) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "INGRESS_ENDPOINT_DOMAIN_MISMATCH"})
		return
	}

	replayKey := fmt.Sprintf("ingress:replay:%s:%s", keyID, input.DeliveryKey)
	replayToken := requestID(r)
	reserved, err := s.replayProtector.Reserve(ctx, replayKey, replayToken, maxDuration(2*s.cfg.IngressAllowedSkew, time.Minute))
	if err != nil {
		s.writeRequestError(w, r, &requestError{
			Status: http.StatusServiceUnavailable,
			Code:   "INGRESS_REPLAY_BACKEND_UNAVAILABLE",
			Cause:  err,
		})
		return
	}
	if !reserved {
		s.writeRequestError(w, r, &requestError{Status: http.StatusConflict, Code: "INGRESS_REPLAY_DETECTED"})
		return
	}

	releaseReservation := true
	defer func() {
		if !releaseReservation {
			return
		}
		releaseCtx, releaseCancel := context.WithTimeout(context.Background(), s.cfg.ReadyTimeout)
		defer releaseCancel()
		if releaseErr := s.replayProtector.Release(releaseCtx, replayKey, replayToken); releaseErr != nil {
			s.logger.Error("release failed ingress replay reservation", "request_id", requestID(r), "error", releaseErr)
		}
	}()

	result, err := store.ReceiveIngress(ctx, input, endpoint)
	if err != nil {
		s.writeStoreError(w, r, "persist ingress message", err)
		return
	}
	releaseReservation = false
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func readIngressBody(request *http.Request) ([]byte, error) {
	if request.Body == nil {
		return nil, validationError("request body must match the ingress JSON contract")
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxIngressJSONBodyBytes+1))
	if err != nil {
		return nil, &requestError{Status: http.StatusBadRequest, Code: "VALIDATION_ERROR", Cause: err}
	}
	if len(body) == 0 {
		return nil, validationError("request body must match the ingress JSON contract")
	}
	if len(body) > maxIngressJSONBodyBytes {
		return nil, &requestError{Status: http.StatusRequestEntityTooLarge, Code: "INGRESS_BODY_TOO_LARGE"}
	}
	return body, nil
}

func verifyIngressSignature(secret, timestamp, method, path string, rawBody []byte, signature string) bool {
	provided, err := hex.DecodeString(signature)
	if err != nil || len(provided) != sha256.Size {
		return false
	}
	bodyHash := sha256.Sum256(rawBody)
	canonical := timestamp + "\n" + strings.ToUpper(method) + "\n" + path + "\n" + hex.EncodeToString(bodyHash[:])
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hmac.Equal(provided, mac.Sum(nil))
}

func normalizeAndValidateIngress(input *IngressReceiveInput) error {
	input.Provider = strings.TrimSpace(input.Provider)
	input.DeliveryKey = strings.TrimSpace(input.DeliveryKey)
	input.ReceivedAt = strings.TrimSpace(input.ReceivedAt)
	input.Envelope.From = strings.ToLower(strings.TrimSpace(input.Envelope.From))
	input.Envelope.To = strings.ToLower(strings.TrimSpace(input.Envelope.To))
	input.Routing.Domain = strings.ToLower(strings.TrimSpace(input.Routing.Domain))
	input.Routing.LocalPart = strings.ToLower(strings.TrimSpace(input.Routing.LocalPart))
	input.Routing.MatchedAddress = strings.ToLower(strings.TrimSpace(input.Routing.MatchedAddress))

	if err := validateTextLength("provider", input.Provider, 1, 50); err != nil {
		return err
	}
	if err := validateTextLength("deliveryKey", input.DeliveryKey, 1, 128); err != nil {
		return err
	}
	receivedAt, err := time.Parse(time.RFC3339, input.ReceivedAt)
	if err != nil {
		return validationError("receivedAt must be an RFC3339 timestamp")
	}
	input.ReceivedTime = receivedAt.UTC()
	if err := validateEmailAddress(input.Envelope.From); err != nil {
		return validationError("envelope.from must be a valid email address")
	}
	if err := validateEmailAddress(input.Envelope.To); err != nil {
		return validationError("envelope.to must be a valid email address")
	}
	if err := validateTextLength("routing.domain", input.Routing.Domain, 1, 255); err != nil {
		return err
	}
	if err := validateTextLength("routing.localPart", input.Routing.LocalPart, 1, 255); err != nil {
		return err
	}
	if err := validateEmailAddress(input.Routing.MatchedAddress); err != nil {
		return validationError("routing.matchedAddress must be a valid email address")
	}
	if input.Routing.MatchedAddress != input.Routing.LocalPart+"@"+input.Routing.Domain {
		return validationError("routing fields must describe the same matched address")
	}
	if input.Envelope.To != input.Routing.MatchedAddress {
		return validationError("envelope.to must match routing.matchedAddress")
	}

	input.Message.MessageID = trimOptionalIngressString(input.Message.MessageID)
	input.Message.Subject = trimOptionalIngressString(input.Message.Subject)
	input.Message.TextPreview = trimOptionalIngressString(input.Message.TextPreview)
	input.Message.HTMLPreview = trimOptionalIngressString(input.Message.HTMLPreview)
	input.Message.RawObjectKey = trimOptionalIngressString(input.Message.RawObjectKey)
	if err := validateOptionalIngressLength("message.messageId", input.Message.MessageID, 255); err != nil {
		return err
	}
	if err := validateOptionalIngressLength("message.subject", input.Message.Subject, 500); err != nil {
		return err
	}
	if err := validateOptionalIngressLength("message.textPreview", input.Message.TextPreview, 12000); err != nil {
		return err
	}
	if err := validateOptionalIngressLength("message.htmlPreview", input.Message.HTMLPreview, 20000); err != nil {
		return err
	}
	if err := validateOptionalIngressLength("message.rawObjectKey", input.Message.RawObjectKey, 500); err != nil {
		return err
	}

	if input.Message.Headers == nil {
		input.Message.Headers = map[string]*string{}
	}
	if input.Message.Attachments == nil {
		input.Message.Attachments = []IngressAttachment{}
	}
	if len(input.Message.Headers) > maxIngressHeaders {
		return validationError("message.headers must contain at most 200 entries")
	}
	for name, value := range input.Message.Headers {
		if err := validateTextLength("message header name", strings.TrimSpace(name), 1, 255); err != nil {
			return err
		}
		if value != nil && len(*value) > 8192 {
			return validationError("message header values must contain at most 8192 characters")
		}
	}
	if len(input.Message.Attachments) > maxIngressAttachments {
		return validationError("message.attachments must contain at most 100 entries")
	}
	for index := range input.Message.Attachments {
		attachment := &input.Message.Attachments[index]
		attachment.Filename = trimOptionalIngressString(attachment.Filename)
		attachment.ContentType = trimOptionalIngressString(attachment.ContentType)
		attachment.ObjectKey = trimOptionalIngressString(attachment.ObjectKey)
		if attachment.Size != nil && *attachment.Size < 0 {
			return validationError("attachment size must be non-negative")
		}
		if err := validateOptionalIngressLength("attachment filename", attachment.Filename, 255); err != nil {
			return err
		}
		if err := validateOptionalIngressLength("attachment contentType", attachment.ContentType, 255); err != nil {
			return err
		}
		if err := validateOptionalIngressLength("attachment objectKey", attachment.ObjectKey, 500); err != nil {
			return err
		}
	}

	input.Message.StorageStatus = strings.ToUpper(strings.TrimSpace(input.Message.StorageStatus))
	if input.Message.StorageStatus == "" {
		if input.Message.RawObjectKey != nil {
			input.Message.StorageStatus = "STORED"
		} else {
			input.Message.StorageStatus = "PENDING"
		}
	}
	switch input.Message.StorageStatus {
	case "PENDING", "STORED", "FAILED":
	default:
		return validationError("message.storageStatus must be PENDING, STORED, or FAILED")
	}
	if input.Message.StorageStatus == "STORED" && input.Message.RawObjectKey == nil {
		return validationError("message.rawObjectKey is required when storageStatus is STORED")
	}
	return nil
}

func trimOptionalIngressString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func validateOptionalIngressLength(name string, value *string, maximum int) error {
	if value == nil {
		return nil
	}
	return validateTextLength(name, *value, 1, maximum)
}

func durationAbs(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func maxDuration(left, right time.Duration) time.Duration {
	if left > right {
		return left
	}
	return right
}

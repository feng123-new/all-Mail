package businessapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type temporaryGmailRequest struct {
	Email       string              `json:"email"`
	Password    string              `json:"password"`
	Operation   string              `json:"operation"`
	Mailbox     string              `json:"mailbox"`
	MessageID   string              `json:"messageId"`
	UIDValidity uint32              `json:"uidValidity"`
	Message     *accountSendRequest `json:"message"`
}

func (s *Server) useTemporaryGmail(w http.ResponseWriter, r *http.Request, _ Admin) {
	var body *temporaryGmailRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil || body == nil {
		s.writeRequestError(w, r, validationError("request body must be a valid Gmail operation"))
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		s.writeRequestError(w, r, validationError("request body must contain one JSON value"))
		return
	}
	email := strings.TrimSpace(body.Email)
	if err := validateEmailAddress(email); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	password := strings.ReplaceAll(strings.TrimSpace(body.Password), " ", "")
	if len(password) != 16 || strings.ContainsFunc(password, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
	}) {
		s.writeRequestError(w, r, validationError("a 16-character Google app password is required"))
		return
	}
	account := mailAccountCredentials{
		Email: email, Password: password, Provider: "GMAIL", AuthType: "APP_PASSWORD",
		ProviderConfig: defaultProviderConfig("GMAIL"),
	}
	provider := imapSMTPProvider{server: s, requireSMTPAuth: true}
	var data any
	var err error
	switch body.Operation {
	case "list", "detail":
		if body.Message != nil || (body.Mailbox != "INBOX" && body.Mailbox != "SENT") {
			err = validationError("a Gmail mailbox is required for read operations")
			break
		}
		if body.Operation == "list" {
			if body.MessageID != "" || body.UIDValidity != 0 {
				err = validationError("messageId and uidValidity apply only to detail")
				break
			}
			data, err = provider.ListSummaries(r.Context(), account, body.Mailbox, 25)
			break
		}
		if body.UIDValidity == 0 {
			err = validationError("uidValidity is required for message detail")
			break
		}
		account.MailboxStatus = map[string]any{body.Mailbox: map[string]any{"uidValidity": body.UIDValidity}}
		data, err = provider.GetMessage(r.Context(), account, body.Mailbox, body.MessageID)
	case "send":
		if body.Message == nil || body.Mailbox != "" || body.MessageID != "" || body.UIDValidity != 0 {
			err = validationError("a send operation must contain only a message and credentials")
			break
		}
		var input providerSendInput
		input, err = validateAccountSend(*body.Message)
		if err == nil {
			input.FromEmail = account.Email
			data, err = provider.Send(r.Context(), account, input)
		}
	default:
		err = validationError("unsupported temporary Gmail operation")
	}
	if err != nil {
		// Do not log upstream responses from a request carrying unsaved credentials.
		writeError(w, statusForError(err), requestID(r), requestErrorCode(err, "INTERNAL_ERROR"), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

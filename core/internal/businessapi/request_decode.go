package businessapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

const maxJSONBodyBytes = 1 << 20

func decodeJSONBody(request *http.Request, target any) error {
	if request.Body == nil {
		return nil
	}
	decoder := json.NewDecoder(io.LimitReader(request.Body, maxJSONBodyBytes+1))
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return validationError("request body must be valid JSON")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return validationError("request body must contain one JSON value")
	}
	return nil
}

func parseNullableAPITime(raw json.RawMessage) (*time.Time, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if string(raw) == "null" {
		return nil, true, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, validationError("expiresAt must be an RFC3339 string or null")
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, true, validationError("expiresAt must be an RFC3339 string or null")
	}
	parsed = parsed.UTC()
	return &parsed, true, nil
}

func validateTextLength(name, value string, minimum, maximum int) error {
	length := utf8.RuneCountInString(value)
	if length < minimum || length > maximum {
		return validationError(fmt.Sprintf("%s must contain between %d and %d characters", name, minimum, maximum))
	}
	return nil
}

func validateEmailAddress(value string) error {
	value = strings.TrimSpace(value)
	address, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(address.Address, value) || !strings.Contains(value, "@") {
		return validationError("email must be a valid email address")
	}
	return nil
}

func statusForError(err error) int {
	var requestErr *requestError
	if errors.As(err, &requestErr) {
		return requestErr.Status
	}
	return http.StatusInternalServerError
}

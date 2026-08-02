package passwordpolicy

import (
	"fmt"
	"unicode/utf8"
)

const MaxBcryptBytes = 72

// Validate enforces a human-readable minimum while respecting bcrypt's
// 72-byte input limit. The byte bound is deliberately checked separately from
// the rune count so non-ASCII passwords cannot be silently truncated or turn
// into an internal hashing error.
func Validate(field, value string, minimumRunes int) error {
	if utf8.RuneCountInString(value) < minimumRunes {
		return fmt.Errorf("%s must contain at least %d characters", field, minimumRunes)
	}
	if len([]byte(value)) > MaxBcryptBytes {
		return fmt.Errorf("%s must contain at most %d UTF-8 bytes", field, MaxBcryptBytes)
	}
	return nil
}

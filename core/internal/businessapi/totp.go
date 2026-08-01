package businessapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

func generateTOTPSecret() (string, error) {
	secret := make([]byte, 20)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate TOTP secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

func buildTOTPURI(secret, account, issuer string) string {
	issuer = strings.TrimSpace(issuer)
	if issuer == "" {
		issuer = "all-Mail"
	}
	account = strings.TrimSpace(account)
	if account == "" {
		account = "admin"
	}
	label := encodeURIComponent(issuer + ":" + account)
	return fmt.Sprintf(
		"otpauth://totp/%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		label,
		encodeURIComponent(secret),
		encodeURIComponent(issuer),
	)
}

func encodeURIComponent(value string) string {
	encoded := strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
	replacements := []string{
		"%21", "!",
		"%27", "'",
		"%28", "(",
		"%29", ")",
		"%2A", "*",
	}
	return strings.NewReplacer(replacements...).Replace(encoded)
}

func verifyTOTP(secret, token string, window int, now time.Time) bool {
	if len(token) != 6 {
		return false
	}
	for _, digit := range token {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
		strings.ToUpper(strings.Map(func(value rune) rune {
			if (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') || (value >= '2' && value <= '7') {
				return value
			}
			return -1
		}, secret)),
	)
	if err != nil || len(decoded) == 0 {
		return false
	}
	if window < 0 {
		window = 0
	} else if window > 5 {
		window = 5
	}
	step := now.Unix() / 30
	for offset := -window; offset <= window; offset++ {
		if hmac.Equal([]byte(totpCode(decoded, step+int64(offset))), []byte(token)) {
			return true
		}
	}
	return false
}

func totpCode(secret []byte, step int64) string {
	counter := make([]byte, 8)
	binary.BigEndian.PutUint64(counter, uint64(step))
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counter)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := (uint32(digest[offset])&0x7f)<<24 |
		uint32(digest[offset+1])<<16 |
		uint32(digest[offset+2])<<8 |
		uint32(digest[offset+3])
	return fmt.Sprintf("%06d", value%1_000_000)
}

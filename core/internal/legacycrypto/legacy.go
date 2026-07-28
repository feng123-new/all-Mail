package legacycrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

func Decrypt(secret, envelope string) (string, error) {
	parts := strings.Split(envelope, ":")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid encrypted format")
	}
	iv, err := hex.DecodeString(parts[0])
	if err != nil || len(iv) == 0 {
		return "", fmt.Errorf("decode encryption IV: %w", err)
	}
	tag, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode authentication tag: %w", err)
	}
	ciphertext, err := hex.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", fmt.Errorf("create AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", fmt.Errorf("create GCM cipher: %w", err)
	}
	if len(tag) != gcm.Overhead() {
		return "", fmt.Errorf("invalid authentication tag length")
	}
	sealed := append(append([]byte{}, ciphertext...), tag...)
	plaintext, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt value: %w", err)
	}
	return string(plaintext), nil
}

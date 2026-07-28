package legacycrypto

import "testing"

func TestDecryptMatchesNodeAES256GCMEnvelope(t *testing.T) {
	const encrypted = "000102030405060708090a0b0c0d0e0f:d053a523f654e3ce24f9c6faca68771f:9cf1bb9dcd2d6d81fd93c48accd5"
	plaintext, err := Decrypt("test-encryption-key-1234567890ab", encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "re_test_secret" {
		t.Fatalf("Decrypt() = %q", plaintext)
	}
}

func TestDecryptRejectsMalformedEnvelope(t *testing.T) {
	if _, err := Decrypt("test-encryption-key-1234567890ab", "invalid"); err == nil {
		t.Fatal("Decrypt() expected an error")
	}
}

package passwordpolicy

import (
	"strings"
	"testing"
)

func TestValidateSeparatesCharactersFromBcryptBytes(t *testing.T) {
	if err := Validate("password", "correct-horse", 8); err != nil {
		t.Fatal(err)
	}
	if err := Validate("password", "短密码", 8); err == nil {
		t.Fatal("short password was accepted")
	}
	if err := Validate("password", strings.Repeat("密", 24), 8); err != nil {
		t.Fatalf("72-byte multibyte password was rejected: %v", err)
	}
	if err := Validate("password", strings.Repeat("密", 25), 8); err == nil {
		t.Fatal("75-byte multibyte password was accepted")
	}
	if err := Validate("password", strings.Repeat("a", MaxBcryptBytes+1), 8); err == nil {
		t.Fatal("overlong ASCII password was accepted")
	}
}

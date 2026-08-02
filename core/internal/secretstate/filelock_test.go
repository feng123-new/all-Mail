package secretstate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileLockIsExclusiveAndReusable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "exclusive.lock")
	first, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	locked, err := tryLockFile(first)
	if err != nil || !locked {
		t.Fatalf("first lock: locked=%v err=%v", locked, err)
	}
	defer func() { _ = unlockFile(first) }()

	locked, err = tryLockFile(second)
	if err != nil {
		t.Fatalf("contended lock: %v", err)
	}
	if locked {
		t.Fatal("second handle acquired an already held lock")
	}

	if err := unlockFile(first); err != nil {
		t.Fatal(err)
	}
	locked, err = tryLockFile(second)
	if err != nil || !locked {
		t.Fatalf("reused lock: locked=%v err=%v", locked, err)
	}
	if err := unlockFile(second); err != nil {
		t.Fatal(err)
	}
}

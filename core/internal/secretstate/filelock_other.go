//go:build !unix && !windows

package secretstate

import (
	"errors"
	"os"
)

var errFileLockUnsupported = errors.New("runtime secret file locking is unsupported on this platform")

func tryExclusiveFileLock(_ *os.File) error {
	return errFileLockUnsupported
}

func releaseFileLock(_ *os.File) error {
	return nil
}

func isFileLockContention(error) bool {
	return false
}

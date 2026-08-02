//go:build windows

package secretstate

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const (
	lockFileFailImmediately = 0x00000001
	lockFileExclusiveLock   = 0x00000002

	errorSharingViolation syscall.Errno = 32
	errorLockViolation    syscall.Errno = 33
)

var (
	kernel32DLL      = syscall.NewLazyDLL("kernel32.dll")
	lockFileExProc   = kernel32DLL.NewProc("LockFileEx")
	unlockFileExProc = kernel32DLL.NewProc("UnlockFileEx")
)

func tryExclusiveFileLock(file *os.File) error {
	var overlapped syscall.Overlapped
	result, _, callErr := lockFileExProc.Call(
		file.Fd(),
		uintptr(lockFileExclusiveLock|lockFileFailImmediately),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if result != 0 {
		return nil
	}
	if callErr != syscall.Errno(0) {
		return callErr
	}
	return syscall.EINVAL
}

func releaseFileLock(file *os.File) error {
	var overlapped syscall.Overlapped
	result, _, callErr := unlockFileExProc.Call(
		file.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if result != 0 {
		return nil
	}
	if callErr != syscall.Errno(0) {
		return callErr
	}
	return syscall.EINVAL
}

func isFileLockContention(err error) bool {
	return errors.Is(err, errorLockViolation) || errors.Is(err, errorSharingViolation)
}

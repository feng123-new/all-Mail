//go:build windows

package secretstate

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	lockFileFailImmediately = 0x00000001
	lockFileExclusiveLock   = 0x00000002
	errorLockViolation      = syscall.Errno(33)
)

var (
	kernel32DLL      = syscall.NewLazyDLL("kernel32.dll")
	lockFileExProc   = kernel32DLL.NewProc("LockFileEx")
	unlockFileExProc = kernel32DLL.NewProc("UnlockFileEx")
)

func tryLockFile(file *os.File) (bool, error) {
	var overlapped syscall.Overlapped
	result, _, callErr := lockFileExProc.Call(
		file.Fd(),
		uintptr(lockFileFailImmediately|lockFileExclusiveLock),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	runtime.KeepAlive(file)
	if result != 0 {
		return true, nil
	}
	if errno, ok := callErr.(syscall.Errno); ok {
		if errno == errorLockViolation {
			return false, nil
		}
		if errno == 0 {
			callErr = syscall.EINVAL
		}
	}
	return false, fmt.Errorf("LockFileEx: %w", callErr)
}

func unlockFile(file *os.File) error {
	var overlapped syscall.Overlapped
	result, _, callErr := unlockFileExProc.Call(
		file.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	runtime.KeepAlive(file)
	if result != 0 {
		return nil
	}
	if errno, ok := callErr.(syscall.Errno); ok && errno == 0 {
		callErr = syscall.EINVAL
	}
	return fmt.Errorf("UnlockFileEx: %w", callErr)
}

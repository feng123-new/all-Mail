package buildinfo

import (
	"runtime"
	"strings"
)

// These values are replaced at build time with -ldflags -X. Development
// builds intentionally retain safe, explicit fallbacks.
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildDate = "unknown"
)

// Info is the stable release identity exposed by `allmail version --json`.
type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
	GoVersion string `json:"goVersion"`
}

// Current returns normalized build metadata without consulting the network or
// the filesystem, so it is safe in every runtime and doctor context.
func Current() Info {
	return Info{
		Version:   normalized(Version, "dev"),
		Commit:    normalized(Commit, "unknown"),
		BuildDate: normalized(BuildDate, "unknown"),
		GoVersion: runtime.Version(),
	}
}

func normalized(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

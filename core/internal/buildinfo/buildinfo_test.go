package buildinfo

import "testing"

func TestCurrentNormalizesInjectedValues(t *testing.T) {
	oldVersion, oldCommit, oldBuildDate := Version, Commit, BuildDate
	t.Cleanup(func() {
		Version, Commit, BuildDate = oldVersion, oldCommit, oldBuildDate
	})

	Version = " 2.0.0 "
	Commit = " abcdef123456 "
	BuildDate = " 2026-08-02T02:57:05Z "

	info := Current()
	if info.Version != "2.0.0" || info.Commit != "abcdef123456" || info.BuildDate != "2026-08-02T02:57:05Z" {
		t.Fatalf("Current() = %#v", info)
	}
	if info.GoVersion == "" {
		t.Fatal("GoVersion is empty")
	}
}

func TestCurrentUsesDevelopmentFallbacks(t *testing.T) {
	oldVersion, oldCommit, oldBuildDate := Version, Commit, BuildDate
	t.Cleanup(func() {
		Version, Commit, BuildDate = oldVersion, oldCommit, oldBuildDate
	})

	Version, Commit, BuildDate = " ", "", "\t"
	info := Current()
	if info.Version != "dev" || info.Commit != "unknown" || info.BuildDate != "unknown" {
		t.Fatalf("fallback Current() = %#v", info)
	}
}

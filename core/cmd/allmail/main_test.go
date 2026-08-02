package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/buildinfo"
)

func TestCommandFromArgsRecognizesHelp(t *testing.T) {
	for _, args := range [][]string{
		{"allmail", "--help"},
		{"allmail", "-h"},
		{"allmail", "help"},
	} {
		command, showHelp := commandFromArgs(args)
		if command != "" || !showHelp {
			t.Fatalf("commandFromArgs(%v) = %q, %v", args, command, showHelp)
		}
	}
}

func TestUsageDocumentsRuntimeCommands(t *testing.T) {
	for _, expected := range []string{
		"allmail api",
		"allmail business-api",
		"allmail routes",
		"allmail version",
		"allmail version --json",
		"allmail worker forwarding",
		"allmail worker retention",
		"allmail migrate",
		"allmail doctor api",
		"allmail doctor business-api",
		"allmail doctor worker forwarding",
		"allmail doctor worker retention",
	} {
		if !strings.Contains(usageText, expected) {
			t.Fatalf("usage is missing %q:\n%s", expected, usageText)
		}
	}
	for _, retired := range []string{"allmail jobs", "allmail doctor jobs"} {
		if strings.Contains(usageText, retired) {
			t.Fatalf("usage still documents retired command %q:\n%s", retired, usageText)
		}
	}
}

func TestWriteVersionJSON(t *testing.T) {
	oldVersion, oldCommit, oldBuildDate := buildinfo.Version, buildinfo.Commit, buildinfo.BuildDate
	t.Cleanup(func() {
		buildinfo.Version, buildinfo.Commit, buildinfo.BuildDate = oldVersion, oldCommit, oldBuildDate
	})
	buildinfo.Version = "2.0.0"
	buildinfo.Commit = "abcdef123456"
	buildinfo.BuildDate = "2026-08-02T02:57:05Z"

	var output bytes.Buffer
	if err := writeVersion(&output, []string{"allmail", "version", "--json"}); err != nil {
		t.Fatal(err)
	}
	var info buildinfo.Info
	if err := json.Unmarshal(output.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Version != "2.0.0" || info.Commit != "abcdef123456" || info.BuildDate != "2026-08-02T02:57:05Z" || info.GoVersion == "" {
		t.Fatalf("version info = %#v", info)
	}
}

func TestWriteVersionRejectsUnknownOption(t *testing.T) {
	if err := writeVersion(&bytes.Buffer{}, []string{"allmail", "version", "--yaml"}); err == nil || !strings.Contains(err.Error(), "allmail version [--json]") {
		t.Fatalf("unknown option error = %v", err)
	}
}

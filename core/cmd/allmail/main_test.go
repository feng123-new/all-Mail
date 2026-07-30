package main

import (
	"strings"
	"testing"
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
		"allmail routes",
		"allmail worker forwarding",
		"allmail worker retention",
		"allmail migrate",
		"allmail doctor api",
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

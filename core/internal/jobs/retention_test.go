package jobs

import (
	"strings"
	"testing"
)

func TestBuildRetentionSQLIsBoundedAndLocked(t *testing.T) {
	sql := buildRetentionSQL(30, 5000)
	for _, expected := range []string{
		"pg_try_advisory_xact_lock",
		"make_interval(days => 30)",
		"LIMIT 5000",
		"DELETE FROM api_logs",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("retention SQL is missing %q:\n%s", expected, sql)
		}
	}
}

func TestParseRetentionResult(t *testing.T) {
	acquired, deleted, err := parseRetentionResult("t|42\n")
	if err != nil {
		t.Fatal(err)
	}
	if !acquired || deleted != 42 {
		t.Fatalf("result = %v %d", acquired, deleted)
	}

	acquired, deleted, err = parseRetentionResult("f|0\n")
	if err != nil {
		t.Fatal(err)
	}
	if acquired || deleted != 0 {
		t.Fatalf("result = %v %d", acquired, deleted)
	}
}

func TestParseRetentionResultRejectsInvalidOutput(t *testing.T) {
	for _, output := range []string{"", "HTTP/1.1 200 OK", "t|not-a-number"} {
		if _, _, err := parseRetentionResult(output); err == nil {
			t.Fatalf("parseRetentionResult(%q) expected an error", output)
		}
	}
}

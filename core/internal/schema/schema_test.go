package schema

import (
	"testing"
)

func TestManifestContainsImmutablePrismaHistory(t *testing.T) {
	manifest, err := Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest) != len(migrationOrder) || len(manifest) != 14 {
		t.Fatalf("manifest length = %d", len(manifest))
	}
	for index, item := range manifest {
		if item.Position != index+1 || item.ID != migrationOrder[index] || len(item.Checksum) != 64 || item.SQL == "" {
			t.Fatalf("manifest item %d = %#v", index, item)
		}
	}
}

func TestRandomUUIDUsesCanonicalShape(t *testing.T) {
	value, err := randomUUID()
	if err != nil {
		t.Fatal(err)
	}
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		t.Fatalf("uuid = %q", value)
	}
}

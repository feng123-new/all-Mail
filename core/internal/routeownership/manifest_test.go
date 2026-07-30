package routeownership

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalManifestClassifiesEveryGatewayFamily(t *testing.T) {
	manifest, err := LoadFile(filepath.Join("..", "..", "..", "config", "route-ownership.json"))
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]struct {
		path  string
		id    string
		owner Owner
	}{
		"health":             {path: "/health", id: "system-health", owner: OwnerGo},
		"dashboard":          {path: "/admin/dashboard/stats", id: "admin-dashboard", owner: OwnerBusinessAPI},
		"admin catch-all":    {path: "/admin/unknown", id: "admin-other", owner: OwnerBusinessAPI},
		"domain mail":        {path: "/api/domain-mail/messages", id: "external-domain-mail", owner: OwnerBusinessAPI},
		"external catch-all": {path: "/api/unknown", id: "external-api", owner: OwnerBusinessAPI},
		"mailbox portal":     {path: "/mail/api/session", id: "mailbox-portal", owner: OwnerBusinessAPI},
		"ingress":            {path: "/ingress/domain-mail/receive", id: "ingress-domain-mail", owner: OwnerBusinessAPI},
		"spa":                {path: "/settings/domains", id: "spa", owner: OwnerGo},
		"prefix boundary":    {path: "/administrator", id: "spa", owner: OwnerGo},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			route := manifest.Match(tc.path)
			if route.ID != tc.id || route.Owner != tc.owner {
				t.Fatalf("Match(%q) = %#v, want id=%q owner=%q", tc.path, route, tc.id, tc.owner)
			}
		})
	}

	dashboard := manifest.Match("/admin/dashboard")
	if dashboard.MigrationStage != MigrationObserving || dashboard.TargetOwner != OwnerGo {
		t.Fatalf("dashboard migration metadata = %#v", dashboard)
	}
	if len(manifest.Digest()) != 64 {
		t.Fatalf("manifest digest = %q", manifest.Digest())
	}
}

func TestManifestRejectsUnsafeOrAmbiguousContracts(t *testing.T) {
	valid := `{
		"version":1,
		"description":"test",
		"routes":[
			{"id":"admin","owner":"business-api","match":"prefix","path":"/admin","migrationStage":"pending","targetOwner":"go"},
			{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}
		]
	}`

	cases := map[string]string{
		"unknown field": strings.Replace(valid, `"description":"test"`, `"description":"test","unexpected":true`, 1),
		"duplicate id": strings.Replace(valid, `"id":"spa"`, `"id":"admin"`, 1),
		"duplicate matcher": strings.Replace(valid, `"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"`, `"id":"admin-2","owner":"business-api","match":"prefix","path":"/admin","migrationStage":"pending","targetOwner":"go"`, 1),
		"missing fallback": `{
			"version":1,
			"description":"test",
			"routes":[{"id":"admin","owner":"business-api","match":"prefix","path":"/admin","migrationStage":"pending","targetOwner":"go"}]
		}`,
		"unsafe completed owner": strings.Replace(valid, `"owner":"business-api","match":"prefix","path":"/admin","migrationStage":"pending","targetOwner":"go"`, `"owner":"business-api","match":"prefix","path":"/admin","migrationStage":"complete"`, 1),
		"bad fallback owner": strings.Replace(valid, `"id":"spa","owner":"go"`, `"id":"spa","owner":"business-api"`, 1),
		"multiple values": valid + `{}`,
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(content)); err == nil {
				t.Fatalf("Parse() accepted invalid manifest: %s", content)
			}
		})
	}
}

func TestSnapshotReturnsAnIndependentRouteSlice(t *testing.T) {
	manifest, err := Parse([]byte(`{
		"version":1,
		"description":"test",
		"routes":[{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}]
	}`))
	if err != nil {
		t.Fatal(err)
	}

	snapshot := manifest.Snapshot()
	snapshot.Routes[0].ID = "changed"
	if manifest.Match("/").ID != "spa" {
		t.Fatal("Snapshot() exposed the manifest's internal route slice")
	}
}

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
		method string
		path   string
		id     string
		owner  Owner
	}{
		"health":                  {method: "GET", path: "/health", id: "system-health", owner: OwnerGo},
		"dashboard stats":         {method: "GET", path: "/admin/dashboard/stats", id: "admin-dashboard-stats-read", owner: OwnerGoBusinessAPI},
		"dashboard head":          {method: "HEAD", path: "/admin/dashboard/logs", id: "admin-dashboard-logs-read", owner: OwnerGoBusinessAPI},
		"dashboard log delete":    {method: "DELETE", path: "/admin/dashboard/logs/42", id: "admin-dashboard-log-delete", owner: OwnerGoBusinessAPI},
		"dashboard batch delete":  {method: "POST", path: "/admin/dashboard/logs/batch-delete", id: "admin-dashboard-log-batch-delete", owner: OwnerGoBusinessAPI},
		"dashboard catch-all":     {method: "POST", path: "/admin/dashboard/unknown", id: "admin-dashboard-other", owner: OwnerBusinessAPI},
		"API key admin":           {method: "POST", path: "/admin/api-keys", id: "admin-api-keys", owner: OwnerGoBusinessAPI},
		"admin catch-all":         {method: "GET", path: "/admin/unknown", id: "admin-other", owner: OwnerBusinessAPI},
		"external email allocate": {method: "GET", path: "/api/get-email", id: "ext-email-allocate-compat", owner: OwnerGoBusinessAPI},
		"domain mail":             {method: "POST", path: "/api/domain-mail/messages", id: "domain-email-list", owner: OwnerGoBusinessAPI},
		"domain regex fallback":   {method: "POST", path: "/api/domain-mail/messages/text", id: "domain-message-text", owner: OwnerBusinessAPI},
		"external catch-all":      {method: "GET", path: "/api/unknown", id: "external-api", owner: OwnerBusinessAPI},
		"mailbox portal":          {method: "GET", path: "/mail/api/session", id: "mailbox-portal", owner: OwnerBusinessAPI},
		"ingress":                 {method: "POST", path: "/ingress/domain-mail/receive", id: "ingress-domain-mail", owner: OwnerBusinessAPI},
		"spa":                     {method: "GET", path: "/settings/domains", id: "spa", owner: OwnerGo},
		"prefix boundary":         {method: "GET", path: "/administrator", id: "spa", owner: OwnerGo},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			route := manifest.Match(tc.method, tc.path)
			if route.ID != tc.id || route.Owner != tc.owner {
				t.Fatalf("Match(%q, %q) = %#v, want id=%q owner=%q", tc.method, tc.path, route, tc.id, tc.owner)
			}
		})
	}

	for _, route := range []Route{
		manifest.Match("GET", "/admin/dashboard/stats"),
		manifest.Match("DELETE", "/admin/dashboard/logs/42"),
		manifest.Match("POST", "/admin/dashboard/logs/batch-delete"),
	} {
		if route.MigrationStage != MigrationComplete || route.TargetOwner != "" || route.Owner != OwnerGoBusinessAPI {
			t.Fatalf("completed Dashboard migration metadata = %#v", route)
		}
	}
	if len(manifest.Digest()) != 64 {
		t.Fatalf("manifest digest = %q", manifest.Digest())
	}
}

func TestManifestRejectsUnsafeOrAmbiguousContracts(t *testing.T) {
	valid := `{
		"version":2,
		"description":"test",
		"routes":[
			{"id":"admin-read","owner":"go-business-api","match":"prefix","path":"/admin","methods":["GET"],"migrationStage":"complete"},
			{"id":"admin-write","owner":"business-api","match":"prefix","path":"/admin","methods":["POST"],"migrationStage":"pending","targetOwner":"go-business-api"},
			{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}
		]
	}`

	cases := map[string]string{
		"old version":            strings.Replace(valid, `"version":2`, `"version":1`, 1),
		"unknown field":          strings.Replace(valid, `"description":"test"`, `"description":"test","unexpected":true`, 1),
		"duplicate id":           strings.Replace(valid, `"id":"spa"`, `"id":"admin-read"`, 1),
		"overlapping method":     strings.Replace(valid, `"methods":["POST"]`, `"methods":["GET","POST"]`, 1),
		"all-method ambiguity":   strings.Replace(valid, `"methods":["POST"]`, ``, 1),
		"unsupported method":     strings.Replace(valid, `"methods":["GET"]`, `"methods":["BREW"]`, 1),
		"missing fallback":       `{"version":2,"description":"test","routes":[{"id":"admin","owner":"business-api","match":"prefix","path":"/admin","migrationStage":"pending","targetOwner":"go-business-api"}]}`,
		"unsafe completed owner": strings.Replace(valid, `"owner":"go-business-api","match":"prefix","path":"/admin","methods":["GET"],"migrationStage":"complete"`, `"owner":"business-api","match":"prefix","path":"/admin","methods":["GET"],"migrationStage":"complete"`, 1),
		"bad pending target":     strings.Replace(valid, `"targetOwner":"go-business-api"`, `"targetOwner":"business-api"`, 1),
		"bad fallback owner":     strings.Replace(valid, `"id":"spa","owner":"go"`, `"id":"spa","owner":"business-api"`, 1),
		"fallback methods":       strings.Replace(valid, `"id":"spa","owner":"go","match":"fallback"`, `"id":"spa","owner":"go","match":"fallback","methods":["GET"]`, 1),
		"multiple values":        valid + `{}`,
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(content)); err == nil {
				t.Fatalf("Parse() accepted invalid manifest: %s", content)
			}
		})
	}
}

func TestSnapshotReturnsIndependentRouteAndMethodSlices(t *testing.T) {
	manifest, err := Parse([]byte(`{
		"version":2,
		"description":"test",
		"routes":[
			{"id":"read","owner":"go-business-api","match":"exact","path":"/read","methods":["get","HEAD","GET"],"migrationStage":"complete"},
			{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}

	route := manifest.Match("GET", "/read")
	if strings.Join(route.Methods, ",") != "GET,HEAD" {
		t.Fatalf("normalized methods = %#v", route.Methods)
	}

	snapshot := manifest.Snapshot()
	snapshot.Routes[0].ID = "changed"
	snapshot.Routes[0].Methods[0] = "POST"
	if manifest.Match("GET", "/read").ID != "read" || manifest.Match("POST", "/read").ID != "spa" {
		t.Fatal("Snapshot() exposed the manifest's internal route or method slice")
	}
}

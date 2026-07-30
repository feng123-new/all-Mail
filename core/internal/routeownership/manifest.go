package routeownership

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
)

const (
	ManifestFileEnvironment = "ALL_MAIL_ROUTE_OWNERSHIP_FILE"
	DefaultManifestFile     = "/app/config/route-ownership.json"
)

type Owner string

const (
	OwnerGo            Owner = "go"
	OwnerGoBusinessAPI Owner = "go-business-api"
	OwnerBusinessAPI   Owner = "business-api"
)

type MatchKind string

const (
	MatchExact    MatchKind = "exact"
	MatchPrefix   MatchKind = "prefix"
	MatchFallback MatchKind = "fallback"
)

type MigrationStage string

const (
	MigrationComplete  MigrationStage = "complete"
	MigrationObserving MigrationStage = "observing"
	MigrationPending   MigrationStage = "pending"
)

type Route struct {
	ID             string         `json:"id"`
	Owner          Owner          `json:"owner"`
	Match          MatchKind      `json:"match"`
	Path           string         `json:"path"`
	Methods        []string       `json:"methods,omitempty"`
	MigrationStage MigrationStage `json:"migrationStage"`
	TargetOwner    Owner          `json:"targetOwner,omitempty"`
}

type Manifest struct {
	Version     int     `json:"version"`
	Description string  `json:"description"`
	Routes      []Route `json:"routes"`

	digest   string
	exact    map[string][]Route
	prefixes []Route
	fallback Route
}

type Snapshot struct {
	Version     int     `json:"version"`
	SHA256      string  `json:"sha256"`
	Description string  `json:"description"`
	Routes      []Route `json:"routes"`
}

var routeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

var supportedMethods = map[string]struct{}{
	"GET":     {},
	"HEAD":    {},
	"POST":    {},
	"PUT":     {},
	"PATCH":   {},
	"DELETE":  {},
	"OPTIONS": {},
}

func ResolveFile() string {
	if configured := strings.TrimSpace(os.Getenv(ManifestFileEnvironment)); configured != "" {
		return configured
	}
	for _, candidate := range []string{
		DefaultManifestFile,
		"config/route-ownership.json",
		"../config/route-ownership.json",
		"../../../config/route-ownership.json",
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return DefaultManifestFile
}

func LoadDefault() (*Manifest, error) {
	return LoadFile(ResolveFile())
}

func LoadFile(filePath string) (*Manifest, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read route ownership manifest %q: %w", filePath, err)
	}
	manifest, err := Parse(content)
	if err != nil {
		return nil, fmt.Errorf("parse route ownership manifest %q: %w", filePath, err)
	}
	return manifest, nil
}

func Parse(content []byte) (*Manifest, error) {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()

	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return nil, err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	if err := manifest.prepare(); err != nil {
		return nil, err
	}

	digest := sha256.Sum256(content)
	manifest.digest = hex.EncodeToString(digest[:])
	return &manifest, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err == nil {
		return errors.New("route ownership manifest contains multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func (m *Manifest) prepare() error {
	if m.Version != 2 {
		return fmt.Errorf("unsupported route ownership manifest version %d", m.Version)
	}
	if strings.TrimSpace(m.Description) == "" {
		return errors.New("route ownership manifest description is required")
	}
	if len(m.Routes) == 0 {
		return errors.New("route ownership manifest has no routes")
	}

	m.exact = make(map[string][]Route)
	m.prefixes = nil
	m.fallback = Route{}
	seenIDs := make(map[string]struct{}, len(m.Routes))
	matcherGroups := make(map[string][]Route)

	for index := range m.Routes {
		route := m.Routes[index]
		if err := normalizeRoute(&route); err != nil {
			return fmt.Errorf("route %d: %w", index, err)
		}
		m.Routes[index] = route

		if _, exists := seenIDs[route.ID]; exists {
			return fmt.Errorf("duplicate route id %q", route.ID)
		}
		seenIDs[route.ID] = struct{}{}

		matcherKey := string(route.Match) + "\x00" + route.Path
		for _, existing := range matcherGroups[matcherKey] {
			if methodsOverlap(existing.Methods, route.Methods) {
				return fmt.Errorf(
					"ambiguous %s matcher %q for routes %q and %q",
					route.Match,
					route.Path,
					existing.ID,
					route.ID,
				)
			}
		}
		matcherGroups[matcherKey] = append(matcherGroups[matcherKey], route)

		switch route.Match {
		case MatchExact:
			m.exact[route.Path] = append(m.exact[route.Path], route)
		case MatchPrefix:
			m.prefixes = append(m.prefixes, route)
		case MatchFallback:
			if m.fallback.ID != "" {
				return errors.New("route ownership manifest must contain exactly one fallback")
			}
			m.fallback = route
		}
	}

	if m.fallback.ID == "" {
		return errors.New("route ownership manifest has no fallback route")
	}
	if m.fallback.Owner != OwnerGo || m.fallback.Path != "/" || len(m.fallback.Methods) != 0 {
		return errors.New("fallback route must be an all-method Go-owned route at path /")
	}

	sort.Slice(m.prefixes, func(i, j int) bool {
		if len(m.prefixes[i].Path) == len(m.prefixes[j].Path) {
			if m.prefixes[i].Path == m.prefixes[j].Path {
				return m.prefixes[i].ID < m.prefixes[j].ID
			}
			return m.prefixes[i].Path < m.prefixes[j].Path
		}
		return len(m.prefixes[i].Path) > len(m.prefixes[j].Path)
	})
	return nil
}

func normalizeRoute(route *Route) error {
	if !routeIDPattern.MatchString(route.ID) {
		return fmt.Errorf("invalid route id %q", route.ID)
	}
	if route.Owner != OwnerGo && route.Owner != OwnerGoBusinessAPI && route.Owner != OwnerBusinessAPI {
		return fmt.Errorf("route %q has unsupported owner %q", route.ID, route.Owner)
	}
	if route.Match != MatchExact && route.Match != MatchPrefix && route.Match != MatchFallback {
		return fmt.Errorf("route %q has unsupported match kind %q", route.ID, route.Match)
	}
	if !strings.HasPrefix(route.Path, "/") {
		return fmt.Errorf("route %q path must start with /", route.ID)
	}
	if route.Path != "/" && strings.HasSuffix(route.Path, "/") {
		return fmt.Errorf("route %q path must not end with /", route.ID)
	}
	if strings.ContainsAny(route.Path, "?#") {
		return fmt.Errorf("route %q path must not contain a query or fragment", route.ID)
	}
	if route.Match == MatchFallback && route.Path != "/" {
		return fmt.Errorf("fallback route %q must use path /", route.ID)
	}
	if route.Match != MatchFallback && route.Path == "/" {
		return fmt.Errorf("non-fallback route %q cannot use path /", route.ID)
	}

	methods, err := normalizeMethods(route.Methods)
	if err != nil {
		return fmt.Errorf("route %q: %w", route.ID, err)
	}
	route.Methods = methods
	if route.Match == MatchFallback && len(route.Methods) != 0 {
		return fmt.Errorf("fallback route %q must not restrict methods", route.ID)
	}

	switch route.MigrationStage {
	case MigrationComplete:
		if route.Owner == OwnerBusinessAPI || route.TargetOwner != "" {
			return fmt.Errorf("completed route %q must be Go-owned without a target owner", route.ID)
		}
	case MigrationObserving, MigrationPending:
		if route.Owner != OwnerBusinessAPI {
			return fmt.Errorf("incomplete route %q must remain business-api owned", route.ID)
		}
		if route.TargetOwner != OwnerGo && route.TargetOwner != OwnerGoBusinessAPI {
			return fmt.Errorf("incomplete route %q must target a Go owner", route.ID)
		}
	default:
		return fmt.Errorf("route %q has unsupported migration stage %q", route.ID, route.MigrationStage)
	}
	return nil
}

func normalizeMethods(methods []string) ([]string, error) {
	if len(methods) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(methods))
	normalized := make([]string, 0, len(methods))
	for _, method := range methods {
		method = strings.ToUpper(strings.TrimSpace(method))
		if _, ok := supportedMethods[method]; !ok {
			return nil, fmt.Errorf("unsupported HTTP method %q", method)
		}
		if _, exists := seen[method]; exists {
			continue
		}
		seen[method] = struct{}{}
		normalized = append(normalized, method)
	}
	sort.Strings(normalized)
	return normalized, nil
}

func methodsOverlap(left, right []string) bool {
	if len(left) == 0 || len(right) == 0 {
		return true
	}
	set := make(map[string]struct{}, len(left))
	for _, method := range left {
		set[method] = struct{}{}
	}
	for _, method := range right {
		if _, ok := set[method]; ok {
			return true
		}
	}
	return false
}

func routeAllowsMethod(route Route, method string) bool {
	if len(route.Methods) == 0 {
		return true
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	for _, candidate := range route.Methods {
		if candidate == method {
			return true
		}
	}
	return false
}

func (m *Manifest) Match(method, requestPath string) Route {
	if requestPath == "" {
		requestPath = "/"
	}
	for _, route := range m.exact[requestPath] {
		if routeAllowsMethod(route, method) {
			return route
		}
	}
	for _, route := range m.prefixes {
		if !routeAllowsMethod(route, method) {
			continue
		}
		if requestPath == route.Path || strings.HasPrefix(requestPath, route.Path+"/") {
			return route
		}
	}
	return m.fallback
}

func (m *Manifest) Digest() string {
	return m.digest
}

func (m *Manifest) Snapshot() Snapshot {
	routes := make([]Route, len(m.Routes))
	for index, route := range m.Routes {
		route.Methods = append([]string(nil), route.Methods...)
		routes[index] = route
	}
	return Snapshot{
		Version:     m.Version,
		SHA256:      m.digest,
		Description: m.Description,
		Routes:      routes,
	}
}

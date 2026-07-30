package httpapi

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/routeownership"
)

var routeDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

var boundedHTTPMethods = map[string]struct{}{
	"GET":     {},
	"HEAD":    {},
	"POST":    {},
	"PUT":     {},
	"PATCH":   {},
	"DELETE":  {},
	"OPTIONS": {},
}

type routeMetricKey struct {
	Owner  routeownership.Owner
	Family string
}

type requestMetricKey struct {
	routeMetricKey
	Method      string
	StatusClass string
}

type proxyMetricKey struct {
	Upstream routeownership.Owner
	Family   string
}

type durationMetric struct {
	Count   uint64
	Sum     float64
	Buckets []uint64
}

type routeMetrics struct {
	mu          sync.Mutex
	manifest    routeownership.Snapshot
	inflight    map[routeMetricKey]int64
	requests    map[requestMetricKey]uint64
	durations   map[routeMetricKey]*durationMetric
	proxyErrors map[proxyMetricKey]uint64
}

func newRouteMetrics(manifest *routeownership.Manifest) *routeMetrics {
	return &routeMetrics{
		manifest:    manifest.Snapshot(),
		inflight:    make(map[routeMetricKey]int64),
		requests:    make(map[requestMetricKey]uint64),
		durations:   make(map[routeMetricKey]*durationMetric),
		proxyErrors: make(map[proxyMetricKey]uint64),
	}
}

func (m *routeMetrics) begin(route routeownership.Route) {
	key := routeMetricKey{Owner: route.Owner, Family: route.ID}
	m.mu.Lock()
	m.inflight[key]++
	m.mu.Unlock()
}

func (m *routeMetrics) observe(route routeownership.Route, method string, status int, elapsed time.Duration) {
	if status == 0 {
		status = 200
	}
	key := routeMetricKey{Owner: route.Owner, Family: route.ID}
	requestKey := requestMetricKey{
		routeMetricKey: key,
		Method:         normalizeMetricMethod(method),
		StatusClass:    statusClass(status),
	}
	seconds := elapsed.Seconds()

	m.mu.Lock()
	if m.inflight[key] > 0 {
		m.inflight[key]--
	}
	m.requests[requestKey]++
	metric := m.durations[key]
	if metric == nil {
		metric = &durationMetric{Buckets: make([]uint64, len(routeDurationBuckets))}
		m.durations[key] = metric
	}
	metric.Count++
	metric.Sum += seconds
	for index, upperBound := range routeDurationBuckets {
		if seconds <= upperBound {
			metric.Buckets[index]++
		}
	}
	m.mu.Unlock()
}

func (m *routeMetrics) proxyError(route routeownership.Route) {
	key := proxyMetricKey{Upstream: route.Owner, Family: route.ID}
	m.mu.Lock()
	m.proxyErrors[key]++
	m.mu.Unlock()
}

func (m *routeMetrics) writePrometheus(writer io.Writer) {
	m.mu.Lock()
	inflight := cloneInflight(m.inflight)
	requests := cloneRequests(m.requests)
	durations := cloneDurations(m.durations)
	proxyErrors := cloneProxyErrors(m.proxyErrors)
	manifest := m.manifest
	m.mu.Unlock()

	fmt.Fprintln(writer, "# HELP allmail_route_manifest_info Active route ownership manifest.")
	fmt.Fprintln(writer, "# TYPE allmail_route_manifest_info gauge")
	fmt.Fprintf(
		writer,
		"allmail_route_manifest_info{version=%s,sha256=%s} 1\n",
		metricLabel(strconv.Itoa(manifest.Version)),
		metricLabel(manifest.SHA256),
	)

	fmt.Fprintln(writer, "# HELP allmail_route_owner_info Declared owner and migration state for a bounded route family.")
	fmt.Fprintln(writer, "# TYPE allmail_route_owner_info gauge")
	routes := append([]routeownership.Route(nil), manifest.Routes...)
	sort.Slice(routes, func(i, j int) bool { return routes[i].ID < routes[j].ID })
	for _, route := range routes {
		fmt.Fprintf(
			writer,
			"allmail_route_owner_info{family=%s,owner=%s,match=%s,path=%s,methods=%s,migration_stage=%s,target_owner=%s} 1\n",
			metricLabel(route.ID),
			metricLabel(string(route.Owner)),
			metricLabel(string(route.Match)),
			metricLabel(route.Path),
			metricLabel(strings.Join(route.Methods, ",")),
			metricLabel(string(route.MigrationStage)),
			metricLabel(string(route.TargetOwner)),
		)
	}

	fmt.Fprintln(writer, "# HELP allmail_route_inflight_requests Requests currently executing by route family and owner.")
	fmt.Fprintln(writer, "# TYPE allmail_route_inflight_requests gauge")
	for _, route := range routes {
		key := routeMetricKey{Owner: route.Owner, Family: route.ID}
		fmt.Fprintf(
			writer,
			"allmail_route_inflight_requests{family=%s,owner=%s} %d\n",
			metricLabel(route.ID),
			metricLabel(string(route.Owner)),
			inflight[key],
		)
	}

	fmt.Fprintln(writer, "# HELP allmail_route_requests_total Completed requests by bounded route family, owner, method, and status class.")
	fmt.Fprintln(writer, "# TYPE allmail_route_requests_total counter")
	requestKeys := make([]requestMetricKey, 0, len(requests))
	for key := range requests {
		requestKeys = append(requestKeys, key)
	}
	sort.Slice(requestKeys, func(i, j int) bool {
		left, right := requestKeys[i], requestKeys[j]
		if left.Family != right.Family {
			return left.Family < right.Family
		}
		if left.Owner != right.Owner {
			return left.Owner < right.Owner
		}
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		return left.StatusClass < right.StatusClass
	})
	for _, key := range requestKeys {
		fmt.Fprintf(
			writer,
			"allmail_route_requests_total{family=%s,owner=%s,method=%s,status_class=%s} %d\n",
			metricLabel(key.Family),
			metricLabel(string(key.Owner)),
			metricLabel(key.Method),
			metricLabel(key.StatusClass),
			requests[key],
		)
	}

	fmt.Fprintln(writer, "# HELP allmail_route_request_duration_seconds Request duration by bounded route family and owner.")
	fmt.Fprintln(writer, "# TYPE allmail_route_request_duration_seconds histogram")
	durationKeys := make([]routeMetricKey, 0, len(durations))
	for key := range durations {
		durationKeys = append(durationKeys, key)
	}
	sort.Slice(durationKeys, func(i, j int) bool {
		if durationKeys[i].Family != durationKeys[j].Family {
			return durationKeys[i].Family < durationKeys[j].Family
		}
		return durationKeys[i].Owner < durationKeys[j].Owner
	})
	for _, key := range durationKeys {
		metric := durations[key]
		for index, upperBound := range routeDurationBuckets {
			fmt.Fprintf(
				writer,
				"allmail_route_request_duration_seconds_bucket{family=%s,owner=%s,le=%s} %d\n",
				metricLabel(key.Family),
				metricLabel(string(key.Owner)),
				metricLabel(strconv.FormatFloat(upperBound, 'g', -1, 64)),
				metric.Buckets[index],
			)
		}
		fmt.Fprintf(
			writer,
			"allmail_route_request_duration_seconds_bucket{family=%s,owner=%s,le=\"+Inf\"} %d\n",
			metricLabel(key.Family),
			metricLabel(string(key.Owner)),
			metric.Count,
		)
		fmt.Fprintf(
			writer,
			"allmail_route_request_duration_seconds_sum{family=%s,owner=%s} %g\n",
			metricLabel(key.Family),
			metricLabel(string(key.Owner)),
			metric.Sum,
		)
		fmt.Fprintf(
			writer,
			"allmail_route_request_duration_seconds_count{family=%s,owner=%s} %d\n",
			metricLabel(key.Family),
			metricLabel(string(key.Owner)),
			metric.Count,
		)
	}

	fmt.Fprintln(writer, "# HELP allmail_business_proxy_errors_total Gateway proxy failures by route family and private upstream.")
	fmt.Fprintln(writer, "# TYPE allmail_business_proxy_errors_total counter")
	proxyKeys := make([]proxyMetricKey, 0, len(proxyErrors))
	for key := range proxyErrors {
		proxyKeys = append(proxyKeys, key)
	}
	sort.Slice(proxyKeys, func(i, j int) bool {
		if proxyKeys[i].Family != proxyKeys[j].Family {
			return proxyKeys[i].Family < proxyKeys[j].Family
		}
		return proxyKeys[i].Upstream < proxyKeys[j].Upstream
	})
	for _, key := range proxyKeys {
		fmt.Fprintf(
			writer,
			"allmail_business_proxy_errors_total{family=%s,upstream=%s} %d\n",
			metricLabel(key.Family),
			metricLabel(string(key.Upstream)),
			proxyErrors[key],
		)
	}
}

func normalizeMetricMethod(method string) string {
	method = strings.ToUpper(strings.TrimSpace(method))
	if _, ok := boundedHTTPMethods[method]; ok {
		return method
	}
	return "OTHER"
}

func statusClass(status int) string {
	if status >= 100 && status <= 599 {
		return fmt.Sprintf("%dxx", status/100)
	}
	return "other"
}

func metricLabel(value string) string {
	return strconv.Quote(value)
}

func cloneInflight(source map[routeMetricKey]int64) map[routeMetricKey]int64 {
	result := make(map[routeMetricKey]int64, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneRequests(source map[requestMetricKey]uint64) map[requestMetricKey]uint64 {
	result := make(map[requestMetricKey]uint64, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneDurations(source map[routeMetricKey]*durationMetric) map[routeMetricKey]*durationMetric {
	result := make(map[routeMetricKey]*durationMetric, len(source))
	for key, value := range source {
		copyMetric := &durationMetric{
			Count:   value.Count,
			Sum:     value.Sum,
			Buckets: append([]uint64(nil), value.Buckets...),
		}
		result[key] = copyMetric
	}
	return result
}

func cloneProxyErrors(source map[proxyMetricKey]uint64) map[proxyMetricKey]uint64 {
	result := make(map[proxyMetricKey]uint64, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

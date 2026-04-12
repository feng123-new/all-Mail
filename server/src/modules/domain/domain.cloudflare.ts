import { decrypt, encrypt } from "../../lib/crypto.js";
import { proxyFetch } from "../../lib/proxy.js";
import { AppError } from "../../plugins/error.js";

type ValidationState = "pass" | "warn" | "fail" | "info";

export interface DomainCloudflareValidationCheck {
	key: string;
	label: string;
	status: ValidationState;
	message: string;
	details?: string[];
}

export interface DomainCloudflareValidationResult {
	status: Exclude<ValidationState, "info">;
	zoneId: string | null;
	zoneName: string | null;
	zoneStatus: string | null;
	emailRoutingStatus: string | null;
	lastValidatedAt: string;
	checks: DomainCloudflareValidationCheck[];
	manualActions: string[];
}

export interface DomainCloudflareValidationView {
	hasSavedToken: boolean;
	tokenHint: string | null;
	zoneId: string | null;
	lastValidation: DomainCloudflareValidationResult | null;
	lastValidatedAt: string | null;
}

export interface DomainCloudflareConfigInput {
	apiToken?: string | null;
	zoneId?: string | null;
	clearSavedToken?: boolean;
}

export interface DomainDnsStatusRecord {
	provider?: string | null;
	expectedMxConfigured?: boolean;
	expectedIngressConfigured?: boolean;
	cloudflare?: {
		apiTokenEncrypted?: string | null;
		tokenHint?: string | null;
		zoneId?: string | null;
		lastValidation?: DomainCloudflareValidationResult | null;
		lastValidatedAt?: string | null;
	} | null;
}

interface CloudflareApiEnvelope<T> {
	success: boolean;
	result: T;
	errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareZone {
	id: string;
	name: string;
	status?: string;
	name_servers?: string[];
}

interface CloudflareDnsRecord {
	id?: string;
	type?: string;
	name?: string;
	content?: string;
	priority?: number;
}

interface CloudflareEmailRoutingSettings {
	enabled?: boolean;
	status?: string;
	name?: string;
}

interface CloudflareEmailRoutingDnsResult {
	errors?: Array<{
		code?: string;
		missing?: CloudflareDnsRecord;
	}>;
	record?: CloudflareDnsRecord[];
}

interface CloudflareRoutingRule {
	id?: string;
	name?: string;
	enabled?: boolean;
	actions?: Array<{
		type?: string;
		value?: string[];
	}>;
	matchers?: Array<{
		type?: string;
		field?: string;
		value?: string;
	}>;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_WORKER_NAME = "allmail-edge";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
	return Array.from(
		new Set(values.filter((value): value is string => Boolean(value))),
	);
}

export function parseDomainDnsStatus(value: unknown): DomainDnsStatusRecord {
	if (!isRecord(value)) {
		return {};
	}

	const cloudflare = isRecord(value.cloudflare)
		? {
				apiTokenEncrypted: normalizeOptionalString(
					value.cloudflare.apiTokenEncrypted,
				),
				tokenHint: normalizeOptionalString(value.cloudflare.tokenHint),
				zoneId: normalizeOptionalString(value.cloudflare.zoneId),
				lastValidation: isRecord(value.cloudflare.lastValidation)
					? (value.cloudflare.lastValidation as unknown as DomainCloudflareValidationResult)
					: null,
				lastValidatedAt: normalizeOptionalString(
					value.cloudflare.lastValidatedAt,
				),
			}
		: null;

	return {
		provider: normalizeOptionalString(value.provider),
		expectedMxConfigured:
			typeof value.expectedMxConfigured === "boolean"
				? value.expectedMxConfigured
				: undefined,
		expectedIngressConfigured:
			typeof value.expectedIngressConfigured === "boolean"
				? value.expectedIngressConfigured
				: undefined,
		cloudflare,
	};
}

export function buildCloudflareTokenHint(apiToken: string): string {
	const trimmed = apiToken.trim();
	const suffix = trimmed.slice(-4);
	return suffix ? `Saved token ending in ${suffix}` : "Saved Cloudflare token";
}

export function getCloudflareValidationView(
	value: unknown,
): DomainCloudflareValidationView {
	const parsed = parseDomainDnsStatus(value);
	return {
		hasSavedToken: Boolean(parsed.cloudflare?.apiTokenEncrypted),
		tokenHint: parsed.cloudflare?.tokenHint || null,
		zoneId: parsed.cloudflare?.zoneId || null,
		lastValidation: parsed.cloudflare?.lastValidation || null,
		lastValidatedAt: parsed.cloudflare?.lastValidatedAt || null,
	};
}

export function toSafeDomainDnsStatus(
	value: unknown,
): Record<string, unknown> | null {
	const parsed = parseDomainDnsStatus(value);
	const safeCloudflare = parsed.cloudflare
		? {
				tokenHint: parsed.cloudflare.tokenHint || null,
				zoneId: parsed.cloudflare.zoneId || null,
				lastValidatedAt: parsed.cloudflare.lastValidatedAt || null,
			}
		: null;

	if (
		parsed.provider === null &&
		parsed.expectedMxConfigured === undefined &&
		parsed.expectedIngressConfigured === undefined &&
		!safeCloudflare
	) {
		return null;
	}

	return {
		provider: parsed.provider || null,
		expectedMxConfigured:
			parsed.expectedMxConfigured === undefined
				? false
				: parsed.expectedMxConfigured,
		expectedIngressConfigured:
			parsed.expectedIngressConfigured === undefined
				? false
				: parsed.expectedIngressConfigured,
		...(safeCloudflare ? { cloudflare: safeCloudflare } : {}),
	};
}

export function saveCloudflareConfigToDnsStatus(
	value: unknown,
	input: DomainCloudflareConfigInput,
): DomainDnsStatusRecord {
	const parsed = parseDomainDnsStatus(value);
	const currentCloudflare = parsed.cloudflare || {};
	const shouldClearSavedToken = Boolean(input.clearSavedToken);
	const nextToken = normalizeOptionalString(input.apiToken);
	const nextZoneId =
		input.zoneId === undefined
			? currentCloudflare.zoneId || null
			: normalizeOptionalString(input.zoneId);

	return {
		provider: parsed.provider || "CLOUDFLARE",
		expectedMxConfigured: parsed.expectedMxConfigured,
		expectedIngressConfigured: parsed.expectedIngressConfigured,
		cloudflare: {
			apiTokenEncrypted: shouldClearSavedToken
				? null
				: nextToken
					? encrypt(nextToken)
					: currentCloudflare.apiTokenEncrypted || null,
			tokenHint: shouldClearSavedToken
				? null
				: nextToken
					? buildCloudflareTokenHint(nextToken)
					: currentCloudflare.tokenHint || null,
			zoneId: nextZoneId,
			lastValidation: shouldClearSavedToken
				? null
				: currentCloudflare.lastValidation || null,
			lastValidatedAt: shouldClearSavedToken
				? null
				: currentCloudflare.lastValidatedAt || null,
		},
	};
}

export function getSavedCloudflareToken(value: unknown): string | null {
	const encrypted = parseDomainDnsStatus(value).cloudflare?.apiTokenEncrypted;
	if (!encrypted) {
		return null;
	}
	return decrypt(encrypted);
}

export function resolveZoneCandidates(domainName: string): string[] {
	const normalized = domainName.trim().toLowerCase();
	const segments = normalized.split(".").filter(Boolean);
	if (segments.length < 2) {
		return normalized ? [normalized] : [];
	}

	const candidates: string[] = [];
	for (let index = 0; index <= segments.length - 2; index += 1) {
		candidates.push(segments.slice(index).join("."));
	}
	return dedupeStrings(candidates);
}

function buildOverallStatus(
	checks: DomainCloudflareValidationCheck[],
): DomainCloudflareValidationResult["status"] {
	if (checks.some((check) => check.status === "fail")) {
		return "fail";
	}
	if (checks.some((check) => check.status === "warn")) {
		return "warn";
	}
	return "pass";
}

async function fetchCloudflare<T>(
	path: string,
	apiToken: string,
	query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
	const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);
	for (const [key, value] of Object.entries(query || {})) {
		if (value !== undefined) {
			url.searchParams.set(key, String(value));
		}
	}

	const response = await proxyFetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			"Content-Type": "application/json",
		},
	});
	const payload = (await response.json()) as CloudflareApiEnvelope<T>;
	if (response.status === 401 || response.status === 403) {
		throw new AppError(
			"CLOUDFLARE_AUTH_FAILED",
			payload.errors?.[0]?.message ||
				"Cloudflare token is invalid or lacks required permissions",
			400,
		);
	}
	if (!response.ok || !payload.success) {
		throw new AppError(
			"CLOUDFLARE_API_REQUEST_FAILED",
			payload.errors?.[0]?.message ||
				`Cloudflare API request failed with status ${response.status}`,
			502,
		);
	}
	return payload.result;
}

async function resolveZone(
	apiToken: string,
	domainName: string,
	zoneIdOverride?: string | null,
): Promise<CloudflareZone> {
	if (zoneIdOverride) {
		return fetchCloudflare<CloudflareZone>(
			`/zones/${zoneIdOverride}`,
			apiToken,
		);
	}

	for (const candidate of resolveZoneCandidates(domainName)) {
		const zones = await fetchCloudflare<CloudflareZone[]>(`/zones`, apiToken, {
			name: candidate,
			per_page: 1,
		});
		const exact = zones.find((zone) => zone.name.toLowerCase() === candidate);
		if (exact) {
			return exact;
		}
	}

	throw new AppError(
		"CLOUDFLARE_ZONE_NOT_FOUND",
		`No Cloudflare zone matching ${domainName} was found for the saved token`,
		404,
	);
}

function hasTxtRecord(
	records: CloudflareDnsRecord[],
	predicate: (record: CloudflareDnsRecord) => boolean,
): boolean {
	return records.some((record) => record.type === "TXT" && predicate(record));
}

function buildWorkerRuleSummary(rules: CloudflareRoutingRule[]) {
	const workerRules = rules.filter((rule) =>
		rule.actions?.some((action) => action.type === "worker"),
	);
	const hasWorkerRule = workerRules.length > 0;
	const hasExpectedWorker = workerRules.some((rule) =>
		rule.actions?.some(
			(action) =>
				action.type === "worker" &&
				action.value?.some((value) => value.includes(DEFAULT_WORKER_NAME)),
		),
	);
	const hasCatchAllWorker = workerRules.some((rule) =>
		rule.matchers?.some((matcher) => matcher.type === "all"),
	);

	return {
		hasWorkerRule,
		hasExpectedWorker,
		hasCatchAllWorker,
		workerRuleNames: workerRules.map(
			(rule) => rule.name || rule.id || "unnamed-rule",
		),
	};
}

export async function validateCloudflareDomain(options: {
	domainName: string;
	canReceive: boolean;
	isCatchAllEnabled: boolean;
	apiToken: string;
	zoneId?: string | null;
}): Promise<DomainCloudflareValidationResult> {
	const zone = await resolveZone(
		options.apiToken,
		options.domainName,
		options.zoneId,
	);
	const [emailRouting, emailRoutingDns, mxRecords, txtRecords, rules] =
		await Promise.all([
			fetchCloudflare<CloudflareEmailRoutingSettings>(
				`/zones/${zone.id}/email/routing`,
				options.apiToken,
			),
			fetchCloudflare<CloudflareEmailRoutingDnsResult>(
				`/zones/${zone.id}/email/routing/dns`,
				options.apiToken,
			),
			fetchCloudflare<CloudflareDnsRecord[]>(
				`/zones/${zone.id}/dns_records`,
				options.apiToken,
				{
					type: "MX",
					per_page: 100,
				},
			),
			fetchCloudflare<CloudflareDnsRecord[]>(
				`/zones/${zone.id}/dns_records`,
				options.apiToken,
				{
					type: "TXT",
					per_page: 200,
				},
			),
			fetchCloudflare<CloudflareRoutingRule[]>(
				`/zones/${zone.id}/email/routing/rules`,
				options.apiToken,
				{
					enabled: true,
					per_page: 100,
				},
			),
		]);

	const missingRecords = emailRoutingDns.errors || [];
	const missingMx = missingRecords.some(
		(entry) => entry.missing?.type === "MX",
	);
	const missingSpf = missingRecords.some(
		(entry) =>
			entry.missing?.type === "TXT" &&
			String(entry.missing?.content || "")
				.toLowerCase()
				.includes("spf"),
	);
	const zoneName = zone.name.toLowerCase();
	const hasSpf = hasTxtRecord(
		txtRecords,
		(record) =>
			(record.name || "").toLowerCase() === zoneName &&
			String(record.content || "")
				.toLowerCase()
				.includes("v=spf1"),
	);
	const hasDmarc = hasTxtRecord(
		txtRecords,
		(record) =>
			(record.name || "").toLowerCase() === `_dmarc.${zoneName}` &&
			String(record.content || "")
				.toLowerCase()
				.includes("v=dmarc1"),
	);
	const hasDkim = hasTxtRecord(
		txtRecords,
		(record) =>
			(record.name || "").toLowerCase().includes("._domainkey.") &&
			(record.name || "").toLowerCase().endsWith(`.${zoneName}`),
	);
	const workerSummary = buildWorkerRuleSummary(rules);
	const checks: DomainCloudflareValidationCheck[] = [
		{
			key: "zone-status",
			label: "Zone status",
			status: zone.status === "active" ? "pass" : "fail",
			message:
				zone.status === "active"
					? "Cloudflare zone is active and nameserver delegation has completed."
					: `Cloudflare zone is ${zone.status || "unknown"}. Nameserver delegation still needs attention.`,
			details:
				Array.isArray(zone.name_servers) && zone.name_servers.length > 0
					? zone.name_servers
					: undefined,
		},
		{
			key: "email-routing",
			label: "Email Routing",
			status:
				emailRouting.enabled && emailRouting.status === "ready"
					? "pass"
					: options.canReceive
						? "fail"
						: "warn",
			message:
				emailRouting.enabled && emailRouting.status === "ready"
					? "Email Routing is enabled and ready."
					: `Email Routing is ${emailRouting.status || "not ready"} for this zone.`,
		},
		{
			key: "mx-records",
			label: "MX records",
			status:
				!missingMx && mxRecords.length > 0
					? "pass"
					: options.canReceive
						? "fail"
						: "warn",
			message:
				!missingMx && mxRecords.length > 0
					? "Required inbound MX records are present."
					: "Cloudflare still reports missing inbound MX records.",
			details: mxRecords.map(
				(record) => `${record.name || "@"} → ${record.content || ""}`,
			),
		},
		{
			key: "spf-record",
			label: "SPF record",
			status:
				!missingSpf && hasSpf ? "pass" : options.canReceive ? "fail" : "warn",
			message:
				!missingSpf && hasSpf
					? "Inbound SPF TXT record is present."
					: "Cloudflare still reports a missing SPF TXT record.",
		},
		{
			key: "worker-binding",
			label: "Worker binding",
			status: workerSummary.hasExpectedWorker
				? "pass"
				: workerSummary.hasWorkerRule
					? "warn"
					: "fail",
			message: workerSummary.hasExpectedWorker
				? `Email Routing rules are bound to worker ${DEFAULT_WORKER_NAME}.`
				: workerSummary.hasWorkerRule
					? "Email Routing rules use a worker, but not the expected all-Mail worker name."
					: "No Email Routing rule is currently bound to a worker.",
			details: workerSummary.workerRuleNames,
		},
		{
			key: "catch-all",
			label: "Catch-all route",
			status: options.isCatchAllEnabled
				? workerSummary.hasCatchAllWorker
					? "pass"
					: "fail"
				: workerSummary.hasCatchAllWorker
					? "info"
					: "pass",
			message: options.isCatchAllEnabled
				? workerSummary.hasCatchAllWorker
					? "Catch-all is enabled locally and a Cloudflare catch-all worker rule exists."
					: "Catch-all is enabled locally, but Cloudflare does not show an all-address worker rule."
				: workerSummary.hasCatchAllWorker
					? "Cloudflare has a catch-all worker rule even though the local domain catch-all toggle is off."
					: "Catch-all is not required for this domain.",
		},
		{
			key: "dmarc",
			label: "DMARC record",
			status: hasDmarc ? "pass" : "warn",
			message: hasDmarc
				? "A DMARC TXT record is present."
				: "No DMARC TXT record was found. This is recommended for sender reputation, but not required for inbound routing.",
		},
		{
			key: "dkim",
			label: "DKIM record",
			status: hasDkim ? "pass" : "warn",
			message: hasDkim
				? "At least one DKIM TXT record is present."
				: "No DKIM TXT record was found. For outbound mail, DKIM usually comes from your sending provider rather than Cloudflare Email Routing.",
		},
	];

	const manualActions = dedupeStrings([
		zone.status === "active"
			? null
			: "Update the registrar nameservers to the Cloudflare nameservers shown for this zone, then wait for the zone status to become active.",
		emailRouting.enabled && emailRouting.status === "ready"
			? null
			: "Open Cloudflare Dashboard → Email Routing and complete or repair Email Routing until the status becomes ready.",
		workerSummary.hasExpectedWorker
			? null
			: `Bind a custom address or catch-all rule to worker ${DEFAULT_WORKER_NAME} in Cloudflare Email Routing.`,
		options.isCatchAllEnabled && !workerSummary.hasCatchAllWorker
			? "Because this domain enables catch-all locally, create a matching catch-all Email Routing worker rule in Cloudflare."
			: null,
		!hasDmarc
			? "Add a DMARC TXT record if you want stronger email policy visibility and better sender reputation hygiene."
			: null,
	]);

	return {
		status: buildOverallStatus(checks),
		zoneId: zone.id,
		zoneName: zone.name,
		zoneStatus: zone.status || null,
		emailRoutingStatus: emailRouting.status || null,
		lastValidatedAt: new Date().toISOString(),
		checks,
		manualActions,
	};
}

export function mergeCloudflareValidationIntoDnsStatus(
	value: unknown,
	validation: DomainCloudflareValidationResult,
): DomainDnsStatusRecord {
	const parsed = parseDomainDnsStatus(value);
	return {
		provider: parsed.provider || "CLOUDFLARE",
		expectedMxConfigured: validation.checks.some(
			(check) => check.key === "mx-records" && check.status === "pass",
		),
		expectedIngressConfigured: validation.checks.some(
			(check) => check.key === "worker-binding" && check.status === "pass",
		),
		cloudflare: {
			apiTokenEncrypted: parsed.cloudflare?.apiTokenEncrypted || null,
			tokenHint: parsed.cloudflare?.tokenHint || null,
			zoneId: validation.zoneId || parsed.cloudflare?.zoneId || null,
			lastValidation: validation,
			lastValidatedAt: validation.lastValidatedAt,
		},
	};
}

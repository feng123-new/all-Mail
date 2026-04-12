import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
	"postgresql://tester:tester@127.0.0.1:15433/all_mail_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6380/0";
process.env.JWT_SECRET ??= "test-jwt-secret-1234567890abcdef";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-1234567890ab";
process.env.ADMIN_PASSWORD ??= "test-admin-password";

const require = createRequire(import.meta.url);

void test("resolveZoneCandidates falls back from subdomain to parent zone", () => {
	const { resolveZoneCandidates } = requireHelpers();
	assert.deepEqual(resolveZoneCandidates("mail.ops.example.com"), [
		"mail.ops.example.com",
		"ops.example.com",
		"example.com",
	]);
});

void test("saveCloudflareConfigToDnsStatus encrypts tokens and preserves metadata", () => {
	const { buildCloudflareTokenHint, saveCloudflareConfigToDnsStatus } =
		requireHelpers();
	const result = saveCloudflareConfigToDnsStatus(null, {
		apiToken: "cloudflare-token-1234567890",
		zoneId: "zone_12345678",
	});

	assert.equal(result.cloudflare?.zoneId, "zone_12345678");
	assert.equal(
		result.cloudflare?.tokenHint,
		buildCloudflareTokenHint("cloudflare-token-1234567890"),
	);
	assert.ok(result.cloudflare?.apiTokenEncrypted);
	assert.equal(result.provider, "CLOUDFLARE");
});

void test("safe dns status and validation view hide encrypted token material", () => {
	const {
		getCloudflareValidationView,
		mergeCloudflareValidationIntoDnsStatus,
		saveCloudflareConfigToDnsStatus,
		toSafeDomainDnsStatus,
	} = requireHelpers();
	const dnsStatus = saveCloudflareConfigToDnsStatus(null, {
		apiToken: "cloudflare-token-1234567890",
		zoneId: "zone_12345678",
	});
	const merged = mergeCloudflareValidationIntoDnsStatus(dnsStatus, {
		status: "warn",
		zoneId: "zone_12345678",
		zoneName: "example.com",
		zoneStatus: "pending",
		emailRoutingStatus: "misconfigured",
		lastValidatedAt: "2026-04-12T00:00:00.000Z",
		checks: [],
		manualActions: ["Complete nameserver delegation"],
	});

	const safe = toSafeDomainDnsStatus(merged) as {
		cloudflare?: { apiTokenEncrypted?: string; zoneId?: string };
	};
	assert.equal(safe.cloudflare?.apiTokenEncrypted, undefined);
	assert.equal(safe.cloudflare?.zoneId, "zone_12345678");

	const view = getCloudflareValidationView(merged);
	assert.equal(view.hasSavedToken, true);
	assert.equal(view.zoneId, "zone_12345678");
	assert.equal(view.lastValidation?.zoneName, "example.com");
	assert.equal(
		view.lastValidation?.manualActions[0],
		"Complete nameserver delegation",
	);
	assert.equal(
		(view as unknown as { apiTokenEncrypted?: string }).apiTokenEncrypted,
		undefined,
	);
});

function requireHelpers() {
	return require("./domain.cloudflare.js");
}

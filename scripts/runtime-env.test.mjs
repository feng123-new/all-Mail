import assert from "node:assert/strict";
import test from "node:test";
import {
	sanitizeNodeRuntimeEnv,
	stripUseEnvProxyFromNodeOptions,
} from "./runtime-env.mjs";

test("stripUseEnvProxyFromNodeOptions removes use-env-proxy flags and preserves others", () => {
	assert.equal(
		stripUseEnvProxyFromNodeOptions(
			"--max-old-space-size=2048 --use-env-proxy --trace-warnings",
		),
		"--max-old-space-size=2048 --trace-warnings",
	);
	assert.equal(
		stripUseEnvProxyFromNodeOptions("--use-env-proxy=true --inspect"),
		"--inspect",
	);
});

test("sanitizeNodeRuntimeEnv drops NODE_USE_ENV_PROXY and empties NODE_OPTIONS when only proxy flag remains", () => {
	const result = sanitizeNodeRuntimeEnv({
		HTTP_PROXY: "http://127.0.0.1:10808",
		NODE_USE_ENV_PROXY: "1",
		NODE_OPTIONS: "--use-env-proxy",
	});

	assert.equal(result.HTTP_PROXY, "http://127.0.0.1:10808");
	assert.equal("NODE_USE_ENV_PROXY" in result, false);
	assert.equal("NODE_OPTIONS" in result, false);
});

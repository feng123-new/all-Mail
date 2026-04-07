import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const JOBS_HEARTBEAT_FILE_NAME = "jobs-heartbeat.txt";

export function resolveJobsStateDir() {
	const configuredStateDir = process.env.ALL_MAIL_STATE_DIR?.trim();
	if (configuredStateDir) {
		return path.resolve(configuredStateDir);
	}

	return path.resolve(process.cwd(), "..", ".all-mail-runtime");
}

export function resolveJobsHeartbeatFilePath() {
	return path.join(resolveJobsStateDir(), JOBS_HEARTBEAT_FILE_NAME);
}

export async function markJobsHealthy(now: Date = new Date()) {
	const stateDir = resolveJobsStateDir();
	await mkdir(stateDir, { recursive: true });
	await writeFile(
		path.join(stateDir, JOBS_HEARTBEAT_FILE_NAME),
		now.toISOString(),
		"utf8",
	);
}

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";
import { decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import prisma from "../lib/prisma.js";
import { sendWithResend } from "../modules/send/providers/resend.js";
import { formatResendFromAddress } from "../modules/send/send.service.js";
import { AppError } from "../plugins/error.js";
import { markJobsHealthy } from "../runtime/jobsHealth.js";

const emailSchema = z.string().trim().email();

export const FORWARDING_MAX_ATTEMPTS = 3;
const FORWARDING_INITIAL_BACKOFF_MS = 30_000;
const FORWARDING_MAX_BACKOFF_MS = 5 * 60_000;
const FORWARDING_RUNNING_STALE_MS = 10 * 60_000;

export interface ForwardingWorkerDeps {
	prisma: typeof prisma;
	logger: typeof logger;
	decrypt: typeof decrypt;
	sendWithResend: typeof sendWithResend;
	markHealthy: (now?: Date) => Promise<void> | void;
	now: () => Date;
}

function normalizeEmailAddress(value: string): string {
	return value.trim().toLowerCase();
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function stripHtml(value: string): string {
	return value
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function buildForwardingSubject(subject?: string | null): string {
	const trimmed = subject?.trim() || "(no subject)";
	return /^fwd:/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

export function buildForwardingIdempotencyKey(job: {
	id: bigint;
	inboundMessageId: bigint;
}): string {
	return `mailbox-forward/${job.id.toString()}/${job.inboundMessageId.toString()}`;
}

function buildMetadataLines(message: {
	fromAddress: string;
	matchedAddress: string;
	finalAddress: string;
	receivedAt: Date;
	routeKind?: string | null;
}) {
	return [
		`Original sender: ${message.fromAddress}`,
		`Matched mailbox: ${message.matchedAddress}`,
		`Final mailbox: ${message.finalAddress}`,
		`Received at: ${message.receivedAt.toISOString()}`,
		...(message.routeKind ? [`Route kind: ${message.routeKind}`] : []),
	];
}

export function buildForwardingBodies(message: {
	fromAddress: string;
	matchedAddress: string;
	finalAddress: string;
	subject?: string | null;
	textPreview?: string | null;
	htmlPreview?: string | null;
	routeKind?: string | null;
	receivedAt: Date;
}) {
	const metadataLines = buildMetadataLines(message);
	const textPreview = message.textPreview?.trim() || null;
	const htmlPreview = message.htmlPreview?.trim() || null;
	const fallbackText = htmlPreview ? stripHtml(htmlPreview) : null;
	const text = [
		"Forwarded inbound message",
		"",
		...metadataLines,
		"",
		textPreview ||
			fallbackText ||
			"No preview content was captured for this inbound message.",
	].join("\n");

	const htmlContent =
		htmlPreview ||
		(textPreview
			? `<pre>${escapeHtml(textPreview)}</pre>`
			: "<p>No preview content was captured for this inbound message.</p>");
	const htmlMetadata = metadataLines
		.map((line) => `<li>${escapeHtml(line)}</li>`)
		.join("");

	return {
		subject: buildForwardingSubject(message.subject),
		text,
		html: `<div><p>Forwarded inbound message</p><ul>${htmlMetadata}</ul>${htmlContent}</div>`,
	};
}

export function calculateForwardingRetryDelayMs(attemptCount: number): number {
	const safeAttemptCount = Math.max(1, attemptCount);
	return Math.min(
		FORWARDING_INITIAL_BACKOFF_MS * 2 ** (safeAttemptCount - 1),
		FORWARDING_MAX_BACKOFF_MS,
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}
	return "Forwarding failed";
}

function isRetryableForwardingError(error: unknown): boolean {
	if (error instanceof AppError) {
		return false;
	}

	const message = getErrorMessage(error).toLowerCase();
	if (!message) {
		return true;
	}

	if (
		message.includes("invalid email") ||
		message.includes("invalid recipient")
	) {
		return false;
	}

	if (message.includes("invalid_idempotent_request")) {
		return false;
	}

	return true;
}

type ClaimedForwardJobRow = {
	id: bigint;
	previous_status: "PENDING" | "FAILED" | "RUNNING";
};

async function claimForwardJobIds(
	deps: ForwardingWorkerDeps,
	limit: number,
	now: Date,
): Promise<
	Array<{ id: bigint; previousStatus: "PENDING" | "FAILED" | "RUNNING" }>
> {
	const staleRunningCutoff = new Date(
		now.getTime() - FORWARDING_RUNNING_STALE_MS,
	);
	const rows = await deps.prisma.$queryRaw<ClaimedForwardJobRow[]>(Prisma.sql`
        WITH claimable AS (
            SELECT id, status AS previous_status
            FROM mailbox_forward_jobs
            WHERE (
                status IN (CAST('PENDING' AS "ForwardJobStatus"), CAST('FAILED' AS "ForwardJobStatus"))
                AND next_attempt_at IS NOT NULL
                AND next_attempt_at <= ${now}
            )
            OR (
                status = CAST('RUNNING' AS "ForwardJobStatus")
                AND updated_at <= ${staleRunningCutoff}
            )
            ORDER BY next_attempt_at ASC, created_at ASC, id ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE mailbox_forward_jobs AS job
        SET status = CAST('RUNNING' AS "ForwardJobStatus"),
            updated_at = ${now}
        FROM claimable
        WHERE job.id = claimable.id
        RETURNING job.id, claimable.previous_status
    `);

	return rows.map((row) => ({
		id: BigInt(row.id),
		previousStatus: row.previous_status,
	}));
}

async function loadForwardJob(deps: ForwardingWorkerDeps, jobId: bigint) {
	return deps.prisma.mailboxForwardJob.findUnique({
		where: { id: jobId },
		select: {
			id: true,
			inboundMessageId: true,
			mailboxId: true,
			mode: true,
			forwardTo: true,
			attemptCount: true,
			inboundMessage: {
				select: {
					id: true,
					domainId: true,
					matchedAddress: true,
					finalAddress: true,
					fromAddress: true,
					subject: true,
					textPreview: true,
					htmlPreview: true,
					routeKind: true,
					receivedAt: true,
				},
			},
			mailbox: {
				select: {
					id: true,
					address: true,
					status: true,
					forwardMode: true,
					forwardTo: true,
					domain: {
						select: {
							id: true,
							name: true,
							status: true,
							canSend: true,
							sendingConfigs: {
								where: { provider: "RESEND", status: "ACTIVE" },
								select: {
									apiKeyEncrypted: true,
									fromNameDefault: true,
									replyToDefault: true,
								},
								take: 1,
							},
						},
					},
				},
			},
		},
	});
}

async function markForwardJobSkipped(
	deps: ForwardingWorkerDeps,
	jobId: bigint,
	reason: string,
	processedAt: Date,
) {
	await deps.prisma.mailboxForwardJob.update({
		where: { id: jobId },
		data: {
			status: "SKIPPED",
			lastError: reason,
			nextAttemptAt: null,
			processedAt,
		},
	});
}

async function markForwardJobFailed(
	deps: ForwardingWorkerDeps,
	job: { id: bigint; attemptCount: number },
	error: unknown,
	processedAt: Date,
) {
	const nextAttemptCount = job.attemptCount + 1;
	const retryable =
		isRetryableForwardingError(error) &&
		nextAttemptCount < FORWARDING_MAX_ATTEMPTS;
	const nextAttemptAt = retryable
		? new Date(
				processedAt.getTime() +
					calculateForwardingRetryDelayMs(nextAttemptCount),
			)
		: null;

	await deps.prisma.mailboxForwardJob.update({
		where: { id: job.id },
		data: {
			status: "FAILED",
			attemptCount: nextAttemptCount,
			lastError: getErrorMessage(error),
			nextAttemptAt,
			processedAt,
		},
	});

	return {
		nextAttemptCount,
		retryable,
		nextAttemptAt,
		lastError: getErrorMessage(error),
	};
}

async function markForwardJobSent(
	deps: ForwardingWorkerDeps,
	job: {
		id: bigint;
		inboundMessageId: bigint;
		mode: "COPY" | "MOVE";
		attemptCount: number;
	},
	providerMessageId: string | null,
	processedAt: Date,
) {
	await deps.prisma.$transaction(async (tx) => {
		if (job.mode === "MOVE") {
			await tx.inboundMessage.update({
				where: { id: job.inboundMessageId },
				data: {
					portalState: "FORWARDED_HIDDEN",
				},
			});
		}

		await tx.mailboxForwardJob.update({
			where: { id: job.id },
			data: {
				status: "SENT",
				attemptCount: job.attemptCount + 1,
				lastError: null,
				providerMessageId,
				nextAttemptAt: null,
				processedAt,
			},
		});
	});
}

function validateForwardTarget(forwardTo: string) {
	const parsed = emailSchema.safeParse(forwardTo);
	if (!parsed.success) {
		throw new AppError(
			"FORWARD_TARGET_INVALID",
			"Forward target email is invalid",
			400,
		);
	}
	return parsed.data;
}

async function processForwardJob(deps: ForwardingWorkerDeps, jobId: bigint) {
	const job = await loadForwardJob(deps, jobId);
	if (!job) {
		return;
	}

	const processedAt = deps.now();
	const idempotencyKey = buildForwardingIdempotencyKey(job);

	deps.logger.info(
		{
			jobId: job.id.toString(),
			inboundMessageId: job.inboundMessageId.toString(),
			mailboxId: job.mailboxId,
			mode: job.mode,
			forwardTo: job.forwardTo,
			attemptNumber: job.attemptCount + 1,
			idempotencyKey,
		},
		"Mailbox forwarding job started",
	);

	if (!job.mailbox || job.mailbox.status !== "ACTIVE") {
		const failure = await markForwardJobFailed(
			deps,
			{ id: job.id, attemptCount: job.attemptCount },
			new AppError(
				"DOMAIN_MAILBOX_DISABLED",
				"Mailbox is no longer active for forwarding",
				400,
			),
			processedAt,
		);
		deps.logger.warn(
			{
				jobId: job.id.toString(),
				idempotencyKey,
				retryable: failure.retryable,
				nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
				lastError: failure.lastError,
			},
			"Mailbox forwarding job failed before send",
		);
		return;
	}

	const currentForwardTo = job.mailbox.forwardTo
		? normalizeEmailAddress(job.mailbox.forwardTo)
		: null;
	if (
		job.mailbox.forwardMode === "DISABLED" ||
		!currentForwardTo ||
		currentForwardTo !== normalizeEmailAddress(job.forwardTo)
	) {
		await markForwardJobSkipped(
			deps,
			job.id,
			"Forwarding configuration changed after job creation",
			processedAt,
		);
		deps.logger.info(
			{
				jobId: job.id.toString(),
				mailboxId: job.mailbox.id,
				idempotencyKey,
			},
			"Mailbox forwarding job skipped because forwarding configuration changed",
		);
		return;
	}

	if (job.mailbox.domain.status !== "ACTIVE") {
		const failure = await markForwardJobFailed(
			deps,
			{ id: job.id, attemptCount: job.attemptCount },
			new AppError(
				"DOMAIN_DISABLED",
				"Domain is not active for forwarding",
				400,
			),
			processedAt,
		);
		deps.logger.warn(
			{
				jobId: job.id.toString(),
				idempotencyKey,
				retryable: failure.retryable,
				nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
				lastError: failure.lastError,
			},
			"Mailbox forwarding job failed because domain is inactive",
		);
		return;
	}

	if (!job.mailbox.domain.canSend) {
		const failure = await markForwardJobFailed(
			deps,
			{ id: job.id, attemptCount: job.attemptCount },
			new AppError(
				"DOMAIN_SEND_DISABLED",
				"Domain cannot send forwarded mail",
				400,
			),
			processedAt,
		);
		deps.logger.warn(
			{
				jobId: job.id.toString(),
				idempotencyKey,
				retryable: failure.retryable,
				nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
				lastError: failure.lastError,
			},
			"Mailbox forwarding job failed because domain sending is disabled",
		);
		return;
	}

	const sendConfig = job.mailbox.domain.sendingConfigs[0];
	if (!sendConfig) {
		const failure = await markForwardJobFailed(
			deps,
			{ id: job.id, attemptCount: job.attemptCount },
			new AppError(
				"SEND_CONFIG_NOT_FOUND",
				"No active sending configuration is available for this domain",
				404,
			),
			processedAt,
		);
		deps.logger.warn(
			{
				jobId: job.id.toString(),
				idempotencyKey,
				retryable: failure.retryable,
				nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
				lastError: failure.lastError,
			},
			"Mailbox forwarding job failed because send config is missing",
		);
		return;
	}

	try {
		const forwardTo = validateForwardTarget(job.forwardTo);
		const bodies = buildForwardingBodies(job.inboundMessage);
		const replyTo = emailSchema.safeParse(job.inboundMessage.fromAddress)
			.success
			? job.inboundMessage.fromAddress
			: sendConfig.replyToDefault;
		const idempotencyKey = buildForwardingIdempotencyKey(job);

		const result = await deps.sendWithResend({
			apiKey: deps.decrypt(sendConfig.apiKeyEncrypted),
			from: formatResendFromAddress(
				job.inboundMessage.finalAddress,
				sendConfig.fromNameDefault,
			),
			to: [forwardTo],
			subject: bodies.subject,
			html: bodies.html,
			text: bodies.text,
			replyTo,
			idempotencyKey,
		});

		await markForwardJobSent(
			deps,
			{
				id: job.id,
				inboundMessageId: job.inboundMessageId,
				mode: job.mode === "MOVE" ? "MOVE" : "COPY",
				attemptCount: job.attemptCount,
			},
			result.id,
			processedAt,
		);

		deps.logger.info(
			{
				jobId: job.id.toString(),
				inboundMessageId: job.inboundMessageId.toString(),
				mailboxId: job.mailbox.id,
				providerMessageId: result.id,
				idempotencyKey,
				mode: job.mode,
			},
			"Mailbox forwarding job sent",
		);
	} catch (error) {
		const failure = await markForwardJobFailed(
			deps,
			{ id: job.id, attemptCount: job.attemptCount },
			error,
			processedAt,
		);
		deps.logger.warn(
			{
				err: error,
				jobId: job.id.toString(),
				inboundMessageId: job.inboundMessageId.toString(),
				mailboxId: job.mailbox.id,
				idempotencyKey,
				retryable: failure.retryable,
				attemptCount: failure.nextAttemptCount,
				nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
				lastError: failure.lastError,
			},
			"Mailbox forwarding attempt failed",
		);
	}
}

export function createForwardingWorker(
	overrides: Partial<ForwardingWorkerDeps> = {},
) {
	const deps: ForwardingWorkerDeps = {
		prisma,
		logger,
		decrypt,
		sendWithResend,
		markHealthy: markJobsHealthy,
		now: () => new Date(),
		...overrides,
	};
	let running = false;

	async function runOnce() {
		if (running) {
			return;
		}

		running = true;
		try {
			const claimedJobs = await claimForwardJobIds(
				deps,
				env.FORWARDING_WORKER_BATCH_SIZE,
				deps.now(),
			);
			if (claimedJobs.length > 0) {
				deps.logger.info(
					{
						claimedCount: claimedJobs.length,
						reclaimedCount: claimedJobs.filter(
							(job) => job.previousStatus === "RUNNING",
						).length,
						claimedJobIds: claimedJobs.map((job) => job.id.toString()),
					},
					"Mailbox forwarding worker claimed jobs",
				);
			}
			for (const job of claimedJobs) {
				await processForwardJob(deps, job.id);
			}
		} catch (err) {
			deps.logger.error({ err }, "Mailbox forwarding worker failed");
		} finally {
			running = false;
			try {
				await Promise.resolve(deps.markHealthy(deps.now()));
			} catch (err) {
				deps.logger.warn({ err }, "Failed to update jobs heartbeat");
			}
		}
	}

	function start() {
		const intervalMs = env.FORWARDING_WORKER_INTERVAL_SECONDS * 1000;
		deps.logger.info(
			{
				intervalSeconds: env.FORWARDING_WORKER_INTERVAL_SECONDS,
				batchSize: env.FORWARDING_WORKER_BATCH_SIZE,
			},
			"Mailbox forwarding worker started",
		);

		void runOnce();
		const timer = setInterval(() => {
			void runOnce();
		}, intervalMs);

		return () => {
			clearInterval(timer);
		};
	}

	return {
		runOnce,
		start,
	};
}

export function startForwardingWorker(): () => void {
	return createForwardingWorker().start();
}

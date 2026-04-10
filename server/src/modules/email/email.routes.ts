import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../plugins/error.js";
import { authService } from "../auth/auth.service.js";
import { mailService } from "../mail/mail.service.js";
import {
	batchClearMailboxSchema,
	batchFetchMailboxesSchema,
	createEmailSchema,
	deleteSelectedMailsSchema,
	importEmailSchema,
	listEmailSchema,
	revealEmailSecretsSchema,
	revealEmailUnlockSchema,
	updateEmailSchema,
} from "./email.schema.js";
import { emailService } from "./email.service.js";

const ADMIN_REVEAL_EXTERNAL_SECRET_ACTION = "admin_reveal_external_secret";
const ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK_ACTION =
	"admin_reveal_external_secret_unlock";

function toErrorCode(value: unknown): string | undefined {
	return typeof value === "string" || typeof value === "number"
		? String(value)
		: undefined;
}

function getErrorStatusCode(err: unknown): number {
	if (!err || typeof err !== "object") {
		return 500;
	}

	const errorObj = err as { name?: unknown; statusCode?: unknown };
	if (errorObj.name === "ZodError") {
		return 400;
	}
	return typeof errorObj.statusCode === "number" ? errorObj.statusCode : 500;
}

const emailRoutes: FastifyPluginAsync = async (fastify) => {
	// 所有路由需要 JWT 认证
	fastify.addHook("preHandler", fastify.authenticateJwt);

	const loadMailContext = async (emailId: number) => {
		const emailData = await emailService.getById(emailId, true);
		const credentials = mailService.buildCredentialsFromRecord(
			{
				...emailData,
				fetchStrategy: emailData.group?.fetchStrategy,
			},
			false,
		);

		return { emailData, credentials };
	};

	// 列表
	fastify.get("/", async (request) => {
		const input = listEmailSchema.parse(request.query);
		const result = await emailService.list(input);
		return { success: true, data: result };
	});

	fastify.get("/stats", async () => {
		const result = await emailService.getStats();
		return { success: true, data: result };
	});

	// 详情
	fastify.get("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		const email = await emailService.getById(parseInt(id, 10), false);
		return { success: true, data: email };
	});

	fastify.post("/reveal-unlock", async (request) => {
		const startedAt = Date.now();
		const input = revealEmailUnlockSchema.parse(request.body);
		const admin = request.user;
		if (!admin) {
			throw new AppError("UNAUTHORIZED", "Authentication required", 401);
		}
		const adminId = admin.id;
		const metadataBase = {
			adminId,
			requestId: request.id,
			stepUpMethod: "totp",
		};

		try {
			await authService.verifyStepUpTwoFactor(adminId, { otp: input.otp });
			const grant = await authService.createExternalSecretRevealGrant(adminId);
			await mailService.logAdminAction(
				ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK_ACTION,
				undefined,
				request.ip,
				200,
				Date.now() - startedAt,
				{
					...metadataBase,
					success: true,
					expiresAt: grant.expiresAt,
				},
			);
			return { success: true, data: grant };
		} catch (error) {
			await mailService.logAdminAction(
				ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK_ACTION,
				undefined,
				request.ip,
				getErrorStatusCode(error),
				Date.now() - startedAt,
				{
					...metadataBase,
					success: false,
					errorCode:
						error && typeof error === "object" && "code" in error
							? toErrorCode((error as { code?: unknown }).code)
							: undefined,
				},
			);
			throw error;
		}
	});

	fastify.post("/:id(^\\d+$)/reveal-secrets", async (request) => {
		const startedAt = Date.now();
		const { id } = request.params as { id: string };
		const emailId = parseInt(id, 10);
		const input = revealEmailSecretsSchema.parse(request.body);
		const admin = request.user;
		if (!admin) {
			throw new AppError("UNAUTHORIZED", "Authentication required", 401);
		}
		const adminId = admin.id;
		const metadataBase = {
			adminId,
			fields: input.fields,
			requestId: request.id,
			stepUpMethod: input.grantToken ? "grant" : "totp",
		};

		try {
			if (input.grantToken) {
				await authService.verifyExternalSecretRevealGrant(
					adminId,
					input.grantToken,
				);
			} else {
				if (!input.otp) {
					throw new AppError(
						"VALIDATION_ERROR",
						"OTP or grant token is required",
						400,
					);
				}
				await authService.verifyStepUpTwoFactor(adminId, { otp: input.otp });
			}
			const result = await emailService.revealSecrets(emailId, input.fields);
			await mailService.logAdminAction(
				ADMIN_REVEAL_EXTERNAL_SECRET_ACTION,
				emailId,
				request.ip,
				200,
				Date.now() - startedAt,
				{
					...metadataBase,
					success: true,
					availableFields: result.availableFields,
				},
			);
			return { success: true, data: result };
		} catch (error) {
			await mailService.logAdminAction(
				ADMIN_REVEAL_EXTERNAL_SECRET_ACTION,
				emailId,
				request.ip,
				getErrorStatusCode(error),
				Date.now() - startedAt,
				{
					...metadataBase,
					success: false,
					errorCode:
						error && typeof error === "object" && "code" in error
							? toErrorCode((error as { code?: unknown }).code)
							: undefined,
				},
			);
			throw error;
		}
	});

	// 创建
	fastify.post("/", async (request) => {
		const input = createEmailSchema.parse(request.body);
		const email = await emailService.create(input);
		return { success: true, data: email };
	});

	// 更新
	fastify.put("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		const input = updateEmailSchema.parse(request.body);
		const admin = request.user;
		if (!admin) {
			throw new AppError("UNAUTHORIZED", "Authentication required", 401);
		}
		if (input.accountLoginPassword !== undefined) {
			if (!input.accountPasswordGrantToken) {
				throw new AppError(
					"ACCOUNT_LOGIN_PASSWORD_GRANT_REQUIRED",
					"Two-factor verification is required before updating the stored account login password",
					403,
				);
			}
			await authService.verifyExternalSecretRevealGrant(
				admin.id,
				input.accountPasswordGrantToken,
			);
		}
		const {
			accountPasswordGrantToken: _accountPasswordGrantToken,
			...updateData
		} = input;
		const email = await emailService.update(parseInt(id, 10), updateData);
		return { success: true, data: email };
	});

	// 删除
	fastify.delete("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		await emailService.delete(parseInt(id, 10));
		return { success: true, data: { code: "EMAIL_ACCOUNT_DELETED" } };
	});

	// 批量删除
	fastify.post("/batch-delete", async (request) => {
		const { ids } = z.object({ ids: z.array(z.number()) }).parse(request.body);
		const result = await emailService.batchDelete(ids);
		return { success: true, data: result };
	});

	fastify.post("/batch-fetch-mails", async (request) => {
		const input = batchFetchMailboxesSchema.parse(request.body);
		const targets = await emailService.getBatchTargets(input);
		const results: Array<{
			id: number;
			email: string;
			status: "success" | "partial" | "error" | "skipped";
			code?: string;
			mailboxResults: Array<{
				mailbox: string;
				status: "success" | "error";
				code?: string;
				count?: number;
			}>;
		}> = [];

		for (const target of targets) {
			if (target.status === "DISABLED") {
				results.push({
					id: target.id,
					email: target.email,
					status: "skipped",
					code: "EMAIL_TARGET_DISABLED",
					mailboxResults: [],
				});
				continue;
			}

			const credentials = mailService.buildCredentialsFromRecord(
				{
					...target,
					fetchStrategy: target.group?.fetchStrategy,
				},
				false,
			);
			const mailboxResults: Array<{
				mailbox: string;
				status: "success" | "error";
				code?: string;
				count?: number;
			}> = [];
			let successCount = 0;
			let lastErrorMessage: string | undefined;
			let lastErrorCode: string | undefined;

			for (const mailbox of input.mailboxes) {
				try {
					const mails = await mailService.getEmails(credentials, {
						mailbox,
						mailboxCheckpoint: target.mailboxStatus[mailbox] ?? null,
					});
					await emailService.updateMailboxStatus(
						target.id,
						mailbox,
						mails.messages,
						{
							markAsSeen: false,
							mailboxCheckpoint: mails.mailboxCheckpoint,
						},
					);
					mailboxResults.push({
						mailbox,
						status: "success",
						count: mails.count,
					});
					successCount += 1;
				} catch (error) {
					const errorMessage =
						error instanceof Error && error.message
							? error.message
							: `收取 ${mailbox} 失败`;
					mailboxResults.push({
						mailbox,
						status: "error",
						code:
							toErrorCode(error instanceof AppError ? error.code : undefined) ||
							"MAILBOX_FETCH_FAILED",
					});
					lastErrorMessage = errorMessage;
					lastErrorCode =
						toErrorCode(error instanceof AppError ? error.code : undefined) ||
						"MAILBOX_FETCH_FAILED";
				}
			}

			const finalStatus =
				successCount === input.mailboxes.length
					? "success"
					: successCount > 0
						? "partial"
						: "error";

			await mailService.updateEmailStatus(
				target.id,
				finalStatus !== "error",
				finalStatus === "error" ? lastErrorMessage : undefined,
			);

			results.push({
				id: target.id,
				email: target.email,
				status: finalStatus,
				code:
					finalStatus === "success"
						? "EMAIL_BATCH_FETCH_SUCCESS"
						: finalStatus === "partial"
							? "EMAIL_BATCH_FETCH_PARTIAL"
							: lastErrorCode || "EMAIL_BATCH_FETCH_FAILED",
				mailboxResults,
			});
		}

		const successCount = results.filter(
			(item) => item.status === "success",
		).length;
		const partialCount = results.filter(
			(item) => item.status === "partial",
		).length;
		const errorCount = results.filter((item) => item.status === "error").length;
		const skippedCount = results.filter(
			(item) => item.status === "skipped",
		).length;

		return {
			success: true,
			data: {
				targeted: targets.length,
				successCount,
				partialCount,
				errorCount,
				skippedCount,
				results,
			},
		};
	});

	fastify.post("/batch-clear-mailbox", async (request) => {
		const input = batchClearMailboxSchema.parse(request.body);
		const targets = await emailService.getBatchTargets(input);
		const results: Array<{
			id: number;
			email: string;
			status: "success" | "error" | "skipped";
			code: string;
			deletedCount: number;
		}> = [];
		let deletedCount = 0;

		for (const target of targets) {
			if (target.status === "DISABLED") {
				results.push({
					id: target.id,
					email: target.email,
					status: "skipped",
					code: "EMAIL_TARGET_DISABLED",
					deletedCount: 0,
				});
				continue;
			}

			if (target.capabilitySummary && !target.capabilitySummary.clearMailbox) {
				results.push({
					id: target.id,
					email: target.email,
					status: "skipped",
					code: "MAILBOX_CLEAR_UNSUPPORTED",
					deletedCount: 0,
				});
				continue;
			}

			const credentials = mailService.buildCredentialsFromRecord(
				{
					...target,
					fetchStrategy: target.group?.fetchStrategy,
				},
				false,
			);

			try {
				const result = await mailService.processMailbox(credentials, {
					mailbox: input.mailbox,
				});
				await emailService.clearMailboxStatus(target.id, input.mailbox);
				await mailService.updateEmailStatus(target.id, true);
				deletedCount += result.deletedCount;
				results.push({
					id: target.id,
					email: target.email,
					status: "success",
					code: "MAILBOX_CLEAR_SUCCESS",
					deletedCount: result.deletedCount,
				});
			} catch (error) {
				const errorMessage =
					error instanceof Error && error.message
						? error.message
						: "批量清空邮箱失败";
				await mailService.updateEmailStatus(target.id, false, errorMessage);
				results.push({
					id: target.id,
					email: target.email,
					status: "error",
					code:
						toErrorCode(error instanceof AppError ? error.code : undefined) ||
						"MAILBOX_CLEAR_FAILED",
					deletedCount: 0,
				});
			}
		}

		return {
			success: true,
			data: {
				targeted: targets.length,
				deletedCount,
				successCount: results.filter((item) => item.status === "success")
					.length,
				errorCount: results.filter((item) => item.status === "error").length,
				skippedCount: results.filter((item) => item.status === "skipped")
					.length,
				results,
			},
		};
	});

	// 批量导入
	fastify.post("/import", async (request) => {
		const input = importEmailSchema.parse(request.body);
		const result = await emailService.import(input);
		return { success: true, data: result };
	});

	// 导出
	fastify.get("/export", async (request) => {
		const query = z
			.object({
				ids: z.string().optional(),
				separator: z.string().optional(),
				groupId: z.coerce.number().int().positive().optional(),
				rawSecrets: z.coerce.boolean().default(false),
			})
			.parse(request.query);

		const idArray = query.ids
			?.split(",")
			.map(Number)
			.filter((id: number) => Number.isFinite(id) && id > 0);
		const content = await emailService.export(
			idArray,
			query.separator,
			query.groupId,
			query.rawSecrets,
		);
		return { success: true, data: { content } };
	});

	// 查看邮件 (管理员专用)
	fastify.get("/:id(^\\d+$)/mails", async (request) => {
		const { id } = request.params as { id: string };
		const { mailbox, markAsSeen } = z
			.object({
				mailbox: z.enum(["INBOX", "SENT", "Junk"]).default("INBOX"),
				markAsSeen: z.coerce.boolean().default(false),
			})
			.parse(request.query);
		const emailId = parseInt(id, 10);

		const { emailData, credentials } = await loadMailContext(emailId);

		try {
			const mails = await mailService.getEmails(credentials, {
				mailbox,
				mailboxCheckpoint: emailData.mailboxStatus[mailbox] ?? null,
			});
			if (mails.resolvedMailbox && mails.resolvedMailbox !== mailbox) {
				await emailService.updateResolvedMailboxFolder(
					emailId,
					mailbox,
					mails.resolvedMailbox,
				);
			}
			await emailService.updateMailboxStatus(emailId, mailbox, mails.messages, {
				markAsSeen,
				mailboxCheckpoint: mails.mailboxCheckpoint,
			});
			await mailService.updateEmailStatus(emailId, true);
			return { success: true, data: mails };
		} catch (error) {
			const errorMessage =
				error instanceof Error && error.message
					? error.message
					: "获取邮件失败";
			await mailService.updateEmailStatus(emailId, false, errorMessage);
			throw error;
		}
	});

	fastify.post("/:id(^\\d+$)/mails/delete", async (request) => {
		const { id } = request.params as { id: string };
		const input = deleteSelectedMailsSchema.parse(request.body);
		const emailId = parseInt(id, 10);
		const { emailData, credentials } = await loadMailContext(emailId);

		try {
			const result = await mailService.deleteMessages(credentials, {
				mailbox: input.mailbox,
				messageIds: input.messageIds,
				mailboxCheckpoint: emailData.mailboxStatus[input.mailbox] ?? null,
			});
			if (result.resolvedMailbox && result.resolvedMailbox !== input.mailbox) {
				await emailService.updateResolvedMailboxFolder(
					emailId,
					input.mailbox,
					result.resolvedMailbox,
				);
			}
			const remainingMails = await mailService.getEmails(credentials, {
				mailbox: input.mailbox,
				mailboxCheckpoint:
					result.mailboxCheckpoint ??
					emailData.mailboxStatus[input.mailbox] ??
					null,
			});
			if (
				remainingMails.resolvedMailbox &&
				remainingMails.resolvedMailbox !== input.mailbox
			) {
				await emailService.updateResolvedMailboxFolder(
					emailId,
					input.mailbox,
					remainingMails.resolvedMailbox,
				);
			}
			await emailService.updateMailboxStatus(
				emailId,
				input.mailbox,
				remainingMails.messages,
				{
					markAsSeen: true,
					mailboxCheckpoint: remainingMails.mailboxCheckpoint,
				},
			);
			await mailService.updateEmailStatus(emailId, true);
			const { message: _message, ...resultData } = result;
			return {
				success: true,
				data: {
					...resultData,
					messages: remainingMails.messages,
					remainingCount: remainingMails.count,
				},
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error && error.message
					? error.message
					: "删除选中邮件失败";
			await mailService.updateEmailStatus(emailId, false, errorMessage);
			throw error;
		}
	});

	fastify.post("/:id(^\\d+$)/send", async (request) => {
		const { id } = request.params as { id: string };
		const input = z
			.object({
				fromName: z.string().trim().max(255).optional(),
				to: z.array(z.string().trim().email()).min(1),
				subject: z.string().trim().min(1).max(500),
				text: z.string().trim().optional(),
				html: z.string().trim().optional(),
				socks5: z.string().optional(),
				http: z.string().optional(),
			})
			.parse(request.body);

		const emailId = parseInt(id, 10);
		const { credentials } = await loadMailContext(emailId);

		const result = await mailService.sendEmail(credentials, {
			fromEmail: credentials.email,
			fromName: input.fromName,
			to: input.to,
			subject: input.subject,
			text: input.text,
			html: input.html,
			socks5: input.socks5,
			http: input.http,
		});

		await mailService.updateEmailStatus(emailId, true);
		return { success: true, data: result };
	});

	// 清空邮箱 (管理员专用)
	fastify.post("/:id(^\\d+$)/clear", async (request) => {
		const { id } = request.params as { id: string };
		const { mailbox } = z
			.object({
				mailbox: z.enum(["INBOX", "Junk"]).default("INBOX"),
			})
			.parse(request.body);
		const emailId = parseInt(id, 10);

		const { credentials } = await loadMailContext(emailId);

		try {
			const result = await mailService.processMailbox(credentials, { mailbox });
			await emailService.clearMailboxStatus(emailId, mailbox);
			await mailService.updateEmailStatus(emailId, true);
			const { message: _message, ...resultData } = result;
			return { success: true, data: resultData };
		} catch (error) {
			const errorMessage =
				error instanceof Error && error.message
					? error.message
					: "清空邮箱失败";
			await mailService.updateEmailStatus(emailId, false, errorMessage);
			throw error;
		}
	});
};

export default emailRoutes;

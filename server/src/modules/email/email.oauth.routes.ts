import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../plugins/error.js";
import { emailOAuthService } from "./email.oauth.service.js";
import { emailOAuthConfigService } from "./email.oauth-config.service.js";

const startOAuthSchema = z.object({
	groupId: z.coerce.number().int().positive().optional(),
	emailId: z.coerce.number().int().positive().optional(),
});

const providerParamSchema = z.object({
	provider: z.string().min(1),
});

const callbackQuerySchema = z.object({
	state: z.string().optional(),
	code: z.string().optional(),
	error: z.string().optional(),
	error_description: z.string().optional(),
});

const oauthStatusQuerySchema = z.object({
	state: z.string().trim().min(1),
});

const providerConfigSchema = z.object({
	clientId: z.string().trim().optional().nullable(),
	clientSecret: z.string().trim().optional().nullable(),
	redirectUri: z.string().trim().optional().nullable(),
	scopes: z.string().trim().optional().nullable(),
	tenant: z.string().trim().optional().nullable(),
});

const googleClientSecretParseSchema = z.object({
	filePath: z.string().trim().optional().nullable(),
	jsonText: z.string().trim().optional().nullable(),
	callbackUri: z.string().trim().optional().nullable(),
});

const emailOAuthRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.get(
		"/providers",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async () => {
			return {
				success: true,
				data: await emailOAuthService.getProviderStatuses(),
			};
		},
	);

	fastify.get(
		"/configs",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async () => {
			return {
				success: true,
				data: await emailOAuthConfigService.listConfigSummaries(),
			};
		},
	);

	fastify.put(
		"/configs/:provider",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async (request) => {
			const { provider } = providerParamSchema.parse(request.params);
			const input = providerConfigSchema.parse(request.body ?? {});
			return {
				success: true,
				data: await emailOAuthConfigService.saveProviderConfig({
					provider: emailOAuthConfigService.parseProvider(provider),
					clientId: input.clientId,
					clientSecret: input.clientSecret,
					redirectUri: input.redirectUri,
					scopes: input.scopes,
					tenant: input.tenant,
				}),
			};
		},
	);

	fastify.post(
		"/google/parse-client-secret",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async (request) => {
			const input = googleClientSecretParseSchema.parse(request.body ?? {});
			return {
				success: true,
				data: await emailOAuthConfigService.parseGoogleClientSecret({
					filePath: input.filePath,
					jsonText: input.jsonText,
					callbackUri: input.callbackUri,
				}),
			};
		},
	);

	fastify.post(
		"/:provider/start",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async (request) => {
			const adminId = request.user?.id;
			if (!adminId) {
				throw new AppError("UNAUTHORIZED", "Authentication required", 401);
			}
			const { provider } = providerParamSchema.parse(request.params);
			const input = startOAuthSchema.parse(request.body ?? {});
			const result = await emailOAuthService.startAuthorization({
				provider,
				adminId,
				groupId: input.groupId,
				emailId: input.emailId,
			});
			return {
				success: true,
				data: result,
			};
		},
	);

	fastify.get(
		"/:provider/status",
		{
			preHandler: [fastify.authenticateJwt],
		},
		async (request) => {
			const adminId = request.user?.id;
			if (!adminId) {
				throw new AppError("UNAUTHORIZED", "Authentication required", 401);
			}
			const { provider } = providerParamSchema.parse(request.params);
			const { state } = oauthStatusQuerySchema.parse(request.query);
			return {
				success: true,
				data: await emailOAuthService.getAuthorizationStatus({
					provider,
					state,
					adminId,
				}),
			};
		},
	);

	fastify.get("/:provider/callback", async (request, reply) => {
		const { provider } = providerParamSchema.parse(request.params);
		const query = callbackQuerySchema.parse(request.query);
		const result = await emailOAuthService.completeAuthorization({
			provider,
			state: query.state,
			code: query.code,
			error: query.error,
			errorDescription: query.error_description,
		});
		return reply.redirect(emailOAuthService.buildRedirectUrl(result));
	});
};

export default emailOAuthRoutes;

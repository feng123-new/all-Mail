import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../plugins/error.js";
import {
	configureCatchAllSchema,
	configureDomainVerificationSchema,
	createDomainSchema,
	createMailboxAliasSchema,
	listDomainSchema,
	listMailboxAliasSchema,
	saveCloudflareValidationConfigSchema,
	saveDomainSendingConfigSchema,
	updateDomainSchema,
	updateMailboxAliasSchema,
} from "./domain.schema.js";
import { domainService } from "./domain.service.js";

const domainRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.addHook("preHandler", fastify.authenticateJwt);

	fastify.get("/", async (request) => {
		const input = listDomainSchema.parse(request.query);
		const result = await domainService.list(input);
		return { success: true, data: result };
	});

	fastify.get("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		const result = await domainService.getById(Number.parseInt(id, 10));
		return { success: true, data: result };
	});

	fastify.post("/", async (request) => {
		const input = createDomainSchema.parse(request.body);
		const adminId = request.user?.id;
		if (!adminId) {
			throw new AppError("UNAUTHORIZED", "Authentication required", 401);
		}
		const result = await domainService.create(input, adminId);
		return { success: true, data: result };
	});

	fastify.patch("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		const input = updateDomainSchema.parse(request.body);
		const result = await domainService.update(Number.parseInt(id, 10), input);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/verify", async (request) => {
		const { id } = request.params as { id: string };
		const input = configureDomainVerificationSchema.parse(request.body ?? {});
		const result = await domainService.configureVerification(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/cloudflare-config", async (request) => {
		const { id } = request.params as { id: string };
		const input = saveCloudflareValidationConfigSchema.parse(
			request.body ?? {},
		);
		const result = await domainService.saveCloudflareValidationConfig(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/cloudflare-validate", async (request) => {
		const { id } = request.params as { id: string };
		const result = await domainService.validateCloudflare(
			Number.parseInt(id, 10),
		);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/catch-all", async (request) => {
		const { id } = request.params as { id: string };
		const input = configureCatchAllSchema.parse(request.body);
		const result = await domainService.configureCatchAll(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/sending-config", async (request) => {
		const { id } = request.params as { id: string };
		const input = saveDomainSendingConfigSchema.parse(request.body);
		const result = await domainService.saveSendingConfig(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.get("/:id(^\\d+$)/aliases", async (request) => {
		const { id } = request.params as { id: string };
		const input = listMailboxAliasSchema.parse(request.query);
		const result = await domainService.listAliases(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.post("/:id(^\\d+$)/aliases", async (request) => {
		const { id } = request.params as { id: string };
		const input = createMailboxAliasSchema.parse(request.body);
		const result = await domainService.createAlias(
			Number.parseInt(id, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.patch("/:id(^\\d+$)/aliases/:aliasId(^\\d+$)", async (request) => {
		const { id, aliasId } = request.params as { id: string; aliasId: string };
		const input = updateMailboxAliasSchema.parse(request.body ?? {});
		const result = await domainService.updateAlias(
			Number.parseInt(id, 10),
			Number.parseInt(aliasId, 10),
			input,
		);
		return { success: true, data: result };
	});

	fastify.delete("/:id(^\\d+$)/aliases/:aliasId(^\\d+$)", async (request) => {
		const { id, aliasId } = request.params as { id: string; aliasId: string };
		const result = await domainService.deleteAlias(
			Number.parseInt(id, 10),
			Number.parseInt(aliasId, 10),
		);
		return { success: true, data: result };
	});

	fastify.delete("/:id(^\\d+$)", async (request) => {
		const { id } = request.params as { id: string };
		const result = await domainService.delete(Number.parseInt(id, 10));
		return { success: true, data: result };
	});
};

export default domainRoutes;

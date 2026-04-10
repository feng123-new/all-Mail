import { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "../../lib/crypto.js";
import {
	type MailProviderConfig,
	mergeProviderConfigForProfile,
	type ProviderProfile,
} from "../mail/providers/types.js";

export function parseJsonObject(
	value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

export function sanitizeProviderConfig(
	profile: ProviderProfile,
	value?: Record<string, unknown> | null,
): Prisma.InputJsonValue {
	return mergeProviderConfigForProfile(
		profile,
		value as MailProviderConfig | null | undefined,
	) as unknown as Prisma.InputJsonValue;
}

export function sanitizeCapabilities(
	value?: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
	if (!value) {
		return Prisma.JsonNull;
	}
	return value as Prisma.InputJsonValue;
}

export function decryptOptional(
	value: string | null | undefined,
): string | undefined {
	if (!value) return undefined;
	return decrypt(value);
}

export function encryptOptional(
	value: string | null | undefined,
): string | null {
	if (!value || !value.trim()) return null;
	return encrypt(value);
}

import { z } from 'zod';

export const domainStatusSchema = z.enum(['PENDING', 'ACTIVE', 'DISABLED', 'ERROR']);

export const listDomainSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().trim().optional(),
    status: domainStatusSchema.optional(),
});

export const createDomainSchema = z.object({
    name: z.string().trim().min(3).max(255),
    displayName: z.string().trim().max(255).optional(),
    canReceive: z.boolean().default(true),
    canSend: z.boolean().default(false),
    isCatchAllEnabled: z.boolean().default(false),
});

export const updateDomainSchema = z.object({
    displayName: z.string().trim().max(255).nullable().optional(),
    status: domainStatusSchema.optional(),
    canReceive: z.boolean().optional(),
    canSend: z.boolean().optional(),
    isCatchAllEnabled: z.boolean().optional(),
});

export const configureDomainVerificationSchema = z.object({
    verificationToken: z.string().trim().min(8).optional(),
});

export const saveCloudflareValidationConfigSchema = z.object({
    apiToken: z.string().trim().min(20).nullable().optional(),
    zoneId: z.string().trim().min(8).nullable().optional(),
    clearSavedToken: z.boolean().optional(),
});

export const saveDomainSendingConfigSchema = z.object({
    provider: z.enum(['RESEND']).default('RESEND'),
    fromNameDefault: z.string().trim().max(255).nullable().optional(),
    replyToDefault: z.string().trim().email().nullable().optional(),
    apiKey: z.string().trim().min(8).optional(),
});

export const configureCatchAllSchema = z.object({
    isCatchAllEnabled: z.boolean(),
    catchAllTargetMailboxId: z.coerce.number().int().positive().nullable().optional(),
});

export const listMailboxAliasSchema = z.object({
    mailboxId: z.coerce.number().int().positive().optional(),
});

export const createMailboxAliasSchema = z.object({
    mailboxId: z.coerce.number().int().positive(),
    aliasLocalPart: z.string().trim().min(1).max(255),
});

export const updateMailboxAliasSchema = z.object({
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export type ListDomainInput = z.infer<typeof listDomainSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;
export type ConfigureDomainVerificationInput = z.infer<typeof configureDomainVerificationSchema>;
export type SaveCloudflareValidationConfigInput = z.infer<typeof saveCloudflareValidationConfigSchema>;
export type SaveDomainSendingConfigInput = z.infer<typeof saveDomainSendingConfigSchema>;
export type ConfigureCatchAllInput = z.infer<typeof configureCatchAllSchema>;
export type ListMailboxAliasInput = z.infer<typeof listMailboxAliasSchema>;
export type CreateMailboxAliasInput = z.infer<typeof createMailboxAliasSchema>;
export type UpdateMailboxAliasInput = z.infer<typeof updateMailboxAliasSchema>;

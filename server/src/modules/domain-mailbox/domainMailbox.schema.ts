import { z } from 'zod';

export const domainMailboxStatusSchema = z.enum(['ACTIVE', 'DISABLED', 'SUSPENDED']);
export const forwardModeSchema = z.enum(['DISABLED', 'COPY', 'MOVE']);
export const provisioningModeSchema = z.enum(['MANUAL', 'API_POOL']);

export const listDomainMailboxSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    domainId: z.coerce.number().int().positive().optional(),
    keyword: z.string().trim().optional(),
    status: domainMailboxStatusSchema.optional(),
    batchTag: z.string().trim().max(100).optional(),
    provisioningMode: provisioningModeSchema.optional(),
});

export const createDomainMailboxSchema = z.object({
    domainId: z.coerce.number().int().positive(),
    localPart: z.string().trim().min(1).max(255),
    displayName: z.string().trim().max(255).optional(),
    canLogin: z.boolean().default(true),
    provisioningMode: provisioningModeSchema.default('MANUAL'),
    batchTag: z.string().trim().max(100).optional(),
    quotaMb: z.coerce.number().int().positive().optional(),
    password: z.string().min(8).optional(),
    ownerUserId: z.coerce.number().int().positive().optional(),
    memberUserIds: z.array(z.coerce.number().int().positive()).default([]),
    forwardMode: forwardModeSchema.default('DISABLED'),
    forwardTo: z.string().trim().email().optional(),
});

export const updateDomainMailboxSchema = z.object({
    displayName: z.string().trim().max(255).nullable().optional(),
    status: domainMailboxStatusSchema.optional(),
    canLogin: z.boolean().optional(),
    provisioningMode: provisioningModeSchema.optional(),
    batchTag: z.string().trim().max(100).nullable().optional(),
    quotaMb: z.coerce.number().int().positive().nullable().optional(),
    password: z.string().min(8).nullable().optional(),
    ownerUserId: z.coerce.number().int().positive().nullable().optional(),
    memberUserIds: z.array(z.coerce.number().int().positive()).optional(),
    forwardMode: forwardModeSchema.optional(),
    forwardTo: z.string().trim().email().nullable().optional(),
});

const batchCreateByListSchema = z.object({
    localParts: z.array(z.string().trim().min(1).max(255)).min(1),
    prefix: z.undefined().optional(),
    count: z.undefined().optional(),
    startFrom: z.undefined().optional(),
    padding: z.undefined().optional(),
});

const batchCreateByPrefixSchema = z.object({
    prefix: z.string().trim().min(1).max(100),
    count: z.coerce.number().int().min(1).max(1000),
    startFrom: z.coerce.number().int().min(0).default(1),
    padding: z.coerce.number().int().min(0).max(10).default(0),
    localParts: z.undefined().optional(),
});

export const batchCreateDomainMailboxSchema = z.intersection(
    z.object({
        domainId: z.coerce.number().int().positive(),
        displayName: z.string().trim().max(255).optional(),
        canLogin: z.boolean().default(false),
        provisioningMode: provisioningModeSchema.default('API_POOL'),
        batchTag: z.string().trim().max(100).optional(),
        quotaMb: z.coerce.number().int().positive().optional(),
        password: z.string().min(8).optional(),
        ownerUserId: z.coerce.number().int().positive().optional(),
        memberUserIds: z.array(z.coerce.number().int().positive()).default([]),
        forwardMode: forwardModeSchema.default('DISABLED'),
        forwardTo: z.string().trim().email().optional(),
        bindApiKeyIds: z.array(z.coerce.number().int().positive()).default([]),
    }),
    z.union([batchCreateByListSchema, batchCreateByPrefixSchema])
);

export const batchDeleteDomainMailboxSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).default([]),
    domainId: z.coerce.number().int().positive().optional(),
    batchTag: z.string().trim().max(100).optional(),
    provisioningMode: provisioningModeSchema.optional(),
}).superRefine((input, ctx) => {
    const hasIds = input.ids.length > 0;
    const hasFilter = Boolean(input.domainId || input.batchTag || input.provisioningMode);
    if (!hasIds && !hasFilter) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ids'],
            message: 'Provide mailbox ids or at least one domain filter for batch delete',
        });
    }
});

export type ListDomainMailboxInput = z.infer<typeof listDomainMailboxSchema>;
export type CreateDomainMailboxInput = z.infer<typeof createDomainMailboxSchema>;
export type UpdateDomainMailboxInput = z.infer<typeof updateDomainMailboxSchema>;
export type BatchCreateDomainMailboxInput = z.infer<typeof batchCreateDomainMailboxSchema>;
export type BatchDeleteDomainMailboxInput = z.infer<typeof batchDeleteDomainMailboxSchema>;

import { z } from 'zod';

const providerEnum = z.enum(['OUTLOOK', 'GMAIL', 'QQ']);
const authTypeEnum = z.enum(['MICROSOFT_OAUTH', 'GOOGLE_OAUTH', 'APP_PASSWORD']);
const emailStatusEnum = z.enum(['ACTIVE', 'ERROR', 'DISABLED']);
const clientSecretSchema = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.unknown());

function validateProviderCredentials(
    value: {
        provider: 'OUTLOOK' | 'GMAIL' | 'QQ';
        authType?: 'MICROSOFT_OAUTH' | 'GOOGLE_OAUTH' | 'APP_PASSWORD';
        clientId?: string | null;
        refreshToken?: string | null;
        password?: string | null;
    },
    ctx: z.RefinementCtx,
    isCreate = false
) {
    const authType = value.authType || (value.provider === 'QQ' ? 'APP_PASSWORD' : value.provider === 'GMAIL' ? 'GOOGLE_OAUTH' : 'MICROSOFT_OAUTH');

    if ((value.provider === 'OUTLOOK' || value.provider === 'GMAIL') && authType !== 'APP_PASSWORD') {
        if (isCreate && !value.clientId) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: `${value.provider} requires clientId` });
        }
        if (isCreate && !value.refreshToken) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refreshToken'], message: `${value.provider} requires refreshToken` });
        }
    }

    if (value.provider === 'QQ' || authType === 'APP_PASSWORD') {
        if (isCreate && !value.password) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: `${value.provider} requires password or authorization code` });
        }
    }
}

export const createEmailSchema = z.object({
    email: z.string().email(),
    provider: providerEnum.default('OUTLOOK'),
    authType: authTypeEnum.optional(),
    clientId: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    clientSecret: z.union([clientSecretSchema, z.literal('')]).optional(),
    password: z.string().min(1).optional(),
    groupId: z.coerce.number().int().positive().optional(),
    providerConfig: jsonObjectSchema.optional(),
    capabilities: jsonObjectSchema.optional(),
}).superRefine((value, ctx) => validateProviderCredentials(value, ctx, true));

export const updateEmailSchema = z.object({
    email: z.string().email().optional(),
    provider: providerEnum.optional(),
    authType: authTypeEnum.optional(),
    clientId: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    refreshToken: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    clientSecret: z.union([clientSecretSchema, z.literal(''), z.null()]).optional(),
    password: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    status: emailStatusEnum.optional(),
    groupId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    providerConfig: z.union([jsonObjectSchema, z.null()]).optional(),
    capabilities: z.union([jsonObjectSchema, z.null()]).optional(),
}).superRefine((value, ctx) => {
    if (!value.provider) return;
    validateProviderCredentials({
        provider: value.provider,
        authType: value.authType,
        clientId: typeof value.clientId === 'string' && value.clientId.trim() ? value.clientId : undefined,
        refreshToken: typeof value.refreshToken === 'string' && value.refreshToken.trim() ? value.refreshToken : undefined,
        password: typeof value.password === 'string' ? value.password : undefined,
    }, ctx, false);
});

export const listEmailSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(10),
    status: emailStatusEnum.optional(),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
    provider: providerEnum.optional(),
});

const emailMailboxEnum = z.enum(['INBOX', 'SENT', 'Junk']);
const clearableEmailMailboxEnum = z.enum(['INBOX', 'Junk']);

export const batchFetchMailboxesSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).optional(),
    status: emailStatusEnum.optional(),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
    provider: providerEnum.optional(),
    mailboxes: z.array(emailMailboxEnum).min(1).default(['INBOX', 'SENT', 'Junk']),
});

export const batchClearMailboxSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).optional(),
    status: emailStatusEnum.optional(),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
    provider: providerEnum.optional(),
    mailbox: clearableEmailMailboxEnum.default('INBOX'),
});

export const deleteSelectedMailsSchema = z.object({
    mailbox: emailMailboxEnum.default('INBOX'),
    messageIds: z.array(z.string().trim().min(1)).min(1),
});

export const importEmailSchema = z.object({
    content: z.string().min(1),
    separator: z.string().default('----'),
    groupId: z.coerce.number().int().positive().optional(),
});

export type CreateEmailInput = z.infer<typeof createEmailSchema>;
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
export type ListEmailInput = z.infer<typeof listEmailSchema>;
export type ImportEmailInput = z.infer<typeof importEmailSchema>;
export type BatchFetchMailboxesInput = z.infer<typeof batchFetchMailboxesSchema>;
export type BatchClearMailboxInput = z.infer<typeof batchClearMailboxSchema>;
export type DeleteSelectedMailsInput = z.infer<typeof deleteSelectedMailsSchema>;

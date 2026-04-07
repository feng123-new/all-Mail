import { z } from 'zod';
import {
    emailAuthTypes,
    emailProviders,
    getDefaultAuthType,
    getProviderProfileSummary,
    mergeProviderConfigForProfile,
    representativeProtocols,
    resolveProviderProfile,
    type EmailAuthType,
    type EmailProvider,
    type MailProviderConfig,
} from '../mail/providers/types.js';

const providerEnum = z.enum(emailProviders);
const authTypeEnum = z.enum(emailAuthTypes);
const representativeProtocolEnum = z.enum(representativeProtocols);
const emailStatusEnum = z.enum(['ACTIVE', 'ERROR', 'DISABLED']);
const clientSecretSchema = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.unknown());

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateImapSmtpProviderConfig(
    value: {
        provider: EmailProvider;
        authType?: EmailAuthType;
        providerConfig?: Record<string, unknown> | null;
    },
    ctx: z.RefinementCtx,
) {
    const authType = value.authType || getDefaultAuthType(value.provider);
    const profile = resolveProviderProfile(value.provider, authType);
    const profileSummary = getProviderProfileSummary(profile);

    if (profileSummary.capabilitySummary.usesOAuth) {
        return;
    }

    const mergedConfig = mergeProviderConfigForProfile(profile, value.providerConfig as MailProviderConfig | null | undefined);

    if (!isNonEmptyString(mergedConfig.imapHost)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providerConfig', 'imapHost'],
            message: `${value.provider} requires imapHost`,
        });
    }

    if (!isNonEmptyString(mergedConfig.smtpHost)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providerConfig', 'smtpHost'],
            message: `${value.provider} requires smtpHost`,
        });
    }

    if (mergedConfig.imapPort !== undefined && (!Number.isInteger(mergedConfig.imapPort) || mergedConfig.imapPort <= 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providerConfig', 'imapPort'],
            message: 'imapPort must be a positive integer',
        });
    }

    if (mergedConfig.smtpPort !== undefined && (!Number.isInteger(mergedConfig.smtpPort) || mergedConfig.smtpPort <= 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providerConfig', 'smtpPort'],
            message: 'smtpPort must be a positive integer',
        });
    }
}

function validateProviderCredentials(
    value: {
        provider: EmailProvider;
        authType?: EmailAuthType;
        clientId?: string | null;
        refreshToken?: string | null;
        password?: string | null;
    },
    ctx: z.RefinementCtx,
    isCreate = false
) {
    const authType = value.authType || getDefaultAuthType(value.provider);
    const profileSummary = getProviderProfileSummary(resolveProviderProfile(value.provider, authType));

    if (profileSummary.capabilitySummary.usesOAuth) {
        if (isCreate && !value.clientId) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: `${value.provider} requires clientId` });
        }
        if (isCreate && !value.refreshToken) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refreshToken'], message: `${value.provider} requires refreshToken` });
        }
    }

    if (!profileSummary.capabilitySummary.usesOAuth) {
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
    accountLoginPassword: z.string().min(1).optional(),
    groupId: z.coerce.number().int().positive().optional(),
    providerConfig: jsonObjectSchema.optional(),
    capabilities: jsonObjectSchema.optional(),
}).superRefine((value, ctx) => {
    validateProviderCredentials(value, ctx, true);
    validateImapSmtpProviderConfig(value, ctx);
});

export const updateEmailSchema = z.object({
    email: z.string().email().optional(),
    provider: providerEnum.optional(),
    authType: authTypeEnum.optional(),
    clientId: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    refreshToken: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    clientSecret: z.union([clientSecretSchema, z.literal(''), z.null()]).optional(),
    password: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    accountLoginPassword: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
    accountPasswordGrantToken: z.string().trim().min(1).optional(),
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

    validateImapSmtpProviderConfig({
        provider: value.provider,
        authType: value.authType,
        providerConfig: value.providerConfig && typeof value.providerConfig === 'object' && !Array.isArray(value.providerConfig)
            ? value.providerConfig as Record<string, unknown>
            : undefined,
    }, ctx);
});

export const listEmailSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(10),
    status: emailStatusEnum.optional(),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
    provider: providerEnum.optional(),
    representativeProtocol: representativeProtocolEnum.optional(),
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
    representativeProtocol: representativeProtocolEnum.optional(),
    mailboxes: z.array(emailMailboxEnum).min(1).default(['INBOX', 'SENT', 'Junk']),
});

export const batchClearMailboxSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).optional(),
    status: emailStatusEnum.optional(),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
    provider: providerEnum.optional(),
    representativeProtocol: representativeProtocolEnum.optional(),
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

const revealableEmailSecretFieldEnum = z.enum(['password', 'refreshToken', 'accountLoginPassword']);
const otpSchema = z.string().trim().regex(/^\d{6}$/, '请输入 6 位验证码');
const revealGrantTokenSchema = z.string().trim().min(1, '缺少临时授权令牌');

export const revealEmailUnlockSchema = z.object({
    otp: otpSchema,
});

export const revealEmailSecretsSchema = z.object({
    otp: otpSchema.optional(),
    grantToken: revealGrantTokenSchema.optional(),
    fields: z.array(revealableEmailSecretFieldEnum).min(1),
}).superRefine((value, ctx) => {
    if (!value.otp && !value.grantToken) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['otp'],
            message: '请输入验证码或提供临时授权令牌',
        });
    }
});

export type CreateEmailInput = z.infer<typeof createEmailSchema>;
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
export type ListEmailInput = z.infer<typeof listEmailSchema>;
export type ImportEmailInput = z.infer<typeof importEmailSchema>;
export type BatchFetchMailboxesInput = z.infer<typeof batchFetchMailboxesSchema>;
export type BatchClearMailboxInput = z.infer<typeof batchClearMailboxSchema>;
export type DeleteSelectedMailsInput = z.infer<typeof deleteSelectedMailsSchema>;
export type RevealEmailUnlockInput = z.infer<typeof revealEmailUnlockSchema>;
export type RevealEmailSecretsInput = z.infer<typeof revealEmailSecretsSchema>;

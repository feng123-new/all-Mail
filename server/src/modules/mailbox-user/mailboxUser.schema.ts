import { z } from 'zod';

export const mailboxUserStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

export const listMailboxUserSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().trim().optional(),
    status: mailboxUserStatusSchema.optional(),
});

export const createMailboxUserSchema = z.object({
    username: z.string().trim().min(3).max(100),
    email: z.string().trim().email().optional(),
    password: z.string().min(8),
    mailboxIds: z.array(z.coerce.number().int().positive()).default([]),
});

export const updateMailboxUserSchema = z.object({
    email: z.string().trim().email().nullable().optional(),
    status: mailboxUserStatusSchema.optional(),
    mustChangePassword: z.boolean().optional(),
    password: z.string().min(8).nullable().optional(),
    mailboxIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const addMailboxMembershipsSchema = z.object({
    mailboxIds: z.array(z.coerce.number().int().positive()).min(1),
});

export const mailboxPortalLoginSchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
});

export const mailboxPortalChangePasswordSchema = z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(8),
});

export const mailboxPortalUpdateForwardingSchema = z.object({
    mailboxId: z.coerce.number().int().positive(),
    forwardMode: z.enum(['DISABLED', 'COPY', 'MOVE']),
    forwardTo: z.string().trim().email().nullable().optional(),
});

export const mailboxPortalListSentMessagesSchema = z.object({
    mailboxId: z.coerce.number().int().positive(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const mailboxPortalListForwardingJobsSchema = z.object({
    mailboxId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(5),
});

export const mailboxPortalSendMessageSchema = z.object({
    mailboxId: z.coerce.number().int().positive(),
    to: z.array(z.string().trim().email()).min(1),
    subject: z.string().trim().min(1).max(500),
    html: z.string().trim().optional(),
    text: z.string().trim().optional(),
});

export type ListMailboxUserInput = z.infer<typeof listMailboxUserSchema>;
export type CreateMailboxUserInput = z.infer<typeof createMailboxUserSchema>;
export type UpdateMailboxUserInput = z.infer<typeof updateMailboxUserSchema>;
export type AddMailboxMembershipsInput = z.infer<typeof addMailboxMembershipsSchema>;
export type MailboxPortalLoginInput = z.infer<typeof mailboxPortalLoginSchema>;
export type MailboxPortalChangePasswordInput = z.infer<typeof mailboxPortalChangePasswordSchema>;
export type MailboxPortalUpdateForwardingInput = z.infer<typeof mailboxPortalUpdateForwardingSchema>;
export type MailboxPortalListSentMessagesInput = z.infer<typeof mailboxPortalListSentMessagesSchema>;
export type MailboxPortalListForwardingJobsInput = z.infer<typeof mailboxPortalListForwardingJobsSchema>;
export type MailboxPortalSendMessageInput = z.infer<typeof mailboxPortalSendMessageSchema>;

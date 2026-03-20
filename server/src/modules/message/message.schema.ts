import { z } from 'zod';

export const listDomainMessageSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    domainId: z.coerce.number().int().positive().optional(),
    mailboxId: z.coerce.number().int().positive().optional(),
    unreadOnly: z.coerce.boolean().default(false),
});

export const deleteDomainMessageSchema = z.object({
    ids: z.array(z.union([z.string().trim().min(1), z.number().int().positive()])).min(1),
});

export type ListDomainMessageInput = z.infer<typeof listDomainMessageSchema>;
export type DeleteDomainMessageInput = z.infer<typeof deleteDomainMessageSchema>;

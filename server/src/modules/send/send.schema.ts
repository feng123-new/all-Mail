import { z } from 'zod';

export const listSendConfigSchema = z.object({
    domainId: z.coerce.number().int().positive().optional(),
});

export const listOutboundMessageSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    domainId: z.coerce.number().int().positive().optional(),
    mailboxId: z.coerce.number().int().positive().optional(),
});

export const sendMessageSchema = z.object({
    domainId: z.coerce.number().int().positive(),
    mailboxId: z.coerce.number().int().positive().optional(),
    from: z.string().trim().email(),
    to: z.array(z.string().trim().email()).min(1),
    subject: z.string().trim().min(1).max(500),
    html: z.string().trim().optional(),
    text: z.string().trim().optional(),
});

export const deleteSendConfigSchema = z.object({
    id: z.coerce.number().int().positive(),
});

export const deleteOutboundMessageSchema = z.object({
    ids: z.array(z.union([z.string().trim().min(1), z.number().int().positive()])).min(1),
});

export type ListSendConfigInput = z.infer<typeof listSendConfigSchema>;
export type ListOutboundMessageInput = z.infer<typeof listOutboundMessageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type DeleteSendConfigInput = z.infer<typeof deleteSendConfigSchema>;
export type DeleteOutboundMessageInput = z.infer<typeof deleteOutboundMessageSchema>;

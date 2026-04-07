import { z } from 'zod';

export const forwardingJobStatusSchema = z.enum(['PENDING', 'RUNNING', 'SENT', 'FAILED', 'SKIPPED']);
export const forwardingJobModeSchema = z.enum(['COPY', 'MOVE']);

export const listForwardingJobSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: forwardingJobStatusSchema.optional(),
    mode: forwardingJobModeSchema.optional(),
    mailboxId: z.coerce.number().int().positive().optional(),
    domainId: z.coerce.number().int().positive().optional(),
    keyword: z.string().trim().min(1).max(255).optional(),
});

export const forwardingJobDetailSchema = z.object({
    id: z.string().trim().min(1),
});

export const requeueForwardingJobSchema = z.object({
    id: z.string().trim().min(1),
});

export type ListForwardingJobInput = z.infer<typeof listForwardingJobSchema>;
export type ForwardingJobDetailInput = z.infer<typeof forwardingJobDetailSchema>;
export type RequeueForwardingJobInput = z.infer<typeof requeueForwardingJobSchema>;

import { z } from 'zod';

export const ingressReceiveSchema = z.object({
    provider: z.string().trim().min(1),
    deliveryKey: z.string().trim().min(1).max(128),
    receivedAt: z.string().datetime(),
    envelope: z.object({
        from: z.string().trim().email(),
        to: z.string().trim().email(),
    }),
    routing: z.object({
        domain: z.string().trim().min(1),
        localPart: z.string().trim().min(1),
        matchedAddress: z.string().trim().email(),
    }),
    message: z.object({
        messageId: z.string().trim().optional().nullable(),
        subject: z.string().trim().optional().nullable(),
        textPreview: z.string().trim().optional().nullable(),
        htmlPreview: z.string().trim().optional().nullable(),
        headers: z.record(z.string(), z.string().optional()).optional(),
        attachments: z.array(z.object({
            filename: z.string().trim().optional().nullable(),
            contentType: z.string().trim().optional().nullable(),
            size: z.number().int().nonnegative().optional().nullable(),
            objectKey: z.string().trim().optional().nullable(),
        })).default([]),
        rawObjectKey: z.string().trim().optional().nullable(),
        storageStatus: z.enum(['PENDING', 'STORED', 'FAILED']).optional(),
    }),
});

export type IngressReceiveInput = z.infer<typeof ingressReceiveSchema>;

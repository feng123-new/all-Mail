import { z } from 'zod';

export const mailRequestSchema = z.object({
    email: z.string().email().optional(),
    auto: z.boolean().or(z.string().transform(v => v === 'true' || v === '1')).optional(),
    mailbox: z.string().default('inbox'),
    socks5: z.string().optional(),
    http: z.string().optional(),
});

export type MailRequestInput = z.infer<typeof mailRequestSchema>;

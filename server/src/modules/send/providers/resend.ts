import { Resend } from 'resend';

export interface ResendSendInput {
    apiKey: string;
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | null;
}

export async function sendWithResend(input: ResendSendInput): Promise<{ id: string | null }> {
    const resend = new Resend(input.apiKey);
    const payload = input.html
        ? {
            from: input.from,
            to: input.to,
            subject: input.subject,
            html: input.html,
            ...(input.text ? { text: input.text } : {}),
            ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        }
        : {
            from: input.from,
            to: input.to,
            subject: input.subject,
            text: input.text || '',
            ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
        throw new Error(error.message || 'Resend send failed');
    }

    return {
        id: data?.id || null,
    };
}

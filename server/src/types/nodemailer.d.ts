declare module 'nodemailer' {
    export function createTransport(options: unknown): {
        sendMail(input: unknown): Promise<{ messageId?: string | null }>;
    };
}

declare module 'nodemailer/lib/mail-composer/index.js' {
    export default class MailComposer {
        constructor(options: unknown);
        compile(): {
            build(): Promise<Buffer>;
        };
    }
}

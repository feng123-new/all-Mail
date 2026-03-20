import { mailProviderRegistry } from './providers/registry.js';
import type { MailCredentials, MailDeleteOptions, MailFetchOptions, MailProcessOptions, MailProviderRegistryLike, MailSendOptions } from './providers/types.js';

export function createMailFacade(registry: MailProviderRegistryLike) {
    return {
        getCapabilities(credentials: MailCredentials) {
            return registry.resolve(credentials).getCapabilities(credentials);
        },
        getEmails(credentials: MailCredentials, options: MailFetchOptions) {
            return registry.resolve(credentials).getEmails(credentials, options);
        },
        processMailbox(credentials: MailCredentials, options: MailProcessOptions) {
            return registry.resolve(credentials).processMailbox(credentials, options);
        },
        deleteMessages(credentials: MailCredentials, options: MailDeleteOptions) {
            return registry.resolve(credentials).deleteMessages(credentials, options);
        },
        sendEmail(credentials: MailCredentials, options: MailSendOptions) {
            return registry.resolve(credentials).sendEmail(credentials, options);
        },
    };
}

export const mailFacade = createMailFacade(mailProviderRegistry);

import { AppError } from '../../../plugins/error.js';
import { gmailMailAdapter } from './gmail.adapter.js';
import { outlookMailAdapter } from './outlook.adapter.js';
import { qqMailAdapter } from './qq.adapter.js';
import type { MailCredentials, MailProviderAdapter, MailProviderRegistryLike } from './types.js';

const providerMap = new Map<string, MailProviderAdapter>([
    [outlookMailAdapter.provider, outlookMailAdapter],
    [gmailMailAdapter.provider, gmailMailAdapter],
    [qqMailAdapter.provider, qqMailAdapter],
]);

export const mailProviderRegistry: MailProviderRegistryLike = {
    resolve(credentials: MailCredentials) {
        const adapter = providerMap.get(credentials.provider || 'OUTLOOK');
        if (!adapter) {
            throw new AppError('MAIL_PROVIDER_UNSUPPORTED', `Provider ${credentials.provider} is not supported`, 400);
        }
        return adapter;
    },
};

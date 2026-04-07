import { AppError } from '../../../plugins/error.js';
import { gmailMailAdapter } from './gmail.adapter.js';
import {
    aliyunMailAdapter,
    amazonWorkmailAdapter,
    aolMailAdapter,
    customImapSmtpMailAdapter,
    fastmailAdapter,
    gmxMailAdapter,
    icloudMailAdapter,
    mailcomMailAdapter,
    netease126MailAdapter,
    netease163MailAdapter,
    yahooMailAdapter,
    yandexMailAdapter,
    zohoMailAdapter,
} from './imap-smtp.adapter.js';
import { outlookMailAdapter } from './outlook.adapter.js';
import { qqMailAdapter } from './qq.adapter.js';
import type { MailCredentials, MailProviderAdapter, MailProviderRegistryLike } from './types.js';

const providerMap = new Map<string, MailProviderAdapter>([
    [outlookMailAdapter.provider, outlookMailAdapter],
    [gmailMailAdapter.provider, gmailMailAdapter],
    [qqMailAdapter.provider, qqMailAdapter],
    [netease163MailAdapter.provider, netease163MailAdapter],
    [netease126MailAdapter.provider, netease126MailAdapter],
    [icloudMailAdapter.provider, icloudMailAdapter],
    [yahooMailAdapter.provider, yahooMailAdapter],
    [zohoMailAdapter.provider, zohoMailAdapter],
    [aliyunMailAdapter.provider, aliyunMailAdapter],
    [amazonWorkmailAdapter.provider, amazonWorkmailAdapter],
    [fastmailAdapter.provider, fastmailAdapter],
    [aolMailAdapter.provider, aolMailAdapter],
    [gmxMailAdapter.provider, gmxMailAdapter],
    [mailcomMailAdapter.provider, mailcomMailAdapter],
    [yandexMailAdapter.provider, yandexMailAdapter],
    [customImapSmtpMailAdapter.provider, customImapSmtpMailAdapter],
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

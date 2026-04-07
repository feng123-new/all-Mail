import { AppError } from '../../../plugins/error.js';
import { enrichMailCredentials, getProviderProfileSummary, type EmailProvider, type MailCredentials, type MailDeleteOptions, type MailFetchOptions, type MailProcessOptions, type MailProfileDelegate, type MailProviderAdapter, type MailSendOptions, type RepresentativeProtocol } from './types.js';

function resolveDelegate(provider: EmailProvider, delegates: MailProfileDelegate[], credentials: MailCredentials): {
    delegate: MailProfileDelegate;
    credentials: MailCredentials;
    family: RepresentativeProtocol;
} {
    const enriched = enrichMailCredentials({
        ...credentials,
        provider,
    });
    const delegate = delegates.find((candidate) => candidate.profile === enriched.providerProfile);
    if (!delegate) {
        throw new AppError('MAIL_PROVIDER_PROFILE_UNSUPPORTED', `Provider ${provider} does not support profile ${enriched.providerProfile}`, 400);
    }
    const providerProfile = enriched.providerProfile;
    if (!providerProfile) {
        throw new AppError('MAIL_PROVIDER_PROFILE_UNSUPPORTED', `Provider ${provider} does not have a resolved profile`, 400);
    }
    const profileSummary = getProviderProfileSummary(providerProfile);
    return {
        delegate,
        credentials: enriched,
        family: enriched.representativeProtocol || profileSummary.representativeProtocol,
    };
}

export function createFamilyAwareProviderAdapter(provider: EmailProvider, delegates: MailProfileDelegate[]): MailProviderAdapter {
    return {
        provider,
        getCapabilities(credentials: MailCredentials) {
            const { delegate, credentials: enriched } = resolveDelegate(provider, delegates, credentials);
            return delegate.getCapabilities(enriched);
        },
        getEmails(credentials: MailCredentials, options: MailFetchOptions) {
            const { delegate, credentials: enriched } = resolveDelegate(provider, delegates, credentials);
            return delegate.getEmails(enriched, options);
        },
        processMailbox(credentials: MailCredentials, options: MailProcessOptions) {
            const { delegate, credentials: enriched } = resolveDelegate(provider, delegates, credentials);
            return delegate.processMailbox(enriched, options);
        },
        deleteMessages(credentials: MailCredentials, options: MailDeleteOptions) {
            const { delegate, credentials: enriched } = resolveDelegate(provider, delegates, credentials);
            return delegate.deleteMessages(enriched, options);
        },
        sendEmail(credentials: MailCredentials, options: MailSendOptions) {
            const { delegate, credentials: enriched } = resolveDelegate(provider, delegates, credentials);
            return delegate.sendEmail(enriched, options);
        },
    };
}

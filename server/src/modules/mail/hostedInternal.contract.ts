import { createProtocolCapabilityMatrix, type MailProtocolSummary, type ProviderProfileCapabilities } from './providers/types.js';

export type HostedInternalProfile = 'hosted-internal-manual' | 'hosted-internal-api-pool';

export interface HostedInternalCapabilitySummary extends ProviderProfileCapabilities {
    receiveMail: boolean;
    apiAccess: boolean;
    forwarding: boolean;
}

export type HostedInternalProtocolSummary = MailProtocolSummary<HostedInternalProfile, HostedInternalCapabilitySummary>;

export interface HostedInternalContext {
    provisioningMode: 'MANUAL' | 'API_POOL';
    canSend: boolean;
    canReceive: boolean;
}

const HOSTED_INTERNAL_SUMMARY_HINTS: Record<HostedInternalProfile, string> = {
    'hosted-internal-manual': 'Hosted Internal · MANUAL：适合人工维护或门户运营的站内邮箱，由内部域名收件链路统一承载。',
    'hosted-internal-api-pool': 'Hosted Internal · API_POOL：适合 API 池自动分配的站内邮箱，由内部域名收件链路统一承载。',
};

export function resolveHostedInternalProfile(provisioningMode: HostedInternalContext['provisioningMode']): HostedInternalProfile {
    return provisioningMode === 'API_POOL' ? 'hosted-internal-api-pool' : 'hosted-internal-manual';
}

export function getHostedInternalProtocolSummary(context: HostedInternalContext): HostedInternalProtocolSummary {
    const profile = resolveHostedInternalProfile(context.provisioningMode);

    return {
        providerProfile: profile,
        representativeProtocol: 'hosted_internal',
        secondaryProtocols: [],
        profileSummaryHint: HOSTED_INTERNAL_SUMMARY_HINTS[profile],
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: context.canReceive,
            clearMailbox: true,
            sendMail: context.canSend,
            usesOAuth: false,
            receiveMail: context.canReceive,
            apiAccess: context.provisioningMode === 'API_POOL',
            forwarding: true,
        }),
    };
}

export function enrichHostedInternalRecord<T extends HostedInternalContext>(record: T): T & HostedInternalProtocolSummary {
    return {
        ...record,
        ...getHostedInternalProtocolSummary(record),
    };
}

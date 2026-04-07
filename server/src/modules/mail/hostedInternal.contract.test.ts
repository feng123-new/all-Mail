import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichHostedInternalRecord, getHostedInternalProtocolSummary, resolveHostedInternalProfile } from './hostedInternal.contract.js';

void test('resolveHostedInternalProfile distinguishes manual and API pool mailboxes', () => {
    assert.equal(resolveHostedInternalProfile('MANUAL'), 'hosted-internal-manual');
    assert.equal(resolveHostedInternalProfile('API_POOL'), 'hosted-internal-api-pool');
});

void test('hosted internal protocol summary reflects domain send and receive capabilities', () => {
    assert.deepEqual(getHostedInternalProtocolSummary({
        provisioningMode: 'API_POOL',
        canSend: true,
        canReceive: true,
    }), {
        providerProfile: 'hosted-internal-api-pool',
        representativeProtocol: 'hosted_internal',
        secondaryProtocols: [],
        profileSummaryHint: 'Hosted Internal · API_POOL：适合 API 池自动分配的站内邮箱，由内部域名收件链路统一承载。',
        capabilitySummary: {
            readInbox: true,
            readJunk: false,
            readSent: false,
            clearMailbox: true,
            sendMail: true,
            usesOAuth: false,
            receiveMail: true,
            apiAccess: true,
            forwarding: true,
            search: false,
            refreshToken: false,
            webhook: false,
            aliasSupport: false,
            modes: [],
        },
    });
});

void test('enrichHostedInternalRecord appends protocol contract fields', () => {
    const result = enrichHostedInternalRecord({
        provisioningMode: 'MANUAL' as const,
        canSend: false,
        canReceive: true,
        address: 'ops@example.com',
    });

    assert.equal(result.providerProfile, 'hosted-internal-manual');
    assert.equal(result.representativeProtocol, 'hosted_internal');
    assert.deepEqual(result.secondaryProtocols, []);
    assert.equal(result.capabilitySummary.sendMail, false);
    assert.equal(result.address, 'ops@example.com');
});

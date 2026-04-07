import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichMailCredentials, getCapabilitiesForProfile, getImportProviderConfigForProfile, getImportTokenForProfile, getProfilesForRepresentativeProtocol, getProviderProfileSummary, getRepresentativeProtocol, getSecondaryProtocols, resolveProviderProfile, resolveProviderProfileByImportToken } from './types.js';

void test('resolveProviderProfile maps Gmail OAuth and app password to different profiles', () => {
    assert.equal(resolveProviderProfile('GMAIL', 'GOOGLE_OAUTH'), 'gmail-oauth');
    assert.equal(resolveProviderProfile('GMAIL', 'APP_PASSWORD'), 'gmail-app-password');
});

void test('resolveProviderProfile preserves provider-first fallback behavior for mismatched auth types', () => {
    assert.equal(resolveProviderProfile('OUTLOOK', 'APP_PASSWORD'), 'outlook-oauth');
    assert.equal(resolveProviderProfile('QQ', 'GOOGLE_OAUTH'), 'qq-imap-smtp');
});

void test('representative protocol follows the chosen profile rather than provider label', () => {
    assert.equal(getRepresentativeProtocol('OUTLOOK', 'MICROSOFT_OAUTH'), 'oauth_api');
    assert.equal(getRepresentativeProtocol('GMAIL', 'APP_PASSWORD'), 'imap_smtp');
    assert.deepEqual(getSecondaryProtocols('GMAIL', 'GOOGLE_OAUTH'), ['imap']);
});

void test('enrichMailCredentials injects derived profile metadata', () => {
    const credentials = enrichMailCredentials({
        id: 1,
        email: 'gmail@example.com',
        provider: 'GMAIL',
        authType: 'APP_PASSWORD',
        password: 'secret',
        autoAssigned: false,
    });

    assert.equal(credentials.providerProfile, 'gmail-app-password');
    assert.equal(credentials.representativeProtocol, 'imap_smtp');
    assert.deepEqual(credentials.secondaryProtocols, ['smtp']);
    assert.equal(getImportTokenForProfile(credentials.providerProfile), 'GMAIL_APP_PASSWORD');
});

void test('provider profile summary exposes unified protocol metadata and capabilities', () => {
    assert.deepEqual(getProviderProfileSummary('gmail-app-password'), {
        providerProfile: 'gmail-app-password',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        profileSummaryHint: 'Gmail 应用专用密码归类为 IMAP / SMTP',
        capabilitySummary: {
            readInbox: true,
            readJunk: true,
            readSent: true,
            clearMailbox: false,
            sendMail: true,
            usesOAuth: false,
            receiveMail: true,
            apiAccess: false,
            forwarding: false,
            search: false,
            refreshToken: false,
            webhook: false,
            aliasSupport: false,
            modes: ['IMAP', 'SMTP'],
        },
    });
});

void test('import tokens resolve through the provider profile registry', () => {
    assert.equal(resolveProviderProfileByImportToken('GMAIL_APP_PASSWORD'), 'gmail-app-password');
    assert.equal(resolveProviderProfileByImportToken('GMAIL'), 'gmail-oauth');
    assert.equal(resolveProviderProfileByImportToken('OUTLOOK_OAUTH'), 'outlook-oauth');
    assert.equal(resolveProviderProfileByImportToken('QQ'), 'qq-imap-smtp');
    assert.equal(resolveProviderProfileByImportToken('ICLOUD_IMAP_SMTP'), 'icloud-imap-smtp');
    assert.equal(resolveProviderProfileByImportToken('missing-token'), null);
    assert.equal(getImportProviderConfigForProfile('gmail-app-password').readMode, 'IMAP');
    assert.equal(getImportProviderConfigForProfile('icloud-imap-smtp').smtpHost, 'smtp.mail.me.com');
});

void test('profile capability summary matches clear/send expectations', () => {
    assert.deepEqual(getCapabilitiesForProfile('outlook-oauth'), {
        readInbox: true,
        readJunk: true,
        readSent: true,
        clearMailbox: true,
        sendMail: true,
        usesOAuth: true,
        receiveMail: true,
        apiAccess: false,
        forwarding: false,
        search: false,
        refreshToken: true,
        webhook: false,
        aliasSupport: false,
        modes: ['GRAPH_API', 'IMAP'],
    });
    assert.deepEqual(getCapabilitiesForProfile('qq-imap-smtp'), {
        readInbox: true,
        readJunk: true,
        readSent: true,
        clearMailbox: false,
        sendMail: true,
        usesOAuth: false,
        receiveMail: true,
        apiAccess: false,
        forwarding: false,
        search: false,
        refreshToken: false,
        webhook: false,
        aliasSupport: false,
        modes: ['IMAP', 'SMTP'],
    });
});

void test('representative protocol resolves to the expected provider profiles', () => {
    assert.deepEqual(getProfilesForRepresentativeProtocol('oauth_api'), ['outlook-oauth', 'gmail-oauth']);
    assert.deepEqual(getProfilesForRepresentativeProtocol('imap_smtp'), [
        'gmail-app-password',
        'qq-imap-smtp',
        'netease-163-imap-smtp',
        'netease-126-imap-smtp',
        'icloud-imap-smtp',
        'yahoo-imap-smtp',
        'zoho-imap-smtp',
        'aliyun-imap-smtp',
        'amazon-workmail-imap-smtp',
        'fastmail-imap-smtp',
        'aol-imap-smtp',
        'gmx-imap-smtp',
        'mailcom-imap-smtp',
        'yandex-imap-smtp',
        'custom-imap-smtp',
    ]);
    assert.deepEqual(getProfilesForRepresentativeProtocol('hosted_internal'), []);
});

void test('new imap_smtp providers resolve to dedicated profiles', () => {
    assert.equal(resolveProviderProfile('NETEASE_163', 'APP_PASSWORD'), 'netease-163-imap-smtp');
    assert.equal(resolveProviderProfile('NETEASE_126', 'APP_PASSWORD'), 'netease-126-imap-smtp');
    assert.equal(resolveProviderProfile('ICLOUD', 'APP_PASSWORD'), 'icloud-imap-smtp');
    assert.equal(resolveProviderProfile('YAHOO', 'APP_PASSWORD'), 'yahoo-imap-smtp');
    assert.equal(resolveProviderProfile('ZOHO', 'APP_PASSWORD'), 'zoho-imap-smtp');
    assert.equal(resolveProviderProfile('ALIYUN', 'APP_PASSWORD'), 'aliyun-imap-smtp');
    assert.equal(resolveProviderProfile('AMAZON_WORKMAIL', 'APP_PASSWORD'), 'amazon-workmail-imap-smtp');
    assert.equal(resolveProviderProfile('FASTMAIL', 'APP_PASSWORD'), 'fastmail-imap-smtp');
    assert.equal(resolveProviderProfile('AOL', 'APP_PASSWORD'), 'aol-imap-smtp');
    assert.equal(resolveProviderProfile('GMX', 'APP_PASSWORD'), 'gmx-imap-smtp');
    assert.equal(resolveProviderProfile('MAILCOM', 'APP_PASSWORD'), 'mailcom-imap-smtp');
    assert.equal(resolveProviderProfile('YANDEX', 'APP_PASSWORD'), 'yandex-imap-smtp');
    assert.equal(resolveProviderProfile('CUSTOM_IMAP_SMTP', 'APP_PASSWORD'), 'custom-imap-smtp');
});

void test('extended imap providers expose expected import defaults', () => {
    assert.equal(getImportProviderConfigForProfile('fastmail-imap-smtp').imapHost, 'imap.fastmail.com');
    assert.equal(getImportProviderConfigForProfile('gmx-imap-smtp').smtpPort, 587);
    assert.equal(getImportProviderConfigForProfile('mailcom-imap-smtp').smtpSecure, false);
    assert.equal(getImportProviderConfigForProfile('custom-imap-smtp').imapHost, undefined);
});

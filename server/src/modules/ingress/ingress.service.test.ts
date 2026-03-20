import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVerificationCode } from './ingress.service.js';

void test('extractVerificationCode returns first 6-digit code from text', () => {
    assert.equal(extractVerificationCode('Your code is 123456, please verify.', null), '123456');
});

void test('extractVerificationCode falls back to html content', () => {
    assert.equal(extractVerificationCode(null, '<p>Use 987654 to continue</p>'), '987654');
});

void test('extractVerificationCode returns null when no code exists', () => {
    assert.equal(extractVerificationCode('hello world', '<p>no verification code</p>'), null);
});

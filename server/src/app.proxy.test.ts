import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { FASTIFY_TRUST_PROXY_HOPS } from './app.js';

void test('Fastify derives request.ip from exactly one canonical Go proxy hop', async () => {
    assert.equal(FASTIFY_TRUST_PROXY_HOPS, 1);

    const app = Fastify({
        logger: false,
        trustProxy: FASTIFY_TRUST_PROXY_HOPS,
    });
    app.get('/ip', async (request) => ({ ip: request.ip }));

    const response = await app.inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '172.18.0.4',
        headers: {
            'x-forwarded-for': '198.51.100.24',
        },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ip, '198.51.100.24');
    await app.close();
});

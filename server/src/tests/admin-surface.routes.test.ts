import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import type { Prisma } from '@prisma/client';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function toPrismaPromise<T>(value: T): Prisma.PrismaPromise<T> {
  return Promise.resolve(value) as Prisma.PrismaPromise<T>;
}

async function createAdminToken(adminId: number, role: 'ADMIN' | 'SUPER_ADMIN') {
  const { signToken } = await import('../lib/jwt.js');
  return signToken({
    sub: String(adminId),
    username: 'admin-user',
    role,
  }, { audience: 'admin-console' });
}

async function mockAdminAuthContext(role: 'ADMIN' | 'SUPER_ADMIN') {
  const { default: prisma } = await import('../lib/prisma.js');
  const originalFindUnique = prisma.admin.findUnique.bind(prisma.admin);
  const findUniqueMock: typeof prisma.admin.findUnique = () => toPrismaPromise({
    id: 1,
    username: 'admin-user',
    role,
    status: 'ACTIVE',
    mustChangePassword: false,
    twoFactorEnabled: false,
  });

  prisma.admin.findUnique = findUniqueMock;

  return () => {
    prisma.admin.findUnique = originalFindUnique;
  };
}

void test('admin, api-key, and domain mailbox routes reject unauthenticated access', async () => {
  const { buildApp } = await import('../app.js');
  const app = await buildApp();

  try {
    const [adminResponse, apiKeyResponse, domainMailboxResponse] = await Promise.all([
      app.inject({ method: 'GET', url: '/admin/admins' }),
      app.inject({ method: 'GET', url: '/admin/api-keys' }),
      app.inject({ method: 'GET', url: '/admin/domain-mailboxes' }),
    ]);

    assert.equal(adminResponse.statusCode, 401);
    assert.equal(apiKeyResponse.statusCode, 401);
    assert.equal(domainMailboxResponse.statusCode, 401);
    assert.equal(JSON.parse(adminResponse.payload).error.code, 'UNAUTHORIZED');
    assert.equal(JSON.parse(apiKeyResponse.payload).error.code, 'UNAUTHORIZED');
    assert.equal(JSON.parse(domainMailboxResponse.payload).error.code, 'UNAUTHORIZED');
  } finally {
    await app.close();
  }
});

void test('admin routes remain super-admin only after JWT auth succeeds', async () => {
  const { buildApp } = await import('../app.js');
  const restoreAdminFindUnique = await mockAdminAuthContext('ADMIN');
  const app = await buildApp();

  try {
    const token = await createAdminToken(1, 'ADMIN');
    const response = await app.inject({
      method: 'GET',
      url: '/admin/admins',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(response.payload).error.code, 'FORBIDDEN');
  } finally {
    restoreAdminFindUnique();
    await app.close();
  }
});

void test('admin routes return standard success envelopes for authenticated super-admin reads', async () => {
  const [{ buildApp }, { adminService }] = await Promise.all([
    import('../app.js'),
    import('../modules/admin/admin.service.js'),
  ]);

  const restoreAdminFindUnique = await mockAdminAuthContext('SUPER_ADMIN');
  let capturedListInput: unknown;
  let capturedDetailId: unknown;

  mock.method(adminService, 'list', async (input: unknown) => {
    capturedListInput = input;
    return {
      list: [{ id: 7, username: 'root', role: 'SUPER_ADMIN' }],
      total: 1,
      page: 2,
      pageSize: 5,
    };
  });
  mock.method(adminService, 'getById', async (id: number) => {
    capturedDetailId = id;
    return {
      id,
      username: 'root',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    };
  });

  const app = await buildApp();
  try {
    const token = await createAdminToken(1, 'SUPER_ADMIN');
    const [listResponse, detailResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/admin/admins?page=2&pageSize=5&keyword=root',
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: 'GET',
        url: '/admin/admins/7',
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);

    assert.equal(listResponse.statusCode, 200);
    assert.equal(detailResponse.statusCode, 200);
    assert.deepEqual(capturedListInput, { page: 2, pageSize: 5, keyword: 'root' });
    assert.equal(capturedDetailId, 7);
    assert.deepEqual(JSON.parse(listResponse.payload), {
      success: true,
      data: {
        list: [{ id: 7, username: 'root', role: 'SUPER_ADMIN' }],
        total: 1,
        page: 2,
        pageSize: 5,
      },
    });
    assert.deepEqual(JSON.parse(detailResponse.payload), {
      success: true,
      data: {
        id: 7,
        username: 'root',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });
  } finally {
    restoreAdminFindUnique();
    mock.restoreAll();
    await app.close();
  }
});

void test('api-key and domain-mailbox routes return success envelopes for authenticated admins', async () => {
  const [{ buildApp }, { apiKeyService }, { domainMailboxService }] = await Promise.all([
    import('../app.js'),
    import('../modules/api-key/apiKey.service.js'),
    import('../modules/domain-mailbox/domainMailbox.service.js'),
  ]);

  const restoreAdminFindUnique = await mockAdminAuthContext('ADMIN');
  let capturedApiKeyListInput: unknown;
  let capturedApiKeyDetailId: unknown;
  let capturedMailboxListInput: unknown;
  let capturedMailboxDetailId: unknown;

  mock.method(apiKeyService, 'list', async (input: unknown) => {
    capturedApiKeyListInput = input;
    return {
      list: [{ id: 11, name: 'ops-key', status: 'ACTIVE' }],
      total: 1,
      page: 2,
      pageSize: 5,
    };
  });
  mock.method(apiKeyService, 'getById', async (id: number) => {
    capturedApiKeyDetailId = id;
    return {
      id,
      name: 'ops-key',
      keyPrefix: 'ops_',
      status: 'ACTIVE',
    };
  });
  mock.method(domainMailboxService, 'list', async (input: unknown) => {
    capturedMailboxListInput = input;
    return {
      list: [{ id: 9, address: 'ops@example.com', status: 'ACTIVE' }],
      total: 1,
      page: 3,
      pageSize: 20,
    };
  });
  mock.method(domainMailboxService, 'getById', async (id: number) => {
    capturedMailboxDetailId = id;
    return {
      id,
      domainId: 5,
      localPart: 'ops',
      address: 'ops@example.com',
      status: 'ACTIVE',
    };
  });

  const app = await buildApp();
  try {
    const token = await createAdminToken(1, 'ADMIN');
    const [apiKeyListResponse, apiKeyDetailResponse, mailboxListResponse, mailboxDetailResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/admin/api-keys?page=2&pageSize=5&status=ACTIVE&keyword=ops',
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: 'GET',
        url: '/admin/api-keys/11',
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: 'GET',
        url: '/admin/domain-mailboxes?page=3&pageSize=20&domainId=5&status=ACTIVE&batchTag=batch-1&provisioningMode=API_POOL',
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: 'GET',
        url: '/admin/domain-mailboxes/9',
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);

    assert.equal(apiKeyListResponse.statusCode, 200);
    assert.equal(apiKeyDetailResponse.statusCode, 200);
    assert.equal(mailboxListResponse.statusCode, 200);
    assert.equal(mailboxDetailResponse.statusCode, 200);
    assert.deepEqual(capturedApiKeyListInput, { page: 2, pageSize: 5, status: 'ACTIVE', keyword: 'ops' });
    assert.equal(capturedApiKeyDetailId, 11);
    assert.deepEqual(capturedMailboxListInput, {
      page: 3,
      pageSize: 20,
      domainId: 5,
      status: 'ACTIVE',
      batchTag: 'batch-1',
      provisioningMode: 'API_POOL',
    });
    assert.equal(capturedMailboxDetailId, 9);
    assert.deepEqual(JSON.parse(apiKeyListResponse.payload), {
      success: true,
      data: {
        list: [{ id: 11, name: 'ops-key', status: 'ACTIVE' }],
        total: 1,
        page: 2,
        pageSize: 5,
      },
    });
    assert.deepEqual(JSON.parse(apiKeyDetailResponse.payload), {
      success: true,
      data: {
        id: 11,
        name: 'ops-key',
        keyPrefix: 'ops_',
        status: 'ACTIVE',
      },
    });
    assert.deepEqual(JSON.parse(mailboxListResponse.payload), {
      success: true,
      data: {
        list: [{ id: 9, address: 'ops@example.com', status: 'ACTIVE' }],
        total: 1,
        page: 3,
        pageSize: 20,
      },
    });
    assert.deepEqual(JSON.parse(mailboxDetailResponse.payload), {
      success: true,
      data: {
        id: 9,
        domainId: 5,
        localPart: 'ops',
        address: 'ops@example.com',
        status: 'ACTIVE',
      },
    });
  } finally {
    restoreAdminFindUnique();
    mock.restoreAll();
    await app.close();
  }
});

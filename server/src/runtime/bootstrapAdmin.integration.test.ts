import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { bootstrapAdministrator } from './bootstrapAdmin.js';

const databaseUrl = process.env.ALLMAIL_BOOTSTRAP_ADMIN_TEST_DATABASE_URL?.trim();

void test(
    'one-shot administrator bootstrap is idempotent and retires consumed plaintext',
    { skip: !databaseUrl },
    async () => {
        const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-bootstrap-admin-'));
        const bootstrapFile = path.join(stateDir, 'bootstrap-admin.env');
        const prisma = new PrismaClient({
            datasources: { db: { url: databaseUrl } },
        });

        try {
            await prisma.admin.deleteMany();
            const environment = {
                DATABASE_URL: databaseUrl,
                BOOTSTRAP_ADMIN_SECRET_FILE: bootstrapFile,
                ADMIN_USERNAME: 'integration-admin',
                ADMIN_PASSWORD: '',
            } as NodeJS.ProcessEnv;

            const first = await bootstrapAdministrator(prisma, environment);
            assert.equal(first.created, true);
            assert.equal(first.username, 'integration-admin');
            assert.equal(first.mustChangePassword, true);
            assert.equal(first.secretAvailable, true);
            assert.ok(first.password);

            const storedFile = await readFile(bootstrapFile, 'utf8');
            assert.match(storedFile, /ADMIN_USERNAME=integration-admin/);
            assert.match(storedFile, /ADMIN_PASSWORD=/);

            const admin = await prisma.admin.findUniqueOrThrow({
                where: { username: 'integration-admin' },
                select: {
                    id: true,
                    passwordHash: true,
                    mustChangePassword: true,
                },
            });
            assert.equal(admin.mustChangePassword, true);
            assert.equal(await bcrypt.compare(first.password!, admin.passwordHash), true);

            const second = await bootstrapAdministrator(prisma, {
                ...environment,
                ADMIN_USERNAME: 'different-admin',
                ADMIN_PASSWORD: 'different-password',
            });
            assert.equal(second.created, false);
            assert.equal(await prisma.admin.count(), 1);
            assert.equal(second.secretAvailable, true);

            await prisma.admin.update({
                where: { id: admin.id },
                data: { mustChangePassword: false },
            });
            const third = await bootstrapAdministrator(prisma, environment);
            assert.equal(third.created, false);
            assert.equal(third.mustChangePassword, false);
            assert.equal(third.secretAvailable, false);
            await assert.rejects(access(bootstrapFile));
        } finally {
            await prisma.$disconnect();
        }
    },
);

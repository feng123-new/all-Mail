import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient, Role, Status } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BOOTSTRAP_LOCK_NAMESPACE = 421337;
const BOOTSTRAP_LOCK_KEY = 240730;
const DEFAULT_BOOTSTRAP_FILE = '/var/lib/all-mail/bootstrap-admin.env';
const PLACEHOLDER_PREFIXES = ['replace-with-', 'changeme-', 'example-'];
const SALT_ROUNDS = 10;

interface BootstrapCredential {
    username: string;
    password: string;
    source: 'file' | 'environment' | 'generated';
}

interface BootstrapResult {
    created: boolean;
    username: string | null;
    mustChangePassword: boolean;
    secretAvailable: boolean;
    password?: string;
    passwordSource?: BootstrapCredential['source'];
}

function isMissing(value: unknown): boolean {
    if (typeof value !== 'string') {
        return true;
    }
    const normalized = value.trim();
    if (!normalized) {
        return true;
    }
    return PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseEnvText(content: string): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const value = line.slice(separatorIndex + 1).trim();
        const first = value[0];
        const last = value[value.length - 1];
        entries[line.slice(0, separatorIndex).trim()] = value.length >= 2
            && ((first === '"' && last === '"') || (first === "'" && last === "'"))
            ? value.slice(1, -1)
            : value;
    }
    return entries;
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath, fsConstants.R_OK);
        return true;
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function readBootstrapFile(targetPath: string): Promise<Record<string, string>> {
    if (!(await pathExists(targetPath))) {
        return {};
    }
    return parseEnvText(await readFile(targetPath, 'utf8'));
}

async function writeBootstrapFile(targetPath: string, credential: BootstrapCredential): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const content = [
        '# One-time all-Mail bootstrap administrator credential',
        '# Delete this file only after the administrator password has been changed.',
        `ADMIN_USERNAME=${credential.username}`,
        `ADMIN_PASSWORD=${credential.password}`,
        '',
    ].join('\n');
    const temporaryPath = `${targetPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, targetPath);
}

function validateCredential(credential: BootstrapCredential): BootstrapCredential {
    if (credential.username.length < 1 || credential.username.length > 50) {
        throw new Error('ADMIN_USERNAME must contain between 1 and 50 characters');
    }
    if (/\r|\n/.test(credential.username)) {
        throw new Error('ADMIN_USERNAME must not contain line breaks');
    }
    if (credential.password.length < 8) {
        throw new Error('ADMIN_PASSWORD must contain at least 8 characters');
    }
    if (/\r|\n/.test(credential.password)) {
        throw new Error('ADMIN_PASSWORD must not contain line breaks');
    }
    return credential;
}

export function resolveBootstrapCredential(
    fileEntries: Record<string, string>,
    environment: NodeJS.ProcessEnv,
): BootstrapCredential {
    for (const [name, value] of [
        ['ADMIN_USERNAME', environment.ADMIN_USERNAME],
        ['ADMIN_PASSWORD', environment.ADMIN_PASSWORD],
    ] as const) {
        if (typeof value !== 'string') {
            continue;
        }
        if (/\r|\n/.test(value)) {
            throw new Error(`${name} must not contain line breaks`);
        }
        const normalized = value.trim();
        if (normalized && (/^['"]/.test(normalized) || /['"]$/.test(normalized))) {
            throw new Error(`${name} must not start or end with a quote`);
        }
    }
    const environmentUsername = environment.ADMIN_USERNAME?.trim() ?? '';
    const environmentPassword = environment.ADMIN_PASSWORD?.trim() ?? '';

    if (!isMissing(fileEntries.ADMIN_PASSWORD)) {
        return validateCredential({
            username: !isMissing(fileEntries.ADMIN_USERNAME)
                ? fileEntries.ADMIN_USERNAME.trim()
                : 'admin',
            password: fileEntries.ADMIN_PASSWORD.trim(),
            source: 'file',
        });
    }

    if (!isMissing(environmentPassword)) {
        return validateCredential({
            username: !isMissing(environmentUsername)
                ? environmentUsername
                : 'admin',
            password: environmentPassword,
            source: 'environment',
        });
    }

    return validateCredential({
        username: !isMissing(environmentUsername)
            ? environmentUsername
            : 'admin',
        password: randomBytes(18).toString('base64url'),
        source: 'generated',
    });
}

function resolveLoginUrl(environment: NodeJS.ProcessEnv): string {
    const publicBaseURL = environment.PUBLIC_BASE_URL?.trim() ?? '';
    const base = !isMissing(publicBaseURL)
        ? publicBaseURL.replace(/\/+$/, '')
        : `http://127.0.0.1:${environment.APP_PORT?.trim() || '3002'}`;
    return `${base}/login`;
}

async function matchExistingBootstrapAdmin(
    admins: Array<{
        id: number;
        username: string;
        passwordHash: string;
        mustChangePassword: boolean;
    }>,
    fileEntries: Record<string, string>,
) {
    const password = fileEntries.ADMIN_PASSWORD?.trim();
    if (isMissing(password)) {
        return null;
    }

    const requestedUsername = fileEntries.ADMIN_USERNAME?.trim();
    if (requestedUsername) {
        const named = admins.find((admin) => admin.username === requestedUsername);
        if (
            named?.mustChangePassword
            && await bcrypt.compare(password, named.passwordHash)
        ) {
            return named;
        }
    }

    for (const admin of admins) {
        if (!admin.mustChangePassword) {
            continue;
        }
        if (await bcrypt.compare(password, admin.passwordHash)) {
            return admin;
        }
    }
    return null;
}

export async function bootstrapAdministrator(
    prisma: PrismaClient,
    environment: NodeJS.ProcessEnv = process.env,
): Promise<BootstrapResult> {
    const bootstrapFile = environment.BOOTSTRAP_ADMIN_SECRET_FILE?.trim() || DEFAULT_BOOTSTRAP_FILE;

    return prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
            SELECT pg_advisory_xact_lock(
                CAST(${BOOTSTRAP_LOCK_NAMESPACE} AS integer),
                CAST(${BOOTSTRAP_LOCK_KEY} AS integer)
            )
        `;

        const admins = await transaction.admin.findMany({
            select: {
                id: true,
                username: true,
                passwordHash: true,
                mustChangePassword: true,
            },
            orderBy: { id: 'asc' },
        });

        if (admins.length > 0) {
            const fileEntries = await readBootstrapFile(bootstrapFile);
            const matching = await matchExistingBootstrapAdmin(admins, fileEntries);
            const shouldKeepFile = Boolean(matching);

            if (matching) {
                const storedUsername = fileEntries.ADMIN_USERNAME?.trim();
                if (storedUsername !== matching.username) {
                    await writeBootstrapFile(bootstrapFile, {
                        username: matching.username,
                        password: fileEntries.ADMIN_PASSWORD.trim(),
                        source: 'file',
                    });
                }
            } else {
                await rm(bootstrapFile, { force: true });
            }

            const pending = matching ?? admins.find((admin) => admin.mustChangePassword);
            return {
                created: false,
                username: pending?.username ?? admins[0].username,
                mustChangePassword: Boolean(pending),
                secretAvailable: shouldKeepFile,
            };
        }

        const existingFile = await readBootstrapFile(bootstrapFile);
        const credential = resolveBootstrapCredential(existingFile, environment);
        await writeBootstrapFile(bootstrapFile, credential);
        const passwordHash = await bcrypt.hash(credential.password, SALT_ROUNDS);

        const created = await transaction.admin.create({
            data: {
                username: credential.username,
                passwordHash,
                role: Role.SUPER_ADMIN,
                status: Status.ACTIVE,
                mustChangePassword: true,
            },
            select: {
                username: true,
                mustChangePassword: true,
            },
        });

        return {
            created: true,
            username: created.username,
            mustChangePassword: created.mustChangePassword,
            secretAvailable: true,
            password: credential.password,
            passwordSource: credential.source,
        };
    });
}

function shouldPrintPassword(environment: NodeJS.ProcessEnv): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
        String(environment.ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD || '').trim().toLowerCase(),
    );
}

async function main(): Promise<void> {
    const prisma = new PrismaClient();
    try {
        const result = await bootstrapAdministrator(prisma);
        const bootstrapFile = process.env.BOOTSTRAP_ADMIN_SECRET_FILE?.trim() || DEFAULT_BOOTSTRAP_FILE;

        if (result.created) {
            console.log(`First login URL: ${process.env.ALL_MAIL_LOGIN_URL || resolveLoginUrl(process.env)}`);
            console.log(`Bootstrap admin username: ${result.username}`);
            if (shouldPrintPassword(process.env)) {
                console.log(`Temporary admin password: ${result.password}`);
                console.log('WARNING: startup logs may retain this password; disable ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD immediately.');
            } else {
                console.log(`Bootstrap admin password is stored in ${bootstrapFile}.`);
                console.log(`Example: docker compose exec legacy-api sh -lc "grep '^ADMIN_PASSWORD=' ${bootstrapFile} | cut -d= -f2-"`);
            }
            console.log('You must change the temporary password before using the rest of the application.');
            return;
        }

        if (result.mustChangePassword && result.secretAvailable) {
            console.log(`Bootstrap admin ${result.username} still requires a password change.`);
            console.log(`Bootstrap admin password remains available in ${bootstrapFile}.`);
            return;
        }

        if (result.mustChangePassword) {
            console.warn(`Administrator ${result.username} requires a password change, but no recoverable bootstrap password file is present.`);
            return;
        }

        console.log('Administrator bootstrap already completed; no credential was created or changed.');
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

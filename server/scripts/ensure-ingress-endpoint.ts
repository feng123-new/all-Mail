import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Status } from '@prisma/client';

interface Options {
    check: boolean;
    global: boolean;
    domainName?: string;
    keyId: string;
    name: string;
    provider: string;
}

interface MinimalEnv {
    DATABASE_URL: string;
    INGRESS_SIGNING_SECRET?: string;
}

const scriptDir = import.meta.dirname;
const serverDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverDir, '..');
const candidateEnvFiles = [
    path.join(serverDir, '.env'),
    path.join(repoRoot, '.env'),
];

function parseArgs(argv: string[]): Options {
    const options: Options = {
        check: false,
        global: true,
        keyId: 'allmail-edge-main',
        name: 'allmail-edge global worker',
        provider: 'CLOUDFLARE_WORKER',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--check':
                options.check = true;
                break;
            case '--global':
                options.global = true;
                options.domainName = undefined;
                break;
            case '--domain':
                options.domainName = argv[index + 1]?.trim().toLowerCase();
                options.global = false;
                index += 1;
                break;
            case '--key-id':
                options.keyId = argv[index + 1]?.trim() || options.keyId;
                index += 1;
                break;
            case '--name':
                options.name = argv[index + 1]?.trim() || options.name;
                index += 1;
                break;
            case '--provider':
                options.provider = argv[index + 1]?.trim() || options.provider;
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.keyId) {
        throw new Error('Missing --key-id value');
    }

    if (!options.name) {
        throw new Error('Missing --name value');
    }

    if (!options.provider) {
        throw new Error('Missing --provider value');
    }

    if (!options.global && !options.domainName) {
        throw new Error('Use --domain <name> or --global');
    }

    return options;
}

function parseEnvFile(content: string): Map<string, string> {
    const entries = new Map<string, string>();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        entries.set(key, value);
    }
    return entries;
}

function deriveDatabaseUrl(entries: Map<string, string>): string | undefined {
    const explicit = process.env.DATABASE_URL || entries.get('DATABASE_URL');
    if (explicit) {
        return explicit;
    }

    const postgresPort = entries.get('POSTGRES_PORT') || '15433';
    const postgresUser = entries.get('POSTGRES_USER') || 'allmail';
    const postgresPassword = entries.get('POSTGRES_PASSWORD') || 'allmail_dev_password';
    const postgresDb = entries.get('POSTGRES_DB') || 'allmail';
    return `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDb}`;
}

function loadMinimalEnv(): MinimalEnv {
    const merged = new Map<string, string>();

    for (const envFile of candidateEnvFiles) {
        if (!existsSync(envFile)) {
            continue;
        }
        const parsed = parseEnvFile(readFileSync(envFile, 'utf8'));
        for (const [key, value] of parsed.entries()) {
            if (!(key in process.env)) {
                process.env[key] = value;
            }
            merged.set(key, value);
        }
    }

    const databaseUrl = deriveDatabaseUrl(merged);
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required. Define it in server/.env, repo .env, or shell environment.');
    }

    const ingressSigningSecret = process.env.INGRESS_SIGNING_SECRET || merged.get('INGRESS_SIGNING_SECRET') || undefined;

    return {
        DATABASE_URL: databaseUrl,
        INGRESS_SIGNING_SECRET: ingressSigningSecret,
    };
}

function buildSigningKeyHash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

async function resolveDomain(prisma: PrismaClient, domainName?: string) {
    if (!domainName) {
        return null;
    }

    const domain = await prisma.domain.findUnique({
        where: { name: domainName },
        select: {
            id: true,
            name: true,
            status: true,
            canReceive: true,
        },
    });

    if (!domain) {
        throw new Error(`Domain not found: ${domainName}`);
    }

    return domain;
}

async function runCheck(prisma: PrismaClient, env: MinimalEnv, options: Options): Promise<number> {
    const endpoint = await prisma.ingressEndpoint.findUnique({
        where: { keyId: options.keyId },
        select: {
            id: true,
            domainId: true,
            keyId: true,
            name: true,
            provider: true,
            signingKeyHash: true,
            status: true,
            domain: {
                select: {
                    name: true,
                },
            },
        },
    });

    const expectedHash = env.INGRESS_SIGNING_SECRET ? buildSigningKeyHash(env.INGRESS_SIGNING_SECRET) : null;
    const report = {
        exists: Boolean(endpoint),
        active: endpoint?.status === Status.ACTIVE,
        keyId: options.keyId,
        expectedDomain: options.domainName ?? null,
        actualDomain: endpoint?.domain?.name ?? null,
        envSigningSecretConfigured: Boolean(env.INGRESS_SIGNING_SECRET),
        signingKeyHashMatchesEnv: expectedHash ? endpoint?.signingKeyHash === expectedHash : null,
        endpoint,
    };

    console.log(JSON.stringify(report, null, 2));

    const domainMatches = options.domainName ? endpoint?.domain?.name === options.domainName : endpoint?.domain == null;
    const signingHashMatches = expectedHash ? endpoint?.signingKeyHash === expectedHash : true;
    if (!endpoint || endpoint.status !== Status.ACTIVE || !domainMatches || !signingHashMatches) {
        return 1;
    }

    return 0;
}

async function runEnsure(prisma: PrismaClient, env: MinimalEnv, options: Options): Promise<void> {
    if (!env.INGRESS_SIGNING_SECRET) {
        throw new Error('INGRESS_SIGNING_SECRET must be configured before ensuring ingress endpoint');
    }

    const domain = await resolveDomain(prisma, options.domainName);
    const signingKeyHash = buildSigningKeyHash(env.INGRESS_SIGNING_SECRET);

    const endpoint = await prisma.ingressEndpoint.upsert({
        where: { keyId: options.keyId },
        create: {
            domainId: domain?.id ?? null,
            keyId: options.keyId,
            name: options.name,
            provider: options.provider,
            signingKeyHash,
            status: Status.ACTIVE,
        },
        update: {
            domainId: domain?.id ?? null,
            name: options.name,
            provider: options.provider,
            signingKeyHash,
            status: Status.ACTIVE,
        },
        select: {
            id: true,
            keyId: true,
            name: true,
            provider: true,
            status: true,
            domain: {
                select: {
                    name: true,
                },
            },
            signingKeyHash: true,
        },
    });

    console.log(JSON.stringify({
        ensured: true,
        endpoint,
    }, null, 2));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const minimalEnv = loadMinimalEnv();
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: minimalEnv.DATABASE_URL,
            },
        },
    });

    try {
        if (options.check) {
            const exitCode = await runCheck(prisma, minimalEnv, options);
            process.exitCode = exitCode;
            return;
        }

        await runEnsure(prisma, minimalEnv, options);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

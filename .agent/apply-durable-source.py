from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one source fragment, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "server/src/modules/domain/domain.service.ts",
    'import { env } from "../../config/env.js";\n',
    '',
)
replace_once(
    "server/src/modules/domain/domain.service.ts",
    '''const SEND_ENABLED_DOMAIN_NAMES = new Set(
\t(env.SEND_ENABLED_DOMAINS || "")
\t\t.split(",")
\t\t.map((name) => normalizeDomainName(name))
\t\t.filter(Boolean),
);

function isSendEligibleDomain(name: string): boolean {
\treturn SEND_ENABLED_DOMAIN_NAMES.has(normalizeDomainName(name));
}

function ensureSendCapabilityAllowed(
\tdomainName: string,
\tcanSend: boolean,
): void {
\tif (canSend && !isSendEligibleDomain(domainName)) {
\t\tthrow new AppError(
\t\t\t"DOMAIN_SEND_NOT_ALLOWED",
\t\t\t`Domain ${domainName} is not listed in SEND_ENABLED_DOMAINS and cannot enable outbound sending`,
\t\t\t400,
\t\t);
\t}
}

''',
    '''type SendApprovalClient = Pick<
\tPrisma.TransactionClient,
\t"$queryRaw" | "$executeRaw"
>;

async function isSendApproved(
\tclient: SendApprovalClient,
\tdomainId: number,
): Promise<boolean> {
\tconst rows = await client.$queryRaw<Array<{ send_approved: boolean }>>`
\t\tSELECT send_approved
\t\tFROM domains
\t\tWHERE id = ${domainId}
\t`;
\treturn rows[0]?.send_approved === true;
}

async function approveSendCapability(
\tclient: SendApprovalClient,
\tdomainId: number,
\tsource: string,
): Promise<void> {
\tawait client.$executeRaw`
\t\tUPDATE domains
\t\tSET send_approved = true,
\t\t\tsend_approved_at = COALESCE(send_approved_at, CURRENT_TIMESTAMP),
\t\t\tsend_approval_source = COALESCE(send_approval_source, ${source}),
\t\t\tupdated_at = CURRENT_TIMESTAMP
\t\tWHERE id = ${domainId}
\t`;
}

''',
)

old_create = '''\tasync create(input: CreateDomainInput, createdByAdminId: number) {
\t\tconst name = normalizeDomainName(input.name);
\t\tensureSendCapabilityAllowed(name, input.canSend);

\t\tconst existing = await prisma.domain.findUnique({ where: { name } });
\t\tif (existing) {
\t\t\tthrow new AppError("DOMAIN_EXISTS", "Domain already exists", 409);
\t\t}

\t\tconst domain = await prisma.domain.create({
\t\t\tdata: {
\t\t\t\tname,
\t\t\t\tdisplayName: input.displayName?.trim() || null,
\t\t\t\tcanReceive: input.canReceive,
\t\t\t\tcanSend: input.canSend,
\t\t\t\tisCatchAllEnabled: input.isCatchAllEnabled,
\t\t\t\tverificationToken: randomBytes(12).toString("hex"),
\t\t\t\tdnsStatus: {
\t\t\t\t\tprovider: "CLOUDFLARE",
\t\t\t\t\texpectedMxConfigured: false,
\t\t\t\t\texpectedIngressConfigured: false,
\t\t\t\t},
\t\t\t\tcreatedByAdminId,
\t\t\t},
\t\t\tselect: {
\t\t\t\tid: true,
\t\t\t\tname: true,
\t\t\t\tdisplayName: true,
\t\t\t\tstatus: true,
\t\t\t\tcanReceive: true,
\t\t\t\tcanSend: true,
\t\t\t\tisCatchAllEnabled: true,
\t\t\t\tverificationToken: true,
\t\t\t\tresendDomainId: true,
\t\t\t\tcreatedAt: true,
\t\t\t\tupdatedAt: true,
\t\t\t\tcreator: { select: { id: true, username: true } },
\t\t\t\t_count: {
\t\t\t\t\tselect: {
\t\t\t\t\t\tmailboxes: true,
\t\t\t\t\t\tinboundMessages: true,
\t\t\t\t\t\tsendingConfigs: true,
\t\t\t\t\t},
\t\t\t\t},
\t\t\t},
\t\t});

\t\treturn toDomainSummary(domain);
\t},
'''
new_create = '''\tasync create(input: CreateDomainInput, createdByAdminId: number) {
\t\tconst name = normalizeDomainName(input.name);
\t\tconst existing = await prisma.domain.findUnique({ where: { name } });
\t\tif (existing) {
\t\t\tthrow new AppError("DOMAIN_EXISTS", "Domain already exists", 409);
\t\t}

\t\tconst domain = await prisma.$transaction(async (tx) => {
\t\t\tconst created = await tx.domain.create({
\t\t\t\tdata: {
\t\t\t\t\tname,
\t\t\t\t\tdisplayName: input.displayName?.trim() || null,
\t\t\t\t\tcanReceive: input.canReceive,
\t\t\t\t\tcanSend: input.canSend,
\t\t\t\t\tisCatchAllEnabled: input.isCatchAllEnabled,
\t\t\t\t\tverificationToken: randomBytes(12).toString("hex"),
\t\t\t\t\tdnsStatus: {
\t\t\t\t\t\tprovider: "CLOUDFLARE",
\t\t\t\t\t\texpectedMxConfigured: false,
\t\t\t\t\t\texpectedIngressConfigured: false,
\t\t\t\t\t},
\t\t\t\t\tcreatedByAdminId,
\t\t\t\t},
\t\t\t\tselect: {
\t\t\t\t\tid: true,
\t\t\t\t\tname: true,
\t\t\t\t\tdisplayName: true,
\t\t\t\t\tstatus: true,
\t\t\t\t\tcanReceive: true,
\t\t\t\t\tcanSend: true,
\t\t\t\t\tisCatchAllEnabled: true,
\t\t\t\t\tverificationToken: true,
\t\t\t\t\tresendDomainId: true,
\t\t\t\t\tcreatedAt: true,
\t\t\t\t\tupdatedAt: true,
\t\t\t\t\tcreator: { select: { id: true, username: true } },
\t\t\t\t\t_count: {
\t\t\t\t\t\tselect: {
\t\t\t\t\t\t\tmailboxes: true,
\t\t\t\t\t\t\tinboundMessages: true,
\t\t\t\t\t\t\tsendingConfigs: true,
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
\t\t\tif (input.canSend) {
\t\t\t\tawait approveSendCapability(tx, created.id, "admin-create");
\t\t\t}
\t\t\treturn created;
\t\t});

\t\treturn toDomainSummary(domain);
\t},
'''
replace_once("server/src/modules/domain/domain.service.ts", old_create, new_create)

old_update = '''\tasync update(id: number, input: UpdateDomainInput) {
\t\tconst existing = await prisma.domain.findUnique({ where: { id } });
\t\tif (!existing) {
\t\t\tthrow new AppError("DOMAIN_NOT_FOUND", "Domain not found", 404);
\t\t}

\t\tconst nextCanSend = input.canSend ?? existing.canSend;
\t\tensureSendCapabilityAllowed(existing.name, nextCanSend);

\t\tconst domain = await prisma.domain.update({
\t\t\twhere: { id },
\t\t\tdata: {
\t\t\t\tdisplayName:
\t\t\t\t\tinput.displayName === undefined
\t\t\t\t\t\t? undefined
\t\t\t\t\t\t: input.displayName?.trim() || null,
\t\t\t\tstatus: input.status,
\t\t\t\tcanReceive: input.canReceive,
\t\t\t\tcanSend: input.canSend,
\t\t\t\tisCatchAllEnabled: input.isCatchAllEnabled,
\t\t\t},
\t\t\tselect: {
\t\t\t\tid: true,
\t\t\t\tname: true,
\t\t\t\tdisplayName: true,
\t\t\t\tstatus: true,
\t\t\t\tcanReceive: true,
\t\t\t\tcanSend: true,
\t\t\t\tisCatchAllEnabled: true,
\t\t\t\tverificationToken: true,
\t\t\t\tresendDomainId: true,
\t\t\t\tcreatedAt: true,
\t\t\t\tupdatedAt: true,
\t\t\t\tcreator: { select: { id: true, username: true } },
\t\t\t\t_count: {
\t\t\t\t\tselect: {
\t\t\t\t\t\tmailboxes: true,
\t\t\t\t\t\tinboundMessages: true,
\t\t\t\t\t\tsendingConfigs: true,
\t\t\t\t\t},
\t\t\t\t},
\t\t\t},
\t\t});

\t\treturn toDomainSummary(domain);
\t},
'''
new_update = '''\tasync update(id: number, input: UpdateDomainInput) {
\t\tconst existing = await prisma.domain.findUnique({ where: { id } });
\t\tif (!existing) {
\t\t\tthrow new AppError("DOMAIN_NOT_FOUND", "Domain not found", 404);
\t\t}

\t\tconst domain = await prisma.$transaction(async (tx) => {
\t\t\tconst updated = await tx.domain.update({
\t\t\t\twhere: { id },
\t\t\t\tdata: {
\t\t\t\t\tdisplayName:
\t\t\t\t\t\tinput.displayName === undefined
\t\t\t\t\t\t\t? undefined
\t\t\t\t\t\t\t: input.displayName?.trim() || null,
\t\t\t\t\tstatus: input.status,
\t\t\t\t\tcanReceive: input.canReceive,
\t\t\t\t\tcanSend: input.canSend,
\t\t\t\t\tisCatchAllEnabled: input.isCatchAllEnabled,
\t\t\t\t},
\t\t\t\tselect: {
\t\t\t\t\tid: true,
\t\t\t\t\tname: true,
\t\t\t\t\tdisplayName: true,
\t\t\t\t\tstatus: true,
\t\t\t\t\tcanReceive: true,
\t\t\t\t\tcanSend: true,
\t\t\t\t\tisCatchAllEnabled: true,
\t\t\t\t\tverificationToken: true,
\t\t\t\t\tresendDomainId: true,
\t\t\t\t\tcreatedAt: true,
\t\t\t\t\tupdatedAt: true,
\t\t\t\t\tcreator: { select: { id: true, username: true } },
\t\t\t\t\t_count: {
\t\t\t\t\t\tselect: {
\t\t\t\t\t\t\tmailboxes: true,
\t\t\t\t\t\t\tinboundMessages: true,
\t\t\t\t\t\t\tsendingConfigs: true,
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
\t\t\tif (input.canSend === true && !(await isSendApproved(tx, id))) {
\t\t\t\tawait approveSendCapability(tx, id, "admin-update");
\t\t\t}
\t\t\treturn updated;
\t\t});

\t\treturn toDomainSummary(domain);
\t},
'''
replace_once("server/src/modules/domain/domain.service.ts", old_update, new_update)
replace_once(
    "server/src/modules/domain/domain.service.ts",
    '''\t\tensureSendCapabilityAllowed(domain.name, true);

\t\tconst existingConfig = domain.sendingConfigs[0];''',
    '''\t\tif (!(await isSendApproved(prisma, id))) {
\t\t\tthrow new AppError(
\t\t\t\t"DOMAIN_SEND_NOT_APPROVED",
\t\t\t\t"Outbound sending has not been approved for this domain",
\t\t\t\t400,
\t\t\t);
\t\t}

\t\tconst existingConfig = domain.sendingConfigs[0];''',
)

replace_once(
    "server/src/plugins/auth.ts",
    "import { hashApiKey } from '../lib/crypto.js';",
    "import { decrypt, hashApiKey } from '../lib/crypto.js';",
)
replace_once(
    "server/src/plugins/auth.ts",
    '''        if (!env.INGRESS_SIGNING_SECRET) {
            throw new AppError('INGRESS_NOT_CONFIGURED', 'Ingress signing is not configured', 503);
        }

''',
    '',
)
replace_once(
    "server/src/plugins/auth.ts",
    '''        const expectedSignature = createHmac('sha256', env.INGRESS_SIGNING_SECRET)
            .update(buildIngressCanonicalString(request, timestamp))
            .digest('hex');''',
    '''        const secretRows = await prisma.$queryRaw<Array<{ signing_secret_encrypted: string | null }>>`
            SELECT signing_secret_encrypted
            FROM ingress_endpoints
            WHERE id = ${endpoint.id}
        `;
        const encryptedSecret = secretRows[0]?.signing_secret_encrypted;
        if (!encryptedSecret) {
            throw new AppError('INGRESS_NOT_CONFIGURED', 'Ingress signing is not configured', 503);
        }
        let ingressSecret: string;
        try {
            ingressSecret = decrypt(encryptedSecret);
        } catch {
            throw new AppError(
                'INGRESS_CONFIGURATION_INVALID',
                'Ingress signing configuration is invalid',
                500,
            );
        }

        const expectedSignature = createHmac('sha256', ingressSecret)
            .update(buildIngressCanonicalString(request, timestamp))
            .digest('hex');''',
)

replace_once(
    "server/src/plugins/auth.ingress.test.ts",
    '''    const [{ default: prisma }, ingressModule, appModule] = await Promise.all([
        import('../lib/prisma.js'),
        import('../modules/ingress/ingress.service.js'),
        import('../app.js'),
    ]);''',
    '''    const [{ default: prisma }, ingressModule, appModule, cryptoModule] = await Promise.all([
        import('../lib/prisma.js'),
        import('../modules/ingress/ingress.service.js'),
        import('../app.js'),
        import('../lib/crypto.js'),
    ]);''',
)
replace_once(
    "server/src/plugins/auth.ingress.test.ts",
    '''        overrideMethod(prisma.ingressEndpoint, 'findUnique', (async () => ({
            id: 1,
            domainId: 1,
            keyId: 'edge-key',
            name: 'default',
            status: 'ACTIVE',
            domain: { name: 'example.com' },
        })) as never),''',
    '''        overrideMethod(prisma.ingressEndpoint, 'findUnique', (async () => ({
            id: 1,
            domainId: 1,
            keyId: 'edge-key',
            name: 'default',
            status: 'ACTIVE',
            domain: { name: 'example.com' },
        })) as never),
        overrideMethod(prisma, '$queryRaw', (async () => ([{
            signing_secret_encrypted: cryptoModule.encrypt(
                process.env.INGRESS_SIGNING_SECRET as string,
            ),
        }])) as never),''',
)

replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    "import { createHash } from 'node:crypto';",
    "import { createCipheriv, createHash, randomBytes } from 'node:crypto';",
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''interface MinimalEnv {
    DATABASE_URL: string;
    INGRESS_SIGNING_SECRET?: string;
}''',
    '''interface MinimalEnv {
    DATABASE_URL: string;
    INGRESS_SIGNING_SECRET?: string;
    ENCRYPTION_KEY?: string;
}''',
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''    return {
        DATABASE_URL: databaseUrl,
        INGRESS_SIGNING_SECRET: ingressSigningSecret,
    };''',
    '''    return {
        DATABASE_URL: databaseUrl,
        INGRESS_SIGNING_SECRET: ingressSigningSecret,
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || merged.get('ENCRYPTION_KEY') || undefined,
    };''',
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''function buildSigningKeyHash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}
''',
    '''function buildSigningKeyHash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function encryptIngressSecret(secret: string, encryptionKey: string): string {
    if (encryptionKey.length !== 32) {
        throw new Error('ENCRYPTION_KEY must contain exactly 32 characters');
    }
    const iv = randomBytes(16);
    const key = createHash('sha256').update(encryptionKey).digest();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}
''',
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''    const report = {
        exists: Boolean(endpoint),''',
    '''    const secretRows = endpoint
        ? await prisma.$queryRaw<Array<{ signing_secret_encrypted: string | null }>>`
            SELECT signing_secret_encrypted
            FROM ingress_endpoints
            WHERE id = ${endpoint.id}
        `
        : [];
    const report = {
        exists: Boolean(endpoint),
        encryptedSigningSecretConfigured: Boolean(secretRows[0]?.signing_secret_encrypted),''',
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''    if (!env.INGRESS_SIGNING_SECRET) {
        throw new Error('INGRESS_SIGNING_SECRET must be configured before ensuring ingress endpoint');
    }

    const domain = await resolveDomain(prisma, options.domainName);''',
    '''    if (!env.INGRESS_SIGNING_SECRET) {
        throw new Error('INGRESS_SIGNING_SECRET must be configured before ensuring ingress endpoint');
    }
    if (!env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY is required to persist an ingress signing secret');
    }

    const domain = await resolveDomain(prisma, options.domainName);''',
)
replace_once(
    "server/scripts/ensure-ingress-endpoint.ts",
    '''    console.log(JSON.stringify({
        ensured: true,
        endpoint,
    }, null, 2));''',
    '''    const encryptedSecret = encryptIngressSecret(
        env.INGRESS_SIGNING_SECRET,
        env.ENCRYPTION_KEY,
    );
    await prisma.$executeRaw`
        UPDATE ingress_endpoints
        SET signing_secret_encrypted = ${encryptedSecret},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${endpoint.id}
    `;

    console.log(JSON.stringify({
        ensured: true,
        encryptedSigningSecretConfigured: true,
        endpoint,
    }, null, 2));''',
)

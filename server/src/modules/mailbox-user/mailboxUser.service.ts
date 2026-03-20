import prisma from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { signToken } from '../../lib/jwt.js';
import { AppError } from '../../plugins/error.js';
import type {
    AddMailboxMembershipsInput,
    CreateMailboxUserInput,
    ListMailboxUserInput,
    MailboxPortalChangePasswordInput,
    MailboxPortalLoginInput,
    MailboxPortalUpdateForwardingInput,
    UpdateMailboxUserInput,
} from './mailboxUser.schema.js';

const MAILBOX_JWT_AUDIENCE = 'mailbox-portal';

function normalizeDistinctIds(ids: number[] | undefined): number[] {
    return Array.from(new Set((ids || []).filter((id) => Number.isInteger(id) && id > 0)));
}

async function ensureMailboxIdsExist(ids: number[]): Promise<void> {
    if (ids.length === 0) {
        return;
    }
    const count = await prisma.domainMailbox.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
        throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'One or more mailbox ids are invalid', 404);
    }
}

async function getAccessibleMailboxIds(userId: number): Promise<number[]> {
    const [owned, memberships] = await Promise.all([
        prisma.domainMailbox.findMany({
            where: { ownerUserId: userId, status: 'ACTIVE' },
            select: { id: true },
        }),
        prisma.mailboxMembership.findMany({
            where: { userId },
            select: { mailboxId: true },
        }),
    ]);

    return Array.from(new Set([
        ...owned.map((item) => item.id),
        ...memberships.map((item) => item.mailboxId),
    ]));
}

async function ensureUserHasMailboxAccess(userId: number, mailboxId: number) {
    const mailboxIds = await getAccessibleMailboxIds(userId);
    if (!mailboxIds.includes(mailboxId)) {
        throw new AppError('FORBIDDEN_MAILBOX', 'You do not have access to this mailbox', 403);
    }
}

async function syncMailboxMemberships(
    tx: {
        mailboxMembership: {
            deleteMany: typeof prisma.mailboxMembership.deleteMany;
            createMany: typeof prisma.mailboxMembership.createMany;
        };
    },
    userId: number,
    mailboxIds: number[] | undefined
): Promise<void> {
    if (mailboxIds === undefined) {
        return;
    }

    await tx.mailboxMembership.deleteMany({ where: { userId } });
    if (mailboxIds.length > 0) {
        await tx.mailboxMembership.createMany({
            data: mailboxIds.map((mailboxId) => ({ userId, mailboxId, role: 'MEMBER' })),
            skipDuplicates: true,
        });
    }
}

export const mailboxUserService = {
    async list(input: ListMailboxUserInput) {
        const skip = (input.page - 1) * input.pageSize;
        const where = {
            ...(input.status ? { status: input.status } : {}),
            ...(input.keyword ? {
                OR: [
                    { username: { contains: input.keyword, mode: 'insensitive' as const } },
                    { email: { contains: input.keyword, mode: 'insensitive' as const } },
                ],
            } : {}),
        };
        const [list, total] = await Promise.all([
            prisma.mailboxUser.findMany({
                where,
                select: {
                    id: true,
                    username: true,
                    email: true,
                    status: true,
                    mustChangePassword: true,
                    lastLoginAt: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { memberships: true, ownedMailboxes: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ id: 'desc' }],
            }),
            prisma.mailboxUser.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                mailboxCount: item._count.memberships + item._count.ownedMailboxes,
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: number) {
        const user = await prisma.mailboxUser.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                mustChangePassword: true,
                lastLoginAt: true,
                lastLoginIp: true,
                createdAt: true,
                updatedAt: true,
                ownedMailboxes: {
                    select: { id: true, address: true, status: true },
                    orderBy: { id: 'asc' },
                },
                memberships: {
                    select: {
                        id: true,
                        role: true,
                        mailbox: { select: { id: true, address: true, status: true } },
                    },
                    orderBy: { id: 'asc' },
                },
            },
        });
        if (!user) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }
        return user;
    },

    async create(input: CreateMailboxUserInput) {
        const existing = await prisma.mailboxUser.findFirst({
            where: {
                OR: [
                    { username: input.username },
                    ...(input.email ? [{ email: input.email }] : []),
                ],
            },
            select: { id: true },
        });
        if (existing) {
            throw new AppError('MAILBOX_USER_EXISTS', 'Mailbox user already exists', 409);
        }

        const mailboxIds = normalizeDistinctIds(input.mailboxIds);
        await ensureMailboxIdsExist(mailboxIds);

        const passwordHash = await hashPassword(input.password);
        return prisma.$transaction(async (tx) => {
            const user = await tx.mailboxUser.create({
                data: {
                    username: input.username.trim(),
                    email: input.email?.trim() || null,
                    passwordHash,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    status: true,
                    mustChangePassword: true,
                    createdAt: true,
                },
            });

            await syncMailboxMemberships(tx, user.id, mailboxIds);
            return user;
        });
    },

    async update(id: number, input: UpdateMailboxUserInput) {
        const existing = await prisma.mailboxUser.findUnique({ where: { id } });
        if (!existing) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }

        const mailboxIds = input.mailboxIds === undefined ? undefined : normalizeDistinctIds(input.mailboxIds);
        if (mailboxIds) {
            await ensureMailboxIdsExist(mailboxIds);
        }

        return prisma.$transaction(async (tx) => {
            const user = await tx.mailboxUser.update({
                where: { id },
                data: {
                    email: input.email === undefined ? undefined : (input.email?.trim() || null),
                    status: input.status,
                    mustChangePassword: input.mustChangePassword,
                    passwordHash: input.password === undefined ? undefined : (input.password ? await hashPassword(input.password) : existing.passwordHash),
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    status: true,
                    mustChangePassword: true,
                    updatedAt: true,
                },
            });

            await syncMailboxMemberships(tx, id, mailboxIds);
            return user;
        });
    },

    async addMailboxes(id: number, input: AddMailboxMembershipsInput) {
        const existing = await prisma.mailboxUser.findUnique({
            where: { id },
            select: { id: true, username: true },
        });
        if (!existing) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }

        const mailboxIds = normalizeDistinctIds(input.mailboxIds);
        await ensureMailboxIdsExist(mailboxIds);

        const ownedMailboxIdSet = new Set((await prisma.domainMailbox.findMany({
            where: {
                id: { in: mailboxIds },
                ownerUserId: id,
            },
            select: { id: true },
        })).map((item) => item.id));

        const membershipMailboxIds = mailboxIds.filter((mailboxId) => !ownedMailboxIdSet.has(mailboxId));
        const created = membershipMailboxIds.length > 0
            ? await prisma.mailboxMembership.createMany({
                data: membershipMailboxIds.map((mailboxId) => ({
                    userId: id,
                    mailboxId,
                    role: 'MEMBER',
                })),
                skipDuplicates: true,
            })
            : { count: 0 };

        return {
            userId: existing.id,
            username: existing.username,
            addedCount: created.count,
            totalAccessible: (await getAccessibleMailboxIds(id)).length,
        };
    },

    async login(input: MailboxPortalLoginInput, ip?: string) {
        const username = input.username.trim();
        const user = await prisma.mailboxUser.findFirst({
            where: {
                OR: [
                    { username },
                    { email: username },
                ],
            },
            select: {
                id: true,
                username: true,
                email: true,
                passwordHash: true,
                status: true,
                mustChangePassword: true,
            },
        });
        if (!user) {
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }
        if (user.status !== 'ACTIVE') {
            throw new AppError('ACCOUNT_DISABLED', 'Mailbox user is disabled', 403);
        }

        const isValid = await verifyPassword(input.password, user.passwordHash);
        if (!isValid) {
            throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
        }

        const mailboxIds = await getAccessibleMailboxIds(user.id);
        await prisma.mailboxUser.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ip || null,
            },
        });

        const token = await signToken({
            sub: user.id.toString(),
            mailboxUserId: user.id,
            username: user.username,
            role: 'MAILBOX_USER',
            mailboxIds,
        }, { audience: MAILBOX_JWT_AUDIENCE });

        return {
            token,
            mailboxUser: {
                id: user.id,
                username: user.username,
                email: user.email,
                mustChangePassword: user.mustChangePassword,
                mailboxIds,
            },
        };
    },

    async getSession(userId: number) {
        const user = await prisma.mailboxUser.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                mustChangePassword: true,
                lastLoginAt: true,
            },
        });
        if (!user) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }
        const mailboxIds = await getAccessibleMailboxIds(userId);
        return {
            authenticated: true,
            mailboxUser: {
                ...user,
                mailboxIds,
            },
        };
    },

    async getAccessibleMailboxes(userId: number) {
        return prisma.domainMailbox.findMany({
            where: {
                OR: [
                    { ownerUserId: userId },
                    { memberships: { some: { userId } } },
                ],
                status: 'ACTIVE',
                domain: {
                    status: 'ACTIVE',
                    canReceive: true,
                },
            },
            select: {
                id: true,
                domainId: true,
                localPart: true,
                address: true,
                displayName: true,
                status: true,
                canLogin: true,
                isCatchAllTarget: true,
                forwardMode: true,
                forwardTo: true,
                domain: {
                    select: {
                        id: true,
                        name: true,
                        canSend: true,
                        canReceive: true,
                    },
                },
            },
            orderBy: [{ id: 'asc' }],
        });
    },

    async changePassword(userId: number, input: MailboxPortalChangePasswordInput) {
        const user = await prisma.mailboxUser.findUnique({
            where: { id: userId },
            select: { id: true, passwordHash: true },
        });
        if (!user) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }

        const isValid = await verifyPassword(input.oldPassword, user.passwordHash);
        if (!isValid) {
            throw new AppError('INVALID_PASSWORD', 'Invalid old password', 400);
        }

        await prisma.mailboxUser.update({
            where: { id: userId },
            data: {
                passwordHash: await hashPassword(input.newPassword),
                mustChangePassword: false,
            },
        });

        return { success: true };
    },

    async updateForwarding(userId: number, input: MailboxPortalUpdateForwardingInput) {
        await ensureUserHasMailboxAccess(userId, input.mailboxId);

        if (input.forwardMode !== 'DISABLED' && !input.forwardTo) {
            throw new AppError('FORWARD_TARGET_REQUIRED', 'Forward target is required when forwarding is enabled', 400);
        }

        return prisma.domainMailbox.update({
            where: { id: input.mailboxId },
            data: {
                forwardMode: input.forwardMode,
                forwardTo: input.forwardMode === 'DISABLED' ? null : (input.forwardTo ?? null),
            },
            select: {
                id: true,
                address: true,
                forwardMode: true,
                forwardTo: true,
                updatedAt: true,
            },
        });
    },

    async delete(id: number) {
        const existing = await prisma.mailboxUser.findUnique({ where: { id } });
        if (!existing) {
            throw new AppError('MAILBOX_USER_NOT_FOUND', 'Mailbox user not found', 404);
        }

        await prisma.$transaction(async (tx) => {
            await tx.mailboxMembership.deleteMany({ where: { userId: id } });
            await tx.domainMailbox.updateMany({
                where: { ownerUserId: id },
                data: { ownerUserId: null },
            });
            await tx.mailboxUser.delete({ where: { id } });
        });

        return { success: true };
    },
};

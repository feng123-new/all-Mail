import * as jose from 'jose';
import { env, parseJWTDurationSeconds } from '../config/env.js';
import { JWT_ISSUER, loadSessionVersion, sessionSubjectKind } from './session-version.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface JwtPayload {
    sub: string;
    role: string;
    username: string;
    aud?: string | string[];
    iss?: string;
    sessionVersion?: number;
    mailboxUserId?: number | string;
    mailboxIds?: number[];
    [key: string]: unknown;
}

interface SignTokenOptions {
    audience?: string | string[];
    expiresIn?: string;
    sessionVersion?: number;
}

/**
 * Sign a token with one explicit algorithm, issuer, audience and either the
 * caller-confirmed or current durable session version.
 */
export async function signToken(payload: JwtPayload, options: SignTokenOptions = {}): Promise<string> {
    let sessionVersion = payload.sessionVersion;
    if (sessionSubjectKind(options.audience)) {
        sessionVersion = options.sessionVersion
            ?? await loadSessionVersion(options.audience, payload.sub)
            ?? undefined;
        if (!sessionVersion || sessionVersion <= 0) {
            throw new Error('Session subject does not exist');
        }
        if (!Number.isInteger(sessionVersion)) {
            throw new Error('Session version must be a positive integer');
        }
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresInSeconds = parseJWTDurationSeconds(options.expiresIn || env.JWT_EXPIRES_IN);
    let signer = new jose.SignJWT({
        ...payload,
        ...(sessionVersion ? { sessionVersion } : {}),
    } as jose.JWTPayload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(JWT_ISSUER)
        .setIssuedAt(issuedAt);

    if (options.audience) {
        signer = signer.setAudience(options.audience);
    }

    return signer
        .setExpirationTime(issuedAt + expiresInSeconds)
        .sign(secret);
}

/**
 * Verify cryptography and issuer, then compare the token's session version
 * with durable PostgreSQL state. Password, role, status and 2FA changes bump
 * that state and immediately revoke every older token.
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
    try {
        const { payload, protectedHeader } = await jose.jwtVerify(token, secret, {
            algorithms: ['HS256'],
            issuer: JWT_ISSUER,
        });
        if (protectedHeader.alg !== 'HS256') {
            return null;
        }
        if (sessionSubjectKind(payload.aud)) {
            const currentVersion = await loadSessionVersion(payload.aud, payload.sub);
            if (
                !currentVersion
                || !Number.isInteger(payload.sessionVersion)
                || payload.sessionVersion !== currentVersion
            ) {
                return null;
            }
        }
        return payload as unknown as JwtPayload;
    } catch {
        return null;
    }
}

/**
 * Parse a token without verification. This is for diagnostics only.
 */
export function decodeToken(token: string): JwtPayload | null {
    try {
        const payload = jose.decodeJwt(token);
        return payload as unknown as JwtPayload;
    } catch {
        return null;
    }
}

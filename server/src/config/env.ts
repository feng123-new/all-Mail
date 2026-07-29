import { z } from 'zod';
import 'dotenv/config';

const booleanFromEnv = z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
        return false;
    }

    return value;
}, z.boolean());

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

    // Database
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().optional(),
    ALLOW_LOCAL_RATE_LIMIT_FALLBACK: booleanFromEnv.default(false),
    CORS_ORIGIN: z.string().optional(),

    // JWT and encrypted business secrets
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('2h'),
    ENCRYPTION_KEY: z.string().length(32),

    // One-time bootstrap credential cleanup path. The API never receives the
    // bootstrap username or password; it only removes this file after rotation.
    BOOTSTRAP_ADMIN_SECRET_FILE: z.string().trim().min(1).default('/var/lib/all-mail/bootstrap-admin.env'),

    // Admin login security
    ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    ADMIN_LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
    ADMIN_2FA_WINDOW: z.coerce.number().int().min(0).max(5).default(1),

    SEND_ENABLED_DOMAINS: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),

    // Ingress
    INGRESS_SIGNING_SECRET: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(16).optional()
    ),
    INGRESS_ALLOWED_SKEW_SECONDS: z.coerce.number().int().min(30).default(300),

    // Provider OAuth compatibility fallbacks
    GOOGLE_OAUTH_CLIENT_ID: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
    GOOGLE_OAUTH_CLIENT_SECRET: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
    GOOGLE_OAUTH_REDIRECT_URI: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().url().optional()
    ),
    GOOGLE_OAUTH_SCOPES: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),

    MICROSOFT_OAUTH_CLIENT_ID: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
    MICROSOFT_OAUTH_CLIENT_SECRET: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
    MICROSOFT_OAUTH_REDIRECT_URI: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().url().optional()
    ),
    MICROSOFT_OAUTH_TENANT: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
    MICROSOFT_OAUTH_SCOPES: z.preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.string().trim().min(1).optional()
    ),
});

export type Env = z.infer<typeof envSchema>;

function isPlaceholderSecret(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('replace-with-');
}

function loadEnv(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    if (isPlaceholderSecret(result.data.INGRESS_SIGNING_SECRET)) {
        console.error('❌ Invalid environment variables:');
        console.error({
            _errors: [],
            INGRESS_SIGNING_SECRET: {
                _errors: ['Replace the shipped INGRESS_SIGNING_SECRET placeholder before enabling ingress'],
            },
        });
        process.exit(1);
    }

    return result.data;
}

export const env = loadEnv();

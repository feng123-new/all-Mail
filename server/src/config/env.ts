import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

    // Database
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().optional(),
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

    // Ingress replay and clock-skew policy. Endpoint secrets are database-managed.
    INGRESS_ALLOWED_SKEW_SECONDS: z.coerce.number().int().min(30).default(300),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const env = loadEnv();

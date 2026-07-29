import { env } from '../config/env.js';
import { AppError } from '../plugins/error.js';

export function allowLocalSecurityState(nodeEnv: string = env.NODE_ENV): boolean {
    return nodeEnv !== 'production';
}

export function securityStateUnavailable(code: string, message: string, cause?: unknown): AppError {
    const error = new AppError(code, message, 503);
    if (cause !== undefined) {
        Object.assign(error, { cause });
    }
    return error;
}

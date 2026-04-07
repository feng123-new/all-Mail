import { BACKEND_NAMESPACE_PREFIXES } from '../routes/prefixes.js';

export interface SpaFallbackRequest {
    method: string;
    path: string;
    accept?: string;
}

export function isApiOrAdminPath(path: string): boolean {
    return BACKEND_NAMESPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function isAssetPath(path: string): boolean {
    return /\.[^/]+$/.test(path);
}

export function shouldServeSpaIndex(request: SpaFallbackRequest): boolean {
    const method = request.method.toUpperCase();
    const accept = (request.accept || '').toLowerCase();

    if (!['GET', 'HEAD'].includes(method)) {
        return false;
    }
    if (isApiOrAdminPath(request.path)) {
        return false;
    }
    if (isAssetPath(request.path)) {
        return false;
    }
    if (accept.includes('application/json')) {
        return false;
    }

    return true;
}

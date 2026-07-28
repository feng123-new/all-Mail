import { BACKEND_NAMESPACE_PREFIXES } from '../routes/prefixes.js';

export function isApiOrAdminPath(path: string): boolean {
    return BACKEND_NAMESPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

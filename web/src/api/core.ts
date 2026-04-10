import axios, {
    type AxiosError,
    type AxiosRequestConfig,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from 'axios';
import { useAuthStore } from '../stores/authStore';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

export interface ApiResponse<T = unknown> {
    code: number;
    data: T;
    message?: string;
}

interface ApiSuccessEnvelope<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code?: string | number;
        details?: Array<{
            path?: Array<string | number>;
            code?: string;
            message?: string;
        }>;
    };
}

interface ApiErrorPayload {
    requestId?: string;
    error?: {
        code?: string | number;
        details?: Array<{
            path?: Array<string | number>;
            code?: string;
            message?: string;
        }>;
    };
}

export interface ApiPagedList<T> {
    list: T[];
    total: number;
}

export interface RequestGetConfig extends AxiosRequestConfig {
    dedupe?: boolean;
    cacheMs?: number;
}

export interface MutationConfig extends AxiosRequestConfig {
    invalidatePrefixes?: string[];
}

type ApiResult<T = unknown> = Promise<ApiResponse<T>>;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const MAILBOX_PORTAL_PREFIX = '/mail/api';
export const LONG_RUNNING_CHECK_TIMEOUT_MS = 180000;

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

const pendingGetControllers = new Map<string, AbortController>();
const getResponseCache = new Map<string, { expiresAt: number; value: ApiResponse<unknown> }>();
const REQUEST_ID_HEADER = 'X-Request-Id';

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const stableStringify = (value: unknown): string => {
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map((key) => `${key}:${stableStringify(obj[key])}`).join(',')}}`;
    }
    return String(value);
};

const buildGetRequestKey = (url: string, config?: AxiosRequestConfig): string => {
    const paramsKey = stableStringify(config?.params);
    return `${url}?${paramsKey}`;
};

const invalidateGetCache = (prefixes?: string[]) => {
    if (!prefixes || prefixes.length === 0) {
        return;
    }

    for (const key of Array.from(getResponseCache.keys())) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) {
            getResponseCache.delete(key);
        }
    }

    for (const [key, controller] of Array.from(pendingGetControllers.entries())) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) {
            controller.abort();
            pendingGetControllers.delete(key);
        }
    }
};

const createClientRequestId = (): string => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const shouldClearAuthOnUnauthorized = (
    status: number,
    payload?: ApiErrorPayload,
    requestUrl?: string
): boolean => {
    if (status !== 401) {
        return false;
    }

    const code = String(payload?.error?.code || '').toUpperCase();
    const normalizedUrl = String(requestUrl || '');
    const tokenInvalidCodes = new Set(['UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'JWT_EXPIRED']);

    if (tokenInvalidCodes.has(code)) {
        return true;
    }

    return normalizedUrl.includes('/admin/auth/me');
};

const shouldRedirectMailboxPasswordChange = (
    status: number,
    payload?: ApiErrorPayload,
    requestUrl?: string
): boolean => {
    if (status !== 403 || !String(requestUrl || '').includes(MAILBOX_PORTAL_PREFIX)) {
        return false;
    }

    const code = String(payload?.error?.code || '').toUpperCase();
    return code === 'PASSWORD_CHANGE_REQUIRED';
};

const toApiResponse = <T>(payload: unknown): ApiResponse<T> => {
    if (isObject(payload) && typeof payload.success === 'boolean') {
        const envelope = payload as unknown as ApiSuccessEnvelope<T>;
        if (envelope.success) {
            return {
                code: 200,
                data: envelope.data as T,
            };
        }
        throw {
            code: envelope.error?.code || 'ERROR',
            details: envelope.error?.details,
        };
    }

    if (isObject(payload) && typeof payload.code === 'number') {
        return {
            code: payload.code,
            data: (payload as { data?: T }).data as T,
            message: typeof payload.message === 'string' ? payload.message : undefined,
        };
    }

    return {
        code: 200,
        data: payload as T,
    };
};

api.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const headers = config.headers as Record<string, string>;
        if (!headers[REQUEST_ID_HEADER] && !headers['x-request-id']) {
            headers[REQUEST_ID_HEADER] = createClientRequestId();
        }
        return config;
    },
    (error: AxiosError) => Promise.reject(error)
);

api.interceptors.response.use(
    (response: AxiosResponse<unknown>) => {
        return toApiResponse(response.data) as unknown as AxiosResponse<unknown>;
    },
    (error: AxiosError<ApiErrorPayload>) => {
        if (error.code === 'ERR_CANCELED') {
            return Promise.reject({ code: 'REQUEST_CANCELED' });
        }

        if (
            error.code === 'ECONNABORTED' ||
            (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))
        ) {
            return Promise.reject({ code: 'REQUEST_TIMEOUT' });
        }

        if (error.response) {
            const { status, data } = error.response;
            const headerRequestId = error.response.headers?.['x-request-id'];
            const requestId = data?.requestId || (typeof headerRequestId === 'string' ? headerRequestId : undefined);
            const requestUrl = error.config?.url;
            const isMailboxPortalLoginRequest = requestUrl?.includes(`${MAILBOX_PORTAL_PREFIX}/login`);

            if (shouldClearAuthOnUnauthorized(status, data, requestUrl)) {
                useAuthStore.getState().clearAuth();
            }

            if (status === 401 && requestUrl?.includes(MAILBOX_PORTAL_PREFIX) && !isMailboxPortalLoginRequest) {
                useMailboxAuthStore.getState().clearAuth();
            }

            if (shouldRedirectMailboxPasswordChange(status, data, requestUrl)) {
                useMailboxAuthStore.setState((state) => ({
                    isAuthenticated: Boolean(state.mailboxUser),
                    mailboxUser: state.mailboxUser
                        ? { ...state.mailboxUser, mustChangePassword: true }
                        : state.mailboxUser,
                }));
            }

            if (data?.error) {
                return Promise.reject({
                    code: data.error.code || status,
                    details: data.error.details,
                    requestId,
                });
            }

            return Promise.reject({
                code: status,
                requestId,
            });
        }

        return Promise.reject({ code: 'NETWORK_ERROR' });
    }
);

export const requestGet = <T>(url: string, config?: RequestGetConfig): ApiResult<T> => {
    const { dedupe = true, cacheMs = 0, ...axiosConfig } = config || {};
    const requestKey = buildGetRequestKey(url, axiosConfig);

    if (cacheMs > 0) {
        const cached = getResponseCache.get(requestKey);
        if (cached && cached.expiresAt > Date.now()) {
            return Promise.resolve(cached.value as ApiResponse<T>);
        }
        if (cached) {
            getResponseCache.delete(requestKey);
        }
    }

    let controller: AbortController | null = null;
    if (dedupe) {
        const previousController = pendingGetControllers.get(requestKey);
        if (previousController) {
            previousController.abort();
        }
        controller = new AbortController();
        pendingGetControllers.set(requestKey, controller);
        axiosConfig.signal = controller.signal;
    }

    return api
        .get<unknown, ApiResponse<T>>(url, axiosConfig)
        .then((response) => {
            if (cacheMs > 0) {
                getResponseCache.set(requestKey, {
                    expiresAt: Date.now() + cacheMs,
                    value: response as ApiResponse<unknown>,
                });
            }
            return response;
        })
        .finally(() => {
            if (controller && pendingGetControllers.get(requestKey) === controller) {
                pendingGetControllers.delete(requestKey);
            }
        });
};

export const requestPost = <TResponse, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: MutationConfig
): ApiResult<TResponse> => {
    const { invalidatePrefixes, ...axiosConfig } = config || {};
    return api.post<TBody, ApiResponse<TResponse>>(url, data, axiosConfig).then((response) => {
        invalidateGetCache(invalidatePrefixes);
        return response;
    });
};

export const requestPut = <TResponse, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: MutationConfig
): ApiResult<TResponse> => {
    const { invalidatePrefixes, ...axiosConfig } = config || {};
    return api.put<TBody, ApiResponse<TResponse>>(url, data, axiosConfig).then((response) => {
        invalidateGetCache(invalidatePrefixes);
        return response;
    });
};

export const requestPatch = <TResponse, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: MutationConfig
): ApiResult<TResponse> => {
    const { invalidatePrefixes, ...axiosConfig } = config || {};
    return api.patch<TBody, ApiResponse<TResponse>>(url, data, axiosConfig).then((response) => {
        invalidateGetCache(invalidatePrefixes);
        return response;
    });
};

export const requestDelete = <T>(url: string, config?: MutationConfig): ApiResult<T> => {
    const { invalidatePrefixes, ...axiosConfig } = config || {};
    return api.delete<unknown, ApiResponse<T>>(url, axiosConfig).then((response) => {
        invalidateGetCache(invalidatePrefixes);
        return response;
    });
};

export default api;

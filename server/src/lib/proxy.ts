import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { logger } from './logger.js';

type ProxyFetchOptions = NonNullable<Parameters<typeof undiciFetch>[1]>;
type ProxyFetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

interface ProxyOptions {
    dispatcher?: Dispatcher;
    type?: 'socks5' | 'http' | 'none';
}

export function createSocksAgent(socks5: string): Dispatcher | null {
    if (!socks5 || typeof socks5 !== 'string') {
        return null;
    }

    let normalizedUrl = socks5.trim();
    if (!normalizedUrl.startsWith('socks5://')) {
        if (!normalizedUrl.includes('://')) {
            normalizedUrl = `socks5://${normalizedUrl}`;
        } else {
            logger.error({ url: socks5 }, 'Only SOCKS5 protocol is supported');
            return null;
        }
    }

    try {
        const dispatcher = new ProxyAgent(normalizedUrl);
        logger.debug({ url: normalizedUrl }, 'SOCKS5 proxy created');
        return dispatcher;
    } catch (err) {
        logger.error({ err, url: socks5 }, 'Failed to create SOCKS5 proxy');
        return null;
    }
}

export function createHttpAgent(http: string): Dispatcher | null {
    if (!http) {
        return null;
    }

    try {
        const dispatcher = new ProxyAgent(http);
        logger.debug({ url: http }, 'HTTP proxy created');
        return dispatcher;
    } catch (err) {
        logger.error({ err, url: http }, 'Failed to create HTTP proxy');
        return null;
    }
}

/**
 * 自动选择代理
 */
export function autoProxy(socks5?: string, http?: string): ProxyOptions {
    // SOCKS5 代理优先
    if (socks5) {
        const dispatcher = createSocksAgent(socks5);
        if (dispatcher) {
            return {
                dispatcher,
                type: 'socks5',
            };
        }
    }

    // HTTP 代理
    if (http) {
        const dispatcher = createHttpAgent(http);
        if (dispatcher) {
            return {
                dispatcher,
                type: 'http',
            };
        }
    }

    // 无代理
    return {
        type: 'none',
    };
}

/**
 * 使用代理发起请求
 */
export async function proxyFetch(
    url: string,
    options: RequestInit = {},
    proxyConfig?: { socks5?: string; http?: string }
): Promise<ProxyFetchResponse> {
    const proxy = autoProxy(proxyConfig?.socks5, proxyConfig?.http);

    const fetchOptions = { ...options } as ProxyFetchOptions;
    if (proxy.dispatcher) {
        fetchOptions.dispatcher = proxy.dispatcher;
    }

    return undiciFetch(url, fetchOptions);
}

export default { createSocksAgent, createHttpAgent, autoProxy, proxyFetch };

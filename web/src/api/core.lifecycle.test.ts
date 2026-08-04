import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { api, requestGet, resetApiRuntimeState, type ApiResponse } from './core';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ admin: null, isAuthenticated: false });
  resetApiRuntimeState();
});

describe('frontend request lifecycle', () => {
  it('shares one in-flight GET without cancelling either caller', async () => {
    const pending = deferred<ApiResponse<{ value: number }>>();
    const get = vi.spyOn(api, 'get').mockReturnValue(pending.promise as never);

    const first = requestGet<{ value: number }>('/admin/shared', { cacheMs: 500 });
    const second = requestGet<{ value: number }>('/admin/shared', { cacheMs: 500 });

    expect(first).toBe(second);
    expect(get).toHaveBeenCalledTimes(1);

    pending.resolve({ code: 200, data: { value: 7 } });
    await expect(first).resolves.toEqual({ code: 200, data: { value: 7 } });
    await expect(second).resolves.toEqual({ code: 200, data: { value: 7 } });
  });

  it('starts a new request after an explicit runtime reset', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ code: 200, data: { value: 1 } } as never)
      .mockResolvedValueOnce({ code: 200, data: { value: 2 } } as never);

    await expect(requestGet('/admin/cached', { cacheMs: 60_000 })).resolves.toEqual({
      code: 200,
      data: { value: 1 },
    });
    await requestGet('/admin/cached', { cacheMs: 60_000 });
    expect(get).toHaveBeenCalledTimes(1);

    resetApiRuntimeState();
    await expect(requestGet('/admin/cached', { cacheMs: 60_000 })).resolves.toEqual({
      code: 200,
      data: { value: 2 },
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('clears cached data when the administrator session changes', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ code: 200, data: { owner: 'first' } } as never)
      .mockResolvedValueOnce({ code: 200, data: { owner: 'second' } } as never);

    await requestGet('/admin/session-scoped', { cacheMs: 60_000 });
    await requestGet('/admin/session-scoped', { cacheMs: 60_000 });
    expect(get).toHaveBeenCalledTimes(1);

    useAuthStore.getState().setAuth({
      id: 2,
      username: 'second-admin',
      role: 'SUPER_ADMIN',
    });

    await expect(requestGet('/admin/session-scoped', { cacheMs: 60_000 })).resolves.toEqual({
      code: 200,
      data: { owner: 'second' },
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

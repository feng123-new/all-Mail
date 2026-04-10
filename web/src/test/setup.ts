import '@testing-library/jest-dom/vitest';
import { message } from 'antd';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

const noop = () => {};
const reactActWarningPatterns = [
  /inside a test was not wrapped in act\(\.\.\.\)/,
  /The current testing environment is not configured to support act\(\.\.\.\)/,
  /Could not parse CSS stylesheet/,
];
const originalConsoleError = console.error.bind(console);

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true,
});

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg;
        }
        if (arg instanceof Error) {
          return arg.message;
        }
        return String(arg);
      })
      .join(' ');

    if (reactActWarningPatterns.some((pattern) => pattern.test(text))) {
      return;
    }

    originalConsoleError(...args);
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    })),
  });

  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: vi.fn(),
  });

  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: (element: Element, pseudoElement?: string) => {
      if (pseudoElement) {
        return originalGetComputedStyle(element);
      }
      return originalGetComputedStyle(element, pseudoElement);
    },
  });

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  });
});

afterEach(async () => {
  await act(async () => {
    message.destroy();
    cleanup();
    await Promise.resolve();
  });
  useAuthStore.setState({
    admin: null,
    isAuthenticated: false,
  });
  useMailboxAuthStore.setState({
    mailboxUser: null,
    isAuthenticated: false,
  });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
  await new Promise<void>((resolve) => {
    setImmediate(() => resolve());
  });
});

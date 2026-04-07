import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react';
import { I18nContext, type TranslationParams } from './context';
import { normalizeLanguage, translateText, type AppLanguage } from './messages';

const STORAGE_KEY = 'all-mail:language';
const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label'] as const;

function withWhitespacePreserved(value: string, translate: (core: string) => string) {
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  if (!match) {
    return translate(value);
  }

  const [, leading, core, trailing] = match;
  if (!core) {
    return value;
  }

  return `${leading}${translate(core)}${trailing}`;
}

function shouldSkipTextNode(parent: Element | null) {
  if (!parent) {
    return true;
  }

  if (parent.closest('[data-i18n-skip="true"]')) {
    return true;
  }

  return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA'].includes(parent.tagName);
}

const LegacyTextBridge: FC<{ language: AppLanguage }> = ({ language }) => {
  const originalTextRef = useRef(new WeakMap<Text, string>());
  const originalAttrRef = useRef(new WeakMap<Element, Map<string, string>>());
  const applyingRef = useRef(false);

  const translateValue = useCallback((value: string) => withWhitespacePreserved(value, (core) => translateText(core, language)), [language]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-language', language);
  }, [language]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.getElementById('root');
    if (!root) {
      return;
    }

    const translateTextNode = (node: Text, captureOriginal: boolean) => {
      if (shouldSkipTextNode(node.parentElement)) {
        return;
      }

      if (captureOriginal || !originalTextRef.current.has(node)) {
        originalTextRef.current.set(node, node.data);
      }

      const original = originalTextRef.current.get(node) ?? node.data;
      const nextValue = translateValue(original);
      if (node.data !== nextValue) {
        node.data = nextValue;
      }
    };

    const translateAttribute = (element: Element, attributeName: (typeof ATTRIBUTE_NAMES)[number], captureOriginal: boolean) => {
      if (element.closest('[data-i18n-skip="true"]')) {
        return;
      }

      const currentValue = element.getAttribute(attributeName);
      if (!currentValue) {
        return;
      }

      let attributes = originalAttrRef.current.get(element);
      if (!attributes) {
        attributes = new Map<string, string>();
        originalAttrRef.current.set(element, attributes);
      }

      if (captureOriginal || !attributes.has(attributeName)) {
        attributes.set(attributeName, currentValue);
      }

      const original = attributes.get(attributeName) ?? currentValue;
      const nextValue = translateValue(original);
      if (currentValue !== nextValue) {
        element.setAttribute(attributeName, nextValue);
      }
    };

    const translateTree = (node: Node, captureOriginal: boolean) => {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node as Text, captureOriginal);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as Element;
      if (element.closest('[data-i18n-skip="true"]')) {
        return;
      }

      ATTRIBUTE_NAMES.forEach((attributeName) => {
        translateAttribute(element, attributeName, captureOriginal);
      });

      for (const child of Array.from(element.childNodes)) {
        translateTree(child, captureOriginal);
      }
    };

    const applyTranslations = (captureOriginal: boolean) => {
      applyingRef.current = true;
      try {
        translateTree(root, captureOriginal);
      } finally {
        applyingRef.current = false;
      }
    };

    applyTranslations(false);

    const observer = new MutationObserver((mutations) => {
      if (applyingRef.current) {
        return;
      }

      applyingRef.current = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
              translateTree(node, true);
            });
            continue;
          }

          if (mutation.type === 'characterData') {
            translateTextNode(mutation.target as Text, true);
            continue;
          }

          if (mutation.type === 'attributes' && mutation.attributeName) {
            translateAttribute(mutation.target as Element, mutation.attributeName as (typeof ATTRIBUTE_NAMES)[number], true);
          }
        }
      } finally {
        applyingRef.current = false;
      }
    });

    observer.observe(root, {
      attributeFilter: [...ATTRIBUTE_NAMES],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [translateValue]);

  return null;
};

interface I18nProviderProps {
  children: ReactNode;
  initialLanguage?: AppLanguage;
  persist?: boolean;
}

export const I18nProvider: FC<I18nProviderProps> = ({
  children,
  initialLanguage = 'zh-CN',
  persist = true,
}) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    if (typeof window === 'undefined') {
      return initialLanguage;
    }

    const stored = persist ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      return normalizeLanguage(stored);
    }

    return normalizeLanguage(initialLanguage || window.navigator.language);
  });

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
  }, []);

  useEffect(() => {
    if (!persist || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language, persist]);

  const t = useCallback((source: string, params?: TranslationParams) => translateText(source, language, params), [language]);

  const value = useMemo(() => ({
    antdLocale: language === 'en-US' ? enUS : zhCN,
    language,
    setLanguage,
    t,
  }), [language, setLanguage, t]);

  return (
    <I18nContext.Provider value={value}>
      <LegacyTextBridge language={language} />
      {children}
    </I18nContext.Provider>
  );
};

import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FC,
  type ReactNode,
} from 'react';
import { I18nextProvider } from 'react-i18next';
import { I18nContext, type TranslationParams } from './context';
import { i18n } from './instance';
import { isMessageDescriptor, normalizeLanguage, type AppLanguage, type TranslationInput } from './messages';

const STORAGE_KEY = 'all-mail:language';

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
    setLanguageState(normalizeLanguage(nextLanguage));
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-language', language);
  }, [language]);

  useEffect(() => {
    if (!persist || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language, persist]);

  const t = useCallback(
    (source: TranslationInput, params?: TranslationParams) => {
      if (isMessageDescriptor(source)) {
        return i18n.t(source.key, {
          lng: language,
          defaultValue: source.messages[language],
          ...(params ?? {}),
        });
      }

      return i18n.t(source, {
        lng: language,
        ...(params ?? {}),
      });
    },
    [language]
  );

  const value = useMemo(() => ({
    antdLocale: language === 'en-US' ? enUS : zhCN,
    language,
    setLanguage,
    t,
  }), [language, setLanguage, t]);

  return (
    <I18nextProvider i18n={i18n}>
      <I18nContext.Provider value={value}>
        {children}
      </I18nContext.Provider>
    </I18nextProvider>
  );
};

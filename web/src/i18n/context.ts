import zhCN from 'antd/locale/zh_CN';
import { createContext, useContext } from 'react';
import { i18n } from './instance';
import { isMessageDescriptor, type AppLanguage, type TranslationInput, type TranslationParams } from './messages';

export type { TranslationParams } from './messages';

export interface I18nContextValue {
  antdLocale: typeof zhCN;
  language: AppLanguage;
  setLanguage: (nextLanguage: AppLanguage) => void;
  t: (source: TranslationInput, params?: TranslationParams) => string;
}

const fallbackContext: I18nContextValue = {
  antdLocale: zhCN,
  language: 'zh-CN',
  setLanguage: () => undefined,
  t: (source, params) => {
    if (isMessageDescriptor(source)) {
      return i18n.t(source.key, {
        lng: 'zh-CN',
        defaultValue: source.messages['zh-CN'],
        ...(params ?? {}),
      });
    }

    return i18n.t(source, {
      lng: 'zh-CN',
      ...(params ?? {}),
    });
  },
};

export const I18nContext = createContext<I18nContextValue>(fallbackContext);

export function useI18n() {
  return useContext(I18nContext);
}

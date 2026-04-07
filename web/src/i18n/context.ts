import zhCN from 'antd/locale/zh_CN';
import { createContext, useContext } from 'react';
import { translateText, type AppLanguage } from './messages';

export type TranslationParams = Record<string, number | string>;

export interface I18nContextValue {
  antdLocale: typeof zhCN;
  language: AppLanguage;
  setLanguage: (nextLanguage: AppLanguage) => void;
  t: (source: string, params?: TranslationParams) => string;
}

const fallbackContext: I18nContextValue = {
  antdLocale: zhCN,
  language: 'zh-CN',
  setLanguage: () => undefined,
  t: (source, params) => translateText(source, 'zh-CN', params),
};

export const I18nContext = createContext<I18nContextValue>(fallbackContext);

export function useI18n() {
  return useContext(I18nContext);
}

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: 'zh-CN',
      lng: 'zh-CN',
      supportedLngs: ['zh-CN', 'en-US'],
      interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}',
      },
      keySeparator: false,
      nsSeparator: false,
      returnNull: false,
    });
}

export { i18n };

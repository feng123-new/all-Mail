import { Segmented } from 'antd';
import type { FC } from 'react';
import { useI18n } from '../i18n';
import { languageToggleI18n } from '../i18n/catalog/shell';
import type { AppLanguage } from '../i18n/messages';

const LanguageToggle: FC = () => {
  const { language, setLanguage, t } = useI18n();

  return (
    <div style={{ display: 'inline-flex' }}>
      <Segmented<AppLanguage>
        aria-label={t(languageToggleI18n.ariaLabel)}
        onChange={(value) => setLanguage(value as AppLanguage)}
        options={[
          { label: t(languageToggleI18n.chinese), value: 'zh-CN' },
          { label: t(languageToggleI18n.english), value: 'en-US' },
        ]}
        size="small"
        value={language}
      />
    </div>
  );
};

export default LanguageToggle;

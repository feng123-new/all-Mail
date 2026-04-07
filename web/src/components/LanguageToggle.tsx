import { Segmented } from 'antd';
import type { FC } from 'react';
import { useI18n } from '../i18n';
import type { AppLanguage } from '../i18n/messages';

const LanguageToggle: FC = () => {
  const { language, setLanguage } = useI18n();

  return (
    <div data-i18n-skip="true" style={{ display: 'inline-flex' }}>
      <Segmented<AppLanguage>
        aria-label="Language toggle"
        onChange={(value) => setLanguage(value as AppLanguage)}
        options={[
          { label: '中文', value: 'zh-CN' },
          { label: 'English', value: 'en-US' },
        ]}
        size="small"
        value={language}
      />
    </div>
  );
};

export default LanguageToggle;

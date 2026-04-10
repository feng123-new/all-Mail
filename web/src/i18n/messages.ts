export type AppLanguage = 'zh-CN' | 'en-US';

export type TranslationParams = Record<string, number | string>;
export interface MessageDescriptor {
  key: string;
  messages: Record<AppLanguage, string>;
}

export type TranslationInput = string | MessageDescriptor;

export function defineMessage(
  key: string,
  zhCN: string,
  enUS: string,
): MessageDescriptor {
  return {
    key,
    messages: {
      'zh-CN': zhCN,
      'en-US': enUS,
    },
  };
}

function formatTemplate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function normalizeLanguage(candidate?: string | null): AppLanguage {
  if (!candidate) {
    return 'zh-CN';
  }

  const normalized = candidate.trim().toLowerCase();
  if (normalized.startsWith('en')) {
    return 'en-US';
  }

  return 'zh-CN';
}

export function translateMessage(
  input: TranslationInput,
  language: AppLanguage,
  params?: TranslationParams,
) {
  if (typeof input === 'string') {
    return formatTemplate(input, params);
  }

  return formatTemplate(input.messages[language], params);
}

export function isMessageDescriptor(
  input: TranslationInput,
): input is MessageDescriptor {
  return (
    typeof input === 'object' &&
    input !== null &&
    'key' in input &&
    'messages' in input
  );
}

export function collectMessageDescriptors(value: unknown): MessageDescriptor[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if ('key' in value && 'messages' in value) {
    return [value as MessageDescriptor];
  }

  return Object.values(value).flatMap((entry) => collectMessageDescriptors(entry));
}

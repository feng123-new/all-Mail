import { i18n } from '../i18n/instance';
import {
    isMessageDescriptor,
    normalizeLanguage,
    type TranslationInput,
} from '../i18n/messages';

function localizeFallback(fallback: TranslationInput): string {
    const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
    if (isMessageDescriptor(fallback)) {
        return i18n.t(fallback.key, {
            lng: language,
            defaultValue: fallback.messages[language],
        });
    }

    return fallback;
}

function resolveErrorText(code: string, fallback: TranslationInput): string {
    const translationKey = `api.error.${code}`;
    if (i18n.exists(translationKey)) {
        return i18n.t(translationKey);
    }

    return localizeFallback(fallback);
}

export function getErrorMessage(error: unknown, fallback: TranslationInput): string {
    if (!error || typeof error !== 'object') {
        return localizeFallback(fallback);
    }

    const payload = error as {
        code?: unknown;
        details?: unknown;
        requestId?: unknown;
    };
    const code = payload.code;
    const codeText = typeof code === 'string' || typeof code === 'number' ? String(code) : '';

    const finalMessage = codeText ? resolveErrorText(codeText, fallback) : localizeFallback(fallback);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const hasRequestIdText = finalMessage.includes('requestId:');
    const withRequestId = requestId && !hasRequestIdText ? `${finalMessage} (requestId: ${requestId})` : finalMessage;

    if (!codeText) {
        return withRequestId;
    }

    return `[${codeText}] ${withRequestId}`;
}

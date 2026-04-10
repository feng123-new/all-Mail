import { message } from 'antd';
import { i18n } from '../i18n/instance';
import {
    isMessageDescriptor,
    normalizeLanguage,
    type TranslationInput,
} from '../i18n/messages';
import { getErrorMessage } from './error';

interface ApiResponse<T> {
    code: number;
    data: T;
    message?: string;
}

function localizeFallbackMessage(fallbackErrorMessage: TranslationInput): string {
    const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
    if (isMessageDescriptor(fallbackErrorMessage)) {
        return i18n.t(fallbackErrorMessage.key, {
            lng: language,
            defaultValue: fallbackErrorMessage.messages[language],
        });
    }

    return fallbackErrorMessage;
}

export async function requestData<T>(
    requestFn: () => Promise<unknown>,
    fallbackErrorMessage: TranslationInput,
    options?: { silent?: boolean }
): Promise<T | null> {
    const localizedFallbackErrorMessage = localizeFallbackMessage(fallbackErrorMessage);

    try {
        const response = await requestFn() as ApiResponse<T>;
        if (response?.code === 200) {
            return response.data as T;
        }

        if (!options?.silent) {
            message.error(response?.message || localizedFallbackErrorMessage);
        }
        return null;
    } catch (err: unknown) {
        if (
            err &&
            typeof err === 'object' &&
            (err as { code?: unknown }).code === 'REQUEST_CANCELED'
        ) {
            return null;
        }
        if (!options?.silent) {
            message.error(getErrorMessage(err, localizedFallbackErrorMessage));
        }
        return null;
    }
}

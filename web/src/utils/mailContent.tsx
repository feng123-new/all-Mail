import React from 'react';

const LINK_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'img']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function normalizeUrl(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.includes('@') && !trimmed.includes('://') && !trimmed.startsWith('mailto:')) {
        return `mailto:${trimmed}`;
    }
    if (trimmed.startsWith('www.')) {
        return `https://${trimmed}`;
    }

    try {
        const url = new URL(trimmed);
        return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}

export function renderPlainTextWithLinks(value: string): React.ReactNode {
    let keyCounter = 0;
    const nextKey = (prefix: string) => {
        keyCounter += 1;
        return `${prefix}-${keyCounter}`;
    };
    const parts = value.split(LINK_PATTERN);
    return parts.map((part) => {
        const normalized = normalizeUrl(part);
        if (!normalized) {
            return <React.Fragment key={nextKey('mail-text')}>{part}</React.Fragment>;
        }

        return (
            <a key={nextKey('mail-link')} href={normalized} target="_blank" rel="noreferrer noopener">
                {part}
            </a>
        );
    });
}

export function sanitizeEmailHtml(html: string): string {
    if (!html.trim()) {
        return '';
    }

    const parser = new DOMParser();
    const documentNode = parser.parseFromString(html, 'text/html');

    documentNode.querySelectorAll('*').forEach((element) => {
        const tagName = element.tagName.toLowerCase();
        if (FORBIDDEN_TAGS.has(tagName)) {
            element.remove();
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;

            if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || name === 'formaction') {
                element.removeAttribute(attribute.name);
                return;
            }

            if (name === 'href' || name === 'src') {
                const normalized = normalizeUrl(value);
                if (!normalized) {
                    element.removeAttribute(attribute.name);
                } else {
                    element.setAttribute(attribute.name, normalized);
                }
            }
        });

        if (tagName === 'a') {
            const href = element.getAttribute('href');
            if (!href) {
                element.replaceWith(...Array.from(element.childNodes));
                return;
            }
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noreferrer noopener');
        }
    });

    return documentNode.body.innerHTML;
}

export function renderSanitizedEmailHtml(html: string): React.ReactNode {
    const sanitizedHtml = sanitizeEmailHtml(html);
    if (!sanitizedHtml.trim()) {
        return null;
    }

    const parser = new DOMParser();
    const documentNode = parser.parseFromString(sanitizedHtml, 'text/html');
    let keyCounter = 0;
    const nextKey = () => {
        keyCounter += 1;
        return `mail-html-${keyCounter}`;
    };
    const allowedTags = new Set(['a', 'p', 'div', 'span', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code']);

    const convertNode = (node: ChildNode): React.ReactNode => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }

        if (!(node instanceof HTMLElement)) {
            return null;
        }

        const tagName = allowedTags.has(node.tagName.toLowerCase()) ? node.tagName.toLowerCase() : 'span';
        const props: Record<string, string> = { key: nextKey() };

        if (tagName === 'a') {
            const href = node.getAttribute('href');
            if (href) {
                props.href = href;
                props.target = '_blank';
                props.rel = 'noreferrer noopener';
            }
        }

        const children = Array.from(node.childNodes).map((child) => convertNode(child));
        return React.createElement(tagName, props, ...children);
    };

    return Array.from(documentNode.body.childNodes).map((node) => convertNode(node));
}

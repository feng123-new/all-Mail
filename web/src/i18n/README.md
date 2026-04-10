# all-Mail frontend i18n rules

This frontend uses one language runtime and one descriptor format:

- runtime source of truth: `provider.tsx` + `context.ts` + `instance.ts`
- descriptor format: `defineMessage(key, zhCN, enUS)` from `messages.ts`
- renderer: `t(...)` from `useI18n()`

## Placement rules

Use these layers consistently:

1. **Shared catalogs** → `web/src/i18n/catalog/*.ts`
   - reusable shell, admin, provider, and cross-page labels
   - examples: `catalog/admin.ts`, `catalog/providers.ts`, `catalog/shell.ts`
2. **Page-local descriptors** → module-scope constants in the page file, or a page-adjacent file such as `inlineMessages.ts`
   - use this for copy that belongs to one surface only
   - keep descriptors outside render functions and event handlers
3. **Stable backend/result keys** → `resources.ts`
   - reserved for flat i18next resources that are not owned by a single page
   - examples: backend error codes, stable result/action feedback keys

## Do not do this

- no `t(defineMessage(...))` inside render paths
- no `message.success(t(defineMessage(...)))` inside event handlers
- no raw localized fallback strings passed to `requestData(...)`

## Preferred patterns

```ts
const pageI18n = {
  saveFailed: defineMessage('page.saveFailed', '保存失败', 'Save failed'),
} as const;

message.error(t(pageI18n.saveFailed));
```

```ts
const result = await requestData(loadFn, t(pageI18n.saveFailed));
```

If a page already has many legacy inline descriptors, move them into a page-adjacent module such as `inlineMessages.ts` first, then progressively fold reusable keys into shared catalogs.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGroupSchema, updateGroupSchema } from './group.schema.js';

void test('createGroupSchema normalizes null description to undefined', () => {
    const parsed = createGroupSchema.parse({
        name: 'openai-business02',
        description: null,
        fetchStrategy: 'GRAPH_FIRST',
    });

    assert.equal(parsed.description, undefined);
});

void test('updateGroupSchema accepts empty string and normalizes null description', () => {
    const cleared = updateGroupSchema.parse({ description: '' });
    assert.equal(cleared.description, '');

    const normalized = updateGroupSchema.parse({ description: null });
    assert.equal(normalized.description, undefined);
});

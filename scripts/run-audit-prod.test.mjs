import assert from 'node:assert/strict';
import test from 'node:test';
import { productionAuditSteps, runProductionAudits } from './run-audit-prod.mjs';

test('runProductionAudits executes every audit step before failing overall', async () => {
  const executed = [];
  const result = await runProductionAudits(async (step) => {
    executed.push(step.name);
    return {
      step,
      ok: step.name !== 'web',
      code: step.name === 'web' ? 1 : 0,
    };
  });

  assert.deepEqual(executed, productionAuditSteps.map((step) => step.name));
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed.map((failure) => failure.step.name), ['web']);
});

test('runProductionAudits reports success when every audit step passes', async () => {
  const result = await runProductionAudits(async (step) => ({
    step,
    ok: true,
    code: 0,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.failed.length, 0);
  assert.equal(result.results.length, productionAuditSteps.length);
});

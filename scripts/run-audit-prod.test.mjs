import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditAdvisoryAllowlist,
  evaluateAuditReport,
  productionAuditSteps,
  runProductionAudits,
} from './run-audit-prod.mjs';

function routerAuditReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'react-router': {
        name: 'react-router',
        severity: 'high',
        isDirect: false,
        via: [{
          source: 1234,
          name: 'react-router',
          dependency: 'react-router',
          title: 'React Router RSC Mode CSRF Bypass',
          url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
          severity: 'high',
          range: '>=7.12.0 <8.3.0',
        }],
        effects: ['react-router-dom'],
        range: '7.12.0 - 8.2.0',
      },
      'react-router-dom': {
        name: 'react-router-dom',
        severity: 'high',
        isDirect: true,
        via: ['react-router'],
        effects: [],
        range: '>=7.12.0-pre.0',
      },
    },
    metadata: {
      vulnerabilities: { high: 2, total: 2 },
    },
  };
}

test('evaluateAuditReport permits only the scoped active React Router exception', () => {
  const result = evaluateAuditReport(routerAuditReport(), {
    now: new Date('2026-07-28T00:00:00Z'),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.allowed.map((item) => item.packageName).sort(),
    ['react-router', 'react-router-dom'],
  );
  assert.equal(result.blocking.length, 0);
});

test('evaluateAuditReport fails after an exception expires', () => {
  const result = evaluateAuditReport(routerAuditReport(), {
    now: new Date('2026-10-01T00:00:00Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocking.length, 2);
});

test('evaluateAuditReport does not let an exception cover another package', () => {
  const report = routerAuditReport();
  report.vulnerabilities['unrelated-package'] = {
    name: 'unrelated-package',
    severity: 'high',
    via: [report.vulnerabilities['react-router'].via[0]],
  };
  const result = evaluateAuditReport(report, {
    now: new Date('2026-07-28T00:00:00Z'),
    allowlist: auditAdvisoryAllowlist,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blocking.map((item) => item.packageName), ['unrelated-package']);
});

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

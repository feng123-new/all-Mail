        import assert from 'node:assert/strict';
        import { readFile } from 'node:fs/promises';
        import path from 'node:path';
        import test from 'node:test';
        import { fileURLToPath } from 'node:url';

        const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const read = (relativePath) => readFile(path.join(workerRoot, relativePath), 'utf8');

        test('Worker operator tooling uses only the Go backend contract', async () => {
          const [deploy, doctor] = await Promise.all([
            read('bin/deploy-prod.js'),
            read('bin/doctor.js'),
          ]);
          for (const retired of ['serverDir', 'ensure-ingress-endpoint', "path.join(repoRoot, 'server')"]) {
            assert.equal(deploy.includes(retired), false, `deploy retains ${retired}`);
            assert.equal(doctor.includes(retired), false, `doctor retains ${retired}`);
          }
          assert.match(deploy, /Go initializer/);
          assert.match(deploy, /compose-up\.sh/);
          assert.match(doctor, /Go initializer owns endpoint creation/);
        });

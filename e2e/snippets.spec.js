// Runs the copy-paste snippets from the connect page exactly as shown and checks the events arrive.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snippets } from '../app/src/lib/snippets.js';
import { expect, test, uniq } from './fixtures.js';

const has = (cmd) => spawnSync('which', [cmd]).status === 0;

/** @type {Record<string, { file: string, run: (path: string) => [string, string[]], needs: string }>} */
const RUNNERS = {
  JavaScript: { file: 'logger.mjs', run: (p) => ['node', [p]], needs: 'node' },
  Python: { file: 'logger.py', run: (p) => ['python3', [p]], needs: 'python3' },
  Go: { file: 'main.go', run: (p) => ['go', ['run', p]], needs: 'go' },
  HTTP: { file: 'send.sh', run: (p) => ['sh', [p]], needs: 'curl' },
};

test.describe('SDK snippets work as shown', () => {
  test.skip(({ theme }) => theme === 'dark', 'runs once');

  for (const [platform, runner] of Object.entries(RUNNERS)) {
    test(platform, async ({ app, baseURL }) => {
      test.skip(!has(runner.needs), `${runner.needs} is not installed`);
      const { project, token } = await app.projectWithSource(uniq(`snip-${platform.toLowerCase()}`), 'svc');
      const code = snippets(`${baseURL}/v1/logs`, 'svc', 'ol_…')[platform].code;
      const dir = mkdtempSync(join(tmpdir(), 'ol-snippet-'));
      const path = join(dir, runner.file);
      writeFileSync(path, code);
      const [cmd, args] = runner.run(path);
      const r = spawnSync(cmd, args, {
        env: { ...process.env, LOGS_TOKEN: token },
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(r.status, r.stderr).toBe(0);

      const now = Date.now();
      const { events } = await app.post('/api/query', {
        project_id: project.id,
        from: now - 60_000,
        to: now + 1000,
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ level: 'error', message: 'payment failed', source: 'svc' });
      expect(events[0].fields).toMatchObject({ order_id: 4821, service: 'svc' });
    });
  }
});

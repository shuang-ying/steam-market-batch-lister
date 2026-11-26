import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const outFile = resolve('dist/.test-bundle.mjs');
mkdirSync(resolve('dist'), { recursive: true });

await build({
  entryPoints: [resolve('tests/pricing.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: outFile,
});

try {
  execFileSync(process.execPath, ['--test', outFile], { stdio: 'inherit' });
} finally {
  rmSync(outFile, { force: true });
}

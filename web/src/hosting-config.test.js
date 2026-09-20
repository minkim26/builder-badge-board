import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// Guards the hosting and deploy settings that keep Amplify build minutes low.
// Plain text matching on purpose: no YAML parser dependency for four checks.
// ponytail: switch to a YAML parser if these regexes get brittle.
const repoRoot = join(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(join(repoRoot, file), 'utf8');

// The deploy job diffs these paths to decide whether Amplify needs a build.
const deployJob = () => read('.github/workflows/ci.yml').split('\n  deploy:\n')[1] ?? '';
const deployPaths = () => deployJob().match(/git diff --quiet .* -- (.*?);/)?.[1].split(/\s+/) ?? [];

test('amplify.yml caches the npm download cache, not node_modules that npm ci wipes', () => {
  const amplify = read('amplify.yml');
  const cachePaths = amplify.match(/cache:\s*\n\s*paths:\s*\n((?:\s+-\s+.+\n?)+)/)?.[1] ?? '';

  assert.match(cachePaths, /\.npm\/\*\*\/\*/);
  assert.doesNotMatch(cachePaths, /node_modules/);
  assert.match(amplify, /npm ci --cache \.npm --prefer-offline/);
});

test('customHttp.yml serves hashed /assets/* as immutable for the web app', () => {
  const headers = read('customHttp.yml');

  assert.match(headers, /appRoot:\s*web\b/);
  assert.match(
    headers,
    /pattern:\s*'\/assets\/\*'\s*\n\s*headers:\s*\n\s*-\s*key:\s*'Cache-Control'\s*\n\s*value:\s*'public, max-age=31536000, immutable'/,
  );
});

test('ci.yml has a deploy job that needs test, is limited to main, and diffs the frontend paths', () => {
  const deploy = deployJob();

  assert.match(deploy, /needs:\s*test\b/);
  assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /AMPLIFY_WEBHOOK_URL/);
  assert.deepEqual(deployPaths(), [
    'web',
    'tampermonkey/progress-sync.user.js',
    'amplify.yml',
    'customHttp.yml',
  ]);
});

test('every file bundled from outside web/ is in the deploy path filter', () => {
  const webDir = join(repoRoot, 'web');
  const srcDir = join(webDir, 'src');
  const filterPaths = deployPaths();
  // Relative specifiers only: `from './x'`, `import './x'` and `import('./x')`.
  const specifier = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"?]*)/g;

  // Walks src recursively and resolves each import against the importing file,
  // so a nested component reaching outside web/ is caught too.
  const bundledFromOutside = readdirSync(srcDir, { recursive: true })
    .filter((name) => /\.jsx?$/.test(name))
    .flatMap((name) => {
      const file = join(srcDir, name);
      return [...readFileSync(file, 'utf8').matchAll(specifier)]
        .map((match) => resolve(dirname(file), match[1]))
        .filter((target) => relative(webDir, target).startsWith('..'))
        .map((target) => relative(repoRoot, target));
    });

  // Guards against the scan silently matching nothing.
  assert.ok(bundledFromOutside.length > 0, 'expected to find the tampermonkey import');
  for (const target of bundledFromOutside) {
    assert.ok(
      filterPaths.some((path) => target === path || target.startsWith(`${path}/`)),
      `${target} is bundled into the frontend but is not in the deploy path filter`,
    );
  }
});

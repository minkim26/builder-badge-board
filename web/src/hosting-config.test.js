import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards the hosting and deploy settings that keep Amplify build minutes low.
// Plain text matching on purpose: no YAML parser dependency for four checks.
// ponytail: switch to a YAML parser if these regexes get brittle.
const repoRoot = join(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(join(repoRoot, file), 'utf8');

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
    /pattern:\s*'\/assets\/\*'\s*\n\s*headers:\s*\n\s*-\s*key:\s*'Cache-Control'\s*\n\s*value:\s*'[^']*\bimmutable\b[^']*'/,
  );
});

test('ci.yml deploys to Amplify only after tests pass on main, and only for web changes', () => {
  const deploy = read('.github/workflows/ci.yml').split('\n  deploy:\n')[1] ?? '';

  assert.match(deploy, /needs:\s*test\b/);
  assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /-- web amplify\.yml customHttp\.yml/);
  assert.match(deploy, /AMPLIFY_WEBHOOK_URL/);
});

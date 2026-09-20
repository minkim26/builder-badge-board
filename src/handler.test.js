const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handler,
  buildUpdateExpression,
  isValidProgressItems,
  toArticleItem,
  isValidTimezone,
  hasValidSyncKey,
  parseBody,
  getSyncKey,
  clearSyncKeyCache,
} = require('./handler');
const { SSMClient } = require('@aws-sdk/client-ssm');

// The sync key lives in SSM, so tests stand in for that single call by
// replacing SSMClient's send(). The key cache is module-level state, so this
// clears it first — each test starts from a cold cache.
function mockSsm(t, respond) {
  clearSyncKeyCache();
  return t.mock.method(SSMClient.prototype, 'send', async (command) => respond(command));
}
const withKey = (value) => async () => ({ Parameter: { Value: value } });

// Builds the slice of an API Gateway HTTP API event the handler reads. Only
// used with requests the handler rejects before it touches DynamoDB, so no
// AWS client mocking is needed.
function apiEvent(method, rawPath, { body, headers } = {}) {
  return { requestContext: { http: { method, sourceIp: '203.0.113.9' } }, rawPath, body, headers };
}

test('builds SET expression for updatable fields', () => {
  const result = buildUpdateExpression({ status: 'earned', dateEarned: '2026-09-12' }, ['userId', 'badgeId']);
  assert.equal(result.UpdateExpression, 'SET #f0 = :v0, #f1 = :v1');
  assert.deepEqual(result.ExpressionAttributeNames, { '#f0': 'status', '#f1': 'dateEarned' });
  assert.deepEqual(result.ExpressionAttributeValues, { ':v0': 'earned', ':v1': '2026-09-12' });
});

test('excludes key fields from the update', () => {
  const result = buildUpdateExpression({ userId: 'me', badgeId: 'x', status: 'earned' }, ['userId', 'badgeId']);
  assert.deepEqual(result.ExpressionAttributeNames, { '#f0': 'status' });
});

test('returns null when nothing to update', () => {
  const result = buildUpdateExpression({ userId: 'me', badgeId: 'x' }, ['userId', 'badgeId']);
  assert.equal(result, null);
});

test('progress-sync accepts a well-formed items array', () => {
  assert.equal(isValidProgressItems([{ badgeId: 'a', name: 'A', progress: 1 }]), true);
});

test('progress-sync rejects a missing/empty/oversized/malformed items array', () => {
  assert.equal(isValidProgressItems(undefined), false);
  assert.equal(isValidProgressItems([]), false);
  assert.equal(isValidProgressItems(Array(26).fill({ badgeId: 'a', name: 'A', progress: 1 })), false);
  assert.equal(isValidProgressItems([{ badgeId: 'a', progress: 1 }]), false); // missing name
});

test('progress-sync rejects a missing/negative/non-numeric progress', () => {
  assert.equal(isValidProgressItems([{ badgeId: 'a', name: 'A' }]), false); // missing progress
  assert.equal(isValidProgressItems([{ badgeId: 'a', name: 'A', progress: -1 }]), false);
  assert.equal(isValidProgressItems([{ badgeId: 'a', name: 'A', progress: 'lots' }]), false);
});

test('toArticleItem converts lastPublishedAt (epoch ms) to a plain date string', () => {
  const item = toArticleItem({
    articleId: '/content/abc',
    title: 'Some Article',
    uri: '/content/abc/some-article',
    lastPublishedAt: 1789357828961,
    tags: ['aws', 'serverless'],
    heroImageUrl: 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp',
  });
  assert.equal(item.publishDate, new Date(1789357828961).toISOString().slice(0, 10));
});

test('toArticleItem joins tags into the comma-separated string PublicPage.jsx expects', () => {
  const item = toArticleItem({
    articleId: '/content/abc',
    title: 'Some Article',
    uri: '/content/abc/some-article',
    lastPublishedAt: 1789357828961,
    tags: ['aws', 'serverless'],
    heroImageUrl: 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp',
  });
  assert.equal(item.tags, 'aws, serverless');
});

test('toArticleItem builds the full URL and carries the thumbnail through', () => {
  const item = toArticleItem({
    articleId: '/content/abc',
    title: 'Some Article',
    uri: '/content/abc/some-article',
    lastPublishedAt: 1789357828961,
    tags: [],
    heroImageUrl: 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp',
  });
  assert.equal(item.url, 'https://builder.aws.com/content/abc/some-article');
  assert.equal(item.thumbnailUrl, 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp');
  assert.equal(item.articleId, '/content/abc');
});

test('isValidTimezone accepts each of the frontend TIMEZONE_OPTIONS values', () => {
  for (const tz of ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'UTC']) {
    assert.equal(isValidTimezone(tz), true);
  }
});

test('isValidTimezone rejects anything outside that whitelist', () => {
  assert.equal(isValidTimezone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone(undefined), false);
});

test('toArticleItem carries the description through', () => {
  const item = toArticleItem({
    articleId: '/content/abc',
    title: 'Some Article',
    uri: '/content/abc/some-article',
    lastPublishedAt: 1789357828961,
    tags: [],
    description: 'What this article is about.',
    heroImageUrl: 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp',
  });
  assert.equal(item.description, 'What this article is about.');
});

const validArticle = {
  articleId: '/content/abc',
  title: 'Some Article',
  uri: '/content/abc/some-article',
  lastPublishedAt: 1789357828961,
  tags: [],
  heroImageUrl: 'https://prod-assets.cosmic.aws.dev/a/abc/hero.webp',
};

test('toArticleItem rejects a uri that would leave builder.aws.com', () => {
  for (const uri of ['//evil.example/x', 'https://evil.example/x', 'javascript:alert(1)']) {
    assert.equal(toArticleItem({ ...validArticle, uri }), null, uri);
  }
});

test('toArticleItem keeps an "@evil" style uri on builder.aws.com instead of treating it as userinfo', () => {
  const item = toArticleItem({ ...validArticle, uri: '@evil.example/x' });
  assert.equal(new URL(item.url).origin, 'https://builder.aws.com');
});

test('toArticleItem rejects an article whose publish date is not a real timestamp', () => {
  assert.equal(toArticleItem({ ...validArticle, lastPublishedAt: 'yesterday' }), null);
  assert.equal(toArticleItem({ ...validArticle, lastPublishedAt: undefined }), null);
});

test('toArticleItem skips an article missing its id or title, and nulls (not undefines) a missing description', () => {
  assert.equal(toArticleItem({ ...validArticle, articleId: undefined }), null);
  assert.equal(toArticleItem({ ...validArticle, title: '' }), null);
  // undefined would make DynamoDB's document client throw and abort the whole sync
  assert.equal(toArticleItem({ ...validArticle, description: undefined }).description, null);
});

test('toArticleItem only carries a thumbnail through when it is https', () => {
  assert.equal(toArticleItem({ ...validArticle, heroImageUrl: 'http://cdn.example/a.png' }).thumbnailUrl, null);
  assert.equal(toArticleItem({ ...validArticle, heroImageUrl: 'javascript:alert(1)' }).thumbnailUrl, null);
  assert.equal(toArticleItem({ ...validArticle, heroImageUrl: undefined }).thumbnailUrl, null);
});

test('progress-sync rejects oversized names, badgeIds, and progress values', () => {
  const ok = { badgeId: 'a', name: 'A', progress: 1 };
  assert.equal(isValidProgressItems([{ ...ok, name: 'x'.repeat(201) }]), false);
  assert.equal(isValidProgressItems([{ ...ok, badgeId: 'x'.repeat(201) }]), false);
  assert.equal(isValidProgressItems([{ ...ok, progress: 1_000_001 }]), false);
  assert.equal(isValidProgressItems([{ ...ok, name: 'x'.repeat(200), progress: 1_000_000 }]), true);
});

test('hasValidSyncKey accepts only an exact match', () => {
  assert.equal(hasValidSyncKey('s3cret-key', 's3cret-key'), true);
  assert.equal(hasValidSyncKey('s3cret-kez', 's3cret-key'), false);
  assert.equal(hasValidSyncKey('s3cret', 's3cret-key'), false); // different length must not throw
  assert.equal(hasValidSyncKey('s3cret-key-and-more', 's3cret-key'), false);
});

test('hasValidSyncKey fails closed when either side is missing', () => {
  assert.equal(hasValidSyncKey(undefined, 's3cret-key'), false);
  assert.equal(hasValidSyncKey('s3cret-key', undefined), false);
  assert.equal(hasValidSyncKey('', ''), false); // an unset or empty parameter must never match an empty header
  assert.equal(hasValidSyncKey(['s3cret-key'], 's3cret-key'), false);
});

test('parseBody returns a plain object and undefined for anything else', () => {
  assert.deepEqual(parseBody({ body: '{"a":1}' }), { a: 1 });
  assert.deepEqual(parseBody({}), {}); // no body
  for (const body of ['{bad json', 'null', '[]', '[1,2]', '"str"', '42']) {
    assert.equal(parseBody({ body }), undefined, body);
  }
});

test('a malformed percent-escape in the id is a 400, not a crash', async () => {
  const res = await handler(apiEvent('PUT', '/badges/%E0%A4%A', { body: '{}' }));
  assert.equal(res.statusCode, 400);
});

test('malformed JSON on the write routes is a 400, not a 500', async () => {
  for (const [method, path] of [['POST', '/badges'], ['POST', '/articles'], ['PUT', '/badges/x'], ['PUT', '/settings']]) {
    const res = await handler(apiEvent(method, path, { body: '{bad json' }));
    assert.equal(res.statusCode, 400, `${method} ${path}`);
  }
});

test('progress-sync with a wrong key is a 401 and logs the attempt without the key', async (t) => {
  mockSsm(t, withKey('the-real-key'));
  const warn = t.mock.method(console, 'warn', () => {});
  const res = await handler(apiEvent('POST', '/badges/progress-sync', { headers: { 'x-sync-key': 'guess-1234' }, body: '{}' }));
  assert.equal(res.statusCode, 401);
  // The alarm's metric filter matches this exact phrase — see template.yaml.
  assert.equal(warn.mock.calls[0].arguments[0], 'progress-sync rejected');
  assert.ok(!JSON.stringify(warn.mock.calls[0].arguments).includes('guess-1234'));
  assert.ok(!JSON.stringify(warn.mock.calls[0].arguments).includes('the-real-key'));
});

test('progress-sync with the right key is authenticated (a bad body then fails as 400, not 401)', async (t) => {
  mockSsm(t, withKey('the-real-key'));
  const res = await handler(apiEvent('POST', '/badges/progress-sync', { headers: { 'x-sync-key': 'the-real-key' }, body: '{bad json' }));
  assert.equal(res.statusCode, 400);
});

test('progress-sync is a 401 when the parameter has no usable value, even with an empty header', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let value;
  mockSsm(t, async () => ({ Parameter: { Value: value } }));
  for (value of [undefined, '']) {
    clearSyncKeyCache();
    for (const headers of [{}, { 'x-sync-key': '' }]) {
      const res = await handler(apiEvent('POST', '/badges/progress-sync', { headers, body: '{}' }));
      assert.equal(res.statusCode, 401, `value=${JSON.stringify(value)} headers=${JSON.stringify(headers)}`);
    }
  }
});

test('an unreadable sync key is a 500 and is not counted as a rejected key', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  mockSsm(t, async () => { throw new Error('AccessDeniedException'); });
  const res = await handler(apiEvent('POST', '/badges/progress-sync', { headers: { 'x-sync-key': 'anything' }, body: '{}' }));
  assert.equal(res.statusCode, 500);
  // A rejected-key log line feeds the brute-force alarm; an SSM outage must not.
  assert.equal(warn.mock.callCount(), 0);
});

test('getSyncKey reads the configured parameter with decryption on', async (t) => {
  process.env.SYNC_KEY_PARAM = '/test/sync-key';
  const send = mockSsm(t, withKey('abc'));
  assert.equal(await getSyncKey(), 'abc');
  assert.deepEqual(send.mock.calls[0].arguments[0].input, { Name: '/test/sync-key', WithDecryption: true });
});

test('getSyncKey caches for five minutes, then reads again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const send = mockSsm(t, withKey('abc'));
  await getSyncKey();
  await getSyncKey();
  assert.equal(send.mock.callCount(), 1);
  t.mock.timers.tick(5 * 60 * 1000 - 1);
  await getSyncKey();
  assert.equal(send.mock.callCount(), 1); // one millisecond short of expiry
  t.mock.timers.tick(1);
  await getSyncKey();
  assert.equal(send.mock.callCount(), 2);
});

test('a rotated key is picked up once the cache expires, and not before', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let value = 'old-key';
  mockSsm(t, async () => ({ Parameter: { Value: value } }));
  assert.equal(await getSyncKey(), 'old-key');
  value = 'new-key';
  assert.equal(await getSyncKey(), 'old-key'); // documented rotation lag
  t.mock.timers.tick(5 * 60 * 1000);
  assert.equal(await getSyncKey(), 'new-key');
});

test('a failed read is not cached, so the next request retries', async (t) => {
  let failing = true;
  const send = mockSsm(t, async () => {
    if (failing) throw new Error('boom');
    return { Parameter: { Value: 'abc' } };
  });
  await assert.rejects(() => getSyncKey(), /boom/);
  failing = false;
  assert.equal(await getSyncKey(), 'abc');
  assert.equal(send.mock.callCount(), 2);
});

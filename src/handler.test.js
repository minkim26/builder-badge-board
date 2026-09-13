const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUpdateExpression, isValidProgressItems } = require('./handler');

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStoredTheme, setStoredTheme, resolveTheme, applyTheme } from './theme.js';

test('resolveTheme resolves system to light when the OS prefers light', () => {
  assert.equal(resolveTheme('system', false), 'light');
});

test('resolveTheme resolves system to dark when the OS prefers dark', () => {
  assert.equal(resolveTheme('system', true), 'dark');
});

test('resolveTheme returns an explicit light choice regardless of OS preference', () => {
  assert.equal(resolveTheme('light', true), 'light');
});

test('resolveTheme returns an explicit dark choice regardless of OS preference', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('getStoredTheme defaults to system when nothing is stored', () => {
  const storage = { getItem: () => null };
  assert.equal(getStoredTheme(storage), 'system');
});

test('getStoredTheme defaults to system for a garbage stored value', () => {
  const storage = { getItem: () => 'blue' };
  assert.equal(getStoredTheme(storage), 'system');
});

test('getStoredTheme returns a validly stored explicit theme', () => {
  const storage = { getItem: () => 'dark' };
  assert.equal(getStoredTheme(storage), 'dark');
});

test('getStoredTheme defaults to system when storage access throws', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(getStoredTheme(storage), 'system');
});

test('setStoredTheme persists the theme to storage', () => {
  const calls = [];
  const storage = { setItem: (key, value) => calls.push([key, value]) };
  setStoredTheme('dark', storage);
  assert.deepEqual(calls, [['theme', 'dark']]);
});

test('setStoredTheme does not throw when storage access throws', () => {
  const storage = {
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => setStoredTheme('dark', storage));
});

test('applyTheme sets data-theme for an explicit light choice', () => {
  const root = { dataset: {} };
  applyTheme('light', root);
  assert.equal(root.dataset.theme, 'light');
});

test('applyTheme sets data-theme for an explicit dark choice', () => {
  const root = { dataset: {} };
  applyTheme('dark', root);
  assert.equal(root.dataset.theme, 'dark');
});

test('applyTheme clears data-theme for system, so CSS falls back to prefers-color-scheme', () => {
  const root = { dataset: { theme: 'dark' } };
  applyTheme('system', root);
  assert.equal('theme' in root.dataset, false);
});

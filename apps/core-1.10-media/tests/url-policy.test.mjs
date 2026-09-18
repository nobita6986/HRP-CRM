/**
 * tests/url-policy.test.mjs — SSRF policy harness (CORE/1.10).
 *
 * Deterministic string-based tests. NO real network calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateUrl,
  evaluateBatch,
  isPrivateHost,
  isPrivateIPv4,
  isPrivateIPv6,
  installDenyList,
  resetDenyList,
  assertUrlDenied,
  assertUrlAllowed,
} from '../dist/index.js';

test('url-policy: rejects http:// (non-https scheme)', () => {
  assertUrlDenied('http://example.com/');
  assertUrlDenied('http://example.com:80/foo');
  assertUrlDenied('ftp://example.com/foo');
  assertUrlDenied('file:///etc/passwd');
  assertUrlDenied('gopher://example.com/');
});

test('url-policy: accepts https:// public hosts', () => {
  assertUrlAllowed('https://example.com/');
  assertUrlAllowed('https://api.zalo.cloud/webhook');
  assertUrlAllowed('https://chatwoot.example.com/inbox');
});

test('url-policy: rejects loopback IPv4', () => {
  assertUrlDenied('https://127.0.0.1/');
  assertUrlDenied('https://127.0.0.1:3000/health');
  assertUrlDenied('https://127.255.255.254/foo');
});

test('url-policy: rejects private RFC1918 IPv4', () => {
  assertUrlDenied('https://10.0.0.1/');
  assertUrlDenied('https://10.255.255.255/');
  assertUrlDenied('https://172.16.0.1/');
  assertUrlDenied('https://172.31.255.254/');
  assertUrlDenied('https://192.168.0.1/');
  assertUrlDenied('https://192.168.1.100:8080/admin');
});

test('url-policy: rejects cloud metadata 169.254.169.254', () => {
  assertUrlDenied('https://169.254.169.254/latest/meta-data/');
  assertUrlDenied('https://169.254.0.1/');
});

test('url-policy: rejects link-local IPv6', () => {
  assertUrlDenied('https://[::1]/');
  assertUrlDenied('https://[fe80::1]/');
  assertUrlDenied('https://[fc00::1]/');
  assertUrlDenied('https://[fd00::1]/');
});

test('url-policy: rejects localhost hostname', () => {
  assertUrlDenied('https://localhost/');
  assertUrlDenied('https://api.localhost/');
});

test('url-policy: rejects .local and .internal hostnames', () => {
  assertUrlDenied('https://service.internal/');
  assertUrlDenied('https://host.local/');
});

test('url-policy: rejects malformed URL', () => {
  const d = evaluateUrl('not-a-url');
  assert.equal(d.allow, false);
  assert.match(d.reason, /INVALID_URL/u);
});

test('url-policy: deny list extension', () => {
  installDenyList(['evil.example.com']);
  try {
    assertUrlDenied('https://evil.example.com/');
    assertUrlAllowed('https://good.example.com/');
  } finally {
    resetDenyList();
  }
});

test('url-policy: evaluateBatch aggregates allowed/denied', () => {
  const batch = evaluateBatch([
    'https://example.com/ok',
    'https://127.0.0.1/denied',
    'http://example.com/bad-scheme',
    'file:///etc/passwd',
  ]);
  assert.equal(batch.allowed.length, 1);
  assert.equal(batch.denied.length, 3);
  assert.equal(batch.allowed[0], 'https://example.com/ok');
});

test('url-policy: isPrivateIPv4 unit checks', () => {
  assert.equal(isPrivateIPv4('127.0.0.1'), true);
  assert.equal(isPrivateIPv4('10.0.0.1'), true);
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.15.0.1'), false);
  assert.equal(isPrivateIPv4('172.32.0.1'), false);
  assert.equal(isPrivateIPv4('192.168.0.1'), true);
  assert.equal(isPrivateIPv4('169.254.169.254'), true);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('1.1.1.1'), false);
});

test('url-policy: isPrivateIPv6 unit checks', () => {
  assert.equal(isPrivateIPv6('::1'), true);
  assert.equal(isPrivateIPv6('fc00::1'), true);
  assert.equal(isPrivateIPv6('fd00::1'), true);
  assert.equal(isPrivateIPv6('fe80::1'), true);
  assert.equal(isPrivateIPv6('feb0::1'), true);
  assert.equal(isPrivateIPv6('2001:db8::1'), false);
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false);
});

test('url-policy: isPrivateHost unit checks', () => {
  assert.equal(isPrivateHost('localhost'), true);
  assert.equal(isPrivateHost('host.local'), true);
  assert.equal(isPrivateHost('host.internal'), true);
  assert.equal(isPrivateHost('example.com'), false);
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('[::1]'), true);
});

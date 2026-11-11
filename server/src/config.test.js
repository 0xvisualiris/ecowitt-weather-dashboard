import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, legalText } from './config.js';

function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('a missing config.yaml does not force demo mode, so admin-page settings can take over', () => {
  const missing = path.join(os.tmpdir(), `no-such-config-${process.pid}.yaml`);
  const cfg = withEnv({ CONFIG_PATH: missing, DEMO: undefined }, () => loadConfig());
  assert.equal(cfg.server.demo, false);
});

test('DEMO=1 still forces demo mode without a config.yaml', () => {
  const missing = path.join(os.tmpdir(), `no-such-config-${process.pid}.yaml`);
  const cfg = withEnv({ CONFIG_PATH: missing, DEMO: '1' }, () => loadConfig());
  assert.equal(cfg.server.demo, true);
});

test('server.demo: true in config.yaml still forces demo mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, 'server:\n  demo: true\n');
  try {
    const cfg = withEnv({ CONFIG_PATH: file, DEMO: undefined }, () => loadConfig());
    assert.equal(cfg.server.demo, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legalText keeps a string or the known languages, and drops empty texts', () => {
  assert.equal(legalText('  Impressum  '), 'Impressum');
  assert.deepEqual(legalText({ en: 'Imprint', de: ' Impressum ', fr: 'Mentions légales' }), { en: 'Imprint', de: 'Impressum' });
  assert.deepEqual(legalText({ de: 'Nur Deutsch', en: '   ' }), { de: 'Nur Deutsch' });
  for (const empty of [undefined, null, '', '   ', {}, { en: '' }, ['a'], 42]) assert.equal(legalText(empty), '');
});

test('legal texts in config.yaml are loaded and lock their admin fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, 'legal:\n  imprint: |\n    Max Muster\n    Musterweg 1\n  privacy:\n    en: Privacy\n    de: Datenschutz\n');
  try {
    const cfg = withEnv({ CONFIG_PATH: file, DEMO: undefined }, () => loadConfig());
    assert.deepEqual(cfg.legal, { imprint: 'Max Muster\nMusterweg 1', privacy: { en: 'Privacy', de: 'Datenschutz' } });
    assert.equal(cfg._locked.legalImprint, true);
    assert.equal(cfg._locked.legalPrivacy, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

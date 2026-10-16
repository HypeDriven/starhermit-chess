// Localization coverage: every English key the markup and code use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, the language follows sh-language.js and
// switches live, and the platform strings and the Settings panel cover the
// nine locales too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['app.js', 'game.js', 'local.js', 'ui.js', 'net.js', 'audio.js']) codeKeys(read(f), ['tr']).forEach((k) => keys.add(k));
  return [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  assert.deepEqual(audit(loadTables(ROOT, 'strings.js', 'CH_STRINGS'), usedKeys()), []);
});

test('the rules script messages shown to players are all translatable', () => {
  const ui = read('ui.js');
  const msgs = [...read('server.js').matchAll(/error: '([^']+)'/g)].map((m) => m[1]).filter((m) => !/^(Chess needs|Cannot play|Practice needs|Unknown command)/.test(m));
  for (const m of msgs) assert.ok(ui.includes(`N('${m}')`), `ui.js ruleMessage lists "${m}"`);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'strings.js', i18n: 'i18n.js', global: 'CHI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Offer draw'), 'Remis anbieten');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Table talk'), 'Clavardage');
  assert.equal(I18N.T('Offer draw'), 'Proposer la nulle');
  I18N.language.setChoice('es-ES');
  assert.equal(I18N.T('You won'), 'Has ganado');
  assert.equal(I18N.T('{name} to move', { name: 'hal' }), 'Le toca a hal');
});

test('platform strings cover all nine locales, including the terms message', () => {
  const sb = { self: {} };
  vm.runInNewContext(read('platform-strings.js'), sb);
  const PS = sb.self.PlatformStrings;
  const keys = Object.keys(PS.platformStrings('en-US'));
  assert.ok(keys.includes('termsRequired'));
  for (const l of LOCALES) {
    assert.ok(PS.PLATFORM_LOCALES.includes(l), l);
    for (const k of keys) assert.ok(PS.platformStrings(l)[k], `${l} ${k}`);
  }
});

test('the Settings panel follows the game language, not navigator.languages', () => {
  const src = read('settings.js');
  assert.match(src, /window\.CHI18N \? window\.CHI18N\.lang/);
  assert.match(src, /addEventListener\('ch-language'/);
  for (const l of LOCALES) assert.ok(src.includes(`'${l}': {`), `settings.js has ${l}`);
});

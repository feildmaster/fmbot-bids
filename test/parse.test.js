const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parse, toBoolean, toNumber } = require('../src/parse');

const message = (text, data = {}) => ({ type: 'text', text, data });

test('a prefixed command is split into its words and the rest of the line', () => {
  assert.deepEqual(parse(message('.feature-bid 12 500 hidden')), {
    command: 'feature-bid',
    words: ['12', '500', 'hidden'],
    rest: '12 500 hidden',
  });
});

test('the rest of the line keeps its words, for titles', () => {
  const parsed = parse(message('.feature-add Dark mode for the page'));

  assert.equal(parsed.command, 'feature-add');
  assert.equal(parsed.rest, 'Dark mode for the page');
});

test('commands do not care about case or a space after the prefix', () => {
  assert.equal(parse(message('.FEATURE-LIST')).command, 'feature-list');
  assert.equal(parse(message('. feature-list open')).command, 'feature-list');
});

test('a command alone has no words', () => {
  assert.deepEqual(parse(message('.feature-mine')), { command: 'feature-mine', words: [], rest: '' });
});

test('direct messages do not need the prefix, channels do', () => {
  assert.equal(parse(message('feature-list', { isPM: true })).command, 'feature-list');
  assert.equal(parse(message('feature-list')), null);
  assert.equal(parse(message('feature-list', { isPM: null })), null);
});

test('other plugins commands and ordinary text are not ours', () => {
  ['.say hi', '.balance', 'hello .feature-list', '.', '', '.feature', '.feature-lists'].forEach((text) => {
    assert.equal(parse(message(text)), null, text);
  });
});

test('names that exist on every object are not commands', () => {
  ['.constructor', '.toString', '.__proto__', '.hasOwnProperty'].forEach((text) => {
    assert.equal(parse(message(text)), null, text);
  });
});

test('a message without text is ignored', () => {
  assert.equal(parse({ type: 'text', data: {} }), null);
  assert.equal(parse({ type: 'text', text: null, data: {} }), null);
});

test('numbers must be whole and positive', () => {
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber('0'), 0);
  ['-5', '5.5', 'abc', '', undefined, null, '1e3', ' 5', '9'.repeat(30)].forEach((word) => {
    assert.equal(toNumber(word), undefined, String(word));
  });
});

test('the hidden word accepts the spellings people use', () => {
  ['true', 'TRUE', 'yes', 'y', '1', 'hidden', 'private'].forEach((word) => {
    assert.equal(toBoolean(word), true, word);
  });
  ['false', 'no', '0', '', undefined, 'maybe'].forEach((word) => {
    assert.equal(toBoolean(word), false, String(word));
  });
});

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ADMINS_TEMPLATE, DEFAULT_MIN_BID, needsAdmins, parseConfig,
} = require('../src/config');

const alan = '208562116590960640';
const sam = '110000000000000001';

test('admins are Discord ids written as text', () => {
  const { admins, rejected } = parseConfig({ admins: [alan, sam] });

  assert.deepEqual([...admins].sort(), [sam, alan].sort());
  assert.deepEqual(rejected, []);
});

test('spaces around an id are ignored', () => {
  assert.deepEqual([...parseConfig({ admins: [`  ${alan} `] }).admins], [alan]);
});

test('an id entered as a number is refused, because its last digits are already lost', () => {
  const { admins, rejected } = parseConfig({ admins: [208562116590960640, 123456789012345, alan] });

  assert.deepEqual([...admins], [alan]);
  assert.equal(rejected.length, 2);
  assert.equal(typeof rejected[0], 'number');
});

test('anything that is not an id is refused and reported', () => {
  const { admins, rejected } = parseConfig({
    admins: ['alan', '123', '', '   ', null, true, {}, [alan], `${alan}x`, '12 34'],
  });

  assert.equal(admins.size, 0);
  assert.equal(rejected.length, 10);
});

test('the database may hand an array back as an object with numbered keys', () => {
  const { admins } = parseConfig({ admins: { 0: alan, 2: sam } });

  assert.deepEqual([...admins].sort(), [sam, alan].sort());
});

test('a single id on its own works', () => {
  assert.deepEqual([...parseConfig({ admins: alan }).admins], [alan]);
});

test('a missing or odd config means no admins and nothing to report', () => {
  const configs = [undefined, null, {}, 'text', 5, [], { admins: null }, { admins: [] }, { admins: 7 }];

  configs.forEach((config) => {
    const parsed = parseConfig(config);
    assert.equal(parsed.admins.size, 0, JSON.stringify(config));
    assert.equal(parsed.rejected.length, 0, JSON.stringify(config));
  });
});

const [PLACEHOLDER] = ADMINS_TEMPLATE;

test('the placeholder alone means no admins and nothing to report', () => {
  const { admins, rejected } = parseConfig({ admins: ADMINS_TEMPLATE });

  assert.equal(admins.size, 0);
  assert.deepEqual(rejected, []);
});

test('the placeholder can stay next to real admins, in any list shape', () => {
  const list = parseConfig({ admins: [PLACEHOLDER, alan, ` ${PLACEHOLDER} `] });
  const map = parseConfig({ admins: { 0: PLACEHOLDER, 1: alan } });

  assert.deepEqual([...list.admins], [alan]);
  assert.deepEqual(list.rejected, []);
  assert.deepEqual([...map.admins], [alan]);
  assert.deepEqual(map.rejected, []);
});

test('only the exact placeholder is let through, anything else odd is still reported', () => {
  const { rejected } = parseConfig({
    admins: [PLACEHOLDER, PLACEHOLDER.toUpperCase(), `${PLACEHOLDER}2`, 'placeholder', 'alan'],
  });

  assert.deepEqual(rejected, [PLACEHOLDER.toUpperCase(), `${PLACEHOLDER}2`, 'placeholder', 'alan']);
});

test('the placeholder is written when the config has no admins at all, and only then', () => {
  [undefined, null, {}, 'text', 5, [], { minBid: 20 }].forEach((config) => {
    assert.equal(needsAdmins(config), true, JSON.stringify(config));
  });
  [
    { admins: ADMINS_TEMPLATE }, { admins: [alan] }, { admins: alan }, { admins: '' }, { admins: [] },
  ].forEach((config) => {
    assert.equal(needsAdmins(config), false, JSON.stringify(config));
  });
});

test('the placeholder is the one vouchers writes', () => {
  assert.deepEqual(ADMINS_TEMPLATE, ['<placeholder>']);
});

test('the smallest bid is ten unless the config says otherwise', () => {
  assert.equal(DEFAULT_MIN_BID, 10);
  assert.equal(parseConfig({}).minBid, 10);
  assert.equal(parseConfig({ minBid: 25 }).minBid, 25);
  assert.equal(parseConfig({ minBid: '40' }).minBid, 40);
});

test('a minimum that makes no sense falls back to the default', () => {
  [0, -5, 2.5, 'lots', null, NaN, Infinity, 2 ** 60].forEach((minBid) => {
    assert.equal(parseConfig({ minBid }).minBid, 10, String(minBid));
  });
});

test('the board needs a channel and a connector, written as text', () => {
  const { board, boardProblem } = parseConfig({ board: { channel: '429383061965373443', cid: 'fmbot-cid' } });

  assert.deepEqual(board, { channel: '429383061965373443', cid: 'fmbot-cid' });
  assert.equal(boardProblem, undefined);
});

test('spaces around the board settings are ignored', () => {
  assert.deepEqual(
    parseConfig({ board: { channel: ' 429383061965373443 ', cid: ' fmbot-cid ' } }).board,
    { channel: '429383061965373443', cid: 'fmbot-cid' },
  );
});

test('no board setting means no board and nothing to report', () => {
  [{}, { board: null }, undefined].forEach((config) => {
    const parsed = parseConfig(config);
    assert.equal(parsed.board, null);
    assert.equal(parsed.boardProblem, undefined);
  });
});

test('a board setting that cannot work is reported and ignored', () => {
  [
    { board: { channel: 429383061965373443, cid: 'fmbot-cid' } },
    { board: { channel: '429383061965373443' } },
    { board: { channel: '429383061965373443', cid: '' } },
    { board: { channel: 'general', cid: 'fmbot-cid' } },
    { board: 'general' },
    { board: {} },
    { board: [] },
  ].forEach((config) => {
    const parsed = parseConfig(config);
    assert.equal(parsed.board, null, JSON.stringify(config));
    assert.match(parsed.boardProblem, /channel id and a connector cid/, JSON.stringify(config));
  });
});

test('the log channel is read the same way as the board, and does not touch it', () => {
  const parsed = parseConfig({
    board: { channel: '429383061965373443', cid: 'fmbot-cid' },
    log: { channel: ' 429383061965373444 ', cid: ' fmbot-cid ' },
  });

  assert.deepEqual(parsed.log, { channel: '429383061965373444', cid: 'fmbot-cid' });
  assert.deepEqual(parsed.board, { channel: '429383061965373443', cid: 'fmbot-cid' });
  assert.equal(parsed.logProblem, undefined);
});

test('no log setting means no log and nothing to report', () => {
  [{}, { log: null }, undefined].forEach((config) => {
    const parsed = parseConfig(config);
    assert.equal(parsed.log, null);
    assert.equal(parsed.logProblem, undefined);
  });
});

test('a log setting that cannot work is reported and ignored, and the board is unaffected', () => {
  const parsed = parseConfig({
    board: { channel: '429383061965373443', cid: 'fmbot-cid' },
    log: { channel: 'general', cid: 'fmbot-cid' },
  });

  assert.equal(parsed.log, null);
  assert.match(parsed.logProblem, /^log needs a channel id and a connector cid/);
  assert.equal(parsed.boardProblem, undefined);
  assert.notEqual(parsed.board, null);
});

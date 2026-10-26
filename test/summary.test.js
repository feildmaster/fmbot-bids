const assert = require('node:assert/strict');
const { test } = require('node:test');

const { summarize } = require('../src/summary');

const bid = (overrides = {}) => ({
  status: 'confirmed', discordId: '1', name: 'Alan', amount: 100, hidden: false, createdAt: 1, ...overrides,
});

test('nothing confirmed means nothing to show', () => {
  assert.deepEqual(summarize([]), { total: 0, backers: 0, top: undefined });
  assert.deepEqual(summarize([bid({ status: 'pending' }), bid({ status: 'failed' })]), {
    total: 0, backers: 0, top: undefined,
  });
});

test('only confirmed bids count, and bidders are counted once however often they bid', () => {
  const summary = summarize([
    bid({ amount: 100 }),
    bid({ amount: 50 }),
    bid({ discordId: '2', name: 'Sam', amount: 25 }),
    bid({ discordId: '3', status: 'pending', amount: 999 }),
  ]);

  assert.equal(summary.total, 175);
  assert.equal(summary.backers, 2);
  assert.deepEqual(summary.top, { name: 'Alan', amount: 150 });
});

test('hidden bids count towards the total and the bidders but are never the top backer', () => {
  const summary = summarize([
    bid({ discordId: '1', amount: 900, hidden: true }),
    bid({ discordId: '2', name: 'Sam', amount: 30 }),
  ]);

  assert.deepEqual(summary, { total: 930, backers: 2, top: { name: 'Sam', amount: 30 } });
});

test('when every bid is hidden there is no top backer', () => {
  const summary = summarize([bid({ hidden: true }), bid({ discordId: '2', hidden: true })]);

  assert.equal(summary.top, undefined);
  assert.equal(summary.backers, 2);
});

test('a tie goes to whoever reached the amount first, then to the name that sorts first', () => {
  const sam = bid({ discordId: '2', name: 'Sam', createdAt: 1 });
  const alan = bid({ discordId: '1', name: 'Alan', createdAt: 2 });

  assert.equal(summarize([alan, sam]).top.name, 'Sam');
  assert.equal(summarize([{ ...alan, createdAt: 1 }, sam]).top.name, 'Alan');
});

test('firestore timestamps and plain numbers can be compared', () => {
  const early = bid({ discordId: '2', name: 'Sam', createdAt: { toMillis: () => 1000 } });
  const late = bid({ discordId: '1', name: 'Alan', createdAt: { toMillis: () => 2000 } });

  assert.equal(summarize([late, early]).top.name, 'Sam');
});

test('the bids that were passed in are left alone', () => {
  const bids = [bid(), bid({ discordId: '2', name: 'Sam' })];
  const before = JSON.stringify(bids);

  summarize(bids);

  assert.equal(JSON.stringify(bids), before);
});

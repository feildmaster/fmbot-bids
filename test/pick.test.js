const assert = require('node:assert/strict');
const { test } = require('node:test');

const { pickBids } = require('../src/pick');

const bidsOf = (...amounts) => amounts.map((amount, index) => ({
  id: `b${index + 1}`, amount, createdAt: index + 1,
}));
const idsOf = result => result.picked.map(bid => bid.id).sort();

test('a target at or above the total takes every bid', () => {
  const bids = bidsOf(60, 50, 40);

  assert.deepEqual(idsOf(pickBids(bids, 150)), ['b1', 'b2', 'b3']);
  assert.equal(pickBids(bids, 150).sum, 150);
  assert.equal(pickBids(bids, 999).sum, 150);
});

test('a later small bid fills the gap that an older one would overshoot', () => {
  const result = pickBids(bidsOf(60, 50, 40), 100);

  assert.deepEqual(idsOf(result), ['b1', 'b3']);
  assert.equal(result.sum, 100);
});

test('a combination is found even when taking the oldest bids first would miss it', () => {
  const result = pickBids(bidsOf(60, 50, 50), 100);

  assert.deepEqual(idsOf(result), ['b2', 'b3']);
  assert.equal(result.sum, 100);
});

test('when several combinations fit, the older bids are the ones taken', () => {
  const result = pickBids(bidsOf(50, 50, 50), 100);

  assert.deepEqual(idsOf(result), ['b1', 'b2']);
});

test('the order the bids are given in does not matter, their age does', () => {
  const bids = bidsOf(50, 50, 50);

  assert.deepEqual(idsOf(pickBids([...bids].reverse(), 100)), ['b1', 'b2']);
});

test('with no exact fit it reports the closest total below the target', () => {
  const result = pickBids(bidsOf(70, 60), 100);

  assert.equal(result.sum, 70);
  assert.deepEqual(idsOf(result), ['b1']);
});

test('when no bid is small enough nothing is picked', () => {
  const result = pickBids(bidsOf(70, 60), 50);

  assert.equal(result.sum, 0);
  assert.deepEqual(result.picked, []);
});

test('the bids that were passed in are left alone', () => {
  const bids = bidsOf(60, 50, 40);
  const copy = JSON.parse(JSON.stringify(bids));

  pickBids(bids, 100);

  assert.deepEqual(bids, copy);
});

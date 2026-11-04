const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

let fake;
let store;

const bidInput = (overrides = {}) => ({
  featureId: 1,
  discordId: '111',
  name: 'Alan',
  amount: 50,
  hidden: false,
  memo: 'Feature bid #1: Dark mode',
  ...overrides,
});

beforeEach(() => {
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
});

test('features are numbered from one, in the order they are added', async () => {
  const first = await store.createFeature({ title: 'One', createdBy: '9' });
  const second = await store.createFeature({ title: 'Two', createdBy: '9' });
  const third = await store.createFeature({ title: 'Three', createdBy: '9' });

  assert.deepEqual([first, second, third], [1, 2, 3]);
  assert.equal(fake.data.get('counters/features').next, 4);
});

test('a new feature is open and records who added it', async () => {
  const id = await store.createFeature({ title: 'Dark mode', createdBy: '9' });

  assert.deepEqual(await store.getFeature(id), {
    id: '1', title: 'Dark mode', status: 'open', createdBy: '9', createdAt: 1,
  });
});

test('a feature can be looked up by number or by text, and an unknown one is null', async () => {
  await store.createFeature({ title: 'Dark mode', createdBy: '9' });

  assert.equal((await store.getFeature(1)).title, 'Dark mode');
  assert.equal((await store.getFeature('1')).title, 'Dark mode');
  assert.equal(await store.getFeature(2), null);
});

test('features are listed by status, and closing one records who did it', async () => {
  await store.createFeature({ title: 'A', createdBy: '9' });
  await store.createFeature({ title: 'B', createdBy: '9' });
  await store.createFeature({ title: 'C', createdBy: '9' });

  await store.setFeatureStatus(2, 'done', '8');
  await store.setFeatureStatus(3, 'removed', '7');

  assert.deepEqual((await store.listFeatures('open')).map(f => f.title), ['A']);
  assert.deepEqual((await store.listFeatures('done')).map(f => f.title), ['B']);
  assert.deepEqual((await store.listFeatures('removed')).map(f => f.title), ['C']);
  assert.equal((await store.getFeature(2)).closedBy, '8');
});

test('a new bid is pending and does not store a request id, which comes from its own id', async () => {
  const bid = await store.createBid(bidInput());

  assert.equal(bid.status, 'pending');
  assert.equal('requestId' in bid, false);

  const { id, ...stored } = bid;
  assert.deepEqual(fake.data.get(`bids/${id}`), stored);
});

test('a bid stores what is needed to charge it again later', async () => {
  const bid = await store.createBid(bidInput({ featureId: '4', hidden: true }));
  const stored = fake.data.get(`bids/${bid.id}`);

  assert.equal(stored.featureId, 4);
  assert.equal(stored.hidden, true);
  assert.equal(stored.memo, 'Feature bid #1: Dark mode');
  assert.equal(stored.amount, 50);
  assert.equal(stored.discordId, '111');
  assert.equal('id' in stored, false);
});

test('hidden is always a boolean', async () => {
  const unset = await store.createBid(bidInput({ hidden: undefined }));
  const text = await store.createBid(bidInput({ hidden: 'yes' }));

  assert.equal(fake.data.get(`bids/${unset.id}`).hidden, false);
  assert.equal(fake.data.get(`bids/${text.id}`).hidden, false);
});

test('bids can be found by status, feature and person', async () => {
  const a = await store.createBid(bidInput());
  const b = await store.createBid(bidInput({ featureId: 2, discordId: '222' }));
  const c = await store.createBid(bidInput({ featureId: 2 }));
  await store.setBidStatus(a.id, 'confirmed');
  await store.setBidStatus(b.id, 'failed', { reason: 'Balance insufficient' });

  assert.deepEqual((await store.pendingBids()).map(x => x.id), [c.id]);
  assert.deepEqual((await store.confirmedBids()).map(x => x.id), [a.id]);
  assert.deepEqual((await store.bidsForFeature(2)).map(x => x.id).sort(), [b.id, c.id].sort());
  assert.deepEqual((await store.bidsByUser('111')).map(x => x.id).sort(), [a.id, c.id].sort());
  assert.equal(fake.data.get(`bids/${b.id}`).reason, 'Balance insufficient');
});

test('changing the status of a bid that does not exist is an error', async () => {
  await assert.rejects(store.setBidStatus('nope', 'confirmed'), /No document/);
});

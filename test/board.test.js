const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createBoard = require('../src/board');
const createStore = require('../src/store');
const { summarize } = require('../src/summary');
const createFakeFirestore = require('./helpers/fakeFirestore');

const { render } = require('../src/embed');

const TARGET = { channel: '555', cid: 'fmbot-cid' };

let fake;
let store;
let board;
let requests;
let answer;
let errors;
let timers;

const createTimers = () => {
  const pending = new Map();
  let next = 0;
  return {
    setTimer: (fn, ms) => {
      next += 1;
      pending.set(next, { fn, ms });
      return next;
    },
    clearTimer: id => pending.delete(id),
    fire: () => [...pending.entries()].forEach(([id, timer]) => {
      pending.delete(id);
      timer.fn();
    }),
    count: () => pending.size,
  };
};

const flush = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

const defaultAnswer = (options) => {
  if (options.command === 'post-message') {
    return { data: { id: `msg-${requests.length - 1}`, channel: options.arg } };
  }
  if (options.command === 'edit-message') return { data: { id: options.data.id } };
  return { data: 'Success' };
};

const addFeature = async (title = 'Dark mode', extra = {}) => {
  const id = await store.createFeature({ title, createdBy: '9' });
  if (extra.description) await store.getFeature(id).then(() => fake.data.set(`features/${id}`, { ...fake.data.get(`features/${id}`), ...extra }));
  return id;
};

const bid = async (featureId, discordId, name, amount, hidden = false) => {
  const placed = await store.createBid({
    featureId, discordId, name, amount, hidden, memo: 'm',
  });
  await store.setBidStatus(placed.id, 'confirmed');
};

beforeEach(() => {
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  requests = [];
  errors = [];
  timers = createTimers();
  answer = defaultAnswer;
  board = createBoard({
    store,
    request: async (options) => {
      requests.push(options);
      const reply = answer(options);
      if (reply instanceof Error) throw reply;
      if (reply && reply.reject !== undefined) throw reply.reject;
      return reply;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onError: error => errors.push(error.message),
  });
  board.configure(TARGET);
});

test('a feature with no bids shows zero and no top backer', () => {
  const embed = render({ id: '3', title: 'Dark mode', status: 'open' }, summarize([]));

  assert.deepEqual(embed, {
    title: '#3 Dark mode',
    color: 0x5865f2,
    fields: [{ name: 'Backed by', value: '0 FMC from 0 bidders', inline: true }],
    footer: { text: 'Open for bids · feature-bid 3 <amount>' },
  });
});

test('a backed feature shows the total, the bidders and the top public backer', () => {
  const bids = [
    {
      status: 'confirmed', discordId: '1', name: 'Alan', amount: 1500, hidden: false, createdAt: 1,
    },
    {
      status: 'confirmed', discordId: '2', name: 'Sam', amount: 500, hidden: true, createdAt: 2,
    },
  ];

  const embed = render({ id: '1', title: 'Dark mode', status: 'open' }, summarize(bids));

  assert.deepEqual(embed.fields, [
    { name: 'Backed by', value: '2,000 FMC from 2 bidders', inline: true },
    { name: 'Top public backer', value: 'Alan 1,500', inline: true },
  ]);
  assert.equal(JSON.stringify(embed).includes('Sam'), false);
});

test('a finished feature is green and says it was built, and a description is shown', () => {
  const embed = render(
    {
      id: '2', title: 'Export', status: 'done', description: 'As a CSV file',
    },
    summarize([]),
  );

  assert.equal(embed.color, 0x57f287);
  assert.equal(embed.footer.text, 'Built');
  assert.equal(embed.description, 'As a CSV file');
});

test('the embed never carries an undefined value, which the database would refuse', () => {
  const embeds = [
    render({ id: '1', title: 'A', status: 'open' }, summarize([])),
    render({
      id: '1', title: 'A', status: 'done', description: 'x',
    }, summarize([])),
  ];

  embeds.forEach((embed) => {
    assert.equal(JSON.stringify(embed).includes('undefined'), false);
    assert.equal(Object.values(embed).some(value => value === undefined), false);
  });
});

test('a new feature is posted once, and where it was posted is remembered', async () => {
  const id = await addFeature();

  board.touch(id);
  timers.fire();
  await flush();

  assert.equal(requests.length, 1);
  assert.deepEqual(
    { target: requests[0].target, command: requests[0].command, arg: requests[0].arg },
    { target: 'fmbot-cid', command: 'post-message', arg: '555' },
  );
  assert.equal(requests[0].data.embed.title, '#1 Dark mode');
  assert.deepEqual((await store.getFeature(id)).board, { channel: '555', id: 'msg-0', cid: 'fmbot-cid' });
});

test('a posted feature is edited, not posted again, when it changes', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();

  await bid(id, '1', 'Alan', 300);
  board.touch(id);
  timers.fire();
  await flush();

  assert.deepEqual(requests.map(r => r.command), ['post-message', 'edit-message']);
  assert.equal(requests[1].data.id, 'msg-0');
  assert.equal(requests[1].data.embed.fields[0].value, '300 FMC from 1 bidder');
  assert.equal(requests[1].arg, '555');
});

test('many changes in a short time make one update', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  requests.length = 0;

  board.touch(id);
  board.touch(id);
  board.touch(id);

  assert.equal(timers.count(), 1);
  timers.fire();
  await flush();
  assert.equal(requests.length, 1);
});

test('nothing happens until a board is configured, and clearing it stops updates', async () => {
  const id = await addFeature();
  board.configure(null);

  board.touch(id);

  assert.equal(timers.count(), 0);
  assert.equal(board.isConfigured(), false);
  assert.equal(await board.reconcile(), null);
  assert.equal(requests.length, 0);
});

test('a message that was deleted in Discord is posted again', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();

  answer = (options) => {
    if (options.command === 'edit-message') return { reject: 'Unknown message' };
    return defaultAnswer(options);
  };
  board.touch(id);
  timers.fire();
  await flush();

  assert.deepEqual(requests.map(r => r.command), ['post-message', 'edit-message', 'post-message']);
  assert.equal((await store.getFeature(id)).board.id, 'msg-2');
  assert.deepEqual(errors, []);
});

test('a refusal from Discord is reported and the old message is kept', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  const before = (await store.getFeature(id)).board;

  answer = () => ({ reject: 'Access Denied' });
  board.touch(id);
  timers.fire();
  await flush();

  assert.deepEqual((await store.getFeature(id)).board, before);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Access Denied/);
});

test('a failure to reach the connector is reported and nothing is saved', async () => {
  const id = await addFeature();
  answer = () => new Error('Response timed out');

  board.touch(id);
  timers.fire();
  await flush();

  assert.deepEqual(errors, ['Response timed out']);
  assert.equal((await store.getFeature(id)).board, undefined);
});

test('a finished feature stays on the board, edited to say so', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();

  await store.setFeatureStatus(id, 'done', '9');
  board.touch(id);
  timers.fire();
  await flush();

  assert.equal(requests[1].command, 'edit-message');
  assert.equal(requests[1].data.embed.footer.text, 'Built');
});

test('a removed feature keeps its message, turned red and marked removed', async () => {
  const id = await addFeature('Dark mode');
  board.touch(id);
  timers.fire();
  await flush();

  await store.setFeatureStatus(id, 'removed', '9');
  board.touch(id);
  timers.fire();
  await flush();

  assert.equal(requests.length, 2);
  assert.equal(requests[1].command, 'edit-message');
  assert.equal(requests[1].data.id, 'msg-0');
  assert.deepEqual(requests[1].data.embed, {
    title: '#1 Dark mode',
    color: 0xed4245,
    fields: [],
    footer: { text: 'Removed' },
  });
  assert.deepEqual((await store.getFeature(id)).board, { channel: '555', id: 'msg-0', cid: 'fmbot-cid' });
});

test('a removed feature is never deleted from Discord, so a thread on it survives', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();

  await store.setFeatureStatus(id, 'removed', '9');
  await board.reconcile();
  await board.reconcile();

  assert.equal(requests.some(r => r.command === 'delete-message'), false);
});

test('a removed feature shows no totals', () => {
  const embed = render({ id: '4', title: 'Gone', status: 'removed' }, summarize([]));

  assert.deepEqual(embed.fields, []);
  assert.equal(embed.color, 0xed4245);
});

test('a removed feature whose board moved is cleaned from the old channel and not posted again', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  await store.setFeatureStatus(id, 'removed', '9');
  requests.length = 0;

  board.configure({ channel: '777', cid: 'fmbot-cid' });
  await board.reconcile();

  assert.deepEqual(requests.map(r => [r.command, r.arg]), [['delete-message', '555']]);
  assert.equal((await store.getFeature(id)).board, null);
});

test('a removed feature whose message is already gone is just forgotten', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  await store.setFeatureStatus(id, 'removed', '9');
  answer = () => ({ reject: 'Unknown message' });

  board.touch(id);
  timers.fire();
  await flush();

  assert.deepEqual(errors, []);
  assert.equal((await store.getFeature(id)).board, null);
});

test('a removed feature that never reached the board costs nothing', async () => {
  const id = await addFeature();
  await store.setFeatureStatus(id, 'removed', '9');

  board.touch(id);
  timers.fire();
  await flush();

  assert.equal(requests.length, 0);
});

test('moving the board to another channel moves every message', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  requests.length = 0;

  assert.equal(board.configure({ channel: '777', cid: 'fmbot-cid' }), true);
  await board.reconcile();

  assert.deepEqual(requests.map(r => [r.command, r.arg]), [['delete-message', '555'], ['post-message', '777']]);
  assert.deepEqual((await store.getFeature(id)).board, { channel: '777', id: 'msg-1', cid: 'fmbot-cid' });
});

test('a deleted old channel does not stop the board from moving', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  answer = (options) => {
    if (options.command === 'delete-message') return { reject: 'Unknown channel' };
    return defaultAnswer(options);
  };
  requests.length = 0;

  board.configure({ channel: '777', cid: 'fmbot-cid' });
  await board.reconcile();

  assert.deepEqual(errors, []);
  assert.deepEqual(requests.map(r => [r.command, r.arg]), [['delete-message', '555'], ['post-message', '777']]);
  assert.equal((await store.getFeature(id)).board.channel, '777');
});

test('an old message that cannot be deleted is reported but the move still goes ahead', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  answer = (options) => {
    if (options.command === 'delete-message') return { reject: 'Access Denied' };
    return defaultAnswer(options);
  };

  board.configure({ channel: '777', cid: 'fmbot-cid' });
  await board.reconcile();

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Access Denied/);
  assert.equal((await store.getFeature(id)).board.channel, '777');
});

test('syncNow updates at once instead of waiting, and says it worked', async () => {
  const id = await addFeature();
  board.touch(id);

  const result = await board.syncNow(id);

  assert.equal(result, 'updated');
  assert.equal(requests.length, 1);
  assert.equal(timers.count(), 0);
  assert.deepEqual((await store.getFeature(id)).board, { channel: '555', id: 'msg-0', cid: 'fmbot-cid' });
});

test('syncNow says when the board could not be updated, and reports why', async () => {
  const id = await addFeature();
  answer = () => ({ reject: 'Access Denied' });

  assert.equal(await board.syncNow(id), 'failed');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Access Denied/);
});

test('syncNow does nothing without a board', async () => {
  const id = await addFeature();
  board.configure(null);

  assert.equal(await board.syncNow(id), null);
  assert.equal(requests.length, 0);
});

test('syncNow waits behind an update already running for the feature', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();

  const result = await board.syncNow(id);

  assert.equal(result, 'updated');
  assert.deepEqual(requests.map(r => r.command), ['post-message', 'edit-message']);
});

test('configuring the same board again is not a change', () => {
  assert.equal(board.configure({ ...TARGET }), false);
  assert.equal(board.configure(null), true);
  assert.equal(board.configure(null), false);
});

test('reconcile posts every shown feature in number order and skips the rest', async () => {
  await addFeature('First');
  await addFeature('Second');
  await addFeature('Third');
  await addFeature('Gone');
  await store.setFeatureStatus(2, 'done', '9');
  await store.setFeatureStatus(4, 'removed', '9');

  const count = await board.reconcile();

  assert.equal(count, 3);
  assert.deepEqual(requests.map(r => r.data.embed.title), ['#1 First', '#2 Second', '#3 Third']);
});

test('reconcile also marks the message of a feature that was removed while the plugin was off', async () => {
  const id = await addFeature();
  board.touch(id);
  timers.fire();
  await flush();
  await store.setFeatureStatus(id, 'removed', '9');
  requests.length = 0;

  assert.equal(await board.reconcile(), 1);

  assert.deepEqual(requests.map(r => r.command), ['edit-message']);
  assert.equal(requests[0].data.embed.footer.text, 'Removed');
});

test('reconcile is safe to run twice: the second time only edits', async () => {
  await addFeature('First');
  await board.reconcile();
  requests.length = 0;

  await board.reconcile();

  assert.deepEqual(requests.map(r => r.command), ['edit-message']);
});

test('updates to one feature never overlap, so it is not posted twice', async () => {
  const id = await addFeature();
  let release;
  answer = (options) => {
    if (options.command !== 'post-message') return defaultAnswer(options);
    return new Promise((resolve) => {
      release = () => resolve({ data: { id: 'msg-late', channel: '555' } });
    });
  };
  const first = board.reconcile();
  await flush();
  const second = board.reconcile();
  await flush();

  assert.equal(requests.filter(r => r.command === 'post-message').length, 1);
  release();
  await Promise.all([first, second]);

  assert.equal(requests.filter(r => r.command === 'post-message').length, 1);
  assert.equal(requests.filter(r => r.command === 'edit-message').length, 1);
  assert.equal((await store.getFeature(id)).board.id, 'msg-late');
});

const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const { definitions } = require('../src/commands');
const createService = require('../src/service');
const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

const admin = { discordId: '9', name: 'Boss' };
const alan = { discordId: '1', name: 'Alan' };
const sam = { discordId: '2', name: 'Sam' };

let fake;
let store;
let service;
let charges;
let outcome;
let errors;
let minimum;

const build = (options = {}) => createService({
  store,
  charge: async (request) => {
    charges.push(request);
    const result = typeof outcome === 'function' ? outcome(request) : outcome;
    if (result instanceof Error) throw result;
    return result;
  },
  isAdmin: id => id === '9',
  minBid: () => minimum,
  onError: error => errors.push(error.message),
  ...options,
});

const run = (command, ctx, words = [], rest = words.join(' ')) => service
  .run(command, ctx, { words, rest });
const addFeature = title => run('feature-add', admin, [], title);
const bidOn = (ctx, id, amount, ...more) => run('feature-bid', ctx, [String(id), String(amount), ...more]);
const settle = () => new Promise(resolve => setImmediate(resolve));
const user = n => ({ discordId: `10${n}`, name: `User${n}` });

beforeEach(() => {
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  charges = [];
  outcome = { id: 'tx1', balance: 100 };
  errors = [];
  minimum = 10;
  service = build();
});

test('an admin adds features, numbered in order, and the answer is public', async () => {
  const first = await addFeature('Dark mode');
  const second = await addFeature('  Export   to   CSV ');

  assert.deepEqual(first, { text: 'Added #1: Dark mode. Bid on it with feature-bid 1 <amount>.', hidden: false });
  assert.equal(second.text, 'Added #2: Export to CSV. Bid on it with feature-bid 2 <amount>.');
});

test('only the people on the admin list can add, finish or remove features', async () => {
  await addFeature('Dark mode');

  const replies = await Promise.all([
    run('feature-add', alan, [], 'Sneaky'),
    run('feature-done', alan, ['1']),
    run('feature-remove', alan, ['1']),
    run('feature-add', { ...alan, admin: true }, [], 'Still sneaky'),
  ]);

  replies.forEach(reply => assert.deepEqual(reply, { text: 'Only admins can do that.', hidden: true }));
  assert.equal(await store.getFeature(2), null);
  assert.equal((await store.getFeature(1)).status, 'open');
});

test('a title is required and cannot be very long', async () => {
  const none = await run('feature-add', admin, [], '   ');
  const long = await run('feature-add', admin, [], 'x'.repeat(81));
  const limit = await run('feature-add', admin, [], 'x'.repeat(80));

  assert.equal(none.text, 'Usage: feature-add <title>');
  assert.equal(long.text, 'Keep the title under 80 characters.');
  assert.match(limit.text, /^Added #1: x{80}\./);
});

test('the list says so when nothing is open', async () => {
  assert.equal((await run('feature-list', alan)).text, 'No features are open for bids yet.');
  assert.equal((await run('feature-list', alan, ['done'])).text, 'No bid has built a feature yet.');
});

test('the list puts the most backed feature first and counts bidders', async () => {
  await addFeature('A');
  await addFeature('B');
  await addFeature('C');
  await bidOn(alan, 2, 100);
  await bidOn(sam, 3, 100);
  await bidOn(alan, 3, 200);

  const reply = await run('feature-list', alan);

  assert.deepEqual(reply, {
    text: 'Open features:\n#3 C: 300 FMC from 2 bidders\n#2 B: 100 FMC from 1 bidder\n#1 A: 0 FMC from 0 bidders',
    hidden: false,
  });
});

test('only bids the wallet confirmed count towards a total', async () => {
  await addFeature('A');
  await bidOn(alan, 1, 50);
  outcome = { error: 'Balance insufficient' };
  await bidOn(sam, 1, 500);
  outcome = new Error('wallet down');
  await bidOn(user(1), 1, 700);

  assert.equal((await run('feature-list', alan)).text, 'Open features:\n#1 A: 50 FMC from 1 bidder');
});

test('the list shows a dozen features and says how many more there are', async () => {
  await Array.from({ length: 14 }, (_, i) => i)
    .reduce((chain, i) => chain.then(() => addFeature(`Feature ${i}`)), Promise.resolve());

  const lines = (await run('feature-list', alan)).text.split('\n');

  assert.equal(lines.length, 14);
  assert.equal(lines[13], '...and 2 more');
});

test('the list only understands open and done', async () => {
  assert.equal((await run('feature-list', alan, ['everything'])).text, 'Use feature-list open or feature-list done.');
});

test('a bid charges the bidder through the wallet and answers privately', async () => {
  await addFeature('Dark mode');

  const reply = await bidOn(alan, 1, 500);

  assert.deepEqual(reply, {
    text: 'Bid placed: 500 FMC on #1 Dark mode. It has 500 FMC behind it now.',
    hidden: true,
  });
  assert.equal(charges.length, 1);
  const [request] = charges;
  assert.equal(request.uid, 'discord.com:::1');
  assert.equal(request.amount, 500);
  assert.equal(request.memo, 'Feature bid #1: Dark mode');
  assert.equal(request.extra.bidFeature, '1');
  assert.equal(request.requestId, `bid-${request.extra.bidId}`);
  assert.equal(fake.data.get(`bids/${request.extra.bidId}`).status, 'confirmed');
});

test('totals add up across people', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 500);

  assert.equal((await bidOn(sam, 1, 300)).text, 'Bid placed: 300 FMC on #1 Dark mode. It has 800 FMC behind it now.');
});

test('badly formed bids are explained and never charged', async () => {
  await addFeature('Dark mode');
  const usage = 'Usage: feature-bid <number> <amount> [hidden]';

  const replies = await Promise.all([
    run('feature-bid', alan, []),
    run('feature-bid', alan, ['1']),
    run('feature-bid', alan, ['abc', '50']),
    run('feature-bid', alan, ['1', 'lots']),
    run('feature-bid', alan, ['1', '0']),
    run('feature-bid', alan, ['1', '-50']),
    run('feature-bid', alan, ['1', '5.5']),
  ]);

  replies.forEach(reply => assert.deepEqual(reply, { text: usage, hidden: true }));
  assert.equal(charges.length, 0);
});

test('a bid below the minimum is refused, and the minimum can change', async () => {
  await addFeature('Dark mode');

  assert.equal((await bidOn(alan, 1, 9)).text, 'The smallest bid is 10 FMC.');
  assert.equal(charges.length, 0);

  minimum = 100;
  assert.equal((await bidOn(alan, 1, 99)).text, 'The smallest bid is 100 FMC.');
  assert.match((await bidOn(alan, 1, 100)).text, /^Bid placed/);
});

test('you cannot bid on a feature that does not exist, is closed, or was removed', async () => {
  await addFeature('Open');
  await addFeature('Finished');
  await addFeature('Gone');
  await run('feature-done', admin, ['2']);
  await run('feature-remove', admin, ['3']);

  assert.equal((await bidOn(alan, 7, 50)).text, 'There is no feature #7.');
  assert.equal((await bidOn(alan, 2, 50)).text, 'Bidding on #2 is closed.');
  assert.equal((await bidOn(alan, 3, 50)).text, 'There is no feature #3.');
  assert.equal(charges.length, 0);
});

test('a wallet refusal is explained, nothing is counted, and the bid is marked failed', async () => {
  await addFeature('Dark mode');
  outcome = { error: 'Balance insufficient' };

  const reply = await bidOn(alan, 1, 500);

  assert.deepEqual(reply, { text: "You don't have enough FMC for that bid.", hidden: true });
  const [failed] = await store.bidsByUser('1');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'Balance insufficient');
  assert.equal((await store.confirmedBids()).length, 0);
  assert.deepEqual(errors, []);
});

test('someone without a linked wallet is told how to link one', async () => {
  await addFeature('Dark mode');
  outcome = { error: 'User not found' };

  assert.equal((await bidOn(alan, 1, 50)).text, "Your Discord account isn't linked to a wallet yet.");

  service = build({ linkURL: 'https://auth.example.com' });
  assert.equal(
    (await bidOn(alan, 1, 50)).text,
    "Your Discord account isn't linked to a wallet yet. Link it here: https://auth.example.com",
  );
});

test('an answer nobody expected is reported and the user is told nothing was taken', async () => {
  await addFeature('Dark mode');
  outcome = { error: 'Unknown properties: curency' };

  const reply = await bidOn(alan, 1, 50);

  assert.equal(reply.text, 'Something went wrong with your bid, and nothing was taken.');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Unknown properties/);
});

test('when the wallet cannot be reached the bid stays pending and is retried later', async () => {
  await addFeature('Dark mode');
  outcome = new Error('wallet down');

  const reply = await bidOn(alan, 1, 50);

  assert.match(reply.text, /^I couldn't confirm your bid with the wallet yet\./);
  assert.deepEqual(errors, ['wallet down']);
  assert.equal((await store.pendingBids()).length, 1);
  assert.equal((await store.confirmedBids()).length, 0);

  outcome = { id: 'tx2', balance: 10 };
  assert.equal(await service.resume(), 1);

  assert.equal((await store.pendingBids()).length, 0);
  assert.equal((await store.confirmedBids()).length, 1);
  assert.equal(charges.length, 2);
  assert.equal(charges[1].requestId, charges[0].requestId);
  assert.equal(charges[1].memo, charges[0].memo);
  assert.equal(charges[1].amount, charges[0].amount);
});

test('retrying a pending bid that the wallet now refuses marks it failed', async () => {
  await addFeature('Dark mode');
  outcome = new Error('wallet down');
  await bidOn(alan, 1, 50);

  outcome = { error: 'Balance insufficient' };
  await service.resume();

  assert.equal((await store.bidsByUser('1'))[0].status, 'failed');
});

test('retrying while the wallet is still down changes nothing and does not throw', async () => {
  await addFeature('Dark mode');
  outcome = new Error('wallet down');
  await bidOn(alan, 1, 50);
  errors = [];

  assert.equal(await service.resume(), 1);

  assert.equal((await store.pendingBids()).length, 1);
  assert.deepEqual(errors, ['wallet down']);
});

test('there is nothing to retry when nothing is pending', async () => {
  assert.equal(await service.resume(), 0);
  assert.equal(charges.length, 0);
});

test('one person cannot start a second bid while the first is going through', async () => {
  await addFeature('Dark mode');
  let release;
  outcome = () => new Promise((resolve) => {
    release = () => resolve({ id: 'tx1' });
  });

  const first = bidOn(alan, 1, 50);
  await settle();
  const second = await bidOn(alan, 1, 60);
  release();
  await first;
  outcome = { id: 'tx2' };
  const third = await bidOn(alan, 1, 70);

  assert.equal(second.text, 'Your last bid is still going through.');
  assert.match(third.text, /^Bid placed/);
  assert.deepEqual(charges.map(c => c.amount), [50, 70]);
});

test('the lock is released when a bid fails', async () => {
  await addFeature('Dark mode');
  outcome = new Error('wallet down');
  await bidOn(alan, 1, 50);

  outcome = { id: 'tx' };

  assert.match((await bidOn(alan, 1, 60)).text, /^Bid placed/);
});

test('showing a feature names only its highest public bidder', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 500);
  await bidOn(sam, 1, 200);
  await bidOn(alan, 1, 100);

  assert.deepEqual(await run('feature-show', sam, ['1']), {
    text: '#1 Dark mode (open)\n800 FMC from 2 bidders\nTop backer: Alan 600',
    hidden: false,
  });
});

test('nobody else is named, however many people bid', async () => {
  await addFeature('Dark mode');
  await [1, 2, 3, 4, 5, 6].reduce(
    (chain, n) => chain.then(() => bidOn(user(n), 1, n * 10)),
    Promise.resolve(),
  );

  const lines = (await run('feature-show', alan, ['1'])).text.split('\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[1], '210 FMC from 6 bidders');
  assert.equal(lines[2], 'Top backer: User6 60');
});

test('a tie for the top goes to whoever bid first', async () => {
  await addFeature('Dark mode');
  await bidOn(sam, 1, 100);
  await bidOn(alan, 1, 100);

  assert.equal((await run('feature-show', alan, ['1'])).text.split('\n')[2], 'Top backer: Sam 100');
});

test('a tie goes to whoever reached the amount first, not whoever started first', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 50);
  await bidOn(sam, 1, 100);
  await bidOn(alan, 1, 50);

  assert.equal((await run('feature-show', alan, ['1'])).text.split('\n')[2], 'Top backer: Sam 100');
});

test('hidden bids do not decide who reached an amount first', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 100);
  await bidOn(sam, 1, 100);
  await bidOn(alan, 1, 20, 'hidden');
  await bidOn(sam, 1, 5, 'hidden');

  assert.equal((await run('feature-show', alan, ['1'])).text.split('\n')[2], 'Top backer: Alan 100');
});

test('bids with the same time fall back to the name that comes first', async () => {
  await addFeature('Dark mode');
  await bidOn(sam, 1, 100);
  await bidOn(alan, 1, 100);
  fake.data.forEach((bid, path) => {
    if (path.startsWith('bids/')) fake.data.set(path, { ...bid, createdAt: 7 });
  });

  assert.equal((await run('feature-show', alan, ['1'])).text.split('\n')[2], 'Top backer: Alan 100');
});

test('firestore timestamps are understood as well as plain numbers', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 100);
  await bidOn(sam, 1, 100);
  const stamped = {
    ...store,
    bidsForFeature: async id => (await store.bidsForFeature(id)).map(bid => ({
      ...bid,
      createdAt: { toMillis: () => (bid.discordId === '2' ? 1000 : 2000) },
    })),
  };
  service = build({ store: stamped });

  assert.equal((await run('feature-show', alan, ['1'])).text.split('\n')[2], 'Top backer: Sam 100');
});

test('a hidden bid keeps its name and amount off the list but still counts', async () => {
  await addFeature('Dark mode');
  await bidOn(sam, 1, 200);
  const hidden = await bidOn(alan, 1, 555, 'hidden');
  const shown = (await run('feature-show', sam, ['1'])).text;

  assert.match(hidden.text, /^Bid placed: 555 FMC/);
  assert.equal(shown, '#1 Dark mode (open)\n755 FMC from 2 bidders\nTop backer: Sam 200');
  assert.equal(shown.includes('Alan'), false);
  assert.equal(shown.includes('555'), false);
  assert.equal(shown.includes('hidden'), false);
});

test('a hidden bid bigger than every public one never becomes the top backer', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 900, 'hidden');
  await bidOn(sam, 1, 30);

  assert.equal((await run('feature-show', sam, ['1'])).text.split('\n')[2], 'Top backer: Sam 30');
});

test('when every bid is hidden nobody is named at all', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 500, 'hidden');
  await bidOn(sam, 1, 300, 'hidden');

  assert.equal(
    (await run('feature-show', sam, ['1'])).text,
    '#1 Dark mode (open)\n800 FMC from 2 bidders',
  );
});

test('someone who bids openly and in secret is only credited for the open bids', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 100);
  await bidOn(alan, 1, 700, 'hidden');

  assert.equal((await run('feature-show', sam, ['1'])).text.split('\n')[2], 'Top backer: Alan 100');
});

test('a feature with no bids and unknown features are handled', async () => {
  await addFeature('Dark mode');
  await addFeature('Gone');
  await run('feature-remove', admin, ['2']);

  assert.equal((await run('feature-show', alan, ['1'])).text, '#1 Dark mode (open)\nNo bids yet.');
  assert.equal((await run('feature-show', alan, ['5'])).text, 'There is no feature #5.');
  assert.equal((await run('feature-show', alan, ['2'])).text, 'There is no feature #2.');
  assert.equal((await run('feature-show', alan, [])).text, 'Usage: feature-show <number>');
});

test('your own bids are listed privately, with hidden and pending ones marked', async () => {
  await addFeature('Dark mode');
  await addFeature('Export');
  await bidOn(alan, 1, 100);
  await bidOn(alan, 1, 50, 'hidden');
  outcome = new Error('wallet down');
  await bidOn(alan, 2, 30);
  outcome = { error: 'Balance insufficient' };
  await bidOn(alan, 2, 900);

  assert.deepEqual(await run('feature-mine', alan), {
    text: 'Your bids:\n#1 Dark mode: 150 FMC (hidden)\n#2 Export: 30 FMC (pending)',
    hidden: true,
  });
  assert.deepEqual(await run('feature-mine', sam), { text: "You haven't bid on anything yet.", hidden: true });
});

test('finishing a feature closes it, announces it, and keeps the bids', async () => {
  await addFeature('Dark mode');
  await bidOn(alan, 1, 500);
  await bidOn(sam, 1, 300);

  const reply = await run('feature-done', admin, ['1']);

  assert.deepEqual(reply, { text: '#1 Dark mode is done! 2 bidders put 800 FMC behind it.', hidden: false });
  assert.equal((await store.getFeature(1)).status, 'done');
  assert.equal((await store.getFeature(1)).closedBy, '9');
  assert.equal((await store.confirmedBids()).length, 2);
  assert.equal((await run('feature-list', alan)).text, 'No features are open for bids yet.');
  assert.match((await run('feature-list', alan, ['done'])).text, /#1 Dark mode: 800 FMC from 2 bidders/);
});

test('a feature can only be finished once, and only if it exists', async () => {
  await addFeature('Dark mode');
  await run('feature-done', admin, ['1']);

  assert.equal((await run('feature-done', admin, ['1'])).text, '#1 is already done.');
  assert.equal((await run('feature-done', admin, ['4'])).text, 'There is no feature #4.');
  assert.equal((await run('feature-done', admin, [])).text, 'Usage: feature-done <number>');
});

test('a feature nobody bid on can be removed and then disappears', async () => {
  await addFeature('Dark mode');

  assert.deepEqual(await run('feature-remove', admin, ['1']), { text: 'Removed #1: Dark mode.', hidden: true });
  assert.equal((await run('feature-list', alan)).text, 'No features are open for bids yet.');
  assert.equal((await run('feature-remove', admin, ['1'])).text, 'There is no feature #1.');
});

test('a feature with bids cannot be removed until refunds exist', async () => {
  await addFeature('Dark mode');
  await addFeature('Pending one');
  await bidOn(alan, 1, 50);
  outcome = new Error('wallet down');
  await bidOn(alan, 2, 50);

  const confirmed = await run('feature-remove', admin, ['1']);
  const pending = await run('feature-remove', admin, ['2']);

  assert.equal(confirmed.text, "#1 has bids, and refunds aren't available yet, so it can't be removed.");
  assert.equal(pending.text, "#2 has bids, and refunds aren't available yet, so it can't be removed.");
  assert.equal((await store.getFeature(1)).status, 'open');
});

test('failed bids do not stop a feature from being removed', async () => {
  await addFeature('Dark mode');
  outcome = { error: 'Balance insufficient' };
  await bidOn(alan, 1, 50);

  assert.equal((await run('feature-remove', admin, ['1'])).text, 'Removed #1: Dark mode.');
});

test('every command in the definitions has a handler that answers', async () => {
  const replies = await Promise.all(Object.keys(definitions).map(name => run(name, alan)));

  replies.forEach((reply) => {
    assert.equal(typeof reply.text, 'string');
    assert.equal(typeof reply.hidden, 'boolean');
  });
});

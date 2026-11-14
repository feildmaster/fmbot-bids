const assert = require('node:assert/strict');
const { test } = require('node:test');

const { groupCommands, subcommandName, validateCommands } = require('@basedakp48/plugin-utils');
const { definitions } = require('../src/commands');
const privateReply = require('../src/reply');

test('the definitions pass the validation plugin-utils applies at startup', () => {
  assert.deepEqual(validateCommands(definitions), []);
});

test('the admin commands are hidden from people without server permissions', () => {
  [
    'feature-add', 'feature-edit', 'feature-goal', 'feature-due', 'feature-repeat',
    'feature-done', 'feature-reset', 'feature-remove', 'feature-sync',
  ].forEach((name) => {
    assert.deepEqual(
      definitions[name].discord,
      { dmPermission: false, defaultMemberPermissions: '32' },
      name,
    );
  });
  ['feature-list', 'feature-show', 'feature-bid', 'feature-mine'].forEach((name) => {
    assert.equal(definitions[name].discord, undefined, name);
  });
});

test('everyone commands share one group and admin commands another, with short subcommand names', () => {
  const names = group => Object.keys(definitions)
    .filter(name => definitions[name].group === group)
    .map(name => subcommandName({ name, ...definitions[name] }))
    .sort();

  assert.deepEqual(names('feature'), ['bid', 'list', 'mine', 'show']);
  assert.deepEqual(
    names('feature-admin'),
    ['add', 'done', 'due', 'edit', 'goal', 'remove', 'repeat', 'reset', 'sync'],
  );
  assert.equal(Object.values(definitions).every(item => item.group !== undefined), true);
});

test('every group is described and nothing in it is left without a name', () => {
  const commands = Object.entries(definitions).map(([name, item]) => ({ name, ...item }));
  const { groups, standalone, conflicts } = groupCommands(commands);

  assert.deepEqual(conflicts, []);
  assert.deepEqual(standalone, []);
  assert.deepEqual(
    groups.map(group => [group.name, group.description !== group.name]),
    [['feature', true], ['feature-admin', true]],
  );
});

test('only the commands that answer about you are private by default', () => {
  const privateOnes = Object.keys(definitions).filter(name => definitions[name].private === true);

  assert.deepEqual(
    privateOnes.sort(),
    [
      'feature-bid', 'feature-due', 'feature-edit', 'feature-goal', 'feature-mine',
      'feature-remove', 'feature-repeat', 'feature-sync',
    ],
  );
});

test('every command takes its arguments in the order the text form reads them', () => {
  assert.deepEqual(definitions['feature-bid'].args.map(arg => arg.name), ['id', 'amount', 'hidden']);
  assert.deepEqual(definitions['feature-add'].args.map(arg => arg.name), ['title', 'description']);
  assert.deepEqual(definitions['feature-edit'].args.map(arg => arg.name), ['id', 'title', 'description']);
  assert.deepEqual(definitions['feature-goal'].args.map(arg => arg.name), ['id', 'amount']);
  assert.deepEqual(definitions['feature-due'].args.map(arg => arg.name), ['id', 'date']);
  assert.deepEqual(definitions['feature-repeat'].args.map(arg => arg.name), ['id', 'count', 'unit']);
  assert.deepEqual(definitions['feature-reset'].args.map(arg => arg.name), ['id', 'amount']);
  assert.deepEqual(definitions['feature-show'].args.map(arg => arg.name), ['id']);
  assert.deepEqual(definitions['feature-list'].args.map(arg => arg.name), ['private', 'status']);
});

test('a private reply carries the interaction id and nothing else of the message', () => {
  const msg = {
    cid: 'connector', uid: '1', data: { interactionId: 'int1', nick: 'Alan' },
  };

  const reply = privateReply({ cid: 'me' }, msg, 'Bid placed');

  assert.equal(reply.uid, 'me');
  assert.equal(reply.target, 'connector');
  assert.equal(reply.channel, '1');
  assert.equal(reply.type, 'private');
  assert.deepEqual(reply.data, { interactionId: 'int1' });
});

test('a private reply can carry an embed or pages, with or without an interaction', () => {
  const embed = { title: 'Your bids' };
  const pages = [embed, { title: 'More' }];
  const withId = { cid: 'c', uid: '1', data: { interactionId: 'int1' } };
  const direct = { cid: 'c', uid: '1', data: { isPM: true } };

  assert.deepEqual(privateReply({ cid: 'me' }, withId, 'x', { embed }).data, {
    interactionId: 'int1', discord_embed: embed,
  });
  assert.deepEqual(privateReply({ cid: 'me' }, direct, 'x', { pages }).data, { discord_pages: pages });
  assert.equal('data' in privateReply({ cid: 'me' }, direct, 'x', {}), false);
});

test('a private reply to typed text has no data, since the database refuses undefined', () => {
  const reply = privateReply({ cid: 'me' }, { cid: 'c', uid: '1', data: { isPM: true } }, 'x');

  assert.equal('data' in reply, false);
  assert.equal(Object.values(reply).some(value => value === undefined), false);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { validateCommands } = require('@basedakp48/plugin-utils');
const { definitions } = require('../src/commands');
const privateReply = require('../src/reply');

test('the definitions pass the validation plugin-utils applies at startup', () => {
  assert.deepEqual(validateCommands(definitions), []);
});

test('the admin commands are hidden from people without server permissions', () => {
  ['feature-add', 'feature-edit', 'feature-done', 'feature-remove', 'feature-sync'].forEach((name) => {
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

test('only the commands that answer about you are private by default', () => {
  const privateOnes = Object.keys(definitions).filter(name => definitions[name].private === true);

  assert.deepEqual(
    privateOnes.sort(),
    ['feature-bid', 'feature-edit', 'feature-mine', 'feature-remove', 'feature-sync'],
  );
});

test('every command takes its arguments in the order the text form reads them', () => {
  assert.deepEqual(definitions['feature-bid'].args.map(arg => arg.name), ['id', 'amount', 'hidden']);
  assert.deepEqual(definitions['feature-add'].args.map(arg => arg.name), ['title', 'description']);
  assert.deepEqual(definitions['feature-edit'].args.map(arg => arg.name), ['id', 'title', 'description']);
  assert.deepEqual(definitions['feature-show'].args.map(arg => arg.name), ['id']);
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

test('a private reply to typed text has no data, since the database refuses undefined', () => {
  const reply = privateReply({ cid: 'me' }, { cid: 'c', uid: '1', data: { isPM: true } }, 'x');

  assert.equal('data' in reply, false);
  assert.equal(Object.values(reply).some(value => value === undefined), false);
});

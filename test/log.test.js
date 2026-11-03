const assert = require('node:assert/strict');
const { test } = require('node:test');

const createLog = require('../src/log');

const TARGET = { channel: '555', cid: 'fmbot-cid' };

const build = (request, errors = []) => ({
  log: createLog({ request, onError: error => errors.push(error.message) }),
  errors,
});

test('a line is posted to the configured channel through the connector', async () => {
  const requests = [];
  const { log } = build(async (options) => { requests.push(options); });
  log.configure(TARGET);

  await log.say('Refunded 99 FMC to Alan (1) for #1.');

  assert.deepEqual(requests, [{
    target: 'fmbot-cid',
    command: 'post-message',
    arg: '555',
    data: { text: 'Refunded 99 FMC to Alan (1) for #1.' },
  }]);
});

test('nothing is sent until a log channel is configured, or after it is cleared', async () => {
  const requests = [];
  const { log } = build(async (options) => { requests.push(options); });

  await log.say('before');
  assert.equal(log.isConfigured(), false);
  log.configure(TARGET);
  assert.equal(log.isConfigured(), true);
  log.configure(null);
  await log.say('after');

  assert.equal(requests.length, 0);
});

test('a long line is cut to what Discord accepts', async () => {
  const requests = [];
  const { log } = build(async (options) => { requests.push(options); });
  log.configure(TARGET);

  await log.say('x'.repeat(5000));

  assert.equal(requests[0].data.text.length, 2000);
});

test('a failure is reported and never thrown, whether it is an error or a refusal text', async () => {
  const errors = [];
  const refusals = [new Error('Response timed out'), 'Access Denied'];
  const { log } = build(async () => { throw refusals.shift(); }, errors);
  log.configure(TARGET);

  await log.say('one');
  await log.say('two');

  assert.deepEqual(errors, ['Response timed out', 'The log could not post: Access Denied']);
});

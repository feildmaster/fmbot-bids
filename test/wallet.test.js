const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { test } = require('node:test');

const createCharge = require('../src/wallet');

const request = {
  uid: 'discord.com:::1',
  amount: 50,
  requestId: 'bid-abc12345',
  memo: 'Feature bid #1: Dark mode',
  extra: { bidFeature: '1', bidId: 'abc12345' },
};

const fakeFetch = (payload, status = 200) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { status, json: async () => payload };
  };
  return { fetch, calls };
};

const serve = handler => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise(done => server.close(done));
    },
  }));
});

test('it posts the charge, signed with the key, to the charge endpoint', async () => {
  const { fetch, calls } = fakeFetch({ id: 'tx1', balance: 5 });
  const charge = createCharge({ key: 'secret', baseUrl: 'https://wallet.test', fetch });

  assert.deepEqual(await charge(request), { id: 'tx1', balance: 5 });

  const [{ url, options }] = calls;
  assert.equal(url, 'https://wallet.test/wallet-charge');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { ...request, currency: 'FMC' });
  assert.equal(
    options.headers.http_x_signature,
    crypto.createHmac('sha256', 'secret').update(options.body).digest('hex'),
  );
});

test('it sends only the properties the wallet accepts', async () => {
  const { fetch, calls } = fakeFetch({});
  await createCharge({ key: 'k', fetch })(request);

  const allowed = ['amount', 'currency', 'extra', 'free', 'memo', 'requestId', 'uid'];
  Object.keys(JSON.parse(calls[0].options.body)).forEach((key) => {
    assert.ok(allowed.includes(key), key);
  });
});

test('a refusal from the wallet is returned as data, not thrown', async () => {
  const { fetch } = fakeFetch({ error: 'Balance insufficient' });

  assert.deepEqual(await createCharge({ key: 'k', fetch })(request), { error: 'Balance insufficient' });
});

test('a server error is thrown, so the bid can be retried', async () => {
  const { fetch } = fakeFetch({ error: 'Failed' }, 500);

  await assert.rejects(createCharge({ key: 'k', fetch })(request), /answered 500/);
});

test('it gives up when the wallet never answers', async () => {
  const server = await serve(() => {});

  try {
    const started = Date.now();
    await assert.rejects(createCharge({ key: 'k', baseUrl: server.url, timeout: 150 })(request));
    assert.ok(Date.now() - started < 2000);
  } finally {
    await server.close();
  }
});

test('it refuses to start without a key', () => {
  assert.throws(() => createCharge({}), /key is required/);
});

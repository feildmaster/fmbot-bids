const crypto = require('crypto');

const DEFAULT_URL = 'https://us-central1-feildbase.cloudfunctions.net';
const TIMEOUT = 10000;

const createCall = (endpoint, fields) => function createWalletCall({
  key,
  baseUrl = DEFAULT_URL,
  fetch: request = fetch,
  timeout = TIMEOUT,
}) {
  if (!key) throw new Error('A wallet key is required');

  return async function call(input) {
    const body = JSON.stringify(fields(input));
    const signature = crypto.createHmac('sha256', key).update(body).digest('hex');
    const response = await request(`${baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', http_x_signature: signature },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status >= 500) throw new Error(`The wallet answered ${response.status}`);
    return response.json();
  };
};

const createCharge = createCall('wallet-charge', ({
  uid, amount, requestId, memo, extra,
}) => ({
  uid, amount, currency: 'FMC', memo, requestId, extra,
}));

createCharge.createRefund = createCall('wallet-refund', ({ uid, requestId, memo }) => ({
  uid, requestId, memo,
}));

module.exports = createCharge;

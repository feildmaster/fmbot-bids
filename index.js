const utils = require('@basedakp48/plugin-utils');
const admin = require('firebase-admin');
const { definitions } = require('./src/commands');
const { DEFAULT_MIN_BID, parseConfig } = require('./src/config');
const { parse } = require('./src/parse');
const privateReply = require('./src/reply');
const createService = require('./src/service');
const createStore = require('./src/store');
const createCharge = require('./src/wallet');

const RESUME_EVERY = 5 * 60 * 1000;

const charge = createCharge({
  key: process.env.WALLET_BIDS_KEY,
  baseUrl: process.env.WALLET_URL || undefined,
});

const plugin = new utils.Plugin({ dir: __dirname });

const report = error => plugin.sendError(error).then(sent => sent || console.error(error));

let admins = new Set();
let minimum = DEFAULT_MIN_BID;

plugin.on('config', (config) => {
  const parsed = parseConfig(config);
  admins = parsed.admins;
  minimum = parsed.minBid;
  if (parsed.rejected.length) {
    const entries = parsed.rejected.map(entry => JSON.stringify(entry)).join(', ');
    report(new Error(`Ignored admins that are not Discord IDs written as text: ${entries}`));
  }
});

const service = createService({
  store: createStore({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue }),
  charge,
  isAdmin: discordId => typeof discordId === 'string' && admins.has(discordId),
  minBid: () => minimum,
  linkURL: process.env.WALLET_LINK_URL,
  onError: report,
});

plugin.presenceSystem().on('connect', () => service.resume().catch(report));
setInterval(() => service.resume().catch(report), RESUME_EVERY).unref();
plugin.defaultCommands(definitions);

plugin.messageSystem().on('message-in', (msg) => {
  if (msg.type !== 'text' || !msg.data || msg.data.connectorType !== 'discord') return;
  const input = parse(msg);
  if (!input) return;

  const context = { discordId: msg.uid, name: msg.data.nick || msg.uid };
  service.run(input.command, context, input)
    .then(({ text, hidden }) => {
      if (hidden) return plugin.messageSystem().sendMessage(privateReply(plugin, msg, text));
      return plugin.messageSystem().sendText(text, msg);
    })
    .catch(report);
});

const utils = require('@basedakp48/plugin-utils');
const admin = require('firebase-admin');
const createBoard = require('./src/board');
const { definitions } = require('./src/commands');
const { DEFAULT_MIN_BID, parseConfig } = require('./src/config');
const createLog = require('./src/log');
const privateReply = require('./src/reply');
const createService = require('./src/service');
const createStore = require('./src/store');
const createCharge = require('./src/wallet');

const RESUME_EVERY = 5 * 60 * 1000;

const wallet = {
  key: process.env.WALLET_BIDS_KEY,
  baseUrl: process.env.WALLET_URL || undefined,
};
const charge = createCharge(wallet);
const refund = createCharge.createRefund(wallet);

const plugin = new utils.Plugin({ dir: __dirname });

const report = error => plugin.sendError(error).then(sent => sent || console.error(error));

let admins = new Set();
let minimum = DEFAULT_MIN_BID;

const store = createStore({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
const board = createBoard({
  store,
  request: options => plugin.response(options),
  onError: report,
});
const log = createLog({
  request: options => plugin.response(options),
  onError: report,
});

plugin.on('config', (config) => {
  const parsed = parseConfig(config);
  admins = parsed.admins;
  minimum = parsed.minBid;
  if (parsed.rejected.length) {
    const entries = parsed.rejected.map(entry => JSON.stringify(entry)).join(', ');
    report(new Error(`Ignored admins that are not Discord IDs written as text: ${entries}`));
  }
  if (parsed.boardProblem) report(new Error(`Ignored the board setting: ${parsed.boardProblem}`));
  if (parsed.logProblem) report(new Error(`Ignored the log setting: ${parsed.logProblem}`));
  log.configure(parsed.log);
  if (board.configure(parsed.board)) board.reconcile().catch(report);
});

const service = createService({
  store,
  charge,
  refund,
  log: text => log.say(text),
  isAdmin: discordId => typeof discordId === 'string' && admins.has(discordId),
  minBid: () => minimum,
  linkURL: process.env.WALLET_LINK_URL,
  onChange: id => board.touch(id),
  refresh: id => board.syncNow(id),
  resync: () => board.reconcile(),
  onError: report,
});

plugin.presenceSystem().on('connect', () => {
  service.resume().catch(report);
  board.reconcile().catch(report);
});
setInterval(() => service.resume().catch(report), RESUME_EVERY).unref();
plugin.defaultCommands(definitions);

function answer(msg, {
  text, hidden, embed, pages, withText,
}) {
  const system = plugin.messageSystem();
  if (hidden) return system.sendMessage(privateReply(plugin, msg, text, { embed, pages }));
  const data = {};
  if (embed) data.discord_embed = embed;
  if (withText) data.includeText = true;
  if (pages) data.discord_pages = pages;
  return system.sendText(text, msg, Object.keys(data).length ? data : undefined);
}

plugin.messageSystem().on('message/command', (msg) => {
  if (!msg.data || msg.data.connectorType !== 'discord') return;
  if (!Object.hasOwn(definitions, msg.data.command)) return;

  const context = { discordId: msg.uid, name: msg.data.nick || msg.uid };
  service.run(msg.data.command, context, msg.data.args)
    .then(reply => answer(msg, reply))
    .catch(report);
});

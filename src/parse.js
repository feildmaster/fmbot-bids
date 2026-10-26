const { definitions } = require('./commands');

const PREFIX = '.';
const TRUE_WORDS = ['true', 'yes', 'y', '1', 'hidden', 'private'];

const hasCommand = name => Object.prototype.hasOwnProperty.call(definitions, name);

function parse(msg) {
  const text = String(msg.text || '').trim();
  const prefixed = text.startsWith(PREFIX);
  if (!prefixed && !(msg.data && msg.data.isPM)) return null;

  const body = (prefixed ? text.slice(PREFIX.length) : text).trim();
  const [first = '', ...words] = body.split(/\s+/);
  const command = first.toLowerCase();
  if (!hasCommand(command)) return null;
  return { command, words, rest: body.slice(first.length).trim() };
}

function toNumber(word) {
  if (!/^\d+$/.test(String(word))) return undefined;
  const number = Number(word);
  return Number.isSafeInteger(number) ? number : undefined;
}

const toBoolean = word => TRUE_WORDS.includes(String(word || '').toLowerCase());

module.exports = { parse, toBoolean, toNumber };

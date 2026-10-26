const DEFAULT_MIN_BID = 10;
const SNOWFLAKE = /^\d{15,25}$/;

const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};

function parseBoard(value) {
  if (value === undefined || value === null) return { board: null };
  const channel = value && typeof value.channel === 'string' ? value.channel.trim() : '';
  const cid = value && typeof value.cid === 'string' ? value.cid.trim() : '';
  if (SNOWFLAKE.test(channel) && cid) return { board: { channel, cid } };
  return {
    board: null,
    boardProblem: 'board needs a channel id and a connector cid, both written as text',
  };
}

function parseConfig(config) {
  const source = config && typeof config === 'object' ? config : {};

  const admins = new Set();
  const rejected = [];
  asList(source.admins).forEach((entry) => {
    const id = typeof entry === 'string' ? entry.trim() : undefined;
    if (id && SNOWFLAKE.test(id)) admins.add(id);
    else rejected.push(entry);
  });

  const configured = Number(source.minBid);
  const minBid = Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MIN_BID;

  return {
    admins, rejected, minBid, ...parseBoard(source.board),
  };
}

module.exports = { DEFAULT_MIN_BID, parseConfig };

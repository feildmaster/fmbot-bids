const DEFAULT_MIN_BID = 10;
const SNOWFLAKE = /^\d{15,25}$/;

const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};

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

  return { admins, rejected, minBid };
}

module.exports = { DEFAULT_MIN_BID, parseConfig };

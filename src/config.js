const DEFAULT_MIN_BID = 10;
const SNOWFLAKE = /^\d{15,25}$/;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};

const ADMINS_TEMPLATE = ['<placeholder>'];

const needsAdmins = config => !isObject(config) || config.admins === undefined;

function parseTarget(value, name) {
  if (value === undefined || value === null) return { [name]: null };
  const channel = value && typeof value.channel === 'string' ? value.channel.trim() : '';
  const cid = value && typeof value.cid === 'string' ? value.cid.trim() : '';
  if (SNOWFLAKE.test(channel) && cid) return { [name]: { channel, cid } };
  return {
    [name]: null,
    [`${name}Problem`]: `${name} needs a channel id and a connector cid, both written as text`,
  };
}

function parseConfig(config) {
  const source = config && typeof config === 'object' ? config : {};

  const admins = new Set();
  const rejected = [];
  asList(source.admins).forEach((entry) => {
    const id = typeof entry === 'string' ? entry.trim() : undefined;
    if (id && SNOWFLAKE.test(id)) admins.add(id);
    else if (!ADMINS_TEMPLATE.includes(id)) rejected.push(entry);
  });

  const configured = Number(source.minBid);
  const minBid = Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MIN_BID;

  return {
    admins,
    rejected,
    minBid,
    ...parseTarget(source.board, 'board'),
    ...parseTarget(source.log, 'log'),
  };
}

module.exports = {
  ADMINS_TEMPLATE, DEFAULT_MIN_BID, needsAdmins, parseConfig,
};

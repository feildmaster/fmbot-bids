const { toBoolean, toNumber } = require('./parse');

const PROVIDER = 'discord.com';
const MAX_TITLE = 80;
const LIST_LIMIT = 12;
const RETRY_TEXT = "I couldn't confirm your bid with the wallet yet. It will be retried on its own, so check feature-mine in a few minutes before bidding again.";

const fmt = amount => amount.toLocaleString('en-US');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const shown = text => ({ text, hidden: false });
const hiddenReply = text => ({ text, hidden: true });

function totalsByFeature(bids) {
  const totals = new Map();
  bids.forEach((bid) => {
    const entry = totals.get(bid.featureId) || { total: 0, backers: new Set() };
    entry.total += bid.amount;
    entry.backers.add(bid.discordId);
    totals.set(bid.featureId, entry);
  });
  return totals;
}

const totalOf = bids => bids.reduce((sum, bid) => sum + bid.amount, 0);

const millis = value => (value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value) || 0);

module.exports = function createService({
  store,
  charge,
  isAdmin,
  minBid = () => 10,
  linkURL,
  onError = console.error,
}) {
  const inFlight = new Set();

  const notLinked = linkURL
    ? `Your Discord account isn't linked to a wallet yet. Link it here: ${linkURL}`
    : "Your Discord account isn't linked to a wallet yet.";

  async function settle(bid) {
    const result = await charge({
      uid: `${PROVIDER}:::${bid.discordId}`,
      amount: bid.amount,
      requestId: bid.requestId,
      memo: bid.memo,
      extra: { bidFeature: String(bid.featureId), bidId: bid.id },
    });
    if (result && result.error) {
      await store.setBidStatus(bid.id, 'failed', { reason: String(result.error) });
      return { confirmed: false, error: String(result.error) };
    }
    await store.setBidStatus(bid.id, 'confirmed');
    return { confirmed: true };
  }

  function refusal(error) {
    switch (error) {
      case 'Balance insufficient': return "You don't have enough FMC for that bid.";
      case 'User not found': return notLinked;
      case 'Invalid wallet': return "You don't have a wallet yet.";
      default:
        onError(new Error(`Unexpected wallet answer: ${error}`));
        return 'Something went wrong with your bid, and nothing was taken.';
    }
  }

  async function list(ctx, { words }) {
    const status = (words[0] || 'open').toLowerCase();
    if (!['open', 'done'].includes(status)) return shown('Use feature-list open or feature-list done.');

    const [found, confirmed] = await Promise.all([
      store.listFeatures(status),
      store.confirmedBids(),
    ]);
    if (!found.length) {
      return shown(status === 'open' ? 'No features are open for bids yet.' : 'No bid has built a feature yet.');
    }

    const totals = totalsByFeature(confirmed);
    const rows = found
      .map((feature) => {
        const entry = totals.get(Number(feature.id));
        return {
          ...feature,
          total: entry ? entry.total : 0,
          backers: entry ? entry.backers.size : 0,
        };
      })
      .sort((a, b) => b.total - a.total || Number(a.id) - Number(b.id));
    const lines = rows.slice(0, LIST_LIMIT)
      .map(row => `#${row.id} ${row.title}: ${fmt(row.total)} FMC from ${plural(row.backers, 'bidder')}`);
    if (rows.length > LIST_LIMIT) lines.push(`...and ${rows.length - LIST_LIMIT} more`);
    return shown(`${status === 'open' ? 'Open features' : 'Finished features'}:\n${lines.join('\n')}`);
  }

  async function show(ctx, { words }) {
    const id = toNumber(words[0]);
    if (!id) return shown('Usage: feature-show <number>');
    const feature = await store.getFeature(id);
    if (!feature || feature.status === 'removed') return shown(`There is no feature #${id}.`);

    const confirmed = (await store.bidsForFeature(id)).filter(bid => bid.status === 'confirmed');
    const head = `#${id} ${feature.title} (${feature.status})`;
    if (!confirmed.length) return shown(`${head}\nNo bids yet.`);

    const named = new Map();
    confirmed.filter(bid => !bid.hidden).forEach((bid) => {
      const entry = named.get(bid.discordId) || { name: bid.name, amount: 0, reached: 0 };
      entry.name = bid.name;
      entry.amount += bid.amount;
      entry.reached = Math.max(entry.reached, millis(bid.createdAt));
      named.set(bid.discordId, entry);
    });
    const [top] = [...named.values()].sort((a, b) => b.amount - a.amount
      || a.reached - b.reached
      || a.name.localeCompare(b.name));

    const everyone = new Set(confirmed.map(bid => bid.discordId));
    const lines = [
      head,
      `${fmt(totalOf(confirmed))} FMC from ${plural(everyone.size, 'bidder')}`,
    ];
    if (top) lines.push(`Top backer: ${top.name} ${fmt(top.amount)}`);
    return shown(lines.join('\n'));
  }

  async function mine(ctx) {
    const bids = (await store.bidsByUser(ctx.discordId)).filter(bid => bid.status !== 'failed');
    if (!bids.length) return hiddenReply("You haven't bid on anything yet.");

    const ids = [...new Set(bids.map(bid => bid.featureId))];
    const entry = async id => [id, await store.getFeature(id)];
    const features = new Map(await Promise.all(ids.map(entry)));
    const lines = ids.map((id) => {
      const mineHere = bids.filter(bid => bid.featureId === id);
      const feature = features.get(id);
      const flags = [];
      if (mineHere.some(bid => bid.status === 'pending')) flags.push('pending');
      if (mineHere.some(bid => bid.hidden)) flags.push('hidden');
      return `#${id} ${feature ? feature.title : 'removed feature'}: ${fmt(totalOf(mineHere))} FMC${flags.length ? ` (${flags.join(', ')})` : ''}`;
    });
    return hiddenReply(`Your bids:\n${lines.join('\n')}`);
  }

  async function placeBid(ctx, { words }) {
    const id = toNumber(words[0]);
    const amount = toNumber(words[1]);
    if (!id || !amount) return hiddenReply('Usage: feature-bid <number> <amount> [hidden]');
    if (amount < minBid()) return hiddenReply(`The smallest bid is ${fmt(minBid())} FMC.`);

    const feature = await store.getFeature(id);
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);
    if (feature.status !== 'open') return hiddenReply(`Bidding on #${id} is closed.`);
    if (inFlight.has(ctx.discordId)) return hiddenReply('Your last bid is still going through.');

    inFlight.add(ctx.discordId);
    try {
      const placed = await store.createBid({
        featureId: id,
        discordId: ctx.discordId,
        name: ctx.name,
        amount,
        hidden: toBoolean(words[2]),
        memo: `Feature bid #${id}: ${feature.title}`,
      });

      let outcome;
      try {
        outcome = await settle(placed);
      } catch (error) {
        onError(error);
        return hiddenReply(RETRY_TEXT);
      }
      if (!outcome.confirmed) return hiddenReply(refusal(outcome.error));

      const total = totalOf((await store.bidsForFeature(id)).filter(item => item.status === 'confirmed'));
      return hiddenReply(`Bid placed: ${fmt(amount)} FMC on #${id} ${feature.title}. It has ${fmt(total)} FMC behind it now.`);
    } finally {
      inFlight.delete(ctx.discordId);
    }
  }

  async function add(ctx, { rest }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const title = rest.replace(/\s+/g, ' ').trim();
    if (!title) return hiddenReply('Usage: feature-add <title>');
    if (title.length > MAX_TITLE) return hiddenReply(`Keep the title under ${MAX_TITLE} characters.`);
    const id = await store.createFeature({ title, createdBy: ctx.discordId });
    return shown(`Added #${id}: ${title}. Bid on it with feature-bid ${id} <amount>.`);
  }

  async function done(ctx, { words }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const id = toNumber(words[0]);
    if (!id) return hiddenReply('Usage: feature-done <number>');
    const feature = await store.getFeature(id);
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);
    if (feature.status !== 'open') return hiddenReply(`#${id} is already ${feature.status}.`);

    await store.setFeatureStatus(id, 'done', ctx.discordId);
    const confirmed = (await store.bidsForFeature(id)).filter(item => item.status === 'confirmed');
    const backers = new Set(confirmed.map(item => item.discordId)).size;
    return shown(`#${id} ${feature.title} is done! ${plural(backers, 'bidder')} put ${fmt(totalOf(confirmed))} FMC behind it.`);
  }

  async function remove(ctx, { words }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const id = toNumber(words[0]);
    if (!id) return hiddenReply('Usage: feature-remove <number>');
    const feature = await store.getFeature(id);
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);

    const live = (await store.bidsForFeature(id)).filter(item => ['confirmed', 'pending'].includes(item.status));
    if (live.length) return hiddenReply(`#${id} has bids, and refunds aren't available yet, so it can't be removed.`);

    await store.setFeatureStatus(id, 'removed', ctx.discordId);
    return hiddenReply(`Removed #${id}: ${feature.title}.`);
  }

  const handlers = {
    'feature-list': list,
    'feature-show': show,
    'feature-mine': mine,
    'feature-bid': placeBid,
    'feature-add': add,
    'feature-done': done,
    'feature-remove': remove,
  };

  return {
    run: (command, ctx, input) => handlers[command](
      { ...ctx, admin: isAdmin(ctx.discordId) },
      input,
    ),

    async resume() {
      const pending = await store.pendingBids();
      await pending.reduce((chain, item) => chain
        .then(() => settle(item))
        .catch(onError), Promise.resolve());
      return pending.length;
    },
  };
};

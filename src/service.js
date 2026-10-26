const { render } = require('./embed');
const { fmt, plural } = require('./format');
const { summarize } = require('./summary');

const PROVIDER = 'discord.com';
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;
const CLEAR = '-';
const LIST_LIMIT = 12;
const MAX_LIST = 3900;
const LIST_COLOR = 0x5865f2;
const STALE_BOARD = ' The board could not be updated, so it may be out of date.';
const RETRY_TEXT = "I couldn't confirm your bid with the wallet yet. It will be retried on its own, so check feature-mine in a few minutes before bidding again.";

const shown = (text, embed) => ({ text, hidden: false, ...(embed ? { embed } : {}) });
const hiddenReply = (text, embed) => ({ text, hidden: true, ...(embed ? { embed } : {}) });

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

const tidy = text => String(text || '').replace(/\s+/g, ' ').trim();
const isId = id => Number.isSafeInteger(id) && id > 0;

function bidList(lines) {
  const items = [];
  let length = 0;
  lines.every((line) => {
    const item = `- ${line}`;
    if (length + item.length + 1 > MAX_LIST) return false;
    items.push(item);
    length += item.length + 1;
    return true;
  });
  if (items.length < lines.length) items.push(`...and ${lines.length - items.length} more`);
  return { title: 'Your bids', color: LIST_COLOR, description: items.join('\n') };
}

const totalOf = bids => bids.reduce((sum, bid) => sum + bid.amount, 0);

module.exports = function createService({
  store,
  charge,
  isAdmin,
  minBid = () => 10,
  linkURL,
  onChange = () => {},
  refresh = async () => null,
  resync = async () => null,
  onError = console.error,
}) {
  const inFlight = new Set();

  const boardNote = async (id) => {
    try {
      return (await refresh(id)) === 'failed' ? STALE_BOARD : '';
    } catch (error) {
      onError(error);
      return STALE_BOARD;
    }
  };

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
    onChange(bid.featureId);
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

  async function list(ctx, { status: asked }) {
    const status = String(asked || 'open').toLowerCase();
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

  async function show(ctx, { id }) {
    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return shown(`There is no feature #${id}.`);

    const summary = summarize(await store.bidsForFeature(id));
    const head = `#${id} ${feature.title} (${feature.status})`;
    const about = feature.description ? [feature.description] : [];
    const embed = render({ ...feature, id }, summary);
    if (!summary.backers) return shown([head, ...about, 'No bids yet.'].join('\n'), embed);

    const lines = [
      head,
      ...about,
      `${fmt(summary.total)} FMC from ${plural(summary.backers, 'bidder')}`,
    ];
    if (summary.top) lines.push(`Top public backer: ${summary.top.name} ${fmt(summary.top.amount)}`);
    return shown(lines.join('\n'), embed);
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
      const secret = totalOf(mineHere.filter(bid => bid.hidden));
      if (secret && secret === totalOf(mineHere)) flags.push('all hidden');
      else if (secret) flags.push(`${fmt(totalOf(mineHere) - secret)} public`, `${fmt(secret)} hidden`);
      return `#${id} ${feature ? feature.title : 'removed feature'}: ${fmt(totalOf(mineHere))} FMC${flags.length ? ` (${flags.join(', ')})` : ''}`;
    });
    return hiddenReply(`Your bids:\n${lines.join('\n')}`, bidList(lines));
  }

  async function placeBid(ctx, { id, amount, hidden }) {
    if (!Number.isSafeInteger(amount) || amount < minBid()) {
      return hiddenReply(`The smallest bid is ${fmt(minBid())} FMC.`);
    }

    const feature = isId(id) ? await store.getFeature(id) : null;
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
        hidden: hidden === true,
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

      const confirmed = (await store.bidsForFeature(id)).filter(item => item.status === 'confirmed');
      const total = totalOf(confirmed);
      const yours = totalOf(confirmed.filter(item => item.discordId === ctx.discordId));
      const placedText = `Bid placed: ${fmt(amount)} FMC on #${id} ${feature.title}${hidden === true ? ' (hidden)' : ''}.`;
      if (yours === amount) return hiddenReply(`${placedText} It has ${fmt(total)} FMC behind it now.`);
      return hiddenReply(`${placedText} You have ${fmt(yours)} FMC on it now, and ${fmt(total)} FMC is behind it in total.`);
    } finally {
      inFlight.delete(ctx.discordId);
    }
  }

  async function add(ctx, input) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const title = tidy(input.title);
    const description = tidy(input.description);
    if (!title) return hiddenReply('A feature needs a title.');
    if (title.length > MAX_TITLE) return hiddenReply(`Keep the title under ${MAX_TITLE} characters.`);
    if (description.length > MAX_DESCRIPTION) return hiddenReply(`Keep the description under ${MAX_DESCRIPTION} characters.`);
    const id = await store.createFeature({ title, description, createdBy: ctx.discordId });
    const note = await boardNote(id);
    return shown(`Added #${id}: ${title}. Bid on it with feature-bid ${id} <amount>.${note}`);
  }

  async function edit(ctx, { id, ...input }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const title = tidy(input.title);
    const description = tidy(input.description);
    if (!title && !description) {
      return hiddenReply(`Give a new title, a new description, or both. Use ${CLEAR} as the description to remove it.`);
    }
    if (title.length > MAX_TITLE) return hiddenReply(`Keep the title under ${MAX_TITLE} characters.`);
    if (description.length > MAX_DESCRIPTION) return hiddenReply(`Keep the description under ${MAX_DESCRIPTION} characters.`);

    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);

    const changes = {};
    const parts = [];
    if (title) {
      changes.title = title;
      parts.push(`the title is now "${title}"`);
    }
    if (description) {
      changes.description = description === CLEAR ? null : description;
      parts.push(description === CLEAR ? 'the description was removed' : 'the description was updated');
    }
    await store.updateFeature(id, changes);
    const note = await boardNote(id);
    return hiddenReply(`#${id}: ${parts.join(', and ')}.${note}`);
  }

  async function done(ctx, { id }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);
    if (feature.status !== 'open') return hiddenReply(`#${id} is already ${feature.status}.`);

    await store.setFeatureStatus(id, 'done', ctx.discordId);
    const note = await boardNote(id);
    const confirmed = (await store.bidsForFeature(id)).filter(item => item.status === 'confirmed');
    const backers = new Set(confirmed.map(item => item.discordId)).size;
    return shown(`#${id} ${feature.title} is done! ${plural(backers, 'bidder')} put ${fmt(totalOf(confirmed))} FMC behind it.${note}`);
  }

  async function remove(ctx, { id }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);

    const live = (await store.bidsForFeature(id)).filter(item => ['confirmed', 'pending'].includes(item.status));
    if (live.length) return hiddenReply(`#${id} has bids, and refunds aren't available yet, so it can't be removed.`);

    await store.setFeatureStatus(id, 'removed', ctx.discordId);
    const note = await boardNote(id);
    return hiddenReply(`Removed #${id}: ${feature.title}.${note}`);
  }

  async function sync(ctx) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const count = await resync();
    if (count === null) {
      return hiddenReply("The board isn't set up. Add board.channel and board.cid to the plugin's config.");
    }
    return hiddenReply(`Checked ${plural(count, 'feature')} on the board.`);
  }

  const handlers = {
    'feature-list': list,
    'feature-show': show,
    'feature-mine': mine,
    'feature-bid': placeBid,
    'feature-add': add,
    'feature-edit': edit,
    'feature-done': done,
    'feature-remove': remove,
    'feature-sync': sync,
  };

  return {
    run: (command, ctx, args = {}) => handlers[command](
      { ...ctx, admin: isAdmin(ctx.discordId) },
      args,
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

const { render } = require('./embed');
const { fmt, plural } = require('./format');
const { summarize } = require('./summary');

const PROVIDER = 'discord.com';
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;
const CLEAR = '-';
const PAGE_SIZE = 10;
const OPEN_COLOR = 0x5865f2;
const DONE_COLOR = 0x57f287;
const STALE_BOARD = ' The board could not be updated, so it may be out of date.';
const RETRY_TEXT = "I couldn't confirm your bid with the wallet yet. It will be retried on its own, so check feature-mine in a few minutes before bidding again.";

const shown = (text, extra = {}) => ({ text, hidden: false, ...extra });
const hiddenReply = (text, extra = {}) => ({ text, hidden: true, ...extra });

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

function paginate(lines, title, color) {
  const count = Math.ceil(lines.length / PAGE_SIZE);
  return Array.from({ length: count }, (_, page) => ({
    title,
    color,
    description: lines
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map(line => `- ${line}`)
      .join('\n'),
  }));
}

const totalOf = bids => bids.reduce((sum, bid) => sum + bid.amount, 0);

module.exports = function createService({
  store,
  charge,
  refund = async () => ({ error: 'Refunds are not set up' }),
  log = async () => {},
  isAdmin,
  minBid = () => 10,
  linkURL,
  onChange = () => {},
  refresh = async () => null,
  resync = async () => null,
  onError = console.error,
}) {
  const inFlight = new Set();
  const refundFailures = new Set();
  let running = Promise.resolve();

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

  const logRefund = text => Promise.resolve(log(text)).catch(onError);

  async function refundBid(bid) {
    try {
      const result = await refund({
        uid: `${PROVIDER}:::${bid.discordId}`,
        requestId: bid.requestId,
        memo: `Refund: ${bid.memo}`,
      });
      if (result && result.error) throw new Error(String(result.error));
      await store.setBidStatus(bid.id, 'refunded');
      refundFailures.delete(bid.id);
      await logRefund(`Refunded ${fmt(bid.amount)} FMC to ${bid.name} (${bid.discordId}) for #${bid.featureId}.`);
    } catch (error) {
      if (!refundFailures.has(bid.id)) {
        refundFailures.add(bid.id);
        onError(error);
        await logRefund(`Could not refund ${fmt(bid.amount)} FMC to ${bid.name} (${bid.discordId}) for #${bid.featureId}: ${error.message}. It will be tried again.`);
      }
    }
  }

  async function sweepRefunds(only) {
    const confirmed = (await store.confirmedBids())
      .filter(bid => only === undefined || bid.featureId === only);
    const featureIds = [...new Set(confirmed.map(bid => bid.featureId))];
    const load = async id => [id, await store.getFeature(id)];
    const features = new Map(await Promise.all(featureIds.map(load)));
    const owed = confirmed.filter((bid) => {
      const feature = features.get(bid.featureId);
      return feature && feature.status === 'removed';
    });
    await owed.reduce((chain, bid) => chain.then(() => refundBid(bid)), Promise.resolve());
  }

  const queueSweep = (only) => {
    running = running.then(() => sweepRefunds(only)).catch(onError);
    return running;
  };

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

  async function list(ctx, { status: asked, private: hide }) {
    const reply = hide === true ? hiddenReply : shown;
    const status = String(asked || 'open').toLowerCase();
    if (!['open', 'done'].includes(status)) return reply('Use feature-list open or feature-list done.');

    const [found, confirmed] = await Promise.all([
      store.listFeatures(status),
      store.confirmedBids(),
    ]);
    if (!found.length) {
      return reply(status === 'open' ? 'No features are open for bids yet.' : 'No bid has built a feature yet.');
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
    const lines = rows
      .map(row => `#${row.id} ${row.title}: ${fmt(row.total)} FMC from ${plural(row.backers, 'bidder')}`);
    const heading = status === 'open' ? 'Open features' : 'Finished features';
    return reply(`${heading}:\n${lines.join('\n')}`, {
      pages: paginate(lines, heading, status === 'open' ? OPEN_COLOR : DONE_COLOR),
    });
  }

  async function show(ctx, { id }) {
    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return shown(`There is no feature #${id}.`);

    const summary = summarize(await store.bidsForFeature(id));
    const head = `#${id} ${feature.title} (${feature.status})`;
    const about = feature.description ? [feature.description] : [];
    const embed = render({ ...feature, id }, summary);
    if (!summary.backers) return shown([head, ...about, 'No bids yet.'].join('\n'), { embed });

    const lines = [
      head,
      ...about,
      `${fmt(summary.total)} FMC from ${plural(summary.backers, 'bidder')}`,
    ];
    if (summary.top) lines.push(`Top public backer: ${summary.top.name} ${fmt(summary.top.amount)}`);
    return shown(lines.join('\n'), { embed });
  }

  async function mine(ctx) {
    const bids = (await store.bidsByUser(ctx.discordId)).filter(bid => bid.status !== 'failed');
    if (!bids.length) return hiddenReply("You haven't bid on anything yet.");

    const ids = [...new Set(bids.map(bid => bid.featureId))];
    const entry = async id => [id, await store.getFeature(id)];
    const features = new Map(await Promise.all(ids.map(entry)));
    const lines = ids.map((id) => {
      const here = bids.filter(bid => bid.featureId === id);
      const mineHere = here.filter(bid => bid.status !== 'refunded');
      const feature = features.get(id);
      if (!mineHere.length) {
        return `#${id} ${feature ? feature.title : 'removed feature'}: ${fmt(totalOf(here))} FMC refunded`;
      }
      const flags = [];
      if (mineHere.some(bid => bid.status === 'pending')) flags.push('pending');
      const secret = totalOf(mineHere.filter(bid => bid.hidden));
      if (secret && secret === totalOf(mineHere)) flags.push('all hidden');
      else if (secret) flags.push(`${fmt(totalOf(mineHere) - secret)} public`, `${fmt(secret)} hidden`);
      return `#${id} ${feature ? feature.title : 'removed feature'}: ${fmt(totalOf(mineHere))} FMC${flags.length ? ` (${flags.join(', ')})` : ''}`;
    });
    return hiddenReply(`Your bids:\n${lines.join('\n')}`, { pages: paginate(lines, 'Your bids', OPEN_COLOR) });
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
    const summary = summarize(await store.bidsForFeature(id));
    const embed = render({ ...feature, id, status: 'done' }, summary);
    return shown(`#${id} ${feature.title} is done!${note}`, { embed, withText: true });
  }

  async function remove(ctx, { id }) {
    if (!ctx.admin) return hiddenReply('Only admins can do that.');
    const feature = isId(id) ? await store.getFeature(id) : null;
    if (!feature || feature.status === 'removed') return hiddenReply(`There is no feature #${id}.`);

    const live = (await store.bidsForFeature(id)).filter(item => ['confirmed', 'pending'].includes(item.status));
    if (live.length && feature.status !== 'open') {
      return hiddenReply(`#${id} is ${feature.status}, so its bids can't be refunded.`);
    }

    await store.setFeatureStatus(id, 'removed', ctx.discordId);
    queueSweep(id);
    const note = await boardNote(id);
    if (live.length) return hiddenReply(`Removed #${id} ${feature.title} and refunding its bids.${note}`);
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
      await queueSweep();
      return pending.length;
    },

    idle: () => running,
  };
};

const { render } = require('./embed');
const { summarize } = require('./summary');

const DEBOUNCE = 3000;
const SHOWN = ['open', 'done'];
const GONE = ['Unknown message', 'Unknown channel'];
module.exports = function createBoard({
  store,
  request,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounce = DEBOUNCE,
  onError = console.error,
}) {
  let target = null;
  const timers = new Map();
  const chains = new Map();

  const ask = (command, channel, data, cid = target.cid) => request({
    target: cid, command, arg: channel, data,
  }).then(
    reply => reply.data,
    (error) => {
      if (typeof error === 'string') return { error };
      throw error;
    },
  );

  const enqueue = (id, task) => {
    const next = (chains.get(id) || Promise.resolve()).then(task).catch(onError);
    chains.set(id, next);
    next.then(() => {
      if (chains.get(id) === next) chains.delete(id);
    });
    return next;
  };

  async function removeMessage(feature) {
    const { channel, id, cid } = feature.board;
    const result = await ask('delete-message', channel, { id }, cid);
    if (result && result.error && !GONE.includes(result.error)) {
      throw new Error(`The board could not delete message ${id}: ${result.error}`);
    }
    await store.setFeatureBoard(feature.id, null);
  }

  async function syncOne(id) {
    if (!target) return;
    const feature = await store.getFeature(id);
    if (!feature) return;

    const removed = feature.status === 'removed';
    if (!SHOWN.includes(feature.status) && !removed) {
      if (feature.board) await removeMessage(feature);
      return;
    }

    let pointer = feature.board;
    if (pointer && (pointer.channel !== target.channel || pointer.cid !== target.cid)) {
      await removeMessage(feature).catch(onError);
      pointer = null;
    }
    if (removed && !pointer) return;

    const embed = render(feature, summarize(await store.bidsForFeature(id)));
    if (pointer) {
      const edited = await ask('edit-message', target.channel, { id: pointer.id, embed });
      if (!edited.error) return;
      if (edited.error !== 'Unknown message') {
        throw new Error(`The board could not edit message ${pointer.id}: ${edited.error}`);
      }
      if (removed) {
        await store.setFeatureBoard(id, null);
        return;
      }
    }

    const posted = await ask('post-message', target.channel, { embed });
    if (posted.error) throw new Error(`The board could not post feature #${id}: ${posted.error}`);
    await store.setFeatureBoard(id, { channel: target.channel, id: posted.id, cid: target.cid });
  }

  return {
    configure(board) {
      const next = board ? { channel: board.channel, cid: board.cid } : null;
      const changed = JSON.stringify(next) !== JSON.stringify(target);
      target = next;
      return changed;
    },

    isConfigured: () => target !== null,

    async syncNow(id) {
      if (!target) return null;
      clearTimer(timers.get(id));
      timers.delete(id);
      let failed = false;
      await enqueue(id, () => syncOne(id).catch((error) => {
        failed = true;
        throw error;
      }));
      return failed ? 'failed' : 'updated';
    },

    touch(id) {
      if (!target) return;
      clearTimer(timers.get(id));
      timers.set(id, setTimer(() => {
        timers.delete(id);
        enqueue(id, () => syncOne(id));
      }, debounce));
    },

    async reconcile() {
      if (!target) return null;
      const lists = await Promise.all([...SHOWN, 'removed'].map(status => store.listFeatures(status)));
      const features = lists
        .flat()
        .filter(feature => feature.status !== 'removed' || feature.board)
        .sort((a, b) => Number(a.id) - Number(b.id));
      await features.reduce(
        (chain, feature) => chain.then(() => enqueue(feature.id, () => syncOne(feature.id))),
        Promise.resolve(),
      );
      return features.length;
    },
  };
};

const MAX_TEXT = 2000;

module.exports = function createLog({ request, onError = console.error }) {
  const state = { target: null };

  return {
    configure(target) {
      state.target = target ? { channel: target.channel, cid: target.cid } : null;
    },

    isConfigured: () => state.target !== null,

    async say(text) {
      if (!state.target) return;
      try {
        await request({
          target: state.target.cid,
          command: 'post-message',
          arg: state.target.channel,
          data: { text: String(text).slice(0, MAX_TEXT) },
        });
      } catch (error) {
        onError(error instanceof Error ? error : new Error(`The log could not post: ${error}`));
      }
    },
  };
};

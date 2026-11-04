const plain = doc => ({ ...doc.data(), id: doc.id });

module.exports = function createStore({ db, FieldValue }) {
  const features = () => db.collection('features');
  const bids = () => db.collection('bids');

  const query = async (collection, field, value) => {
    const snapshot = await collection.where(field, '==', value).get();
    return snapshot.docs.map(plain);
  };

  return {
    async createFeature({ title, description, createdBy }) {
      const counter = db.doc('counters/features');
      return db.runTransaction(async (t) => {
        const snapshot = await t.get(counter);
        const id = snapshot.exists ? snapshot.get('next') : 1;
        t.set(counter, { next: id + 1 });
        t.set(features().doc(String(id)), {
          title,
          ...(description ? { description } : {}),
          status: 'open',
          createdBy,
          createdAt: FieldValue.serverTimestamp(),
        });
        return id;
      });
    },

    async getFeature(id) {
      const snapshot = await features().doc(String(id)).get();
      return snapshot.exists ? plain(snapshot) : null;
    },

    listFeatures: status => query(features(), 'status', status),

    updateFeature(id, { title, description }) {
      const fields = {};
      if (title !== undefined) fields.title = title;
      if (description !== undefined) {
        fields.description = description === null ? FieldValue.delete() : description;
      }
      return features().doc(String(id)).update(fields);
    },

    setFeatureBoard(id, board) {
      return features().doc(String(id)).update({ board });
    },

    setFeatureStatus(id, status, by) {
      return features().doc(String(id)).update({
        status,
        closedBy: by,
        closedAt: FieldValue.serverTimestamp(),
      });
    },

    async createBid({
      featureId, discordId, name, amount, hidden, memo,
    }) {
      const ref = bids().doc();
      const bid = {
        featureId: Number(featureId),
        discordId,
        name,
        amount,
        hidden: hidden === true,
        memo,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      };
      await ref.set(bid);
      return { ...bid, id: ref.id };
    },

    setBidStatus(id, status, extra = {}) {
      return bids().doc(id).update({ ...extra, status });
    },

    pendingBids: () => query(bids(), 'status', 'pending'),
    confirmedBids: () => query(bids(), 'status', 'confirmed'),
    bidsForFeature: featureId => query(bids(), 'featureId', Number(featureId)),
    bidsByUser: discordId => query(bids(), 'discordId', discordId),
  };
};

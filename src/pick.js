const { millis } = require('./summary');

const byAge = (a, b) => millis(a.createdAt) - millis(b.createdAt)
  || String(a.id).localeCompare(String(b.id));

function pickBids(bids, target) {
  const ordered = [...bids].sort(byAge);
  const total = ordered.reduce((sum, bid) => sum + bid.amount, 0);
  if (target >= total) return { picked: ordered, sum: total };

  const reach = new Map([[0, null]]);
  ordered.forEach((bid) => {
    [...reach.keys()].forEach((sum) => {
      const next = sum + bid.amount;
      if (next <= target && !reach.has(next)) reach.set(next, { from: sum, bid });
    });
  });

  const walk = sum => (sum === 0 ? [] : [reach.get(sum).bid, ...walk(reach.get(sum).from)]);
  const best = Math.max(...reach.keys());
  return { picked: walk(best), sum: best };
}

module.exports = { pickBids };

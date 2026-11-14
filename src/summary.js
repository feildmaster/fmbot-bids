const millis = value => (
  value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value) || 0
);

function summarize(bids) {
  const confirmed = bids.filter(bid => bid.status === 'confirmed');

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

  return {
    total: confirmed.reduce((sum, bid) => sum + bid.amount, 0),
    backers: new Set(confirmed.map(bid => bid.discordId)).size,
    top: top ? { name: top.name, amount: top.amount } : undefined,
  };
}

module.exports = { millis, summarize };

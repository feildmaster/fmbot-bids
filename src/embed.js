const { fmt, plural } = require('./format');

const COLORS = { open: 0x5865f2, done: 0x57f287, removed: 0xed4245 };
const FOOTERS = {
  open: id => `Open for bids · feature-bid ${id} <amount>`,
  done: () => 'Built',
  removed: () => 'Removed',
};

function render(feature, summary) {
  const fields = [];
  if (feature.status !== 'removed') {
    fields.push({
      name: 'Backed by',
      value: `${fmt(summary.total)} FMC from ${plural(summary.backers, 'bidder')}`,
      inline: true,
    });
    if (summary.top) {
      fields.push({ name: 'Top public backer', value: `${summary.top.name} ${fmt(summary.top.amount)}`, inline: true });
    }
  }

  const embed = {
    title: `#${feature.id} ${feature.title}`,
    color: COLORS[feature.status],
    fields,
    footer: { text: FOOTERS[feature.status](feature.id) },
  };
  if (feature.description) embed.description = feature.description;
  return embed;
}

module.exports = { render };

const { fmt, plural } = require('./format');

const COLORS = { open: 0x5865f2, done: 0x57f287, removed: 0xed4245 };
const FOOTERS = {
  open: id => `Open for bids · feature bid ${id} <amount>`,
  done: () => 'Built',
  removed: () => 'Removed',
};

const BAR_WIDTH = 10;

function progress(goal, total) {
  if (total >= goal) return `✅ Goal met: ${fmt(total)} / ${fmt(goal)} FMC`;
  const filled = Math.floor((total / goal) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  return `${bar} ${fmt(total)} / ${fmt(goal)} FMC`;
}

function everyText({ count, unit }) {
  return count === 1 ? `every ${unit.slice(0, -1)}` : `every ${count} ${unit}`;
}

function dueText({ due, every }) {
  const [year, month, day] = due.split('-').map(Number);
  const seconds = Date.UTC(year, month - 1, day) / 1000;
  const when = `<t:${seconds}:D> (<t:${seconds}:R>)`;
  return every ? `${when}\nRepeats ${everyText(every)}` : when;
}

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
    if (feature.goal) {
      fields.push({ name: 'Goal', value: progress(feature.goal, summary.total) });
    }
    if (feature.due && feature.status === 'open') {
      fields.push({ name: 'Due', value: dueText(feature), inline: true });
    }
    const history = feature.history || [];
    if (history.length) {
      const collected = history.reduce((sum, cycle) => sum + cycle.total, 0);
      fields.push({
        name: 'Cashed out',
        value: `${fmt(collected)} FMC over ${plural(history.length, 'cycle')}`,
      });
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

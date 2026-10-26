const fmt = amount => amount.toLocaleString('en-US');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

module.exports = { fmt, plural };

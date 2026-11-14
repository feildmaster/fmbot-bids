const UNITS = ['days', 'months', 'years'];
const MAX_COUNT = 1000;
const MAX_STEPS = 50000;

const parts = text => text.split('-').map(Number);
const pad = (value, width) => String(value).padStart(width, '0');
const format = (year, month, day) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = parts(text);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function addSpan(text, { count, unit }) {
  const [year, month, day] = parts(text);
  if (unit === 'days') {
    const moved = new Date(Date.UTC(year, month - 1, day + count));
    return format(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
  }
  const index = (month - 1) + (unit === 'years' ? count * 12 : count);
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return format(nextYear, nextMonth, Math.min(day, daysIn(nextYear, nextMonth)));
}

function rollDue(text, span, today) {
  return Array.from({ length: MAX_STEPS }).reduce(
    date => (date > today ? date : addSpan(date, span)),
    addSpan(text, span),
  );
}

const todayOf = millis => new Date(millis).toISOString().slice(0, 10);

module.exports = {
  MAX_COUNT, UNITS, addSpan, rollDue, todayOf, validDate,
};

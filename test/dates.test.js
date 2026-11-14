const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  addSpan, rollDue, todayOf, validDate,
} = require('../src/dates');

const span = (count, unit) => ({ count, unit });

test('only real calendar dates written as YYYY-MM-DD are valid', () => {
  ['2027-01-01', '2028-02-29', '1999-12-31'].forEach((text) => {
    assert.equal(validDate(text), true, text);
  });
  ['2027-02-29', '2027-13-01', '2027-00-10', '2027-1-1', '27-01-01', 'soon', '', '2027-01-01 '].forEach((text) => {
    assert.equal(validDate(text), false, text);
  });
});

test('days are added across month and year ends', () => {
  assert.equal(addSpan('2027-01-01', span(30, 'days')), '2027-01-31');
  assert.equal(addSpan('2027-12-31', span(1, 'days')), '2028-01-01');
  assert.equal(addSpan('2028-02-28', span(2, 'days')), '2028-03-01');
});

test('months are added by the calendar, and a day that does not exist moves to the last one', () => {
  assert.equal(addSpan('2027-01-15', span(1, 'months')), '2027-02-15');
  assert.equal(addSpan('2027-01-31', span(1, 'months')), '2027-02-28');
  assert.equal(addSpan('2028-01-31', span(1, 'months')), '2028-02-29');
  assert.equal(addSpan('2027-11-30', span(3, 'months')), '2028-02-29');
  assert.equal(addSpan('2027-12-10', span(1, 'months')), '2028-01-10');
  assert.equal(addSpan('2027-01-10', span(24, 'months')), '2029-01-10');
});

test('years keep the day, and a leap day moves to the last day of February', () => {
  assert.equal(addSpan('2027-06-01', span(1, 'years')), '2028-06-01');
  assert.equal(addSpan('2028-02-29', span(1, 'years')), '2029-02-28');
  assert.equal(addSpan('2028-02-29', span(4, 'years')), '2032-02-29');
});

test('rolling a due date forward adds the span once when it was not late', () => {
  assert.equal(rollDue('2027-01-01', span(1, 'years'), '2026-12-01'), '2028-01-01');
  assert.equal(rollDue('2026-12-01', span(1, 'months'), '2026-11-20'), '2027-01-01');
});

test('a cash-out that is late keeps the rhythm and lands on the next date after today', () => {
  assert.equal(rollDue('2026-01-01', span(1, 'years'), '2026-11-14'), '2027-01-01');
  assert.equal(rollDue('2024-01-01', span(1, 'years'), '2026-11-14'), '2027-01-01');
  assert.equal(rollDue('2026-09-10', span(1, 'months'), '2026-11-14'), '2026-12-10');
  assert.equal(rollDue('2026-11-14', span(7, 'days'), '2026-11-14'), '2026-11-21');
});

test('a due date a very long time ago still rolls forward', () => {
  assert.equal(rollDue('2001-01-01', span(1, 'days'), '2026-11-14'), '2026-11-15');
});

test('today is the UTC date of a clock reading', () => {
  assert.equal(todayOf(Date.UTC(2026, 10, 14, 23, 59)), '2026-11-14');
  assert.equal(todayOf(Date.UTC(2026, 10, 15, 0, 0)), '2026-11-15');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleDate, dueBlock, scheduleType, shiftIsoDate, unfinishedReminderTime } from '../src/schedule.js';

test('calendar weekdays select the same schedule types as the planner', () => {
  assert.equal(scheduleType('2026-11-23'), 'full'); // Monday
  assert.equal(scheduleType('2026-11-28'), 'half'); // Saturday
  assert.equal(scheduleType('2026-11-29'), 'rest'); // Sunday
  assert.equal(scheduleType('2026-11-22'), 'rest'); // preparation before plan start
});

test('cycle day changes at 04:00 local time', () => {
  assert.equal(cycleDate({ year: '2026', month: '11', day: '23', hour: '03', minute: '59' }), '2026-11-22');
  assert.equal(cycleDate({ year: '2026', month: '11', day: '23', hour: '04', minute: '00' }), '2026-11-23');
  assert.equal(shiftIsoDate('2027-01-01', -1), '2026-12-31');
});

test('schedule block notifications use correct block text and morning message', () => {
  const morning = dueBlock({ year: '2026', month: '11', day: '23', hour: '12', minute: '00' });
  assert.equal(morning.title, 'Хорошего и продуктивного дня!');
  assert.equal(morning.tab, 'today');
  const work = dueBlock({ year: '2026', month: '11', day: '23', hour: '16', minute: '00' });
  assert.equal(work.title, 'Начинается блок: Окно касаний');
  assert.equal(work.key, '2026-11-23:16:00:block');
  assert.equal(dueBlock({ year: '2026', month: '11', day: '23', hour: '16', minute: '01' }), null);
});

test('Saturday and Sunday blocks match the planner', () => {
  assert.equal(dueBlock({ year: '2026', month: '11', day: '28', hour: '13', minute: '00' }).title, 'Начинается блок: Ретро недели');
  assert.equal(dueBlock({ year: '2026', month: '11', day: '29', hour: '13', minute: '00' }).title, 'Начинается блок: Восстановление');
});

test('unfinished reminder is 30 minutes before the final sleep block', () => {
  assert.deepEqual(unfinishedReminderTime('2026-11-23'), { hour: '03', minute: '30' });
  assert.deepEqual(unfinishedReminderTime('2026-11-28'), { hour: '23', minute: '30' });
  assert.deepEqual(unfinishedReminderTime('2026-11-29'), { hour: '23', minute: '30' });
});

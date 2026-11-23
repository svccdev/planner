export const PLAN_START = '2026-11-23';

// Время начала каждого блока из расписания приложения.
export const SCHEDULES = {
  full: [
    ['04:00', 'Сон', 'Якорь сна: отбой до 04:00, подъём 12+'],
    ['12:00', 'Подъём и старт', 'Зарядка, еда, план на день'],
    ['13:30', 'Конвейер', 'Лиды + заявки bounty / LaborX'],
    ['16:00', 'Окно касаний', 'Живые ответы: ЕС после обеда + утро США'],
    ['19:00', 'Перерыв', 'Еда, отдохни от экрана'],
    ['20:00', 'Продукт', 'Микропродукты, автоматизации, кейсы'],
    ['23:00', 'Окно США', 'Последний час Востока — добив касаний'],
    ['00:00', 'Код-блок', 'Награда: только после квот, ≤2 ч'],
    ['03:00', 'Лог и отбой', 'Дневной лог, свет выключен']
  ],
  half: [
    ['04:00', 'Сон', 'Отбой до 04:00, подъём до 12:00'],
    ['12:00', 'Подъём и старт', 'Спокойный старт, план на полдня'],
    ['13:00', 'Ретро недели', 'Разбор цифр, выводы'],
    ['15:00', 'Сводка в трекер', 'Выгрузка недели'],
    ['16:00', 'Упаковка', 'Демо, профили, шаблоны'],
    ['19:00', 'Отдых', 'Личное время, никаких квот'],
    ['00:00', 'Сон', 'Отбой до 04:00']
  ],
  rest: [
    ['04:00', 'Сон', 'Воскресенье: сон и восстановление'],
    ['12:00', 'Подъём', 'Медленно, день мягкий'],
    ['13:00', 'Восстановление', 'Прогулка, личное — никакого конвейера'],
    ['20:00', 'Планирование недели', '15 минут, по желанию'],
    ['20:30', 'Вечер', 'Отдых, личное'],
    ['00:00', 'Сон', 'Отбой до 04:00']
  ]
};

export function shiftIsoDate(date, amount) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}

export function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function cycleDate(parts) {
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 4 ? shiftIsoDate(today, -1) : today;
}

export function scheduleType(cycleDay) {
  if (cycleDay < PLAN_START) return 'rest';
  const weekday = new Date(`${cycleDay}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 'rest' : weekday === 6 ? 'half' : 'full';
}

export function dueBlock(parts, cycleDay = cycleDate(parts)) {
  const time = `${parts.hour}:${parts.minute}`;
  const block = SCHEDULES[scheduleType(cycleDay)].find(row => row[0] === time);
  if (!block) return null;
  if (time === '12:00') {
    return {
      key: `${cycleDay}:12:00:morning`,
      title: 'Хорошего и продуктивного дня!',
      body: `Ты сможешь. Начинается блок «${block[1]}». ${block[2]}`,
      tab: 'today'
    };
  }
  return {
    key: `${cycleDay}:${time}:block`,
    title: `Начинается блок: ${block[1]}`,
    body: block[2],
    tab: 'today'
  };
}

export function unfinishedReminderTime(cycleDay) {
  const sleep = SCHEDULES[scheduleType(cycleDay)].filter(row => row[1] === 'Сон').at(-1);
  const [hour, minute] = sleep[0].split(':').map(Number);
  const total = (hour * 60 + minute - 30 + 1440) % 1440;
  return { hour: String(Math.floor(total / 60)).padStart(2, '0'), minute: String(total % 60).padStart(2, '0') };
}

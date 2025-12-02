// Generador de festivos de Colombia (Ley Emiliani + festivos religiosos basados en Pascua)
function pad2(n) {
  return String(n).padStart(2, '0');
}
function ymdUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function dateUTC(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}
function addDaysUTC(d, days) {
  const nd = new Date(d.getTime());
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}
function moveToNextMondayUTC(d) {
  // Lunes=1 ... Domingo=0 (getUTCDay)
  const dow = d.getUTCDay();
  if (dow === 1) return d; // ya es lunes
  const delta = (8 - dow) % 7; // días hasta el próximo lunes
  return addDaysUTC(d, delta);
}
// Algoritmo de Pascua (Calendario Gregoriano)
function getEasterUTC(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Marzo, 4=Abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day)); // Domingo de Pascua
}

function getColombiaHolidays(year) {
  const holidays = [];

  // Fijos (NO se mueven)
  holidays.push({ date: ymdUTC(dateUTC(year, 1, 1)), name: 'Año Nuevo' });
  holidays.push({ date: ymdUTC(dateUTC(year, 5, 1)), name: 'Día del Trabajo' });
  holidays.push({ date: ymdUTC(dateUTC(year, 7, 20)), name: 'Día de la Independencia' });
  holidays.push({ date: ymdUTC(dateUTC(year, 8, 7)), name: 'Batalla de Boyacá' });
  holidays.push({ date: ymdUTC(dateUTC(year, 12, 8)), name: 'Inmaculada Concepción' });
  holidays.push({ date: ymdUTC(dateUTC(year, 12, 25)), name: 'Navidad' });

  // Fijos con Ley Emiliani (se mueven al lunes)
  const emiliani = [
    { m: 1, d: 6, name: 'Reyes Magos' },
    { m: 3, d: 19, name: 'San José' },
    { m: 6, d: 29, name: 'San Pedro y San Pablo' },
    { m: 8, d: 15, name: 'Asunción de la Virgen' },
    { m: 10, d: 12, name: 'Día de la Raza' },
    { m: 11, d: 1, name: 'Todos los Santos' },
    { m: 11, d: 11, name: 'Independencia de Cartagena' },
  ];
  emiliani.forEach(({ m, d, name }) => {
    const base = dateUTC(year, m, d);
    const moved = moveToNextMondayUTC(base);
    holidays.push({ date: ymdUTC(moved), name });
  });

  // Religiosos basados en Pascua (algunos con Emiliani)
  const easter = getEasterUTC(year);
  const juevesSanto = addDaysUTC(easter, -3); // Jueves Santo
  const viernesSanto = addDaysUTC(easter, -2); // Viernes Santo
  holidays.push({ date: ymdUTC(juevesSanto), name: 'Jueves Santo' });
  holidays.push({ date: ymdUTC(viernesSanto), name: 'Viernes Santo' });

  // Ascensión (Easter + 40) movida al lunes
  const ascension = moveToNextMondayUTC(addDaysUTC(easter, 40));
  holidays.push({ date: ymdUTC(ascension), name: 'Ascensión del Señor (Emiliani)' });

  // Corpus Christi (Easter + 60) movido al lunes
  const corpus = moveToNextMondayUTC(addDaysUTC(easter, 60));
  holidays.push({ date: ymdUTC(corpus), name: 'Corpus Christi (Emiliani)' });

  // Sagrado Corazón (Easter + 68) movido al lunes
  const sagradoCorazon = moveToNextMondayUTC(addDaysUTC(easter, 68));
  holidays.push({ date: ymdUTC(sagradoCorazon), name: 'Sagrado Corazón (Emiliani)' });

  return holidays;
}

module.exports = { getColombiaHolidays };
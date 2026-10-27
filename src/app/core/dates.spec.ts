import { addDays, diffDays, endOfMonth, isValidISO, startOfWeek } from './dates';

describe('dates', () => {
  it('suma dias cruzando meses y años', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calcula diferencias de dias', () => {
    expect(diffDays('2026-10-26', '2026-11-01')).toBe(6);
    expect(diffDays('2026-11-01', '2026-10-26')).toBe(-6);
  });

  it('la semana empieza el lunes', () => {
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26'); // lunes
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26'); // domingo
    expect(startOfWeek('2026-10-28')).toBe('2026-10-26');
  });

  it('fin de mes incluye bisiestos', () => {
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });

  it('rechaza fechas imposibles', () => {
    expect(isValidISO('2026-02-31')).toBe(false);
    expect(isValidISO('2026-11-15')).toBe(true);
  });
});

const DAY_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayDateISO(): string {
  return formatLocalDateISO(new Date());
}

export function formatLocalDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateISO(dateISO: string): Date {
  if (!DAY_ISO_PATTERN.test(dateISO)) {
    throw new Error(`Invalid dateISO: ${dateISO}`);
  }
  const [yearText, monthText, dayText] = dateISO.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(year, month - 1, day);
}

export function addDays(dateISO: string, amount: number): string {
  const date = parseDateISO(dateISO);
  date.setDate(date.getDate() + amount);
  return formatLocalDateISO(date);
}

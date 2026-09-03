const CIRCLED_NUMBER_BY_VALUE: Readonly<Record<number, string>> = Object.freeze({
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [index + 1, String.fromCodePoint(0x2460 + index)])
  ),
  ...Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => [index + 21, String.fromCodePoint(0x3251 + index)])
  ),
  ...Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => [index + 36, String.fromCodePoint(0x32b1 + index)])
  ),
});

function normalizeAsciiDigits(value: string): string {
  return value.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10));
}

export function normalizeCircledGroupLabel(value: unknown): string {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9０-９]+)(.*)$/s);
  if (!match) return trimmed;

  const numericPrefix = Number(normalizeAsciiDigits(match[1]));
  const circledNumber = CIRCLED_NUMBER_BY_VALUE[numericPrefix];
  if (!circledNumber) return trimmed;

  const label = match[2].trim();
  return label ? `${circledNumber} ${label}` : circledNumber;
}

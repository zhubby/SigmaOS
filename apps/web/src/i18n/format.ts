import type { SupportedLocale } from "./locale.js";

export function formatBytes(value: number, locale: SupportedLocale): string {
  if (value < 1024) {
    return `${formatNumber(value, locale, 0)} B`;
  }
  if (value < 1024 * 1024) {
    return `${formatNumber(value / 1024, locale, 1)} KB`;
  }
  return `${formatNumber(value / (1024 * 1024), locale, 1)} MB`;
}

export function formatDate(value: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatTime(value: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatNumber(value: number, locale: SupportedLocale, fractionDigits: number): string {
  return formatLocaleNumber(value, locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

export function formatLocaleNumber(
  value: number,
  locale: SupportedLocale,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, {
    ...options
  }).format(value);
}

import type { SupportedLocale } from "./locale.js";

export function formatBytes(value: number, locale: SupportedLocale): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let unitIndex = 0;

  while (Math.abs(size) >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(size, locale, unitIndex === 0 ? 0 : 1)} ${units[unitIndex] ?? "PB"}`;
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

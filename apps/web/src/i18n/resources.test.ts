import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { en, resources, zhCN } from "./resources.js";

describe("i18n resources", () => {
  it("keeps simplified Chinese keys in parity with English", () => {
    expect(flattenKeys(zhCN)).toEqual(flattenKeys(en));
  });

  it("translates pluralized counts and interpolated preview text", async () => {
    const instance = i18next.createInstance();
    await instance.init({
      resources,
      lng: "en",
      fallbackLng: "en",
      defaultNS: "translation",
      interpolation: {
        escapeValue: false
      }
    });

    expect(instance.t("chat.metrics.messages", { count: 1, formattedCount: "1" })).toBe("1 message");
    expect(instance.t("chat.metrics.messages", { count: 2, formattedCount: "2" })).toBe("2 messages");
    expect(instance.t("chat.metrics.events", { count: 1, formattedCount: "1" })).toBe("1 event");
    expect(instance.t("chat.metrics.events", { count: 2, formattedCount: "2" })).toBe("2 events");

    await instance.changeLanguage("zh-CN");
    expect(instance.t("chat.metrics.messages", { count: 1, formattedCount: "1" })).toBe("1 条消息");
    expect(instance.t("chat.metrics.messages", { count: 2, formattedCount: "2" })).toBe("2 条消息");
    expect(instance.t("chat.metrics.events", { count: 1, formattedCount: "1" })).toBe("1 个事件");
    expect(instance.t("chat.metrics.events", { count: 2, formattedCount: "2" })).toBe("2 个事件");
    expect(instance.t("preview.cannotPreview", { size: "8 KB" })).toBe("8 KB 无法内联预览。");
  });
});

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") {
    return [prefix];
  }

  return Object.entries(value)
    .flatMap(([key, nextValue]) => flattenKeys(nextValue, prefix ? `${prefix}.${key}` : key))
    .sort();
}

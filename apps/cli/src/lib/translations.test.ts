import { describe, expect, it } from "vitest";
import { isTranslation, keyChanges, keysOf, languageOf } from "./translations";

const lines = (text: string) => text.split("\n");

describe("translation files read as the keys their change moves", () => {
  it("are told by their folder or their format, never a code file in a messages folder", () => {
    expect(["src/locales/en.json", "config/locales/de.yml", "locale/fr/LC_MESSAGES/django.po", "lib/l10n/app_fr.arb", "src/messages/handler.ts", "src/data.json"].map(isTranslation)).toEqual([true, true, true, true, false, false]);
  });

  it("know their language and their set, from the name or the folder", () => {
    expect(["src/locales/en.json", "app/i18n/messages.pt-BR.json", "lib/l10n/app_fr.arb", "ios/de.lproj/Localizable.strings", "locale/fr/LC_MESSAGES/django.po"].map(languageOf)).toEqual([
      { lang: "en", set: "src/locales/*.json" },
      { lang: "pt-BR", set: "app/i18n/messages.*.json" },
      { lang: "fr", set: "lib/l10n/app_*.arb" },
      { lang: "de", set: "ios/*/Localizable.strings" },
      { lang: "fr", set: "locale/*/LC_MESSAGES/django.po" },
    ]);
  });

  it("read nested JSON, a Rails YAML file under its language, and gettext", () => {
    expect([...keysOf("en.json", lines('{"nav":{"home":"Home","@home":{"x":1}},"title":"Hi"}'))!]).toEqual([
      ["nav.home", "Home"],
      ["title", "Hi"],
    ]);
    expect([...keysOf("de.yml", lines('de:\n  nav:\n    home: "Start"\n  title: Hallo'))!]).toEqual([
      ["nav.home", "Start"],
      ["title", "Hallo"],
    ]);
    expect([...keysOf("django.po", lines('msgid "Save"\nmsgstr "Gem"'))!]).toEqual([["Save", "Gem"]]);
  });

  it("show every language beside a key, and the one that did not keep up", () => {
    const en = { file: "locales/en.json", lang: "en", before: lines('{"save":"Save"}'), after: lines('{"save":"Save it","cancel":"Cancel"}') };
    const de = { file: "locales/de.json", lang: "de", before: lines('{"save":"Sichern"}'), after: lines('{"save":"Sichern"}') };
    expect(keyChanges([en, de])).toEqual([
      { key: "cancel", texts: { en: { after: "Cancel" }, de: {} } },
      { key: "save", texts: { en: { before: "Save", after: "Save it" }, de: { before: "Sichern", after: "Sichern" } } },
    ]);
  });
});

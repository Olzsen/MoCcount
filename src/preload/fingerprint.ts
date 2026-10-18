// Minimal, explicit privacy controls. These overrides run before page scripts.
const arg = process.argv.find((item) => item.startsWith('--moccount-fingerprint='));
if (arg) {
  try {
    const settings = JSON.parse(Buffer.from(arg.slice('--moccount-fingerprint='.length), 'base64').toString('utf8')) as {
      hardwareConcurrency?: number; deviceMemory?: number; locale?: string; timezone?: string;
    };
    const define = (target: object, key: string, value: unknown) => {
      try { Object.defineProperty(target, key, { configurable: true, get: () => value }); } catch { /* Chromium may lock a property */ }
    };
    const navigatorCtor = (globalThis as unknown as { Navigator?: { prototype: object } }).Navigator;
    if (navigatorCtor && Number.isFinite(settings.hardwareConcurrency)) define(navigatorCtor.prototype, 'hardwareConcurrency', settings.hardwareConcurrency);
    if (navigatorCtor && Number.isFinite(settings.deviceMemory)) define(navigatorCtor.prototype, 'deviceMemory', settings.deviceMemory);
    if (navigatorCtor && settings.locale) {
      define(navigatorCtor.prototype, 'language', settings.locale);
      define(navigatorCtor.prototype, 'languages', [settings.locale]);
    }
    if (settings.timezone) {
      const NativeDateTimeFormat = Intl.DateTimeFormat;
      const WrappedDateTimeFormat = function(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? settings.timezone });
      } as typeof Intl.DateTimeFormat;
      Object.defineProperty(WrappedDateTimeFormat, 'prototype', { value: NativeDateTimeFormat.prototype });
      Object.setPrototypeOf(WrappedDateTimeFormat, NativeDateTimeFormat);
      Intl.DateTimeFormat = WrappedDateTimeFormat;
    }
  } catch { /* Ignore invalid per-profile settings and keep Chromium defaults. */ }
}

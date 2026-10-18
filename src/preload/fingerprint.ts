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


// Optional multi-profile interaction relay. It never cancels or blocks the user's events.
import { ipcRenderer } from 'electron';

const groupArg = process.argv.find((item) => item.startsWith('--moccount-group='));
const profileArg = process.argv.find((item) => item.startsWith('--moccount-profile='));
const groupId = groupArg?.slice('--moccount-group='.length) ?? '';
const profileId = profileArg?.slice('--moccount-profile='.length) ?? '';

function selectorFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < 7) {
    const htmlElement = current as HTMLElement;
    if (htmlElement.id) {
      parts.unshift(`#${CSS.escape(htmlElement.id)}`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const name = current.getAttribute('name');
    const type = current.getAttribute('type');
    const escapeAttribute = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (name) part += `[name="${escapeAttribute(name)}"]`;
    if (type) part += `[type="${escapeAttribute(type)}"]`;
    if (!name) {
      const parent = current.parentElement;
      if (parent) {
        const tagName = current.tagName;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function relay(kind: 'value' | 'click', element: Element, value?: string) {
  if (!groupId || !profileId) return;
  const selector = selectorFor(element);
  if (!selector || selector.length > 1200) return;
  if (kind === 'value' && (value === undefined || value.length > 8000)) return;
  ipcRenderer.send('group:interaction', groupId, profileId, { kind, selector, value });
}

if (groupId && profileId && typeof document !== 'undefined') {
  document.addEventListener('input', (event) => {
    if (!event.isTrusted) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target instanceof HTMLInputElement && ['password', 'file', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(target.type)) return;
    relay('value', target, target.value);
  }, true);

  document.addEventListener('change', (event) => {
    if (!event.isTrusted || !(event.target instanceof HTMLSelectElement)) return;
    relay('value', event.target, event.target.value);
  }, true);

  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target.closest('button,input[type="submit"],input[type="button"],input[type="checkbox"],input[type="radio"],summary,[role="button"],[aria-pressed]');
    if (!target || target.matches('a[href]')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    if (target.getAttribute('aria-disabled') === 'true') return;
    relay('click', target);
  }, true);
}

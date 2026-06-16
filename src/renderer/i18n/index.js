/*
 * Active UI-language selector.
 *
 * The UI language is chosen from config (`ui_language`, default 'en'). The
 * preload reads config synchronously via IPC and exposes it as
 * `window.api.bootConfig` BEFORE these modules evaluate, so `T` resolves to the
 * right dictionary at import time — no flash, no async, no hardcoded strings.
 *
 * NOTE: the patient consent form (src/renderer/consent.js) and generated reports
 * (src/main/*) have their OWN language, independent of this UI language.
 */
import { en } from './en.js';
import { es } from './es.js';

const DICTS = { en, es };

const boot = (typeof window !== 'undefined' && window.api && window.api.bootConfig) || {};
const requested = boot.ui_language || 'en';

export const UI_LANG = DICTS[requested] ? requested : 'en';
export const T = DICTS[UI_LANG];

// Human-readable language names for small UI notes.
export const LANG_NAMES = { en: 'English', es: 'Español' };

export default T;

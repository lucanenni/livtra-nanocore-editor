import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
];

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    it: { translation: it },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // Data-driven content (effect/param names & descriptions from data/blocks/*) is passed
  // through t(key, englishDefault) at the call site rather than duplicated in every locale
  // file. Locale files only need to override the keys they actually translate.
  returnEmptyString: false,
});

export default i18n;

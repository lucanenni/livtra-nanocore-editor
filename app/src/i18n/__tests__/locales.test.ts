import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import itLocale from '../locales/it.json';
import ptBR from '../locales/pt-BR.json';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

describe('pt-BR locale', () => {
  it('translates every key the English and Italian files have', () => {
    const pt = new Set(keys(ptBR));
    const missing = [...new Set([...keys(en), ...keys(itLocale)])].filter((k) => !pt.has(k));
    expect(missing).toEqual([]);
  });

  it('keeps every {{placeholder}} of the English text', () => {
    const flat = (tree: Tree) => Object.fromEntries(keys(tree).map((k) => [k, k.split('.').reduce<string | Tree>((t, p) => (t as Tree)[p], tree) as string]));
    const enFlat = flat(en);
    const ptFlat = flat(ptBR);
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [k, text] of Object.entries(enFlat)) expect([k, placeholders(ptFlat[k] ?? '')]).toEqual([k, placeholders(text)]);
  });
});

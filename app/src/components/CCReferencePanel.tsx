import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { buildCCReference, type CCReferenceEntry } from '@nanocore/protocol';
import { usePatchStore } from '../store/patchStore';

const ON_OFF_TEST_VALUES = [
  { label: 'Off', value: 0 },
  { label: 'On', value: 127 },
];
const GENERIC_TEST_VALUES = [
  { label: '0', value: 0 },
  { label: '64', value: 64 },
  { label: '127', value: 127 },
];

function testValuesFor(entry: CCReferenceEntry) {
  return entry.kind === 'on-off' ? ON_OFF_TEST_VALUES : GENERIC_TEST_VALUES;
}

/** An entry's texts in the current language (the English ones in `entry` are the fallbacks). */
function translated(entry: CCReferenceEntry, t: TFunction) {
  const scope = entry.blockId ? t(`block.${entry.blockId}.name`, entry.scope) : t('ccRef.global', entry.scope);
  const target =
    entry.kind === 'on-off'
      ? t('ccRef.onOff', entry.target)
      : entry.kind === 'type'
        ? t('ccRef.typeSelect', entry.target)
        : entry.kind === 'global' && entry.globalId
          ? t(`ccRef.control.${entry.globalId}.name`, entry.target)
          : entry.params
            ? entry.params.map((p) => t(`param.${p.id}`, p.label)).join(' / ')
            : entry.target;

  let rangeText = entry.rangeText;
  if (entry.kind === 'on-off') rangeText = t('ccRef.rangeOnOff', entry.rangeText);
  else if (entry.kind === 'type') rangeText = t('ccRef.rangeType', { max: entry.rangeText.match(/^0-(\d+)/)?.[1] ?? '', defaultValue: entry.rangeText });
  else if (entry.kind === 'param' && !entry.range) rangeText = t('ccRef.rangeVaries', entry.rangeText);
  else if (entry.range?.kind === 'enum') rangeText = entry.range.options.map((o) => t(`enum.${o.toLowerCase()}`, o)).join(' / ');
  else if (entry.range?.kind === 'range') {
    const unit = entry.range.unit ? ` ${entry.range.unit}` : '';
    rangeText = t('ccRef.rangeFromTo', { min: `${entry.range.min}${unit}`, max: `${entry.range.max}${unit}`, defaultValue: entry.rangeText });
  }

  const note =
    entry.kind === 'type'
      ? entry.note && t('ccRef.typeSysexNote', entry.note)
      : entry.kind === 'global' && entry.globalId
        ? entry.note && t(`ccRef.control.${entry.globalId}.description`, entry.note)
        : entry.note && entry.blockId
          ? t(`block.${entry.blockId}.note`, entry.note)
          : entry.note;

  return { entry, scope, target, rangeText, note };
}

function matchesFilter(row: ReturnType<typeof translated>, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${row.entry.cc} ${row.scope} ${row.target} ${row.entry.scope} ${row.entry.target}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Every CC this app's data model knows about, one row per CC number, with buttons to send a raw
 * test value directly to the connected device — for configuring an external MIDI foot controller
 * for live use: pick the CC this table says drives what you want, assign it on the controller,
 * then use these buttons to confirm the device reacts before trusting the controller's own
 * mapping. Built from `ccReference.ts`, which derives every row from the same block/param spec
 * data the rest of the editor uses — this can't silently drift out of sync with the real CC map.
 */
export function CCReferencePanel() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const sendTestCC = usePatchStore((s) => s.sendTestCC);
  const connectionReady = usePatchStore(
    (s) => s.connection.ready && !!s.connection.outputId && s.connection.connected,
  );
  const entries = useMemo(() => buildCCReference(), []);
  const rows = useMemo(() => entries.map((e) => translated(e, t)), [entries, t]);
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => matchesFilter(r, needle)), [rows, needle]);

  return (
    <section className="cc-reference">
      <h2 className="panel-title">{t('ccRef.title', 'CC Reference')}</h2>
      <p className="panel-hint">
        {connectionReady
          ? t(
              'ccRef.hintLive',
              'Every CC this editor knows about, in order. Send a test value and watch the device react — handy for setting up an external MIDI foot controller for live use.',
            )
          : t(
              'ccRef.hint',
              'Not connected — connect your pedal to send test values from this table. It still works as a plain reference either way.',
            )}
      </p>

      <input
        type="search"
        className="cc-reference__filter"
        placeholder={t('ccRef.filterPlaceholder', 'Filter by CC number, block, or parameter…') ?? ''}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={t('ccRef.filterLabel', 'Filter the CC reference table') ?? ''}
      />

      <div className="cc-reference__table-wrap">
        <table className="cc-reference__table">
          <thead>
            <tr>
              <th>{t('ccRef.colCC', 'CC')}</th>
              <th>{t('ccRef.colScope', 'Block')}</th>
              <th>{t('ccRef.colTarget', 'Controls')}</th>
              <th>{t('ccRef.colRange', 'Range')}</th>
              <th>{t('ccRef.colTest', 'Send test value')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ entry, scope, target, rangeText, note }, i) => (
              <tr key={`${entry.cc}-${entry.scope}-${i}`} title={note || undefined}>
                <td className="cc-reference__cc">{entry.cc}</td>
                <td>{scope}</td>
                <td>{target}</td>
                <td className="cc-reference__range">{rangeText}</td>
                <td className="cc-reference__actions">
                  {testValuesFor(entry).map(({ label, value }) => (
                    <button
                      key={label}
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={!connectionReady}
                      onClick={() => sendTestCC(entry.cc, value, `Test: ${entry.scope} — ${entry.target} = ${label} (CC${entry.cc}=${value})`)}
                    >
                      {entry.kind === 'on-off' ? (label === 'On' ? t('block.on', 'On') : t('block.off', 'Off')) : label}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="panel-hint">{t('ccRef.noMatches', 'No CC matches that filter.')}</p>}
      </div>
    </section>
  );
}

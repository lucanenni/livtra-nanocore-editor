import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildCCReference, type CCReferenceEntry } from '../data/ccReference';
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

function matchesFilter(entry: CCReferenceEntry, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${entry.cc} ${entry.scope} ${entry.target}`.toLowerCase();
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
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => entries.filter((e) => matchesFilter(e, needle)), [entries, needle]);

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
              'Not connected — connect the NanoCore to send test values from this table. It still works as a plain reference either way.',
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
            {visible.map((entry, i) => (
              <tr key={`${entry.cc}-${entry.scope}-${i}`} title={entry.note}>
                <td className="cc-reference__cc">{entry.cc}</td>
                <td>{entry.scope}</td>
                <td>{entry.target}</td>
                <td className="cc-reference__range">{entry.rangeText}</td>
                <td className="cc-reference__actions">
                  {testValuesFor(entry).map(({ label, value }) => (
                    <button
                      key={label}
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={!connectionReady}
                      onClick={() => sendTestCC(entry.cc, value, `Test: ${entry.scope} — ${entry.target} = ${label} (CC${entry.cc}=${value})`)}
                    >
                      {label}
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

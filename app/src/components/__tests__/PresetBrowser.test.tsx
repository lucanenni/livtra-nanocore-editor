import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { PresetBrowser } from '../PresetBrowser';
import { usePatchStore } from '../../store/patchStore';

function renderBrowser() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PresetBrowser />
    </I18nextProvider>,
  );
}

const names = Array.from({ length: 64 }, (_, i) => (i < 40 ? `Factory${i + 1}` : 'preset'));
let selectDevicePreset: ReturnType<typeof vi.fn<(slot: number) => Promise<void>>>;
let renameAndSaveActivePreset: ReturnType<typeof vi.fn<(name: string) => Promise<boolean>>>;

function connectTo(kind: 'webmidi' | 'simulator') {
  usePatchStore.setState((s) => ({ connection: { ...s.connection, transportKind: kind, connected: true } }));
}

/** In-memory Storage: the test runtime's own `localStorage` can be a bare stub (Node's built-in
 * one shadows jsdom's when no storage file is configured). */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  selectDevicePreset = vi.fn<(slot: number) => Promise<void>>(async () => {});
  renameAndSaveActivePreset = vi.fn<(name: string) => Promise<boolean>>(async () => true);
  usePatchStore.setState({
    presetNames: names,
    presetNamesLoading: false,
    presetSwitchingTo: null,
    activeSlot: 11,
    activeSlotName: 'Factory12',
    selectDevicePreset,
    renameAndSaveActivePreset,
  });
  connectTo('webmidi');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PresetBrowser', () => {
  it('shows the loaded preset and steps with ◀ ▶, wrapping around the ends', () => {
    const { container, getByLabelText } = renderBrowser();
    expect(container.querySelector('.preset-browser__number')!.textContent).toBe('12');
    fireEvent.click(getByLabelText('Next preset'));
    act(() => usePatchStore.setState({ activeSlot: 0 }));
    fireEvent.click(getByLabelText('Previous preset'));
    expect(selectDevicePreset.mock.calls).toEqual([[12], [63]]);
  });

  it('renames the loaded preset in place and saves it, so the name survives a preset change', () => {
    const { getByLabelText, queryByRole } = renderBrowser();
    const input = getByLabelText('Rename and save this preset on the device (max 8 characters)') as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'MyLead' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameAndSaveActivePreset).toHaveBeenCalledWith('MyLead');
    expect(queryByRole('alert')).toBeNull();
  });

  it('says so when the device does not acknowledge the save', async () => {
    renameAndSaveActivePreset.mockResolvedValue(false);
    const { getByLabelText, findByRole } = renderBrowser();
    const input = getByLabelText('Rename and save this preset on the device (max 8 characters)') as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'MyLead' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await findByRole('alert')).textContent).toMatch(/may not have been saved/);
  });

  it('does not rename or save when the name is unchanged', () => {
    const { getByLabelText } = renderBrowser();
    const input = getByLabelText('Rename and save this preset on the device (max 8 characters)') as HTMLInputElement;
    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameAndSaveActivePreset).not.toHaveBeenCalled();
  });

  it('opens a grid of every preset, remembers it open, and jumps to the one clicked', () => {
    const { container, getByText } = renderBrowser();
    expect(container.querySelector('.preset-browser__grid')).toBeNull();
    fireEvent.click(getByText(/All presets/));
    const items = container.querySelectorAll('.preset-browser__item');
    expect(items).toHaveLength(64);
    expect(container.querySelector('[aria-current="true"]')!.textContent).toBe('12Factory12');
    expect(items[49].className).toContain('preset-browser__item--empty');
    fireEvent.click(getByText('Factory3'));
    expect(selectDevicePreset).toHaveBeenCalledWith(2);
    expect(localStorage.getItem('nanocore-editor.preset-grid-open')).toBe('1');
  });

  it('shows the preset being loaded and blocks clicks until it is read back', () => {
    localStorage.setItem('nanocore-editor.preset-grid-open', '1');
    usePatchStore.setState({ presetSwitchingTo: 4 });
    const { getByText, getByLabelText } = renderBrowser();
    expect(getByText('Loading preset 5…')).toBeTruthy();
    fireEvent.click(getByLabelText('Next preset'));
    fireEvent.click(getByText('Factory9'));
    expect(selectDevicePreset).not.toHaveBeenCalled();
  });

  it('shows the loading state while the names are read for the first time', () => {
    localStorage.setItem('nanocore-editor.preset-grid-open', '1');
    usePatchStore.setState({ presetNames: null, presetNamesLoading: true });
    const { getByText } = renderBrowser();
    expect(getByText('Loading presets…')).toBeTruthy();
  });

  it('is hidden in the Simulator, which has no device presets', () => {
    connectTo('simulator');
    const { container } = renderBrowser();
    expect(container.querySelector('.preset-browser')).toBeNull();
  });
});

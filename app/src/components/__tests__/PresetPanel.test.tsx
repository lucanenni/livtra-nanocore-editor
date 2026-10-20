import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { PresetPanel } from '../PresetPanel';
import { usePatchStore } from '../../store/patchStore';

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PresetPanel />
    </I18nextProvider>,
  );
}

let recallProgram: ReturnType<typeof vi.fn<(program: number) => void>>;
let saveToDeviceSlot: ReturnType<typeof vi.fn<(slot: number) => Promise<boolean>>>;

beforeEach(async () => {
  await usePatchStore.getState().initTransport('simulator');
  recallProgram = vi.fn<(program: number) => void>();
  saveToDeviceSlot = vi.fn<(slot: number) => Promise<boolean>>(async () => true);
  usePatchStore.setState({ recallProgram, saveToDeviceSlot });
});
afterEach(cleanup);

describe('PresetPanel device preset numbers', () => {
  it('recalls the preset whose number the device displays (50 sends program 49)', () => {
    const { getByLabelText, getByText } = renderPanel();
    fireEvent.change(getByLabelText('Preset number (1-64)'), { target: { value: '50' } });
    fireEvent.click(getByText('Recall'));
    expect(recallProgram).toHaveBeenCalledWith(49);
  });

  it('saves to the slot the device displays and reports that same number', async () => {
    const { container, getByLabelText, getByText } = renderPanel();
    fireEvent.change(getByLabelText('Save slot number (1-64)'), { target: { value: '12' } });
    fireEvent.click(getByText('Save'));
    expect(saveToDeviceSlot).toHaveBeenCalledWith(11);
    await waitFor(() => expect(container.textContent).toContain('Saved to slot 12.'));
  });

  it('keeps out-of-range or empty input inside the device presets', () => {
    const { getByLabelText, getByText } = renderPanel();
    const input = getByLabelText('Preset number (1-64)');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(getByText('Recall'));
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.click(getByText('Recall'));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(getByText('Recall'));
    expect(recallProgram.mock.calls).toEqual([[0], [63], [0]]);
  });
});

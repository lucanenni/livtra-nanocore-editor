import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { ProfilePanel } from '../ProfilePanel';
import { usePatchStore } from '../../store/patchStore';

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProfilePanel />
    </I18nextProvider>,
  );
}

function fileOf(bytes: number[], name = 'x.ead'): File {
  const f = new File([new Uint8Array(bytes)], name);
  // jsdom's File has no arrayBuffer() in every version — the panel relies on it, so provide it.
  f.arrayBuffer = async () => new Uint8Array(bytes).buffer;
  return f;
}

beforeEach(async () => {
  await usePatchStore.getState().initTransport('simulator');
  usePatchStore.getState().resetProfileUpload();
  usePatchStore.setState({ profileCatalog: null });
});
afterEach(cleanup);

describe('ProfilePanel', () => {
  it('lists all 38 slots in the AMP/FX2 selector with factory names before anything is read', () => {
    const { container } = renderPanel();
    // The first <select> is AMP/FX2 (38 slots); the second is the CAB IR section added below it (30 slots).
    const options = container.querySelectorAll('select')[0].querySelectorAll('option');
    expect(options).toHaveLength(38);
    expect(options[0].textContent).toBe('1 — BogXTC1');
    expect(options[29].textContent).toBe('30 — MarSup');
    expect(options[30].textContent).toBe('31 — Scream'); // first FX2 slot
    expect(options[37].textContent).toBe('38 — Fiman');
  });

  it('keeps Upload disabled until a valid .ead file is chosen, and explains a bad one', async () => {
    const { container, getAllByText } = renderPanel();
    const upload = getAllByText('Upload to slot')[0] as HTMLButtonElement; // AMP/FX2 section's button
    expect(upload.disabled).toBe(true);

    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf(new Array(100).fill(0x41))] } });
    await waitFor(() => expect(container.textContent).toContain('wrong file header'));
    expect(upload.disabled).toBe(true);
  });

  it('enables Upload for a well-formed container (simulator counts as connected)', async () => {
    const data = new Array(160).fill(0);
    data.splice(0, 5, 0x53, 0x41, 0x50, 0x46, 0x01);
    data[24] = 100; // body length = 160 - 60
    const { container, getAllByText } = renderPanel();
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf(data, '00.ead')] } });
    await waitFor(() => expect(container.textContent).toContain('00.ead · 160 B'));
    expect((getAllByText('Upload to slot')[0] as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelectorAll('input[type="text"]')[0] as HTMLInputElement).value).toBe('00.ead');
  });
});

describe('ProfilePanel CAB IR section', () => {
  function fileOfName(bytes: number[], name: string): File {
    const f = new File([new Uint8Array(bytes)], name);
    f.arrayBuffer = async () => new Uint8Array(bytes).buffer;
    return f;
  }

  it('lists all 30 CAB IR slots with factory names', () => {
    const { container } = renderPanel();
    const options = container.querySelectorAll('select')[1].querySelectorAll('option');
    expect(options).toHaveLength(30);
    expect(options[0].textContent).toContain('1 — ');
  });

  it('accepts a raw .bin file directly and enables its own Upload button', async () => {
    const { container, getAllByText } = renderPanel();
    const data = new Array(16).fill(0); // 4 finite float32 samples (all zero)
    const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfName(data, 'cab.bin')] } });
    await waitFor(() => expect(container.textContent).toContain('cab.bin · 16 B'));
    expect((getAllByText('Upload to slot')[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects a misaligned raw file with a clear reason, keeping Upload disabled', async () => {
    const { container, getAllByText } = renderPanel();
    const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfName([1, 2, 3], 'bad.bin')] } });
    await waitFor(() => expect(container.textContent).toContain('multiple of 4 bytes'));
    expect((getAllByText('Upload to slot')[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('converts a .wav file and reports the conversion', async () => {
    const { container } = renderPanel();
    // Minimal mono 16-bit 48kHz WAV, 4 samples.
    const buf = new Uint8Array(44 + 8);
    const view = new DataView(buf.buffer);
    const str = (o: number, s: string) => Array.from(s).forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + 8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, 8, true);
    view.setInt16(44, 1000, true); view.setInt16(46, -1000, true); view.setInt16(48, 500, true); view.setInt16(50, 0, true);
    const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOfName(Array.from(buf), 'cab.wav')] } });
    await waitFor(() => expect(container.textContent).toContain('Converted from 48000Hz'));
  });
});

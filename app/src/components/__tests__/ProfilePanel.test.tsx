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
  it('lists all 38 slots in the selector with factory names before anything is read', () => {
    const { container } = renderPanel();
    const options = container.querySelectorAll('select option');
    expect(options).toHaveLength(38);
    expect(options[0].textContent).toBe('1 — BogXTC1');
    expect(options[29].textContent).toBe('30 — MarSup');
    expect(options[30].textContent).toBe('31 — Scream'); // first FX2 slot
    expect(options[37].textContent).toBe('38 — Fiman');
  });

  it('keeps Upload disabled until a valid .ead file is chosen, and explains a bad one', async () => {
    const { container, getByText } = renderPanel();
    const upload = getByText('Upload to slot') as HTMLButtonElement;
    expect(upload.disabled).toBe(true);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf(new Array(100).fill(0x41))] } });
    await waitFor(() => expect(container.textContent).toContain('wrong file header'));
    expect(upload.disabled).toBe(true);
  });

  it('enables Upload for a well-formed container (simulator counts as connected)', async () => {
    const data = new Array(160).fill(0);
    data.splice(0, 5, 0x53, 0x41, 0x50, 0x46, 0x01);
    data[24] = 100; // body length = 160 - 60
    const { container, getByText } = renderPanel();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf(data, '00.ead')] } });
    await waitFor(() => expect(container.textContent).toContain('00.ead · 160 B'));
    expect((getByText('Upload to slot') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('00.ead');
  });
});

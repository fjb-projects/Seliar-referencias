// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { readCatalog } from './helpers';

const catalog = readCatalog();
const MALVINA_URL = 'https://www.google.com/maps/search/?api=1&query=-31.566827%2C-60.70427';

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
  );
  openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);
  window.open = openSpy as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  const user = userEvent.setup();
  render(<App />);
  const input = await screen.findByRole('combobox', { name: /buscar referencia/i });
  await waitFor(() => expect(screen.queryByText(/cargando referencias/i)).not.toBeInTheDocument());
  return { user, input };
}

describe('App', () => {
  it('shows a loading state and then focuses the search box', async () => {
    render(<App />);
    expect(screen.getByText(/cargando referencias/i)).toBeInTheDocument();
    const input = await screen.findByRole('combobox');
    // Focus is there from the first paint: the operator can type while the catalogue loads.
    expect(input).toHaveFocus();
    await waitFor(() => expect(screen.queryByText(/cargando referencias/i)).not.toBeInTheDocument());
  });

  it('searches while typing, without pressing Enter', async () => {
    const { user, input } = await setup();
    await user.type(input, 'gran malv');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Plaza Gran Malvina');
    expect(options[0]).toHaveTextContent('Barrio Favaloro');
  });

  it('opens Google Maps for the single strong match with Enter', async () => {
    const { user, input } = await setup();
    await user.type(input, 'plaza gran malvina{Enter}');
    expect(openSpy).toHaveBeenCalledWith(MALVINA_URL, '_blank', 'noopener,noreferrer');
  });

  it('does not open anything for an ambiguous query until the operator picks one', async () => {
    const { user, input } = await setup();
    await user.type(input, 'utn{Enter}');
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/varias coincidencias/i);

    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-31\.\d+%2C-60\.\d+$/);
  });

  it('moves with the arrow keys, wrapping around', async () => {
    const { user, input } = await setup();
    await user.type(input, 'comisaria');
    const selected = () => screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(-1);
    await user.keyboard('{ArrowDown}');
    expect(selected()).toBe(0);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe(2);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(1);
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
  });

  it('Escape clears the selection first, then the query', async () => {
    const { user, input } = await setup();
    await user.type(input, 'comisaria{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(input).toHaveValue('comisaria');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('Ctrl+K focuses the search box from anywhere', async () => {
    const { user, input } = await setup();
    (document.activeElement as HTMLElement).blur();
    expect(input).not.toHaveFocus();
    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
  });

  it('shows the no-match state', async () => {
    const { user, input } = await setup();
    await user.type(input, 'zzzzqx');
    expect(screen.getByRole('status')).toHaveTextContent(/sin coincidencias/i);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('renders safe Google Maps links for mouse users', async () => {
    const { user, input } = await setup();
    await user.type(input, 'gran malvina');
    const link = await screen.findByRole('link', { name: /abrir en google maps/i });
    expect(link).toHaveAttribute('href', MALVINA_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('limits the visible results to 10', async () => {
    const { user, input } = await setup();
    await user.type(input, 'ca');
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(10);
  });

  it('reports a load failure with a retry button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    render(<App />);
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});

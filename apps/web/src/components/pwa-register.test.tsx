import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaRegister } from './pwa-register';

const unregister = vi.fn(() => Promise.resolve(true));
const getRegistrations = vi.fn(() => Promise.resolve([{ unregister }]));
const register = vi.fn(() => Promise.resolve({}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistrations, register },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PwaRegister', () => {
  it('unregisters leftover workers outside production and never registers one', async () => {
    // Vitest runs with NODE_ENV=test, which the component treats like development.
    render(<PwaRegister />);
    await vi.waitFor(() => expect(getRegistrations).toHaveBeenCalled());
    await vi.waitFor(() => expect(unregister).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the offline worker in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<PwaRegister />);
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'));
    expect(getRegistrations).not.toHaveBeenCalled();
  });
});

import { describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      auth: {
        signUp: jest.fn(() => ({ data: {}, error: null })),
        signInWithPassword: jest.fn(() => ({ data: { session: {} }, error: null })),
        getUser: jest.fn(() => ({ data: { user: { id: '123' } }, error: null }))
      }
    })
  };
});

const { createClient } = await import('@supabase/supabase-js');

describe('Auth client mock', () => {
  test('returns mocked auth methods', async () => {
    const client = createClient('https://example.supabase.co', 'anon-key');

    expect(client.auth.signUp).toBeDefined();
    expect(client.auth.signInWithPassword).toBeDefined();
    expect(client.auth.getUser).toBeDefined();

    expect(client.auth.signUp()).toEqual({ data: {}, error: null });
    expect(client.auth.signInWithPassword()).toEqual({ data: { session: {} }, error: null });
    expect(client.auth.getUser()).toEqual({ data: { user: { id: '123' } }, error: null });
  });
});

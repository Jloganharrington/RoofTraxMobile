/**
 * Unit tests for RootRoute — the auth-split at "/".
 *
 * Strategy:
 *  - Mock @workspace/api-client-react so useGetCurrentAuthUser is fully
 *    controllable without a real server or React Query cache.
 *  - Mock Dashboard and Home to trivial stubs so each case is explicit about
 *    which branch rendered, without pulling in the rest of the application.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Module mocks — vi.mock is hoisted above imports by vitest's transform,
// so these factories run before RootRoute.tsx is first evaluated.
// ---------------------------------------------------------------------------

vi.mock('@workspace/api-client-react', () => ({
  useGetCurrentAuthUser: vi.fn(),
}));

vi.mock('@/pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock('@/pages/Home', () => ({
  default: () => <div data-testid="home-page">Home</div>,
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { useGetCurrentAuthUser } from '@workspace/api-client-react';
import { RootRoute } from '../routes/RootRoute';

const mockAuth = vi.mocked(useGetCurrentAuthUser);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RootRoute />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootRoute auth-split', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── Loading state ─────────────────────────────────────────────────────────

  it('renders a loading spinner while auth is in-flight', () => {
    mockAuth.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useGetCurrentAuthUser>);

    const { container } = setup();

    // Loader2 icon from lucide-react renders an SVG with class animate-spin
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    // Neither content branch should appear
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });

  // ── Authenticated ─────────────────────────────────────────────────────────

  it('renders Dashboard when the user is authenticated', () => {
    mockAuth.mockReturnValue({
      data: { user: { id: 'u1', email: 'rep@example.com' } },
      isLoading: false,
    } as ReturnType<typeof useGetCurrentAuthUser>);

    setup();

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });

  // ── Unauthenticated — explicit null user ──────────────────────────────────

  it('renders Home when the auth response carries a null user', () => {
    mockAuth.mockReturnValue({
      data: { user: null },
      isLoading: false,
    } as ReturnType<typeof useGetCurrentAuthUser>);

    setup();

    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  // ── Unauthenticated — missing envelope (e.g. no session cookie) ───────────

  it('renders Home when auth resolves with no envelope at all', () => {
    mockAuth.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useGetCurrentAuthUser>);

    setup();

    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  // ── Loading → authenticated transition ────────────────────────────────────

  it('renders Dashboard (not Home) after auth transitions from loading to resolved', () => {
    // First render: loading
    mockAuth.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useGetCurrentAuthUser>);
    const { rerender } = setup();

    // Second render: authenticated
    mockAuth.mockReturnValue({
      data: { user: { id: 'u2', email: 'manager@example.com' } },
      isLoading: false,
    } as ReturnType<typeof useGetCurrentAuthUser>);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <RootRoute />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });
});

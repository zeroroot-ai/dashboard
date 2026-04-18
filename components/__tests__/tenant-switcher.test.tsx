import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantSwitcher } from '@/components/layout/sidebar/tenant-switcher';
import { SidebarProvider } from '@/components/ui/sidebar';

// ---------------------------------------------------------------------------
// Browser API shims required by SidebarProvider / useIsMobile in jsdom
// ---------------------------------------------------------------------------

// jsdom does not implement matchMedia; stub it so hooks that call
// window.matchMedia don't throw.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// useSession is mocked per-test via the factory below so we can vary the
// session data. Default: no session.
const mockUseSession = vi.fn();

vi.mock('@/src/lib/session-client', () => ({
  useSession: () => mockUseSession(),
}));

// sonner toast
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

// Radix UI DropdownMenu uses pointer events and portals which behave
// differently in jsdom. We replace it with a simple test double that:
//   - renders the trigger directly
//   - renders all content inline (no portal)
//   - tracks open state with a data attribute so tests can find menu items
vi.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react') as typeof import('react');

  function DropdownMenu({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = React.useState(false);
    // Clone children and inject open/setOpen via context
    return (
      <DropdownCtx.Provider value={{ open, setOpen }}>
        {children}
      </DropdownCtx.Provider>
    );
  }

  const DropdownCtx = React.createContext<{
    open: boolean;
    setOpen: (v: boolean) => void;
  }>({ open: false, setOpen: () => {} });

  function DropdownMenuTrigger({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) {
    const { open, setOpen } = React.useContext(DropdownCtx);
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        onClick: () => setOpen(!open),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      });
    }
    return (
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {children}
      </button>
    );
  }

  function DropdownMenuContent({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
    side?: string;
    align?: string;
    sideOffset?: number;
  }) {
    const { open } = React.useContext(DropdownCtx);
    if (!open) return null;
    return (
      <div role="menu" data-testid="dropdown-content" className={className}>
        {children}
      </div>
    );
  }

  function DropdownMenuItem({
    children,
    onClick,
    disabled,
    className,
    'aria-checked': ariaChecked,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    'aria-checked'?: boolean;
  }) {
    return (
      <div
        role="menuitem"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled}
        aria-checked={ariaChecked}
        className={className}
        tabIndex={0}
      >
        {children}
      </div>
    );
  }

  function DropdownMenuLabel({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return <div className={className}>{children}</div>;
  }

  function DropdownMenuSeparator() {
    return <hr />;
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(tenants: string[], activeTenantId?: string) {
  return {
    data: {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        tenants,
        tenantId: activeTenantId ?? tenants[0] ?? null,
      },
      session: {
        id: 'sess-1',
        userId: 'user-1',
        activeOrganizationId: activeTenantId ?? tenants[0] ?? null,
      },
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderSwitcher() {
  return render(
    <SidebarProvider>
      <TenantSwitcher />
    </SidebarProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch to a passing default; individual tests override as needed.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, currentTenant: 'acme' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Single-tenant: static label, no interactive chrome
  // -------------------------------------------------------------------------

  describe('single-tenant user', () => {
    it('renders a static workspace label', () => {
      mockUseSession.mockReturnValue(makeSession(['acme']));
      renderSwitcher();

      expect(screen.getByText('Acme')).toBeDefined();
    });

    it('formats hyphenated slug to title case', () => {
      mockUseSession.mockReturnValue(makeSession(['my-corp-labs']));
      renderSwitcher();

      expect(screen.getByText('My Corp Labs')).toBeDefined();
    });

    it('does not render a dropdown trigger', () => {
      mockUseSession.mockReturnValue(makeSession(['acme']));
      renderSwitcher();

      // Multi-tenant path has an aria-label for switching; single-tenant doesn't.
      expect(screen.queryByRole('button', { name: /switch workspace/i })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // No tenants: shows "No workspace"
  // -------------------------------------------------------------------------

  describe('no-tenant user', () => {
    it('renders "No workspace" label when tenant list is empty', () => {
      mockUseSession.mockReturnValue(makeSession([]));
      renderSwitcher();

      expect(screen.getByText('No workspace')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Multi-tenant: dropdown switcher
  // -------------------------------------------------------------------------

  describe('multi-tenant user', () => {
    const tenants = ['acme', 'beta-labs', 'gamma-sec'];

    it('renders a dropdown trigger with the active tenant name', () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      expect(screen.getByText('Acme')).toBeDefined();
    });

    it('shows "Workspace" subtitle under the active tenant', () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      expect(screen.getByText('Workspace')).toBeDefined();
    });

    it('opens dropdown and lists all tenants in title-case', () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      const trigger = screen.getByRole('button', { name: /switch workspace/i });
      fireEvent.click(trigger);

      expect(screen.getByText('Beta Labs')).toBeDefined();
      expect(screen.getByText('Gamma Sec')).toBeDefined();
    });

    it('marks the active tenant with aria-checked=true', () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));

      const activeItem = screen.getAllByRole('menuitem').find(
        (el) => el.getAttribute('aria-checked') === 'true',
      );
      expect(activeItem).toBeDefined();
      expect(activeItem!.textContent).toContain('Acme');
    });

    it('POSTs to /api/tenant/select when a non-active tenant is clicked', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/tenant/select',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ tenant: 'beta-labs' }),
          }),
        );
      });
    });

    it('calls router.refresh() after a successful tenant switch', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it('does not POST when the already-active tenant is clicked', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));

      // Click the active tenant item (Acme is active)
      const acmeItem = screen.getAllByRole('menuitem').find(
        (el) => el.textContent?.includes('Acme'),
      );
      fireEvent.click(acmeItem!);

      // Give a tick for any async work
      await new Promise((r) => setTimeout(r, 50));
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('shows a sonner toast on API error', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'TENANT_FORBIDDEN' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('TENANT_FORBIDDEN');
      });
    });

    it('shows a sonner toast on network error', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Network error');
      });
    });

    it('does not call router.refresh() after a failed switch', async () => {
      mockUseSession.mockReturnValue(makeSession(tenants, 'acme'));
      global.fetch = vi.fn().mockRejectedValue(new Error('fail'));

      renderSwitcher();

      fireEvent.click(screen.getByRole('button', { name: /switch workspace/i }));
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});

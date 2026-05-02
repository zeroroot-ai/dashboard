import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

import { TenantSwitcher } from '@/components/layout/sidebar/tenant-switcher';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TenantContextProvider } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

// ---------------------------------------------------------------------------
// Browser API shims required by SidebarProvider / useIsMobile in jsdom
// ---------------------------------------------------------------------------

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

const mockSwitchActiveTenantAction = vi.fn<
  (tenantId: string) => Promise<
    { ok: true } | { ok: false; reason: 'not_a_member' | 'resolution_failed' }
  >
>();

vi.mock('@/components/gibson/shared/tenant-switcher-action', () => ({
  switchActiveTenantAction: (id: string) => mockSwitchActiveTenantAction(id),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

// Radix DropdownMenu uses portals + pointer events that jsdom handles poorly.
// Replace with a minimal inline test double driven by an open-state context.
vi.mock('@/components/ui/dropdown-menu', () => {
  const ReactImpl = require('react') as typeof import('react');
  const Ctx = ReactImpl.createContext<{
    open: boolean;
    setOpen: (next: boolean) => void;
  }>({ open: false, setOpen: () => {} });

  function DropdownMenu({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = ReactImpl.useState(false);
    return (
      <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>
    );
  }

  function DropdownMenuTrigger({
    children,
  }: {
    children: React.ReactElement;
    asChild?: boolean;
  }) {
    const { open, setOpen } = ReactImpl.useContext(Ctx);
    // Cast to a typed element shape so TS accepts the additional onClick
    // prop in cloneElement.
    type TriggerProps = {
      onClick?: () => void;
      'data-state'?: string;
    };
    const typed = children as React.ReactElement<TriggerProps>;
    return ReactImpl.cloneElement<TriggerProps>(typed, {
      onClick: () => setOpen(!open),
      'data-state': open ? 'open' : 'closed',
    });
  }

  function DropdownMenuContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactImpl.useContext(Ctx);
    if (!open) return null;
    return <div data-testid="dropdown-content">{children}</div>;
  }

  function DropdownMenuItem({
    children,
    onClick,
    disabled,
    className,
    'aria-checked': ariaChecked,
    'aria-busy': ariaBusy,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    'aria-checked'?: boolean;
    'aria-busy'?: boolean;
  }) {
    return (
      <div
        role="menuitem"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled}
        aria-checked={ariaChecked}
        aria-busy={ariaBusy}
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

function makeTenant(slug: string, displayName?: string): Tenant {
  return {
    id: slug,
    name: slug,
    displayName:
      displayName ??
      slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function renderSwitcher({
  availableTenants,
  currentTenant,
}: {
  availableTenants: Tenant[];
  currentTenant: Tenant | null;
}) {
  return render(
    <SidebarProvider>
      <TenantContextProvider
        currentTenant={currentTenant}
        availableTenants={availableTenants}
        permissions={[]}
        crossTenant={false}
        rolesByTenant={{}}
        groups={[]}
      >
        <TenantSwitcher />
      </TenantContextProvider>
    </SidebarProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSwitchActiveTenantAction.mockResolvedValue({ ok: true });
  });

  describe('single-tenant user', () => {
    it('renders a static workspace label', () => {
      const acme = makeTenant('acme');
      renderSwitcher({ availableTenants: [acme], currentTenant: acme });
      expect(screen.getByText('Acme')).toBeDefined();
    });

    it('uses the tenant displayName, not the slug', () => {
      const tenant = makeTenant('my-corp-labs', 'My Corp Labs');
      renderSwitcher({ availableTenants: [tenant], currentTenant: tenant });
      expect(screen.getByText('My Corp Labs')).toBeDefined();
    });

    it('does not render a dropdown trigger', () => {
      const acme = makeTenant('acme');
      renderSwitcher({ availableTenants: [acme], currentTenant: acme });
      expect(
        screen.queryByRole('button', { name: /switch workspace/i }),
      ).toBeNull();
    });
  });

  describe('no-tenant user', () => {
    it('renders "No workspace" label when there are no tenants', () => {
      renderSwitcher({ availableTenants: [], currentTenant: null });
      expect(screen.getByText('No workspace')).toBeDefined();
    });
  });

  describe('multi-tenant user', () => {
    const acme = makeTenant('acme');
    const beta = makeTenant('beta-labs', 'Beta Labs');
    const gamma = makeTenant('gamma-sec', 'Gamma Sec');
    const tenants = [acme, beta, gamma];

    it('renders a dropdown trigger labelled with the active tenant displayName', () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      expect(screen.getByText('Acme')).toBeDefined();
    });

    it('shows the "Workspace" subtitle under the active tenant', () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      expect(screen.getByText('Workspace')).toBeDefined();
    });

    it('opens the dropdown and lists all tenants by displayName', () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });

      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );
      expect(screen.getByText('Beta Labs')).toBeDefined();
      expect(screen.getByText('Gamma Sec')).toBeDefined();
    });

    it('marks the active tenant with aria-checked=true', () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );

      const activeItem = screen
        .getAllByRole('menuitem')
        .find((el) => el.getAttribute('aria-checked') === 'true');
      expect(activeItem).toBeDefined();
      expect(activeItem!.textContent).toContain('Acme');
    });

    it('invokes switchActiveTenantAction when a non-active tenant is clicked', async () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockSwitchActiveTenantAction).toHaveBeenCalledWith('beta-labs');
      });
    });

    it('calls router.refresh() after a successful switch', async () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it('shows a toast error when the switch action rejects membership', async () => {
      mockSwitchActiveTenantAction.mockResolvedValueOnce({
        ok: false,
        reason: 'not_a_member',
      });

      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );
      fireEvent.click(screen.getByText('Beta Labs'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('does not invoke the switch action when the active tenant is clicked', async () => {
      renderSwitcher({ availableTenants: tenants, currentTenant: acme });
      fireEvent.click(
        screen.getByRole('button', { name: /switch workspace/i }),
      );

      // The active item is the only menu entry with aria-checked=true;
      // grabbing it directly avoids the trigger-vs-item collision on "Acme".
      const activeItem = screen
        .getAllByRole('menuitem')
        .find((el) => el.getAttribute('aria-checked') === 'true');
      expect(activeItem).toBeDefined();
      fireEvent.click(activeItem!);

      // Give any pending microtasks a chance to settle.
      await Promise.resolve();
      expect(mockSwitchActiveTenantAction).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});

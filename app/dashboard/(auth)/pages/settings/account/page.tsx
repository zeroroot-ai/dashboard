/**
 * Account Settings page — Server Component.
 *
 * Renders the account preferences form (template component, client-side) and
 * the LinkedAccountsSection (server component) that shows which social
 * providers are connected to the user's account.
 */

import { AccountForm } from "./account-form";
import { LinkedAccountsSection } from "./linked-accounts-section";

export default function Page() {
  return (
    <div className="space-y-6">
      <AccountForm />
      <LinkedAccountsSection />
    </div>
  );
}

import { Link } from "react-router-dom";

const PRIVACY_EMAIL = "privacy@samdamte.com";

function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-bold text-navy-900">Samdamte Water</Link>
          <Link to="/" className="text-sm font-semibold text-aqua-700">Home</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <article className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
          <h1 className="text-3xl font-black tracking-tight text-navy-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>
          <div className="mt-8 space-y-7 leading-7">{children}</div>
        </article>
      </main>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 className="text-xl font-bold text-navy-900">{title}</h2>
    <div className="mt-2 space-y-3 text-slate-600">{children}</div>
  </section>
);

export function PrivacyPolicyPage() {
  return (
    <LegalPage title="Samdamte Privacy Policy" updated="15 September 2026">
      <p className="text-slate-600">
        This policy explains how Samdamte Water processes information when customers and authorised field officers use the Samdamte Android app and related water-utility services.
      </p>
      <Section title="Information we process">
        <p>Account and contact details, customer and water-account identifiers, authentication records, service requests, bills, payments, meter readings, and application or work-order information.</p>
        <p>When a feature requires it, the app also processes precise or approximate location, meter or service evidence photographs, timestamps, and device-generated synchronization information.</p>
      </Section>
      <Section title="Why we use it">
        <p>We use this information to authenticate users, provide water-account services, process and reconcile payments, support field work, maintain offline synchronization, respond to requests, prevent misuse, and meet legal and audit obligations.</p>
      </Section>
      <Section title="Sharing">
        <p>Information may be handled by authorised Samdamte personnel and service providers needed to operate hosting, communications, payment, support, and regulatory functions. We may disclose information when required by law. We do not use app data for third-party advertising.</p>
      </Section>
      <Section title="Storage, security and retention">
        <p>The app encrypts stored sign-in and queued field data and uses HTTPS in production. Access is role-controlled. Online-account data is removed or anonymised after a valid deletion request, while billing, payment, meter, and water-service records may be retained where law, regulation, dispute handling, or financial audit rules require it.</p>
      </Section>
      <Section title="Your choices">
        <p>Android settings control location access. Customers can update account information in the app and can request online-account deletion from Profile → Security &amp; privacy → Delete account.</p>
        <p>See the <Link className="font-semibold text-aqua-700 underline" to="/account-deletion">account deletion page</Link> for another request method.</p>
      </Section>
      <Section title="Contact">
        <p>Privacy questions can be sent to <a className="font-semibold text-aqua-700 underline" href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}

export function AccountDeletionPage() {
  const subject = encodeURIComponent("Samdamte account deletion request");
  return (
    <LegalPage title="Delete your Samdamte account" updated="15 September 2026">
      <Section title="Delete from the Android app">
        <ol className="list-decimal space-y-2 pl-6">
          <li>Sign in to the Samdamte app.</li>
          <li>Open Profile, then Security &amp; privacy.</li>
          <li>Select Delete account, review the warning, enter your current password, and confirm.</li>
        </ol>
      </Section>
      <Section title="Request deletion without the app">
        <p>Email us from the address registered to your account. Include your name and Samdamte username or customer number so we can verify ownership. Never send your password.</p>
        <a
          className="inline-flex rounded-xl bg-aqua-700 px-5 py-3 font-bold text-white"
          href={`mailto:${PRIVACY_EMAIL}?subject=${subject}`}
        >
          Email an account deletion request
        </a>
      </Section>
      <Section title="What is deleted">
        <p>Your online login is disabled and anonymised, and its linked portal access is removed. Data stored only for that login is deleted or anonymised where applicable.</p>
      </Section>
      <Section title="What may be retained">
        <p>Samdamte may retain water-service, meter, billing, payment, fraud-prevention, dispute, and audit records where required for service delivery or by law. Retained records are no longer usable to sign in and remain subject to access controls.</p>
      </Section>
      <Section title="Need help?">
        <p>Contact <a className="font-semibold text-aqua-700 underline" href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}

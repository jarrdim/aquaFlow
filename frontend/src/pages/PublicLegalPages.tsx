import { Link } from "react-router-dom";
import { usePublicContact } from "../lib/publicContact";

const SUPPORT_PHONE = "+254 704 107 724";

function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="legal-page-scroll fixed inset-0 overflow-x-hidden overflow-y-scroll bg-slate-50 text-slate-800">
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
  const contactEmail = usePublicContact().emailAddress?.trim() ?? "";
  return (
    <LegalPage title="Samdamte Privacy Policy" updated="16 September 2026">
      <p className="text-slate-600">
        This notice explains how Samdamte Water Services Ltd ("Samdamte", "we", "us") collects and uses personal data through the Samdamte customer and field-officer applications, the AquaFlow web portal, and related water-utility services. Samdamte is the data controller for this processing.
      </p>

      <Section title="Information covered by this notice">
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Identity and contact information:</strong> names, national identification or organisation registration numbers, telephone numbers, email addresses, postal or physical addresses, language preference and customer number.</li>
          <li><strong>Account and property information:</strong> water-account numbers, plot and property details, service area, route, meter identifiers and service status.</li>
          <li><strong>Service and field information:</strong> meter readings, precise or approximate work-site location, photographs, uploaded documents, service requests, inspection and work-order records, notes, timestamps and synchronization identifiers.</li>
          <li><strong>Financial information:</strong> bills, balances, receipts, payment amount and date, payer name and telephone number, transaction references, M-Pesa responses and reconciliation records. We do not collect a customer&apos;s M-Pesa PIN.</li>
          <li><strong>Account and security information:</strong> username, password hash, roles, account-access records, last sign-in time and security events. Passwords are stored as one-way hashes, not readable text.</li>
          <li><strong>Communications:</strong> SMS, email and in-app notification recipients, message content, delivery status and service-request correspondence.</li>
          <li><strong>Technical information:</strong> IP address used transiently for login abuse prevention, application timestamps and browser session information. The web portal keeps a minimal signed-in-user display record in browser storage until sign-out. A reading queued during a network interruption remains only for the current browser-tab session and is removed after successful synchronization or sign-out.</li>
        </ul>
      </Section>

      <Section title="How we obtain information">
        <p>We receive information directly from customers and applicants, from authorised Samdamte staff and field officers, from existing utility records, and from service providers such as payment and communications providers when they confirm a transaction or delivery.</p>
      </Section>

      <Section title="Purposes and lawful grounds">
        <p>We process personal data to register and authenticate users; establish and administer water services; inspect properties and meters; capture readings; produce bills and statements; receive and reconcile payments; send operational communications; manage requests, arrears and field work; prevent fraud and unauthorised access; maintain audit records; and comply with financial, regulatory and legal duties.</p>
        <p>Depending on the activity, processing is necessary to provide a requested service or perform a contract, comply with a legal obligation, perform an applicable public or utility function, or pursue legitimate interests such as service security, accurate billing and fraud prevention. Where the law requires consent, we will request it separately and it may be withdrawn without affecting earlier lawful processing.</p>
      </Section>

      <Section title="Required and optional information">
        <p>Identity, contact, property and account information marked as required is needed to verify the customer, create or administer a water service, bill accurately, process payment or complete regulated field work. If it is not provided, we may be unable to create online access, open or administer the service, complete a transaction or fulfil the request. Optional information is identified in the relevant form.</p>
      </Section>

      <Section title="Who receives information">
        <p>Access within Samdamte is limited by assigned responsibilities. Where necessary, information is also processed by hosting and backup providers, Safaricom/Daraja for M-Pesa transactions, configured SMS gateway providers, email providers, technical support providers, professional advisers, auditors and competent regulators or public authorities.</p>
        <p>These recipients receive only the information required for their function. We do not sell personal data and do not use utility or app data for third-party advertising.</p>
      </Section>

      <Section title="Transfers outside Kenya">
        <p>A hosting, email, communications or support provider may process information outside Kenya. Before such a transfer, Samdamte must use a lawful transfer mechanism and appropriate contractual, organisational or technical safeguards, or obtain consent where required. Contact us for information about safeguards relevant to a particular provider.</p>
      </Section>

      <Section title="Security">
        <p>Production traffic is protected in transit using HTTPS. Passwords are one-way hashed, browser authentication uses a secure HttpOnly cookie, provider credentials are encrypted at rest, and system access is role-controlled. We also use login throttling, approval controls and audit records. No security measure eliminates every risk, and access devices should be locked and kept up to date.</p>
      </Section>

      <Section title="Retention and deletion">
        <p>We keep identifiable information only for as long as it is needed for the purpose described above and any applicable utility, tax, accounting, dispute, fraud-prevention or regulatory requirement. Retention is determined by the type of record, whether the water account remains active, applicable limitation and statutory periods, an unresolved complaint or transaction, and the backup lifecycle. Records are then deleted, anonymised or securely disposed of.</p>
        <p>Deleting an online account removes its water-account access and anonymises the login identity. It does not automatically erase the underlying customer, property, meter, billing, payment or service history where those records remain necessary for water-service administration, financial audit, fraud prevention, legal claims or regulatory compliance. Data used only for the online login is deleted or anonymised. See the <Link className="font-semibold text-aqua-700 underline" to="/account-deletion">account deletion page</Link> for the exact process.</p>
      </Section>

      <Section title="Location, photographs and device permissions">
        <p>Location and camera access are used only when a field or service feature needs work-site coordinates or evidence. Android device settings control these permissions and can withdraw them, although the affected feature may then be unavailable. We do not use location for advertising.</p>
      </Section>

      <Section title="Your data-protection rights">
        <p>Subject to applicable law, you may ask to be informed about processing, access personal data held about you, correct false or misleading data, object to all or part of processing, or request deletion where the data is inaccurate or no longer lawfully required. You may also withdraw consent where consent is the processing basis.</p>
        <p>Send a request {contactEmail ? <>to <a className="font-semibold text-aqua-700 underline" href={`mailto:${contactEmail}`}>{contactEmail}</a></> : "using the contact email configured by Samdamte"}. We may request enough information to verify identity and protect the account. If you are dissatisfied with our response, you may lodge a complaint with the <a className="font-semibold text-aqua-700 underline" href="https://www.odpc.go.ke/" target="_blank" rel="noreferrer">Office of the Data Protection Commissioner of Kenya</a>.</p>
      </Section>

      <Section title="Children">
        <p>The applications are not directed to children. Where a water-service record concerns a minor, a parent, guardian or other legally authorised person must act on the minor&apos;s behalf.</p>
      </Section>

      <Section title="Changes to this notice">
        <p>We will update the date above when this notice changes materially. Where appropriate, we will also provide an in-app or direct notification.</p>
      </Section>

      <Section title="Contact">
        <p>Data controller: Samdamte Water Services Ltd, P.O. Box 24732, Kenya.</p>
        <p>Email: {contactEmail ? <a className="font-semibold text-aqua-700 underline" href={`mailto:${contactEmail}`}>{contactEmail}</a> : <span>Not configured in System Settings</span>}<br />Telephone: <a className="font-semibold text-aqua-700 underline" href="tel:+254704107724">{SUPPORT_PHONE}</a></p>
      </Section>
    </LegalPage>
  );
}

export function AccountDeletionPage() {
  const subject = encodeURIComponent("Samdamte account deletion request");
  const contactEmail = usePublicContact().emailAddress?.trim() ?? "";
  return (
    <LegalPage title="Delete your Samdamte account" updated="16 September 2026">
      <p className="text-slate-600">This page applies to the Samdamte customer application and its online login. Deleting an app account is different from closing a water-service account.</p>

      <Section title="Delete from the Android app">
        <ol className="list-decimal space-y-2 pl-6">
          <li>Sign in to the Samdamte app.</li>
          <li>Open Profile, then Security &amp; privacy.</li>
          <li>Select Delete account, review the warning, enter your current password, and confirm.</li>
        </ol>
      </Section>

      <Section title="Request deletion without the app">
        <p>Email us from the address registered to your account. Include your name and Samdamte username or customer number so we can verify ownership. Never send your password.</p>
        {contactEmail ? (
          <a className="inline-flex rounded-xl bg-aqua-700 px-5 py-3 font-bold text-white" href={`mailto:${contactEmail}?subject=${subject}`}>
            Email an account deletion request
          </a>
        ) : <p className="font-semibold text-amber-700">The contact email has not been configured in System Settings.</p>}
      </Section>

      <Section title="What is deleted">
        <p>Your online login is permanently disabled and anonymised, its linked portal access and active roles are removed, and data used only for that login is deleted or anonymised. Pending offline readings held in the current web browser session are removed when you sign out or close the tab.</p>
      </Section>

      <Section title="What may be retained">
        <p>The customer and water-service record is not automatically deleted with the online login. Samdamte may retain identity, property, meter, reading, billing, payment, work-order, communications, fraud-prevention, dispute and audit records for as long as necessary to administer the water service or meet financial, legal and regulatory requirements. Retained records cannot be used to sign in and remain protected by access controls.</p>
        <p>You may separately request deletion or correction of information that is inaccurate or no longer lawfully required. We will assess that request against the applicable retention obligation and explain any information that must remain.</p>
      </Section>

      <Section title="After a request">
        <p>We may verify your identity using registered account details. Once verified, we will action the login deletion without undue delay and confirm completion or explain any required retention. Where an applicable service provider holds app-only data on our behalf, we will instruct it to delete that data unless retention is legally required.</p>
      </Section>

      <Section title="Need help?">
        <p>{contactEmail ? <>Contact <a className="font-semibold text-aqua-700 underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.</> : "The contact email has not been configured in System Settings."}</p>
      </Section>
    </LegalPage>
  );
}

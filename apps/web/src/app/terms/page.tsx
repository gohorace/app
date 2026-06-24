import type { Metadata } from 'next'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import styles from '../prose.module.css'

export const metadata: Metadata = {
  title: 'Terms of Service — Horace',
  description: 'Terms of Service for Horace, in plain language.',
}

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <MarketingNav />

      <main>
        <header className={styles.hero}>
          <div className={styles.eyebrow}>Terms of Service</div>
          <h1>Terms of Service.</h1>
          <p className={styles.updated}>Last updated: 23 June 2026</p>
        </header>

        <article className={styles.body}>
          <p>These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Horace, operated by <strong>ONE FIVE THREE PTY LTD (ABN 50 627 419 532)</strong> (&ldquo;Horace&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), of 99 Buderim St, Currimundi, QLD 4551, Australia.</p>
          <p>By creating an account, accessing, or using Horace, you (&ldquo;you&rdquo;, &ldquo;your&rdquo;, the &ldquo;Customer&rdquo;) agree to these Terms. If you are entering into these Terms on behalf of a business, you confirm you have authority to bind that business.</p>
          <p>If you don&apos;t agree to these Terms, don&apos;t use Horace.</p>

          <nav className={styles.toc} aria-label="On this page">
            <div className={styles.tocLabel}>On this page</div>
            <ol className={styles.tocList}>
              <li><a href="#what-horace-does">What Horace does</a></li>
              <li><a href="#eligibility">Eligibility and accounts</a></li>
              <li><a href="#plans-fees">Plans, fees, and billing</a></li>
              <li><a href="#data-consent">Your responsibilities for data and consent</a></li>
              <li><a href="#data-ownership">Data ownership and portability</a></li>
              <li><a href="#privacy">Privacy</a></li>
              <li><a href="#acceptable-use">Acceptable use</a></li>
              <li><a href="#third-party">Third-party services</a></li>
              <li><a href="#availability">Availability</a></li>
              <li><a href="#ip">Intellectual property</a></li>
              <li><a href="#acl">Australian Consumer Law</a></li>
              <li><a href="#disclaimers">Disclaimers and limitation of liability</a></li>
              <li><a href="#indemnity">Indemnity</a></li>
              <li><a href="#term">Term and termination</a></li>
              <li><a href="#changes">Changes to these Terms</a></li>
              <li><a href="#general">General</a></li>
              <li><a href="#governing-law">Governing law</a></li>
              <li><a href="#contact">Contact</a></li>
            </ol>
          </nav>

          <h2 id="what-horace-does">What Horace does</h2>
          <p>Horace reads behavioural signals from your website, matches them against your contacts, and delivers prioritised intelligence and nudges to help you act at the right moment.</p>
          <p>We may add, change, or remove features over time. We&apos;ll give reasonable notice before any change that materially reduces core functionality you rely on.</p>

          <hr />

          <h2 id="eligibility">Eligibility and accounts</h2>
          <p>To use Horace you must be at least 18 and using the service for business purposes connected to real estate or a related field.</p>
          <p>You&apos;re responsible for your account, for keeping your login credentials secure, and for all activity that happens under your account. Tell us promptly if you suspect unauthorised access.</p>
          <p>You must give us accurate account information and keep it current.</p>

          <hr />

          <h2 id="plans-fees">Plans, fees, and billing</h2>
          <p>Horace is offered on subscription plans. The plan, price, and billing cycle that apply to you are those shown at sign-up or in your account.</p>
          <p>Fees are stated in Australian dollars (AUD) and, unless stated otherwise, are exclusive of GST, which we will add where applicable.</p>
          <p>Subscriptions renew automatically at the end of each billing cycle unless cancelled before the renewal date. You authorise us (and our payment processor) to charge your nominated payment method for each cycle.</p>
          <p>We may change pricing. We&apos;ll give you at least 30 days&apos; notice before a price change takes effect for your next billing cycle. Continuing to use Horace after that means you accept the new price.</p>
          <p>Except where required by law (including the Australian Consumer Law), fees already paid are non-refundable.</p>
          <p>If a payment fails, we may suspend your access until the amount owing is paid.</p>

          <hr />

          <h2 id="data-consent">Your responsibilities for data and consent</h2>
          <p>This section matters. Horace processes personal information about people who visit your website. You are responsible for the lawful collection of that information.</p>
          <p>You confirm that:</p>
          <ul>
            <li>You have the right to install Horace&apos;s tracking on your website and to send us the data it captures.</li>
            <li>Your website provides any notices and obtains any consents required under the <em>Privacy Act 1988</em> (Cth), the Australian Privacy Principles, the <em>Spam Act 2003</em> (Cth), and any other law that applies to you — including notice that visitor behaviour is collected and analysed.</li>
            <li>Where Horace sends email on your behalf, you have a lawful basis and any required consent to email each recipient, and you comply with the Spam Act (including unsubscribe obligations).</li>
            <li>The contacts and CRM data you connect to Horace were collected lawfully and you&apos;re permitted to use them this way.</li>
          </ul>
          <p>You — not Horace — are the entity that decides why and how this personal information is collected from your visitors. Horace processes it on your instructions to provide the service.</p>
          <p>You won&apos;t use Horace to surveil, profile, or contact people in a way that breaches any law or any platform policy that applies to you.</p>

          <hr />

          <h2 id="data-ownership">Data ownership and portability</h2>
          <p>The behavioural intelligence Horace builds from your website and contacts belongs to you. We don&apos;t sell it, share it with other customers, or use it to train models for anyone else.</p>
          <p>We hold it as a layer that is separate from any CRM, so it isn&apos;t trapped inside a tool you might later leave.</p>
          <p>When your subscription ends, you may export your data in a commonly used format within 30 days of termination. After that period we may delete it, except where we&apos;re required to retain it by law or need it for a short, reasonable period to wind down the service.</p>
          <p>We retain ownership of the Horace platform, software, models, scoring logic, and all aggregated or de-identified data derived from operating the service (provided it can&apos;t reasonably identify you, your contacts, or your visitors).</p>

          <hr />

          <h2 id="privacy">Privacy</h2>
          <p>Our handling of personal information is described in our <a href="/privacy">Privacy Policy</a>, which forms part of these Terms.</p>
          <p>Where we process personal information on your behalf as part of the service, we do so to provide and support Horace, and we apply reasonable security measures appropriate to the information.</p>

          <hr />

          <h2 id="acceptable-use">Acceptable use</h2>
          <p>You must not:</p>
          <ul>
            <li>Use Horace for anything unlawful, or in breach of any third party&apos;s rights.</li>
            <li>Reverse engineer, scrape, resell, or build a competing product from the service.</li>
            <li>Interfere with the service&apos;s security or operation, or attempt to access data that isn&apos;t yours.</li>
            <li>Misrepresent the source or purpose of any communication Horace helps you send.</li>
            <li>Use Horace to send content that is deceptive, harassing, or prohibited by law.</li>
          </ul>
          <p>We may suspend or limit access if we reasonably believe you&apos;re breaching this section.</p>

          <hr />

          <h2 id="third-party">Third-party services</h2>
          <p>Horace works alongside third-party services you connect — for example your email provider, your CRM, and analytics tooling. Your use of those services is governed by their own terms, and we&apos;re not responsible for them.</p>
          <p>If a third-party service changes or withdraws access, parts of Horace that depend on it may stop working. We&apos;ll make reasonable efforts to keep the service functioning but can&apos;t guarantee continued compatibility.</p>

          <hr />

          <h2 id="availability">Availability</h2>
          <p>We work to keep Horace available and reliable, but we don&apos;t promise it will be uninterrupted or error-free. We may take the service down for maintenance, and will aim to give notice for anything significant and planned.</p>

          <hr />

          <h2 id="ip">Intellectual property</h2>
          <p>We own all rights in the Horace name, brand, software, and platform. These Terms don&apos;t transfer any of those rights to you beyond the right to use the service while your subscription is active.</p>
          <p>You own your data as set out in <a href="#data-ownership">Data ownership and portability</a>. You grant us the limited licence needed to host, process, and use that data to provide and improve the service for you.</p>

          <hr />

          <h2 id="acl">Australian Consumer Law</h2>
          <p>Nothing in these Terms excludes, restricts, or modifies any guarantee, right, or remedy you have under the Australian Consumer Law or any other law that can&apos;t be excluded.</p>
          <p>Where we&apos;re permitted to limit our liability for a failure to comply with a consumer guarantee, our liability is limited (at our option) to resupplying the service or paying the cost of having it resupplied.</p>

          <hr />

          <h2 id="disclaimers">Disclaimers and limitation of liability</h2>
          <p>Subject to <a href="#acl">Australian Consumer Law</a>:</p>
          <p>Horace provides intelligence and prompts to support your judgment. It does not guarantee outcomes, listings, leads, or revenue. Decisions you make based on Horace&apos;s signals are your own.</p>
          <p>To the maximum extent permitted by law, we exclude all implied warranties, and we&apos;re not liable for any indirect, incidental, or consequential loss, or for loss of profit, revenue, data, or business opportunity.</p>
          <p>To the maximum extent permitted by law, our total liability to you for any claim connected with the service is limited to the fees you paid us in the 12 months before the event giving rise to the claim.</p>

          <hr />

          <h2 id="indemnity">Indemnity</h2>
          <p>You agree to indemnify us against claims, losses, and reasonable costs arising from your breach of <a href="#data-consent">Your responsibilities for data and consent</a> or <a href="#acceptable-use">Acceptable use</a>, or from your unlawful collection or use of any data you bring into Horace. This doesn&apos;t apply to the extent the claim is caused by our own breach or negligence.</p>

          <hr />

          <h2 id="term">Term and termination</h2>
          <p>These Terms apply while you have an account.</p>
          <p>You may cancel at any time, effective at the end of your current billing cycle.</p>
          <p>We may suspend or terminate your access if you materially breach these Terms and don&apos;t fix the breach within a reasonable time after we ask, or immediately if the breach can&apos;t be fixed or the law requires it.</p>
          <p>On termination, your right to use Horace ends. Sections that by their nature should survive — including data ownership, IP, liability, and indemnity — continue.</p>

          <hr />

          <h2 id="changes">Changes to these Terms</h2>
          <p>We may update these Terms. If a change is material, we&apos;ll give reasonable notice before it takes effect. Continuing to use Horace after that means you accept the updated Terms.</p>

          <hr />

          <h2 id="general">General</h2>
          <p>These Terms are the entire agreement between us about the service and replace any earlier understanding.</p>
          <p>If any part is found unenforceable, the rest still applies.</p>
          <p>A delay in enforcing a right isn&apos;t a waiver of it.</p>
          <p>You can&apos;t transfer your rights under these Terms without our consent. We may transfer ours as part of a sale or restructure of our business.</p>

          <hr />

          <h2 id="governing-law">Governing law</h2>
          <p>These Terms are governed by the laws of Queensland, Australia. You and we submit to the non-exclusive jurisdiction of the courts of that state.</p>

          <hr />

          <h2 id="contact">Contact</h2>
          <p>Questions about these Terms? Reach us at <a href="mailto:support@gohorace.com"><strong>support@gohorace.com</strong></a>.</p>

          <p className={styles.sig}>Seize the moment — Horace</p>
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { isDoorstepHost } from '@/lib/doorstep/host'
import { DoorstepPrivacy } from '@/components/doorstep/neutral-legal'
import styles from '../prose.module.css'

// HOR-282: host-aware. On the neutral Doorstep host the title must NOT carry
// the Horace brand — even the browser tab is a prospect-facing surface.
export function generateMetadata(): Metadata {
  if (isDoorstepHost(headers().get('host'))) {
    return { title: 'Privacy', description: 'How Doorstep handles the details you provide.' }
  }
  return {
    title: 'Privacy — Horace',
    description: 'Privacy policy for Horace, in plain language.',
  }
}

export default function PrivacyPage() {
  // Neutral, Horace-free policy on onthedoorstep.app; the Horace marketing
  // policy (with nav/footer/voice) everywhere else.
  if (isDoorstepHost(headers().get('host'))) {
    return <DoorstepPrivacy />
  }
  return (
    <div className={styles.page}>
      <MarketingNav />

      <main>
        <header className={styles.hero}>
          <div className={styles.eyebrow}>Privacy</div>
          <h1>Privacy.</h1>
          <p className={styles.updated}>Last updated: 5 May 2026</p>
        </header>

        <article className={styles.body}>
          <p>We follow the Australian Privacy Principles under the <em>Privacy Act 1988</em> (Cth). This page explains, in plain language, what we collect, why we collect it, and what we do with it.</p>
          <p>If you&apos;d rather just read the short version, our <a href="/data">Data page</a> covers the commitments that matter most.</p>

          <nav className={styles.toc} aria-label="On this page">
            <div className={styles.tocLabel}>On this page</div>
            <ol className={styles.tocList}>
              <li><a href="#what-we-collect">What we collect</a></li>
              <li><a href="#why-we-collect">Why we collect it</a></li>
              <li><a href="#how-we-store">How we store it</a></li>
              <li><a href="#who-we-share">Who we share it with</a></li>
              <li><a href="#how-long">How long we keep it</a></li>
              <li><a href="#your-rights">Your rights</a></li>
              <li><a href="#cookies">Cookies</a></li>
              <li><a href="#visitors">Your website&apos;s visitors</a></li>
              <li><a href="#suggested-clause">Suggested clause for your site</a></li>
              <li><a href="#changes">Changes to this policy</a></li>
              <li><a href="#contact">Contact</a></li>
            </ol>
          </nav>

          <h2 id="what-we-collect">What we collect</h2>

          <h3>From agents who use Horace</h3>
          <p>Your name, email, phone number, agency, and login details. Billing information when you pay for the product.</p>

          <h3>From visitors to your website</h3>
          <p>Behavioural information — pages viewed, time on page, return visits, referring source, approximate location, device and browser type. If a visitor identifies themselves through a form on your site, we link that identity to their behaviour so Horace can recognise them when they return.</p>

          <h3>From you, when you contact us</h3>
          <p>Anything you send us by email or through support.</p>
          <p>We don&apos;t collect sensitive information as defined under the Privacy Act. We don&apos;t use cookies for advertising.</p>

          <hr />

          <h2 id="why-we-collect">Why we collect it</h2>
          <p>To make Horace work. That means surfacing signals to you about who&apos;s researching, what they&apos;re looking at, and when they might be ready for a call.</p>
          <p>We also use it to run the business — billing, support, security, and product improvement.</p>
          <p>We don&apos;t use it for advertising. We don&apos;t sell it. We don&apos;t share it with other agents on the platform.</p>

          <hr />

          <h2 id="how-we-store">How we store it</h2>
          <p>Your data is hosted on servers in Australia. It&apos;s encrypted in transit and at rest.</p>
          <p>Access inside our team is limited to people who need it to support you or keep the product running.</p>

          <hr />

          <h2 id="who-we-share">Who we share it with</h2>
          <p>A small number of service providers help us run Horace — for hosting, email delivery, payments, and analytics on our own marketing site. They&apos;re contractually bound to handle your data the same way we do.</p>
          <p>We don&apos;t disclose your data overseas, except where one of those providers requires it. Where that happens, we use providers that meet Australian privacy standards.</p>
          <p>We&apos;ll only share your data with law enforcement or government agencies if we&apos;re legally required to.</p>

          <hr />

          <h2 id="how-long">How long we keep it</h2>
          <p>While you&apos;re a customer, we keep your data so Horace can do its job.</p>
          <p>If you cancel, we&apos;ll export your data to you on request and delete our copy within 90 days — unless we&apos;re legally required to keep some of it for longer (tax records, for example).</p>

          <hr />

          <h2 id="your-rights">Your rights</h2>
          <p>You can:</p>
          <ul>
            <li>Ask what personal information we hold about you</li>
            <li>Ask us to correct it</li>
            <li>Ask us to delete it</li>
            <li>Withdraw consent for us to use it</li>
            <li>Make a complaint about how we&apos;ve handled it</li>
          </ul>
          <p>Email <a href="mailto:team@gohorace.com"><strong>team@gohorace.com</strong></a> and we&apos;ll respond within 30 days.</p>
          <p>If you&apos;re not happy with our response, you can take it to the Office of the Australian Information Commissioner — <a href="https://oaic.gov.au"><strong>oaic.gov.au</strong></a> or <strong>1300 363 992</strong>.</p>

          <hr />

          <h2 id="cookies">Cookies</h2>
          <p>We use cookies to keep you logged in and to remember your preferences. The tracking script you install on your own website uses a first-party cookie to recognise returning visitors. That cookie belongs to your domain, not ours.</p>
          <p>You can disable cookies in your browser, but parts of Horace won&apos;t work properly without them.</p>

          <hr />

          <h2 id="visitors">Visitors to your website</h2>
          <p>When you install Horace on your site, you&apos;re responsible for letting your visitors know — through your own privacy policy and, where required, a cookie notice.</p>
          <p>We&apos;ve written a <a href="#suggested-clause">suggested clause</a> below that you can drop into your existing policy.</p>

          <hr />

          <h2 id="suggested-clause">Suggested clause for your site</h2>
          <p>The text below is a starting point. Adapt it to match your site, your business name, and your contact details — and, if you&apos;re unsure, run it past your own legal adviser. We can&apos;t give legal advice or guarantee this wording is right for your particular setup.</p>
          <blockquote>
            <p><strong>Website analytics</strong></p>
            <p>This website uses Horace (<a href="https://www.gohorace.com">gohorace.com</a>), a website analytics service, to help us understand how visitors interact with our site. Horace records the pages you view, how long you spend on each, when you return, the source that referred you, your approximate location based on IP address, and basic device and browser information.</p>
            <p>If you submit a form on this site — for example, an appraisal request or general enquiry — Horace links your contact details to your prior browsing of our pages so we can follow up appropriately.</p>
            <p>Horace doesn&apos;t sell your information, share it with third parties for advertising, or use it to train artificial-intelligence models. Horace processes this data on our behalf under their privacy policy at <a href="https://www.gohorace.com/privacy">gohorace.com/privacy</a>.</p>
            <p>You can request access to, correction of, or deletion of your information at any time by contacting us at <em>[your contact email]</em>.</p>
          </blockquote>

          <hr />

          <h2 id="changes">Changes to this policy</h2>
          <p>If we change anything material, we&apos;ll email you before it takes effect.</p>

          <hr />

          <h2 id="contact">Contact</h2>
          <p>Privacy questions, requests, or complaints — <a href="mailto:team@gohorace.com"><strong>team@gohorace.com</strong></a>.</p>

          <p className={styles.sig}>Seize the moment — Horace</p>
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}

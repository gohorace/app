// The Horace Handbook — all page copy.
// Paragraphs carry light inline markup as a small token grammar:
//   **bold** -> <strong>, *italic* -> <em>. See `renderInline` in Chapter.tsx.

export const hero = {
  eyebrow: 'The Horace handbook',
  // `lose fewer.` renders as Playfair italic 500; line break before it.
  // Trailing space on titleLead keeps the read-aloud from running the two
  // halves together ("listings,lose") — invisible before the <br>.
  titleLead: 'Win more listings, ',
  titleEm: 'lose fewer.',
  titleTail: '',
  // No standfirst in this edition — the byline carries the hero.
  standfirst: '',
  bylineBy: 'From Horace',
  bylineByTail: '· to the agent who wants to be first',
  bylineKind: 'A manifesto',
} as const

export type Chapter = {
  id: string
  toc?: string // present => listed in the ToC and numbered
  tagLabel: string
  heading: string
  // Each paragraph string may carry **bold**/*italic*. `lead` + `dropcap`
  // apply to the first paragraph of chapter 01.
  paras: string[]
  lead?: boolean
  dropcap?: boolean
}

export const chapters: Chapter[] = [
  {
    id: 's1',
    toc: "Listings you're losing",
    tagLabel: 'The quiet before the listing',
    heading: "The listings you're losing without knowing",
    lead: true,
    dropcap: true,
    paras: [
      "A house sells in your patch. Someone else's board out the front. Weeks before it listed, that vendor was on your website — reading your sold prices, checking what their own place might fetch, weighing you against the agent who got the job. You had a shot at it. You just never knew it was there.",
      "That's the hard part of this work. Not the listing itself, but the quiet before it — the stretch where the pipeline feels thin while the people deciding their next move do it without saying a word to you.",
      'And almost none of them raise their hand. On a typical real estate site, only about two in every hundred visitors ever fill in a form. The other ninety-eight research in silence — then choose.',
      "So the interest isn't missing. It's invisible. The listings walk through your website every week. You just can't see them yet.",
    ],
  },
  {
    id: 's2',
    toc: 'After the same thing',
    tagLabel: 'What I am for',
    heading: "We're both after the same thing",
    paras: [
      "Here's what I'm for. Not more notifications. Not a busier inbox. More listings — and fewer that slip away.",
      'The shift that matters is from reactive to accompanied. From waiting for the phone to ring, to knowing who’s circling before they call. From a pipeline that feels thin, to momentum you can feel even in a quiet month.',
      "You bring the relationships, the local knowledge, the instinct for when to pick up the phone. I watch the street, so you're never guessing where to point that instinct. Put those together and you've got a business that doesn't lurch from listing to listing — it builds.",
      "That's the goal. Win more, lose fewer, and stop wondering where the next one's coming from.",
    ],
  },
  {
    id: 's3',
    toc: 'Vendors have changed',
    tagLabel: 'Why your site matters',
    heading: 'Vendors have changed — and your website matters more than ever',
    paras: [
      'The vendor who sat and waited for an agent to call is gone. Today they research for months before they reach out. Half of first-time sellers go looking for their agent online before they ever pick up the phone.',
      "And they don't just look — they compare. Most line up two or three agents and weigh them side by side, reading sold results and reviews, testing who actually knows their street. They lean on honest reviews, too — a real mix of good and bad beats a wall of perfect fives. By the time they book an appraisal, the choice is half-made.",
      'Where they research is shifting as well. Portals still pull big traffic, but more and more people now start with AI — in the US, over two-thirds of buyers already open a tool like ChatGPT before they contact an agent, and the portals’ grip on discovery has started to slip.',
      "Here's the thing about all of it. Portals, search, AI — that's rented ground. You compete for space on it, you pay for leads through it, and it owns the relationship, not you.",
      "Your website is the one channel you own. It's where a vendor goes to decide whether it's you — and the only place where what they do there is yours to read, not a portal's to sell back to you. That's why it has never mattered more. Better still, the intelligence it builds is yours to keep. It travels with you across any tool or platform, and it can't be locked in or taken away.",
    ],
  },
  {
    id: 's4',
    toc: 'What sharp agents do',
    tagLabel: 'The edge',
    heading: 'What the sharp agents are doing',
    paras: [
      "The pragmatic agent isn't working harder. They're aiming better. They let the signal decide where their time goes — so the call lands on the vendor who's actually moving, not the whole database on a Tuesday.",
      "That's the edge I'm here for. I read the trail every visitor leaves, I learn the normal rhythm of your street and your listings, and I tap you the moment something breaks it — *something's stirring*. A change like that is rarely random. A quiet owner suddenly checking sold prices usually means something shifted in their life — a job, a baby on the way, a number that finally added up. I can't see what changed. But I see the moment it starts to show, and that's all you need to be first.",
      "A best-practice site makes that edge sharper — not because I'm asking for anything, but because a site a vendor can move through cleanly is one where every step they take is a step you can read. Here's what that looks like, mapped to the journey a vendor actually travels.",
    ],
  },
  {
    id: 's4b',
    tagLabel: '',
    heading: '',
    paras: ['The best sites also get a few basics right, and they’re worth naming:'],
  },
  {
    id: 's4c',
    tagLabel: '',
    heading: '',
    paras: [
      'And the sharp ones make their marketing work twice. Every touch they send — an anniversary note, a just-sold card in the street, a newsletter — points back to a page on their own site, never a dead end like a flat PDF or a portal listing. Once as outreach, again as signal: the moment a vendor acts on it, it’s there to read, and the follow-up happens while it’s still warm. That’s how you stay in the mix across a research window that runs months, not days.',
      "One last thing worth knowing about me. I'd rather stay quiet than guess. A nudge means I'm sure — and when I'm not, *nothing worth your attention yet* is me respecting your time, not missing the moment.",
      "Build the site a vendor wants to move through, and you've built the thing that tells you when they're ready. Win more. Lose fewer. Be first.",
    ],
  },
]

// Pull-quotes are positioned by the id of the chapter they follow.
export const pullquotes: { after: string; text: string }[] = [
  { after: 's1', text: "The interest isn't missing. It's invisible." },
  { after: 's3', text: 'Your website is the one channel you own.' },
]

// Best-practice basics (chapter 04, after the journey table). Each may carry
// **bold**/*italic*.
export const basics: string[] = [
  'Every page tracked, not just the homepage — so nothing a vendor does goes unseen.',
  'The pages that carry meaning kept clear and distinct: sold results, appraisals, listings, suburb reports, contact.',
  'Forms that register a start, not only a submit — the vendor who begins and stops is often your warmest call.',
  'Each listing on its own page, so a repeat visit to one property stands out for what it is.',
  'Contact recognition that works — so a returning vendor is *Sarah’s back*, not *someone’s back*.',
]

export type MatrixRow = {
  stageTitle: string
  stageSub?: string
  gives: string
  reads: string
}

export type Matrix = {
  caption: string
  headers: [string, string, string]
  rows: MatrixRow[]
}

// Chapter 04 — placed after s4.
export const journeyMatrix: Matrix = {
  caption: 'The vendor’s journey — and what it tells you',
  headers: ["Where they're at", 'What a great site gives them', 'What it tells you'],
  rows: [
    {
      stageTitle: 'Just wondering',
      stageSub: "What's my place worth?",
      gives: "A value estimate, your suburb's recent sold prices",
      reads: "Someone's checking what homes like theirs are fetching",
    },
    {
      stageTitle: 'Keeping an eye',
      stageSub: 'Watching, not committed',
      gives: 'Suburb reports to download, market updates, sold galleries',
      reads: 'They pulled a report — and they keep coming back to the sold results',
    },
    {
      stageTitle: 'Getting serious',
      stageSub: 'Should I sell?',
      gives: 'An appraisal page, a selling guide, straight talk on fees and the process',
      reads: "They're on your appraisal page but haven't booked — a warm call, not a cold one",
    },
    {
      stageTitle: 'Sizing you up',
      stageSub: 'Who do I trust with this?',
      gives: 'Your track record, recent sales, real reviews, your profile',
      reads: "They're reading your sold listings and reviews — you're on the shortlist, up against two or three others",
    },
    {
      stageTitle: 'On the edge',
      stageSub: 'Ready to reach out',
      gives: 'An easy way to contact you, a simple booking',
      reads: 'They hit your contact page and left. They were close — follow up',
    },
    {
      stageTitle: 'After the first chat',
      stageSub: 'Deciding to list',
      gives: 'Comparable sales, clear next steps',
      reads: "They're back on your sold results after the appraisal — still weighing it",
    },
  ],
}

export const closing = {
  eyebrow: 'Seize the moment',
  lede:
    "The agents who win the next listing aren't the ones who hustle hardest through the quiet. They're the ones who set things up so the quiet tells them something.",
  sub:
    "Do the work once. Then stop wondering where your next listing's coming from — and start building a business you can count on.",
  sigLine1: "I'm watching the street. Let's make sure I can see it.",
  sigLine2: '— Horace',
  ctaPrimary: { label: 'Get started today', href: '/login' },
  ctaGhost: { label: 'Book a walk-through', href: 'https://cal.com/andytwomey/15min' },
  trial: '14-day free trial · no card required · set up in an afternoon',
}

export const share = {
  title: 'The Horace handbook',
  text: 'Win more listings, lose fewer — how Horace reads the trail vendors leave on your own site. Worth a read.',
}

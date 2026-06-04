// The Horace manifesto — all page copy.
// Paragraphs carry light inline markup as a small token grammar:
//   **bold** -> <strong>, *italic* -> <em>. See `renderInline` in Chapter.tsx.

export const hero = {
  eyebrow: 'The Horace manifesto',
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
      "One thing worth knowing about me. I'd rather stay quiet than guess. A nudge means I'm sure — and when I'm not, *nothing worth your attention yet* is me respecting your time, not missing the moment.",
      "The site itself matters too — not as a brochure, but as the surface I read. A site a vendor can move through cleanly is a site where every step they take is a step you can read. The how of that — the build, the structure, the speed, the conversion craft — I've laid out in a separate playbook. This piece is about why. That one's about how.",
    ],
  },
]

// Pull-quotes are positioned by the id of the chapter they follow.
export const pullquotes: { after: string; text: string }[] = [
  { after: 's1', text: "The interest isn't missing. It's invisible." },
  { after: 's3', text: 'Your website is the one channel you own.' },
]

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
  title: 'The Horace manifesto',
  text: 'Win more listings, lose fewer — how Horace reads the trail vendors leave on your own site. Worth a read.',
}

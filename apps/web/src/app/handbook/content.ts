// The Horace Handbook — all page copy.
// Source of truth: the design-handoff prototype `Horace Thesis.html`.
// Paragraphs carry light inline markup as a small token grammar:
//   **bold** -> <strong>, *italic* -> <em>. See `renderInline` in Chapter.tsx.

export const hero = {
  eyebrow: 'The Horace handbook',
  // `take back` renders as Playfair italic 500; line break before "your pipeline".
  titleLead: 'Set up your site,',
  titleEm: 'take back',
  titleTail: ' your pipeline.',
  standfirst:
    "I'm Horace. Your website already knows who's about to sell — people research for months before they ever call. I read the trail they leave, and I tell you before anyone else knows. But I can only see what your site shows me. So here's the deal.",
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

// 01 — also flagged lead + dropcap on its first paragraph.
export const chapters: Chapter[] = [
  {
    id: 's1',
    toc: 'The listings you never saw',
    tagLabel: 'The cost of the quiet',
    heading: "You're losing listings you never knew you had",
    lead: true,
    dropcap: true,
    paras: [
      "A house sells in your patch. Someone else's board out the front. Here's the part that should sting. Weeks before it listed, that vendor was on your website — reading your sold prices, checking what their own place might fetch, weighing you up against the agent who got the job. You had them. You just never knew.",
      "It happens more than you'd like to think. While you wait for the phone to ring, they're already deciding — quietly, online, and more often than not, on someone else.",
      "It doesn't have to keep going like this. Every one of those vendors leaves a trail before they choose, and the trail is on your site. The only question is whether you're there to read it.",
      "That's what this is about. Read on — it's how you stop losing the ones you never saw coming.",
    ],
  },
  {
    id: 's2',
    toc: 'A note from me',
    tagLabel: 'A note from me',
    heading: 'The quiet before the listing is where I live',
    paras: [
      "The hardest part of this job isn't the listing. It's the quiet before it — the stretch where the pipeline feels thin and you're waiting for the phone to ring.",
      "I'm here so you stop waiting.",
      'Your website already knows who’s about to sell. People research before they call — they read sold prices, revisit a listing, pull a suburb report, and never fill in a form. I read that trail. I tell you before anyone else knows.',
      "But I can only see what your site shows me. So here's the deal — **I'll watch the street, you make sure I can see it.** Do that, and you stop chasing your next listing. You start meeting it early.",
      "There's work in it. Not much, and most of it only once. With it done, you've got me by your side.",
    ],
  },
  {
    id: 's3',
    toc: 'Won before the phone rings',
    tagLabel: 'Timing is everything',
    heading: 'The listing is won before the phone rings',
    paras: [
      "Here's what most agents miss. The decision is half-made before you ever speak.",
      'People research for months before they reach out. Twelve million of them are on realestate.com.au every month, forty minutes at a time — reading sold prices, pulling suburb reports, watching the listing down the road. Half of first-time sellers go looking for their agent online before they ever pick up the phone.',
      "And here's the part that should sting. Most of them never fill in a form. They weigh you up in silence — and you don't hear a thing until they've decided. Sometimes until they've decided on someone else.",
      'The agent who gets there **first** wins. Not the one who hustles hardest once the listing’s live — the one already in the conversation while everyone else waits for the phone to ring.',
      "That's the gap I close. While they're still researching — before they've told a soul — I tap you on the shoulder. You're not the fifth agent to call. You're the first, and you already know what they care about.",
      'One listing you’d otherwise have missed pays for me many times over. You only need to seize one moment to be ahead.',
    ],
  },
  {
    id: 's4',
    toc: 'Before they call you',
    tagLabel: "The vendor's secret head-start",
    heading: 'What a vendor does before they call you',
    paras: [
      "By the time a vendor picks up the phone, they've done more than you'd think — and most of it leaves a trail.",
      "**They're comparing you — right now.** Vendors rarely choose blind. They line up two or three agents and weigh them side by side. So when someone's on your site reading your sold listings, you're not their only option — you're on a shortlist, up against the agent down the road. Which means when I tap you, it's not a cold lead. It's a decision already in motion — and a chance to be the one who moves on it.",
      '**They read your reviews.** Before they ever meet you, they’re on the review sites sizing you up. And they trust an honest mix of good and bad over a page of perfect fives.',
      '**They test your local knowledge.** A vendor wants proof you know their street — recent sales like theirs, real suburb numbers. A generic page tells them nothing. A real one tells them you’re the agent for this patch.',
      "**Price runs everything.** They check what homes like theirs are worth, then check again. Repeat visits to your sold results aren't idle — that's a seller talking themselves toward a decision.",
      '**And most of it happens before the appraisal.** By the time they book you in, the choice is half-made. That’s the whole point of me — I get you in the conversation before the booking, not after.',
    ],
  },
  {
    id: 's5',
    toc: 'My eyes on the street',
    tagLabel: 'Why I need you',
    heading: "I'm only as sharp as what your site lets me see",
    paras: [
      'Your site is my eyes on the street. Every page someone visits, every listing they come back to — that’s what I read.',
      "Set it up well and I see more, sooner, and I'm right more often. Leave gaps and I'm watching one window of a house with the lights off in every other room.",
      'This part is yours. Nobody can configure your site for you — but once you do, everything I give you gets sharper.',
    ],
  },
  {
    id: 's6',
    toc: 'Learning your normal',
    tagLabel: 'How I learn your normal',
    heading: "I don't count visits. I learn a rhythm — then watch for the break",
    paras: [
      "I don't just count visits. Anyone can count visits. I learn the normal rhythm of your street and your listings — what a quiet week looks like, what a busy one looks like, what's ordinary for a given property.",
      "Then I watch for the break in that rhythm. The contact who's gone quiet for months, then looks at sold results twice this week. The listing nobody touched that's suddenly getting revisited. That's the moment — *something's stirring* — and it's the one a simple visit count sails straight past.",
      "And a change like that is rarely random. People don't research their own suburb for fun. A burst of it usually means something just shifted — a job, a baby on the way, a separation, a number that finally added up. I can't see what changed in their life. But I see the moment it starts to show on your site — and that's all you need to get there first.",
      "Here's the catch. I learn your normal from what your site feeds me. Thin data, and I either miss the shift or mistake noise for it.",
      'The more I can see, the better I know your normal. And the better I know your normal, the faster and surer I spot when it changes. That’s why setup matters — it’s the difference between me guessing and me knowing.',
    ],
  },
  {
    id: 's7',
    toc: 'What good looks like',
    tagLabel: 'The setup',
    heading: 'What good looks like',
    paras: [
      "Five things. Get these right and you've switched on most of what I can do. Each one earns its place — here's what it gives you.",
    ],
  },
  {
    id: 's8',
    toc: 'The whole journey',
    tagLabel: 'The whole journey',
    heading: 'What a great site looks like — every step of the way',
    paras: [
      "Selling a home doesn't start with a phone call. It starts months earlier, with a quiet look at what the place down the road sold for.",
      'A great site meets them at every step of that — and every step it meets them at, I can read. Here’s the journey, and what a well-built site lets me see along it.',
    ],
  },
  {
    id: 's8b',
    tagLabel: '',
    heading: '',
    paras: [
      "See the shape of it? Every row is a moment — and one I can only catch if your site gave them the page to do it on. Miss a step, and I go quiet exactly where you needed me most.",
      "**Build the journey, and I'll read it back to you the whole way down.**",
    ],
  },
  {
    id: 's9',
    toc: 'Prospecting twice',
    tagLabel: 'Prospecting that works twice',
    heading: 'Make your prospecting work twice',
    paras: [
      'Most agents treat prospecting and their website as two separate things. You send the just-sold card, drop the newsletter, post the listing — and hope it lands. Then you wait.',
      "Here's the shift. Every touch you send should point back to a page on your site — and not the homepage. A page that's the next step: the suburb's sold prices, a value estimate, your appraisal page. Do that, and the touch isn't just outreach anymore. It's a door — and I'm watching who walks through it.",
      "**That's prospecting working twice.** Once when it reaches them. Again when they act on it — because the moment they do, I read it, and I tap you while it's still warm.",
    ],
  },
  {
    id: 's9b',
    tagLabel: '',
    heading: '',
    paras: [
      'The point of the QR code, the link, the call to action is never just the click. It’s the page it opens — one that moves them forward, and lets me see they moved.',
      "This is how you stay in the mix. The research window is long — months, not days. You can't sit in it the whole time. But your prospecting can — and with me reading what it stirs up, you're not hoping it landed. **You know who it moved, and you're there when it matters.**",
    ],
  },
  {
    id: 's10',
    toc: 'Switch on more, get more',
    tagLabel: 'The dial, not the switch',
    heading: 'The more you switch on, the more I give back',
    paras: [
      "This isn't pass or fail. It's how much of me you turn on.",
      'Set up fully, and I work at my best. I name the contact, I watch your people for the change in their rhythm, and I get the calls right far more often than I get them wrong.',
      "Set up lightly, and I still work. I'll catch what's stirring on a street, I'll flag a hot listing — I just stay name-free, and I see less. You'll still hear from me. You'll just hear less, and later.",
      "The gap between those two isn't my limit. It's your setup. **Which means it's yours to close.**",
    ],
  },
  {
    id: 's11',
    toc: 'Rather quiet than wrong',
    tagLabel: 'A promise',
    heading: "I'd rather stay quiet than guess",
    paras: [
      "Here's a promise that cuts the other way. Good setup doesn't just mean more from me — it means more you can trust.",
      "When I'm not sure, I hold. *Nothing worth your attention yet* is me keeping my word, not me asleep.",
      'A nudge from me means I’m confident — and I get to be confident because your site feeds me well. A half-blind me that guesses to look busy is worse than one that waits. I won’t do that to you. So when I tap you on the shoulder, you can move on it.',
    ],
  },
  {
    id: 's12',
    toc: 'Keep me watching',
    tagLabel: 'One last thing',
    heading: 'Keep me watching',
    paras: [
      'One last thing. A site redesign, a new listing format, a page that quietly breaks — any of it can blind me without a sound.',
      'So when your site changes, check I can still see. It takes a minute. It keeps me sharp.',
    ],
  },
]

// Pull-quotes are positioned by the id of the chapter they follow.
export const pullquotes: { after: string; text: string }[] = [
  { after: 's2', text: 'The listing is won before the phone rings.' },
  { after: 's6', text: '“Something’s stirring on Maple Street.”' },
]

export type CheckItem = { title: string; body: string }

// Chapter 07 checklist.
export const checklist: CheckItem[] = [
  {
    title: 'Tracking on every page',
    body: "Not just the homepage — every page. Whatever I can't track, I can't read, and that's signal walking straight past me.",
  },
  {
    title: 'Your key pages legible to me',
    body: 'Sold results, appraisals, individual listings, suburb reports, your contact page. These are the pages that carry meaning — when someone lingers here, it tells me something. Make sure I can tell them apart.',
  },
  {
    title: 'Forms wired so I catch a start, not just a submit',
    body: "Someone who begins a form and stops was close. That's your warm call — the one that gets away if all I ever see is the finished ones.",
  },
  {
    title: 'Listings structured so a repeat visit shows',
    body: "When the same person comes back to one property again and again, that's your serious one. I can only flag it if each listing is its own page I can recognise.",
  },
  {
    title: 'Contact identification working',
    body: 'This is what lets me say “Sarah’s back” instead of “someone’s back”. Get it right and I can name names. Get it wrong and I stay vague — because I’d rather say nothing than say the wrong name.',
  },
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

// Chapter 08 — placed after s8.
export const journeyMatrix: Matrix = {
  caption: "The vendor's journey — and what I read",
  headers: ["Where they're at", 'What a great site gives them', 'What I read'],
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
      reads: "They're reading your sold listings and your reviews — you're on the shortlist, up against two or three others",
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

// Chapter 09 — placed after s9.
export const prospectingMatrix: Matrix = {
  caption: 'Where every touch should land',
  headers: ['What you send', 'Where it should land', 'What I read'],
  rows: [
    {
      stageTitle: 'Purchase anniversary',
      stageSub: '“A year in your home”',
      gives: 'Their property’s value today, your profile',
      reads: 'A current owner checking their number — someone who could be thinking of moving',
    },
    {
      stageTitle: 'Just sold, in their street',
      gives: "The suburb's sold results, behind a QR code",
      reads: 'The neighbours benchmarking their own place — classic pre-appraisal',
    },
    {
      stageTitle: 'Just listed nearby',
      gives: 'The listing, then a clear next step',
      reads: "Who's watching the street they live on",
    },
    {
      stageTitle: 'Newsletter',
      gives: 'A market update or suburb report on your site',
      reads: 'Who clicked through — and what they did once they landed',
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
  text: "Your website already knows who's about to sell. Here's how Horace reads the trail — worth a read.",
}

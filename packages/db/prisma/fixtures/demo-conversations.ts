/**
 * Pre-generated demo conversation transcripts for marketplace agents.
 * Used to populate realistic task data for "Austin Bakery Co" demo instance.
 */

export interface DemoMessage {
  role: "lead" | "agent";
  text: string;
  minutesOffset: number; // minutes from task start
}

export interface DemoConversation {
  agentSlug: string;
  category: string;
  summary: string;
  outcome: "qualified" | "disqualified" | "booked" | "escalated";
  handoffTo?: string;
  reviewStatus: "approved" | "rejected";
  messages: DemoMessage[];
  minutesAgo: number; // minutes before "now" when task was created
}

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  // ===== SPEED-TO-LEAD AGENT (7 conversations) =====
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Wedding cake inquiry for June 2026 — qualified and handed to sales",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 15,
    messages: [
      {
        role: "lead",
        text: "Hi! I'm getting married in June and saw your beautiful wedding cakes on Instagram. Do you have availability?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Congratulations on your engagement! We'd love to help make your day special. June is a popular month — can you share your wedding date and how many guests you're expecting?",
        minutesOffset: 2,
      },
      {
        role: "lead",
        text: "June 14th, about 150 guests. We're looking for something elegant, maybe with fresh flowers.",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "Perfect! That sounds lovely. I'm connecting you with our wedding specialist Sarah who can walk you through design options and schedule a tasting. She'll reach out within the hour!",
        minutesOffset: 7,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Corporate event catering request — qualified for sales team",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 45,
    messages: [
      {
        role: "lead",
        text: "We need breakfast pastries for our quarterly all-hands meeting next month. About 80 people.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "We do a lot of corporate catering! Are you looking for a mix of pastries, or do you have specific favorites in mind?",
        minutesOffset: 1,
      },
      {
        role: "lead",
        text: "A variety would be great — croissants, muffins, maybe some fruit danishes. And coffee service if you offer that.",
        minutesOffset: 4,
      },
      {
        role: "agent",
        text: "We can absolutely do that, including coffee and setup. I'm passing you to our catering team to finalize the menu and delivery details. You'll hear from them today!",
        minutesOffset: 5,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Custom birthday cake for child's party — qualified",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 120,
    messages: [
      {
        role: "lead",
        text: "My daughter is turning 7 and she's obsessed with unicorns. Can you make a unicorn cake?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "How sweet! We love making magical birthday cakes. When is her party, and how many people will you be serving?",
        minutesOffset: 1,
      },
      {
        role: "lead",
        text: "April 19th, probably 20 kids plus some parents. So maybe 30-35 total?",
        minutesOffset: 3,
      },
      {
        role: "agent",
        text: "Perfect timing! I'm connecting you with our cake design team. They'll show you some unicorn options and help you pick flavors. Expect to hear from them shortly!",
        minutesOffset: 4,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Wholesale inquiry for coffee shop partnership — qualified",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 240,
    messages: [
      {
        role: "lead",
        text: "I own a coffee shop in Hyde Park and I'm looking for a local bakery to supply pastries. Are you open to wholesale partnerships?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "We are! We work with several coffee shops around Austin. How many pastries would you need daily, and when are you looking to start?",
        minutesOffset: 2,
      },
      {
        role: "lead",
        text: "Probably 2-3 dozen to start — croissants, scones, maybe some muffins. We'd like to start within the next few weeks if possible.",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "That's a great fit for us. I'm passing you to our wholesale coordinator who handles pricing and delivery logistics. They'll get you a proposal this week!",
        minutesOffset: 6,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Anniversary cake for small celebration — qualified",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 380,
    messages: [
      {
        role: "lead",
        text: "Our 25th wedding anniversary is coming up and we'd love to get a special cake. Nothing huge, just for the two of us and our kids.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "What a wonderful milestone! Congratulations. When is your anniversary, and what size cake are you thinking — maybe 6-8 servings?",
        minutesOffset: 2,
      },
      {
        role: "lead",
        text: "May 3rd. Yeah, probably 6-8 people. We had a lemon cake at our wedding, so maybe something with lemon?",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "That's so thoughtful! Our lemon cakes are really popular. I'm connecting you with our cake team to recreate that memory for you. They'll be in touch soon!",
        minutesOffset: 6,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Student asking about internship opportunities — disqualified (not sales)",
    outcome: "disqualified",
    reviewStatus: "approved",
    minutesAgo: 500,
    messages: [
      {
        role: "lead",
        text: "Hi! I'm a culinary student at ACC and I'm looking for internship opportunities. Are you hiring interns this summer?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Thanks for reaching out! We do occasionally bring on culinary students, but I'm not the right contact for that. You should email our head baker directly at careers@austinbakery.co with your resume.",
        minutesOffset: 2,
      },
      {
        role: "lead",
        text: "Perfect, thank you!",
        minutesOffset: 4,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Inquiry from outside service area — disqualified",
    outcome: "disqualified",
    reviewStatus: "approved",
    minutesAgo: 650,
    messages: [
      {
        role: "lead",
        text: "Do you deliver to San Antonio? We're planning a family reunion and need a big cake.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Unfortunately we only deliver within the Austin metro area right now. San Antonio is a bit too far for us to guarantee freshness. I'd recommend checking out La Panaderia or Bakery Lorraine down there — they do beautiful work!",
        minutesOffset: 2,
      },
      {
        role: "lead",
        text: "Okay, thanks for the suggestions!",
        minutesOffset: 5,
      },
    ],
  },

  // ===== SALES CLOSER AGENT (4 conversations) =====
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Wedding tasting scheduled and deposit collected",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 30,
    messages: [
      {
        role: "agent",
        text: "Hi Emily! I'm Sarah from Austin Bakery. You spoke with our team about a June 14th wedding cake. I'd love to schedule a tasting for you and your fiancé!",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Yes! We're so excited. What days do you have available?",
        minutesOffset: 3,
      },
      {
        role: "agent",
        text: "I have this Saturday at 2pm or next Wednesday at 10am. You'll get to try 5 cake flavors and see our portfolio. Does either work?",
        minutesOffset: 4,
      },
      {
        role: "lead",
        text: "Saturday works perfectly! What do we need to bring?",
        minutesOffset: 7,
      },
      {
        role: "agent",
        text: "Just yourselves and any inspiration photos you love! I'll send a calendar invite now. To hold your June date, we'll need a $200 deposit after the tasting — does that sound good?",
        minutesOffset: 8,
      },
      {
        role: "lead",
        text: "Sounds great, see you Saturday!",
        minutesOffset: 10,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Corporate catering contract signed for quarterly event",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 90,
    messages: [
      {
        role: "agent",
        text: "Hi Jason, following up on your request for breakfast catering for 80 people. I put together a menu proposal — assorted pastries, fruit, and coffee service for $850. Does that work within your budget?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "That's perfect. What's the delivery window?",
        minutesOffset: 4,
      },
      {
        role: "agent",
        text: "We'll deliver between 7:30-8am on your event day and handle setup. We just need a 50% deposit to confirm. Can I send over the contract?",
        minutesOffset: 5,
      },
      {
        role: "lead",
        text: "Yes please, send it over and I'll get it signed today.",
        minutesOffset: 8,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Birthday cake order confirmed with custom design",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 200,
    messages: [
      {
        role: "agent",
        text: "Hi Maria! I saw the unicorn cake request for your daughter's 7th birthday. We have a gorgeous 3-tier unicorn design with rainbow layers inside — the kids go crazy for it! It serves 35 and runs $185. Interested?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "That sounds perfect! Can we do vanilla cake with strawberry filling?",
        minutesOffset: 3,
      },
      {
        role: "agent",
        text: "Absolutely, that's a popular combo. I'll mark you down for pickup on April 19th at 11am. We'll need a $75 deposit to start the design. I'll text you a payment link now!",
        minutesOffset: 4,
      },
      {
        role: "lead",
        text: "Perfect, paying now!",
        minutesOffset: 7,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Wholesale pricing negotiation — escalated to manager",
    outcome: "escalated",
    reviewStatus: "approved",
    minutesAgo: 320,
    messages: [
      {
        role: "agent",
        text: "Hi David, thanks for your interest in wholesale! For 2-3 dozen pastries daily, our rate is $2.50 per pastry with a $75 daily minimum. Delivery is included for Hyde Park.",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "I was hoping for closer to $2 per pastry — that's what I'm paying my current supplier.",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "I appreciate you sharing that! Our pricing reflects our local, from-scratch approach. Let me connect you with our wholesale manager who might have flexibility for a long-term partnership. Sound good?",
        minutesOffset: 7,
      },
      {
        role: "lead",
        text: "Yeah, I'd like to talk to them. I'm definitely interested if we can make the numbers work.",
        minutesOffset: 10,
      },
    ],
  },

  // ===== NURTURE SPECIALIST AGENT (4 conversations) =====
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Re-engaged previous inquiry, now ready to book tasting",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 60,
    messages: [
      {
        role: "agent",
        text: "Hi Rachel! You reached out a few months ago about a wedding cake. I saw your venue just posted photos from your tasting — how's the planning going?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Oh wow, great timing! We just finalized our venue and now we need to book the cake. Are you still available for October 12th?",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "We are! October is beautiful for weddings. Let me reconnect you with Sarah to schedule your tasting. This time you're ready to move forward, right?",
        minutesOffset: 6,
      },
      {
        role: "lead",
        text: "Yes, definitely ready to book!",
        minutesOffset: 8,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Corporate client from last year re-engaged for annual event",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 180,
    messages: [
      {
        role: "agent",
        text: "Hi Mark! You ordered from us for your team retreat last spring. Saw on LinkedIn you have another event coming up — need catering again?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Actually yes! Same event, different venue. Your pastries were a hit last time. Can we do the same order?",
        minutesOffset: 4,
      },
      {
        role: "agent",
        text: "Absolutely! I'm pulling up your previous order now. Let me connect you with our catering team to confirm the date and update quantities if needed.",
        minutesOffset: 5,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Follow-up on previous inquiry — lead not ready yet but engaged",
    outcome: "qualified",
    reviewStatus: "approved",
    minutesAgo: 450,
    messages: [
      {
        role: "agent",
        text: "Hi Jennifer! Following up on your anniversary cake inquiry from last month. Did you end up celebrating, or are you still planning something?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "We had to postpone because my husband got sick. Planning to celebrate next month instead!",
        minutesOffset: 6,
      },
      {
        role: "agent",
        text: "Oh no, hope he's feeling better! Well, we're here whenever you're ready. Just let me know when you have a new date in mind.",
        minutesOffset: 8,
      },
      {
        role: "lead",
        text: "Thanks, I'll reach out in a couple weeks!",
        minutesOffset: 12,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Multiple follow-up attempts, lead unresponsive — lost",
    outcome: "disqualified",
    reviewStatus: "rejected",
    minutesAgo: 900,
    messages: [
      {
        role: "agent",
        text: "Hi Susan! Just checking in one more time about your daughter's graduation cake. We'd still love to help celebrate her big day!",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "I know you're probably busy with graduation planning. If you've found another bakery, no worries! Just wanted to make sure we didn't miss you.",
        minutesOffset: 1440,
      },
    ],
  },
];

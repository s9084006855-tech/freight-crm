import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

/**
 * AFUO Strategy Map — Disney 1957 inspired business strategy visualization
 *
 * Drop this component into your CRM as a route/tab. It's self-contained:
 *   - No external dependencies beyond React
 *   - All content is static (instant, no API calls)
 *   - Styles are inline so it won't conflict with your CRM's CSS
 *   - Persists "last unit viewed" to localStorage under namespaced key
 *
 * To restrict to your profile only:
 *   Wrap the route in your CRM's auth/role gate, e.g.
 *   {currentUser.id === YOUR_USER_ID && <Route path="/strategy" element={<StrategyMap />} />}
 */

const DEEP_DIVES = {
  core: {
    title: 'AFUO brokerage — the creative engine',
    subtitle: 'MC 1136566 · DOT 3471790 · SCAC AFUO',
    sections: [
      {
        heading: 'Why this is the center',
        body: "Every other unit on this map only has value because the brokerage is running. Lead gen has nothing to qualify if you're not booking loads. The newsletter has nothing to say if you're not in the freight every day. The SaaS has no proof if your own ops aren't humming. Disney didn't build Disneyland instead of making movies. He built it because the movies had earned the right to. Protect the center first. If freight goes quiet, every other arrow on this map weakens at the same time.",
      },
      {
        heading: 'The specific corner you own',
        body: "Last-minute, last-mile emergency coverage. That's the angle. You're not trying to be a generalist broker competing on price with C.H. Robinson. You're the dispatcher's 2am phone call when a reefer dies outside Atlanta with produce on it. That positioning matters because it commands premium rates, it builds reputation faster than commodity freight, and it's the kind of thing that becomes a brand. Every shipper who calls you in a crisis becomes a story for the newsletter, a case study for the content brand, and a referral source for life.",
      },
      {
        heading: "What 'protecting the center' actually means",
        body: "Three things, in order. One, your existing shippers stay happy. Repeat lanes are the foundation of everything because they produce cash with the lowest acquisition cost you'll ever see. Two, you keep adding two to four new shippers per month minimum, even when you're tired, even when the market is slow. The pipeline is the lifeline. Three, you protect your reputation in the lanes you specialize in. One bad load handled badly can undo six months of brand building. The center is not optional. The center is not 'when you have time.' The center is daily.",
      },
      {
        heading: 'What scaling looks like over five years',
        body: "Year one is you, doing every call yourself, building the system. Year two you bring in a dispatcher or a part-time ops person so you can spend half your day on the other arrows of this map. Year three you have a small team running the desk while you run the company. Year four the brokerage is a self-running unit and your time is on the SaaS and the brand. Year five the brokerage is one of several income streams, not the only one. That's how you get from where you are to the life you described, and notice that none of it requires you to abandon freight. It requires you to use freight as the launchpad for everything else.",
      },
    ],
  },
  leadgen: {
    title: 'Lead generation subagents',
    subtitle: 'The acquisition arm of the CRM',
    sections: [
      {
        heading: 'What this unit does',
        body: "Subagents continuously discover, score, and queue shippers in the lanes and verticals you want to dominate. Instead of you scraping FMCSA data or trawling LinkedIn at night, the system is doing it in the background. By the time a prospect hits your outbound queue, they've been pre-qualified on factors that actually matter: do they ship in your lanes, what verticals are they in, do they have a history of working with smaller carriers, what's their pay reputation.",
      },
      {
        heading: 'The three subagents to build first',
        body: "First, a shipper discovery agent that pulls from public freight data sources and enriches with company info. Second, a scoring agent that ranks each lead against your ideal shipper profile based on lane match, vertical fit, and historical signals. Third, a sequencing agent that drops the highest-scoring leads into your outbound queue with a setup packet ready to send. Don't try to build all three at once. Get discovery solid first, then scoring, then sequencing.",
      },
      {
        heading: 'The feedback loop that makes it compound',
        body: "This is the part most people skip and it's the most important part. Every time you close a shipper, that data goes back to the scoring agent. Every time you get ghosted, that goes back too. Every time a lead turns into a repeat customer, the system learns what a great shipper looks like for AFUO specifically. After six months of this, your scoring agent knows your business better than you do. After a year, the leads it surfaces are converting at multiples of what cold outreach would.",
      },
      {
        heading: 'How this becomes the SaaS',
        body: "The subagent logic you build here is exactly the same logic other small brokers need but can't build themselves. When you eventually package the CRM as a product, the lead gen subagents are the killer feature. You're not selling a CRM. You're selling 'a system that finds shippers in your lanes while you sleep.' That's a very different product and it commands a very different price.",
      },
    ],
  },
  crm: {
    title: 'Custom CRM',
    subtitle: 'The nervous system of the whole operation',
    sections: [
      {
        heading: 'What this unit does',
        body: "The CRM is where every shipper, every load, every conversation, every rate confirmation lives. It's the structured memory of your business. Without it, everything is in your head or in your inbox, which means it dies when you sleep, gets lost when you switch tools, and never compounds. With it, every interaction becomes data that makes the next interaction better.",
      },
      {
        heading: 'What it must do well from day one',
        body: "Pipeline view of every active shipper conversation by stage. Load tracker with the structure you already use: '[Consignee] — [Destination], 1) Order# / PO# / Weight / Pallets / Cases.' Rate confirmation generator that pulls from saved shipper templates. Contact history per shipper so you never forget what was said in the last call. Search that actually works. If those five things work well, everything else is a nice-to-have.",
      },
      {
        heading: 'What to resist building',
        body: "Resist building features you'd want as a SaaS customer but don't need as an operator. Resist over-engineering reporting dashboards before you have data worth reporting on. Resist integrations with tools you don't yet use. The CRM exists to make today's freight work better. Every hour spent on a feature you don't currently need is an hour not spent on the center of the map.",
      },
      {
        heading: 'The bridge to SaaS',
        body: "Use this CRM yourself, hard, for at least six months before you even consider selling it. The scars you collect in those six months are what make the product good. Other brokers will spot a freight CRM built by someone who hasn't actually brokered freight from a mile away. Yours will be different because it was forged in your own operation first.",
      },
    ],
  },
  newsletter: {
    title: 'Daily newsletter',
    subtitle: 'The owned audience asset',
    sections: [
      {
        heading: 'Why this matters more than social media',
        body: "Social media is rented land. The algorithm changes, the platform dies, your reach disappears. A newsletter is owned land. Those email addresses are yours forever. Every subscriber is a direct line to a shipper, broker, or dispatcher who has chosen to hear from you. Over five years, this list becomes one of the most valuable assets you own, more valuable than the truck of any carrier you book. It's also the only marketing channel where you control the rules.",
      },
      {
        heading: 'What to write about',
        body: "Write about what you see every day that other people in freight don't. A weird load. A lane shifting. A shipper objection and how you handled it. A market signal you noticed before everyone else did. The mistake new brokers make is trying to sound smart. The right move is to sound like the broker on the ground at 7am with coffee, reporting from the field. That's what nobody else is doing, and that's what shippers and dispatchers actually want to read.",
      },
      {
        heading: 'How daily is sustainable',
        body: "Daily sounds insane until you realize each issue is 300 words and based on something that actually happened to you that day. Total time per issue is 20 to 40 minutes once you have a system. The system is: keep a running note throughout the day of anything worth writing about. At 8pm or whenever, pick one item, expand it, send it. Don't aim for masterpieces. Aim for honest, useful, and on time. A consistent C+ newsletter beats an inconsistent A+ newsletter every time, because the C+ one actually shows up.",
      },
      {
        heading: 'What the newsletter feeds back into',
        body: "Subscribers become inbound leads for the brokerage. Issues become content for the social brand. Stories become case studies for the SaaS pitch. Reader replies become market intelligence. A single newsletter touches four other units on this map. That's why it's worth the daily discipline.",
      },
    ],
  },
  content: {
    title: 'Content brand',
    subtitle: 'The inbound flywheel',
    sections: [
      {
        heading: 'What this unit does',
        body: "Your content brand on LinkedIn, X, and short video is the wider funnel. The newsletter is for people who already trust you. The content brand is how people find you in the first place. It's the discovery layer. Done right, it generates inbound leads, attracts hires, builds your reputation in the industry, and gives you optionality you don't currently have.",
      },
      {
        heading: 'The channel that matters most for you',
        body: "LinkedIn. Period. That's where shippers, brokers, dispatchers, and freight executives actually are. X and short video are nice supplements but LinkedIn is where the money is for freight. Post three times a week minimum. Engage daily. Comment thoughtfully on other freight people's posts. Within a year of consistent posting, you'll have a presence that no cold email could buy. The compounding here is real and patient.",
      },
      {
        heading: 'Content that actually works in freight',
        body: "Three formats. One, lessons from real loads, told as short stories. Two, contrarian takes on freight industry conventional wisdom. Three, direct, useful tactical posts: 'here's how to handle X, here's why most brokers miss Y.' Avoid generic motivational content. Avoid pure self-promotion. The goal is that a shipper reads your post and thinks 'this person actually knows what they're doing, I want them on my freight.'",
      },
      {
        heading: 'How it ties back to everything else',
        body: "Content brand feeds newsletter subscribers, which feeds shipper relationships, which feed loads through the brokerage, which feed stories for more content. The loop is real. The loop only starts working after about six months of consistent posting. Most people quit at month three because they haven't seen results. The ones who push through to month nine see results that don't stop.",
      },
    ],
  },
  saas: {
    title: 'SaaS product',
    subtitle: 'The second leg of the table',
    sections: [
      {
        heading: 'What this unit eventually becomes',
        body: "A CRM built specifically for small freight brokers who can't afford McLeod or Aljex and don't need their complexity. Subagent-powered lead generation, simple pipeline management, load tracking, rate con generation, all priced to fit a one-to-five-person operation. This is the product that, once it has a hundred customers paying a hundred dollars a month, replaces your freight income and lets you decide whether you even still want to broker loads. That's the optionality you're working toward.",
      },
      {
        heading: 'When to start selling it',
        body: "Not yet. The single biggest mistake you could make right now is trying to sell this CRM before you've used it for six months on your own freight. The version that exists in your head today is missing the scars that only come from running real loads through it. Build it for yourself first. Break it. Fix it. Add what's missing. Remove what doesn't get used. After six months you'll have a product that other brokers will actually pay for because it was built by someone who lives the problem.",
      },
      {
        heading: 'The early go-to-market plan',
        body: "Your first ten customers come from your newsletter and content brand, not from cold sales. They come from freight people who've watched you build this in public for a year and who reach out asking if they can try it. That's the cheapest, most pre-qualified customer acquisition you'll ever do. Charge them. Don't give it away free for feedback. Free customers are the worst customers. Paid customers tell you the truth.",
      },
      {
        heading: 'The five-year arc',
        body: "Year one and two, internal tool only. Year three, first paying customers from your audience. Year four, dedicated focus on growing it to a hundred customers, hire a developer, you handle support and roadmap. Year five, either you're running it as a standalone business making real money, or you've grown it enough to sell it. Both outcomes are good. That's the second leg of the table the future-self story described. This is the unit that gets you to the financial independence you described in your original message.",
      },
    ],
  },
  success: {
    title: 'Customer success',
    subtitle: 'The retention compounder',
    sections: [
      {
        heading: 'Why this unit is underrated',
        body: "Every freight broker is obsessed with new customers. Almost none of them are obsessed with keeping the customers they have. That's the gap you exploit. A shipper who books you twice is worth more than three new shippers who book you once. A shipper who books you monthly for two years is worth more than a hundred cold emails ever will be. Customer success is the highest-margin revenue you'll ever earn because the acquisition cost was already paid the first time.",
      },
      {
        heading: 'What systematic customer success looks like in freight',
        body: "Weekly check-ins with your top shippers, even when there's no load to discuss. Proactive market updates when you see something that affects their lanes. Remembering what they care about, their kid's name, their preferred carrier types, their pickup preferences. Sending the rate con before they ask. Following up after delivery to confirm everything was clean. None of this is sexy. All of it compounds. After two years of doing this with twenty shippers, those twenty shippers are an income floor that nothing in the market can take from you.",
      },
      {
        heading: 'How this feeds the rest of the map',
        body: "Retained shippers refer other shippers. Retained shippers become case studies for the content brand. Retained shippers are the first people who'd consider trying your SaaS. Retained shippers tolerate price increases. Retained shippers are forgiving when something goes wrong. Every other unit on this map gets easier when customer success is working, and harder when it isn't.",
      },
      {
        heading: 'The thing nobody talks about',
        body: "Customer success is also self-care for the broker. New customer acquisition is exhausting and emotionally taxing. Retained customers are energizing because the relationship is real. If you're burnt out, the fastest way back to enjoying freight is to spend a week just talking to your existing shippers, no pitches, no quotes, just relationship maintenance. Try it. You'll feel different by Friday.",
      },
    ],
  },
};

const NODES = [
  { id: 'leadgen',    label: 'Lead gen subagents',  sub1: 'Shipper discovery, scoring', sub2: 'Outbound sequencing',         x: 40,  y: 100, w: 200, h: 80,  color: 'teal' },
  { id: 'crm',        label: 'Custom CRM',          sub1: 'Pipeline, load tracker',     sub2: 'Rate confirmations, history', x: 440, y: 100, w: 200, h: 80,  color: 'purple' },
  { id: 'saas',       label: 'SaaS product',        sub1: 'CRM for small brokers',      sub2: 'Future second leg',           x: 40,  y: 350, w: 160, h: 80,  color: 'blue' },
  { id: 'core',       label: 'AFUO brokerage',      sub1: 'MC 1136566 · DOT 3471790',   sub2: 'Last mile emergency coverage', sub3: 'The creative engine', x: 240, y: 340, w: 200, h: 100, color: 'amber', center: true },
  { id: 'success',    label: 'Customer success',    sub1: 'Retention, repeat lanes',    sub2: 'Word of mouth referrals',     x: 480, y: 350, w: 160, h: 80,  color: 'green' },
  { id: 'newsletter', label: 'Daily newsletter',    sub1: 'Lanes, market, ops insights',sub2: 'Owned audience asset',        x: 40,  y: 600, w: 200, h: 80,  color: 'coral' },
  { id: 'content',    label: 'Content brand',       sub1: 'LinkedIn, X, short video',   sub2: 'Inbound flywheel',            x: 440, y: 600, w: 200, h: 80,  color: 'pink' },
];

const COLORS = {
  amber:  { fill: '#FAEEDA', stroke: '#BA7517', title: '#633806', sub: '#854F0B' },
  teal:   { fill: '#E1F5EE', stroke: '#1D9E75', title: '#085041', sub: '#0F6E56' },
  purple: { fill: '#EEEDFE', stroke: '#7F77DD', title: '#3C3489', sub: '#534AB7' },
  blue:   { fill: '#E6F1FB', stroke: '#378ADD', title: '#0C447C', sub: '#185FA5' },
  green:  { fill: '#EAF3DE', stroke: '#639922', title: '#27500A', sub: '#3B6D11' },
  coral:  { fill: '#FAECE7', stroke: '#D85A30', title: '#712B13', sub: '#993C1D' },
  pink:   { fill: '#FBEAF0', stroke: '#D4537E', title: '#72243E', sub: '#993556' },
};

const ARROWS = [
  // Lead gen <-> Core
  { x1: 180, y1: 180, x2: 288, y2: 340, color: '#1D9E75', label: 'qualified shippers',   lx: 218, ly: 248, anchor: 'start',  solid: true },
  { x1: 270, y1: 345, x2: 195, y2: 195, color: '#1D9E75', label: 'lane data back',       lx: 228, ly: 282, anchor: 'start',  solid: false },
  // CRM <-> Core
  { x1: 500, y1: 180, x2: 395, y2: 340, color: '#534AB7', label: 'structure, automation',lx: 468, ly: 248, anchor: 'end',    solid: true },
  { x1: 410, y1: 345, x2: 515, y2: 195, color: '#534AB7', label: 'load history, contacts',lx: 458, ly: 282, anchor: 'end',   solid: false },
  // Lead gen <-> CRM (top horizontal)
  { x1: 240, y1: 140, x2: 440, y2: 140, color: '#5F5E5A', label: 'leads enriched in CRM',lx: 340, ly: 132, anchor: 'middle', solid: false },
  // Newsletter <-> Core
  { x1: 200, y1: 600, x2: 288, y2: 440, color: '#D85A30', label: 'authority, inbound',   lx: 220, ly: 540, anchor: 'start',  solid: true },
  { x1: 270, y1: 440, x2: 200, y2: 600, color: '#D85A30', label: 'stories, case studies',lx: 218, ly: 572, anchor: 'start',  solid: false },
  // Content <-> Core
  { x1: 480, y1: 600, x2: 395, y2: 440, color: '#D4537E', label: 'audience, demand',     lx: 468, ly: 540, anchor: 'end',    solid: true },
  { x1: 410, y1: 440, x2: 480, y2: 600, color: '#D4537E', label: 'raw material to post', lx: 458, ly: 572, anchor: 'end',    solid: false },
  // SaaS <-> Core
  { x1: 200, y1: 390, x2: 240, y2: 390, color: '#185FA5', solid: true },
  { x1: 240, y1: 402, x2: 200, y2: 402, color: '#185FA5', solid: false },
  // Success <-> Core
  { x1: 480, y1: 390, x2: 440, y2: 390, color: '#3B6D11', solid: true },
  { x1: 440, y1: 402, x2: 480, y2: 402, color: '#3B6D11', solid: false },
];

const ARROW_LABELS_STANDALONE = [
  { x: 220, y: 448, anchor: 'middle', color: '#0C447C', text: 'proves the tool works' },
  { x: 460, y: 448, anchor: 'middle', color: '#27500A', text: 'retains and refers' },
  { x: 340, y: 592, anchor: 'middle', color: '#444441', text: 'newsletter promotes social posts' },
];

const STORAGE_KEY = 'afuo_strategy_last_unit';

type DeepDiveKey = keyof typeof DEEP_DIVES;
type ColorKey = keyof typeof COLORS;

export default function StrategyMap() {
  const [activeUnit, setActiveUnit] = useState<DeepDiveKey | null>(null);

  useEffect(() => {
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (last && last in DEEP_DIVES) setActiveUnit(last as DeepDiveKey);
    } catch (_) {}
  }, []);

  const openUnit = (id: DeepDiveKey) => {
    setActiveUnit(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
  };

  const closeUnit = () => setActiveUnit(null);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>AFUO freight empire — strategy map</h1>
          <p style={styles.sub}>Disney 1957 model · every unit feeds every other unit · click any node for the deep dive</p>
        </div>
        <div style={styles.legend}>
          <div style={styles.legendRow}><span style={{...styles.legendLine, borderTopStyle: 'solid'}} />primary value flow</div>
          <div style={styles.legendRow}><span style={{...styles.legendLine, borderTopStyle: 'dashed'}} />feedback loop</div>
        </div>
      </header>

      <div style={styles.canvas}>
        <svg width="100%" viewBox="0 0 680 720" role="img" aria-label="AFUO freight empire strategy map">
          <defs>
            <marker id="afuoArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>

          <text x="340" y="28" textAnchor="middle" style={styles.svgTitle}>AFUO freight empire</text>
          <text x="340" y="46" textAnchor="middle" style={styles.svgSub}>Every unit feeds every other unit</text>

          {ARROWS.map((a, i) => (
            <g key={`arr-${i}`}>
              <line
                x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
                stroke={a.color}
                strokeWidth={a.solid ? 1 : 0.7}
                strokeDasharray={a.solid ? undefined : '3 3'}
                markerEnd="url(#afuoArrow)"
              />
              {a.label && (
                <text x={a.lx} y={a.ly} textAnchor={a.anchor as "start" | "middle" | "end"} fill={a.color} style={styles.arrowLabel}>
                  {a.label}
                </text>
              )}
            </g>
          ))}

          {ARROW_LABELS_STANDALONE.map((l, i) => (
            <text key={`lbl-${i}`} x={l.x} y={l.y} textAnchor={l.anchor as "start" | "middle" | "end"} fill={l.color} style={styles.arrowLabel}>
              {l.text}
            </text>
          ))}

          {NODES.map((n) => {
            const c = COLORS[n.color as ColorKey];
            const cx = n.x + n.w / 2;
            return (
              <g key={n.id} onClick={() => openUnit(n.id as DeepDiveKey)} style={{ cursor: 'pointer' }}>
                <rect
                  x={n.x} y={n.y} width={n.w} height={n.h}
                  rx={n.center ? 14 : 12}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={n.center ? 1 : 0.5}
                />
                <text x={cx} y={n.y + (n.center ? 32 : 28)} textAnchor="middle" fill={c.title} style={styles.nodeTitle}>
                  {n.label}
                </text>
                <text x={cx} y={n.y + (n.center ? 52 : 48)} textAnchor="middle" fill={c.sub} style={styles.nodeSub}>
                  {n.sub1}
                </text>
                {n.sub2 && (
                  <text x={cx} y={n.y + (n.center ? 70 : 66)} textAnchor="middle" fill={c.sub} style={styles.nodeSub}>
                    {n.sub2}
                  </text>
                )}
                {n.sub3 && (
                  <text x={cx} y={n.y + 88} textAnchor="middle" fill={c.sub} style={styles.nodeSub}>
                    {n.sub3}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {activeUnit && (
        <DeepDiveDrawer unit={DEEP_DIVES[activeUnit as DeepDiveKey]} unitId={activeUnit} onClose={closeUnit} />
      )}
    </div>
  );
}

type UnitData = typeof DEEP_DIVES[DeepDiveKey];

function DeepDiveDrawer({ unit, unitId, onClose }: { unit: UnitData; unitId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div style={styles.scrim} onClick={onClose} />
      <aside style={styles.drawer} role="dialog" aria-label={unit.title}>
        <div style={styles.drawerHeader}>
          <div>
            <div style={styles.drawerEyebrow}>{unitId}</div>
            <h2 style={styles.drawerTitle}>{unit.title}</h2>
            <div style={styles.drawerSubtitle}>{unit.subtitle}</div>
          </div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">×</button>
        </div>
        <div style={styles.drawerBody}>
          {(unit.sections as { heading: string; body: string }[]).map((s, i) => (
            <section key={i} style={styles.section}>
              <h3 style={styles.sectionHeading}>{s.heading}</h3>
              <p style={styles.sectionBody}>{s.body}</p>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: '#1a1a1a',
    padding: '24px',
    maxWidth: '1100px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  h1: { margin: 0, fontSize: '22px', fontWeight: 500 },
  sub: { margin: '6px 0 0', fontSize: '13px', color: '#5F5E5A' },
  legend: { fontSize: '12px', color: '#5F5E5A' },
  legendRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' },
  legendLine: { display: 'inline-block', width: '24px', borderTopWidth: '1px', borderTopColor: '#5F5E5A' },
  canvas: {
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '12px',
    padding: '16px',
  },
  svgTitle: { fontSize: '14px', fontWeight: 500, fill: '#1a1a1a' },
  svgSub: { fontSize: '12px', fill: '#5F5E5A' },
  nodeTitle: { fontSize: '14px', fontWeight: 500 },
  nodeSub: { fontSize: '12px' },
  arrowLabel: { fontSize: '12px' },
  scrim: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40,
  },
  drawer: {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: 'min(560px, 92vw)',
    background: '#fff',
    boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px 24px 16px',
    borderBottom: '1px solid rgba(0,0,0,0.08)',
  },
  drawerEyebrow: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888780', marginBottom: '4px',
  },
  drawerTitle: { margin: 0, fontSize: '20px', fontWeight: 500 },
  drawerSubtitle: { fontSize: '13px', color: '#5F5E5A', marginTop: '4px' },
  closeBtn: {
    background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer',
    color: '#5F5E5A', padding: '4px 8px', lineHeight: 1,
  },
  drawerBody: { padding: '8px 24px 32px', overflowY: 'auto', flex: 1 },
  section: { margin: '20px 0' },
  sectionHeading: { fontSize: '15px', fontWeight: 500, margin: '0 0 8px' },
  sectionBody: { fontSize: '14px', lineHeight: 1.7, color: '#2C2C2A', margin: 0 },
};

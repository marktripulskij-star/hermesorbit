// sections.jsx — landing page sections for Ultemir

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } = React;

// Where all "Sign up / Login / Start free trial" CTAs point. The app's
// AuthGate handles whether to show login or signup based on session state.
const APP_URL = 'https://app.hermesorbit.com';
const FOUNDER_EMAIL = 'support@hermesorbit.com';

// ── Nav ──────────────────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useS(false);
  useE(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      backdropFilter: 'blur(16px) saturate(140%)',
      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
      background: scrolled ? 'color-mix(in oklab, var(--bg) 78%, transparent)' : 'transparent',
      borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      transition: 'all 200ms ease',
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 64,
      }}>
        <Logo size={26} />
        <nav style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {['Features', 'Pricing'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} style={{
              fontSize: 13.5, color: 'var(--text-2)', fontWeight: 500,
              transition: 'color 120ms',
            }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
            >{l}</a>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Btn variant="ghost" size="sm" href={APP_URL}>Login</Btn>
          <Btn variant="primary" size="sm" href={APP_URL}>Start free →</Btn>
        </div>
      </div>
    </header>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="grid-bg" style={{
      position: 'relative', overflow: 'hidden',
      paddingTop: 90, paddingBottom: 110,
    }}>
      {/* Lime glow */}
      <div style={{
        position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)',
        width: 900, height: 600, pointerEvents: 'none',
        background: 'radial-gradient(closest-side, color-mix(in oklab, var(--accent) 18%, transparent), transparent 70%)',
        filter: 'blur(40px)',
      }} />
      <div className="container" style={{ position: 'relative' }}>
        {/* Status pill */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <a href="#features" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '6px 6px 6px 14px', borderRadius: 999,
            background: 'var(--surface)', border: '1px solid var(--border)',
            fontSize: 12.5, color: 'var(--text-2)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: 'var(--accent)',
              boxShadow: '0 0 0 4px var(--accent-dim)',
            }} />
            New: Image-prompt critique pass v2
            <span style={{
              padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2)',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
            }}>v0.18 →</span>
          </a>
        </div>

        <h1 style={{
          fontSize: 'clamp(44px, 6.4vw, 88px)', lineHeight: 0.98,
          fontWeight: 600, letterSpacing: '-0.035em',
          textAlign: 'center', margin: 0, textWrap: 'balance',
        }}>
          Generate the Meta ads<br />
          your competitors{' '}
          <span style={{
            fontStyle: 'italic', fontWeight: 500,
            color: 'var(--accent)',
          }}>wish</span>{' '}
          they could.
        </h1>

        <p style={{
          maxWidth: 620, margin: '28px auto 0', textAlign: 'center',
          fontSize: 18, lineHeight: 1.5, color: 'var(--text-2)',
          textWrap: 'balance',
        }}>
          Drop in your brand. We crawl your site, extract 20 testing angles
          rooted in real customer language, and ship dozens of ads — copy and
          image — that a senior performance marketer would actually run.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 36 }}>
          <Btn variant="primary" size="lg" href={APP_URL}>Start free — 30 credits, no card</Btn>
          <Btn variant="soft" size="lg" href="#features">See how it works</Btn>
        </div>

        <div style={{
          textAlign: 'center', marginTop: 18, fontSize: 12.5,
          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
        }}>
          ~$0.12/ad · 60s onboarding · cancel any time
        </div>

        {/* Hero visual */}
        <div style={{ marginTop: 80 }}>
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}

// ── Hero animated demo ───────────────────────────────────────────────────
// Stylized window that streams a generation in real time — terminal feel +
// rendered ad output on the right. Loops every ~12s.
function HeroDemo() {
  const STEPS = [
    { t: 0,    line: '$ hermes generate --angle "tired-of-greasy" --format hook-stat' },
    { t: 600,  line: '✓ Loaded brief: Maren Skin · 14 products · 7 avatars' },
    { t: 1200, line: '→ Drafting hook (gpt-4o)…' },
    { t: 2400, line: '✓ Hook: "Your moisturizer is making it worse."' },
    { t: 2900, line: '→ Critic pass (claude-sonnet)…' },
    { t: 4100, line: '  voice 9/10 · hook 9/10 · mechanism 8/10 · cta 9/10' },
    { t: 4500, line: '→ Generating image (1024² · high)…' },
    { t: 7200, line: '✓ Done in 6.4s · 4 credits · queued: 11' },
  ];
  const [phase, setPhase] = useS(0);
  useE(() => {
    let tid;
    const tick = (i) => {
      if (i >= STEPS.length) {
        tid = setTimeout(() => { setPhase(0); tick(0); }, 3500);
        return;
      }
      setPhase(i);
      tid = setTimeout(() => tick(i + 1), (STEPS[i + 1]?.t || STEPS[i].t + 1500) - STEPS[i].t);
    };
    tick(0);
    return () => clearTimeout(tid);
  }, []);

  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      boxShadow: '0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in oklab, var(--accent) 10%, transparent)',
      overflow: 'hidden',
    }}>
      {/* Window chrome */}
      <div style={{
        height: 36, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 14px',
        gap: 10, background: 'color-mix(in oklab, var(--surface-2) 60%, var(--surface))',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: '#3a3a3a' }} />
          <span style={{ width: 10, height: 10, borderRadius: 999, background: '#3a3a3a' }} />
          <span style={{ width: 10, height: 10, borderRadius: 999, background: '#3a3a3a' }} />
        </div>
        <div style={{
          flex: 1, textAlign: 'center', fontSize: 11.5,
          fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
        }}>
          maren-skin · build · angle 03 of 20
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10.5,
          fontFamily: 'var(--font-mono)', color: 'var(--accent)',
          background: 'var(--accent-dim)', fontWeight: 600,
        }}>LIVE</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', minHeight: 440 }}>
        {/* Terminal pane */}
        <div style={{
          padding: 22, fontFamily: 'var(--font-mono)', fontSize: 12.5,
          lineHeight: 1.7, color: 'var(--text-2)',
          borderRight: '1px solid var(--border)',
        }}>
          {STEPS.slice(0, phase + 1).map((s, i) => {
            const isLast = i === phase;
            const c = s.line.startsWith('✓') ? 'var(--accent)'
                    : s.line.startsWith('→') ? 'var(--text)'
                    : s.line.startsWith('$') ? 'var(--text-3)'
                    : s.line.startsWith('  ') ? 'var(--text-3)'
                    : 'var(--text-2)';
            return (
              <div key={i} style={{
                color: c,
                opacity: isLast ? 1 : 0.85,
                animation: isLast ? 'fadeIn 280ms ease both' : 'none',
                whiteSpace: 'pre',
              }}>
                {s.line}
                {isLast && i < STEPS.length - 1 && (
                  <span style={{
                    display: 'inline-block', width: 7, height: 13, marginLeft: 4,
                    verticalAlign: 'middle', background: 'var(--accent)',
                    animation: 'blink 800ms steps(2) infinite',
                  }} />
                )}
              </div>
            );
          })}

          {/* Footer status row */}
          <div style={{
            position: 'absolute', left: 22, bottom: 18, right: '46%',
            display: 'flex', gap: 14, fontSize: 11,
            color: 'var(--text-4)', borderTop: '1px solid var(--border)',
            paddingTop: 12, flexWrap: 'wrap',
          }}>
            <span>credits <b style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>214</b></span>
            <span>queue <b style={{ color: 'var(--text-2)' }}>11</b></span>
            <span>this run <b style={{ color: 'var(--text-2)' }}>6.4s</b></span>
          </div>
        </div>

        {/* Ad output pane */}
        <div style={{
          padding: 22, display: 'flex', flexDirection: 'column', gap: 14,
          background: 'color-mix(in oklab, var(--surface-2) 40%, var(--surface))',
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <FunnelBadge stage="MOFU" />
            <span style={{
              padding: '3px 8px', borderRadius: 999, fontSize: 10.5,
              fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
              background: 'var(--surface)', border: '1px solid var(--border)',
              fontWeight: 600, letterSpacing: '0.04em',
            }}>HOOK · STAT</span>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'center',
            opacity: phase >= 6 ? 1 : 0.15,
            transition: 'opacity 600ms',
          }}>
            <MockAd palette="sage" size={220} fluid
              headline="Your moisturizer is making it worse."
              sub="73% of breakouts post-30 are barrier issues, not bacteria." />
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ScoreChip label="hook" score={9} />
            <ScoreChip label="voice" score={9} />
            <ScoreChip label="mech" score={8} />
            <ScoreChip label="cta" score={9} />
          </div>

          <div style={{
            display: 'flex', gap: 8, marginTop: 'auto',
          }}>
            <Btn variant="primary" size="sm">Approve</Btn>
            <Btn variant="soft" size="sm">↺ Rerun</Btn>
            <Btn variant="ghost" size="sm">✨ Edit</Btn>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

// ── Logos / social proof strip ───────────────────────────────────────────
function ProofStrip() {
  const brands = ['Maren', 'Foldwell', 'Northkit', 'Loamy', 'Halverson', 'Pebble & Co.', 'Thirdshore'];
  return (
    <section style={{ padding: '60px 0 20px', borderTop: '1px solid var(--border)' }}>
      <div className="container">
        <div style={{
          textAlign: 'center', fontSize: 12, fontFamily: 'var(--font-mono)',
          color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em',
          marginBottom: 28,
        }}>Used by 1,400+ DTC brands and operators</div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: 'clamp(24px, 4vw, 56px)', alignItems: 'center',
          opacity: 0.55,
        }}>
          {brands.map(b => (
            <span key={b} style={{
              fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em',
              color: 'var(--text-2)',
            }}>{b}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Founder story ────────────────────────────────────────────────────────
function FounderStory() {
  return (
    <section id="founder" style={{ paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)' }}>
      <div className="container grid-2" style={{
        alignItems: 'start',
      }}>
        <div>
          <Eyebrow num={1}>From the founder</Eyebrow>
          {/* Founder portrait */}
          <div style={{
            marginTop: 22, width: '100%', maxWidth: 280, aspectRatio: '4 / 5', borderRadius: 12,
            border: '1px solid var(--border)',
            position: 'relative', overflow: 'hidden',
            background: '#161616',
          }}>
            <img src="assets/founder.jpeg" alt="Cyrus Vakil"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ marginTop: 18, fontSize: 14, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Cyrus Vakil</div>
            <div style={{ color: 'var(--text-3)' }}>Founder · 19 yr/old engineer & marketer</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {[
                // Instagram — clean Lucide-style: rounded square + lens circle + flash dot
                { href: 'https://www.instagram.com/thecyrusvakil/', label: 'Instagram',
                  svg: <>
                    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" fill="none"/>
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" fill="none"/>
                    <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor"/>
                  </> },
                // YouTube — rounded badge + play triangle
                { href: 'https://www.youtube.com/@thecyrusvakil', label: 'YouTube',
                  svg: <>
                    <rect x="2" y="5" width="20" height="14" rx="4" stroke="currentColor" strokeWidth="1.7" fill="none"/>
                    <path d="M10 9 L10 15 L15.5 12 Z" fill="currentColor"/>
                  </> },
                // X (Twitter) — actual X logo path, filled stylized strokes
                { href: 'https://x.com/cyrus_vakil', label: 'X',
                  svg: <path d="M17.53 3H20.5l-6.46 7.39L21.5 21h-5.94l-4.65-6.07L5.6 21H2.6l6.95-7.96L2.5 3h6.07l4.21 5.56L17.53 3Zm-1.04 16.2h1.65L7.62 4.7H5.85l10.64 14.5Z" fill="currentColor"/> },
              ].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener" title={s.label}
                  style={{
                    width: 32, height: 32, borderRadius: 7,
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-2)', transition: 'all 140ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>{s.svg}</svg>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div style={{ paddingTop: 4, fontSize: 18, lineHeight: 1.55, color: 'var(--text-2)', maxWidth: 640 }}>
          <p style={{ margin: 0, color: 'var(--text)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.4 }}>
            I started running Meta ads because I had to make my own brands work.
            After spending thousands testing products, creatives, funnels, and
            landing pages, one thing became obvious: the ad is usually the bottleneck.
          </p>
          <p style={{ marginTop: 22 }}>
            Every AI tool I tried made the same generic ads. Big claims, weak hooks,
            fake-sounding copy, and no real understanding of the product, customer,
            or angle. It could write words, but it couldn't think like someone who
            had actually spent money testing ads and watching what failed.
          </p>
          <p>
            So I built Hermes around the workflow I wanted myself. It takes in your
            site, product, and brand context, builds a real creative brief, finds
            angles worth testing, writes the ads, critiques them, and rewrites the
            weak ones before you waste budget on them.
          </p>
          <p style={{ color: 'var(--text)' }}>
            It is not meant to replace taste. It is meant to give builders a faster
            way to turn real product context into ads that are actually worth testing.
          </p>

          <div style={{
            marginTop: 36, padding: '20px 24px',
            borderLeft: '2px solid var(--accent)',
            background: 'var(--accent-dim)',
            borderRadius: '0 8px 8px 0',
            fontSize: 15, color: 'var(--text)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', display: 'block', marginBottom: 6, letterSpacing: '0.05em' }}>
              WHAT'S DIFFERENT
            </span>
            Hermes does not just generate copy. It researches, writes, scores, and
            improves every ad so you can spend less time fixing AI slop and more
            time testing creatives.
          </div>
        </div>
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: 'Drop in your docs and website.',
      body: 'Paste a URL, upload brand guidelines, anything you have. We crawl, extract, and classify.',
      mock: <Step1Mock />,
    },
    {
      n: 2,
      title: 'We build the brief and surface 20 angles.',
      body: 'Avatars, pains, desires, proof points, voice. Plus 20 testing angles grouped by funnel stage and rooted in real customer language.',
      mock: <Step2Mock />,
    },
    {
      n: 3,
      title: 'Generate dozens of ads with one click.',
      body: 'Pick angles, pick formats, hit Generate all. Each ad is critiqued by a second AI before it lands in your library.',
      mock: <Step3Mock />,
    },
  ];
  return (
    <section id="features" style={{ paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)' }}>
      <div className="container">
        <div style={{ marginBottom: 64 }}>
          <Eyebrow num={2}>How it works</Eyebrow>
          <h2 style={{
            fontSize: 'clamp(36px, 4.6vw, 56px)', fontWeight: 600,
            letterSpacing: '-0.03em', lineHeight: 1.02, margin: '18px 0 0',
            maxWidth: 720, textWrap: 'balance',
          }}>
            From cold URL to running ads in under{' '}
            <span style={{ color: 'var(--accent)' }}>two minutes</span>.
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{
              display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 60,
              alignItems: 'center',
              padding: 32, border: '1px solid var(--border)',
              borderRadius: 16, background: 'var(--surface)',
            }}>
              <div style={{ order: i % 2 === 0 ? 1 : 2 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: 'var(--accent)', fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.06em', fontWeight: 600,
                }}>
                  STEP {String(s.n).padStart(2, '0')}
                </div>
                <h3 style={{
                  margin: '12px 0 14px', fontSize: 30, fontWeight: 600,
                  letterSpacing: '-0.02em', lineHeight: 1.1,
                  textWrap: 'balance', maxWidth: 460,
                }}>{s.title}</h3>
                <p style={{
                  margin: 0, color: 'var(--text-2)', fontSize: 16,
                  lineHeight: 1.55, maxWidth: 460,
                }}>{s.body}</p>
              </div>
              <div style={{ order: i % 2 === 0 ? 2 : 1 }}>
                {s.mock}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Step1Mock() {
  const lines = [
    { c: 'var(--accent)', t: '✓ marenskin.com fetched · 14ms' },
    { c: 'var(--text-2)', t: '→ /products · found 14 SKUs' },
    { c: 'var(--text-2)', t: '→ /about · extracting voice…' },
    { c: 'var(--accent)', t: '✓ 7 avatars identified' },
    { c: 'var(--text-2)', t: '→ /faq · pulling proof points' },
    { c: 'var(--text-3)', t: '  scraping reviews (2,341)' },
    { c: 'var(--accent)', t: '✓ palette: 4 colors · 2 fonts' },
  ];
  return (
    <div style={{
      borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)',
      padding: 18, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)',
          color: 'var(--text-2)', flex: 1, fontSize: 12,
        }}>
          https://marenskin.com
        </div>
        <span style={{ color: 'var(--accent)' }}>● crawling</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.c }}>{l.t}</div>
      ))}
      <div style={{
        marginTop: 14, height: 4, background: 'var(--surface-2)',
        borderRadius: 999, overflow: 'hidden',
      }}>
        <div style={{ width: '74%', height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function Step2Mock() {
  const angles = [
    { stage: 'TOFU', pain: 'Spent $400 on serums and looks worse.' },
    { stage: 'TOFU', pain: 'Doesn\'t want a 12-step routine.' },
    { stage: 'MOFU', pain: 'Tried "natural" brands, broke out worse.' },
    { stage: 'MOFU', pain: 'Quietly skeptical of clean-beauty claims.' },
    { stage: 'BOFU', pain: 'On the fence — needs a 30-day case.' },
  ];
  return (
    <div style={{
      borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>20 angles</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FunnelBadge stage="TOFU" />
          <FunnelBadge stage="MOFU" />
          <FunnelBadge stage="BOFU" />
        </div>
      </div>
      {angles.map((a, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', borderRadius: 8,
          background: i === 1 ? 'var(--accent-dim)' : 'var(--surface-2)',
          border: i === 1 ? '1px solid color-mix(in oklab, var(--accent) 50%, transparent)' : '1px solid transparent',
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4,
            border: '1px solid var(--border-strong)',
            background: i === 1 ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-on)', fontSize: 11, fontWeight: 700,
          }}>{i === 1 ? '✓' : ''}</span>
          <FunnelBadge stage={a.stage} />
          <span style={{ fontSize: 13, color: 'var(--text-2)', flex: 1 }}>{a.pain}</span>
        </div>
      ))}
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, textAlign: 'right' }}>
        + 15 more
      </div>
    </div>
  );
}

function Step3Mock() {
  return (
    <div style={{
      borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)',
      padding: 18,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, fontSize: 13,
      }}>
        <span style={{ fontWeight: 600 }}>Generating · 8 selected</span>
        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          5 of 8 done
        </span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
      }}>
        {[
          { p: 'sage', s: 'done' }, { p: 'blush', s: 'done' }, { p: 'sand', s: 'done' },
          { p: 'rose', s: 'done' }, { p: 'cream', s: 'done' }, { p: 'moss', s: 'gen' },
          { p: 'citrus', s: 'gen' }, { p: 'night', s: 'queue' },
        ].map((it, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <div style={{
              aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden',
              background: it.s === 'queue' ? 'var(--surface-2)' : 'transparent',
              opacity: it.s === 'done' ? 1 : it.s === 'gen' ? 0.5 : 0.25,
              filter: it.s === 'gen' ? 'blur(2px)' : 'none',
              border: '1px solid var(--border)',
            }}>
              {it.s !== 'queue' && (
                <MockAd palette={it.p} fluid />
              )}
            </div>
            {it.s === 'gen' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10.5, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
              }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 999,
                  border: '2px solid var(--accent)', borderRightColor: 'transparent',
                  animation: 'spin 800ms linear infinite',
                }} />
              </div>
            )}
            {it.s === 'queue' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)',
              }}>queued</div>
            )}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Format library ───────────────────────────────────────────────────────
function FormatLibrary() {
  const formats = [
    { stage: 'TOFU', name: 'Hook · Stat',         desc: 'Lead with a specific, surprising number.' },
    { stage: 'TOFU', name: 'Pattern Interrupt',   desc: 'Contradict the category default.' },
    { stage: 'TOFU', name: 'Quiet Confession',    desc: 'First-person, awkwardly specific.' },
    { stage: 'TOFU', name: 'Founder POV',         desc: 'Direct camera, story-mode.' },
    { stage: 'TOFU', name: 'Side-by-Side',        desc: 'Yours vs theirs, no waffle.' },
    { stage: 'TOFU', name: 'Mythbust',            desc: 'Frame the wrong belief, flip it.' },
    { stage: 'TOFU', name: 'Listicle Top',        desc: '"3 things people get wrong about ___."' },
    { stage: 'TOFU', name: 'Cold Demo',           desc: 'Product on camera, no music, no edit.' },
    { stage: 'MOFU', name: 'Mechanism',           desc: 'Why it works, in one diagram.' },
    { stage: 'MOFU', name: 'Review Stitch',       desc: 'Three customer quotes, one frame.' },
    { stage: 'MOFU', name: 'Founder Reply',       desc: 'Reply to a real comment.' },
    { stage: 'MOFU', name: 'Hero Comparison',     desc: 'You vs the leader. Cite specifics.' },
    { stage: 'MOFU', name: 'Build Story',         desc: 'How we engineered it, told tightly.' },
    { stage: 'MOFU', name: 'Spec Sheet',          desc: 'Mono-styled facts, no fluff.' },
    { stage: 'MOFU', name: 'Editorial Photo',     desc: 'Moodboard with one strong claim.' },
    { stage: 'BOFU', name: 'Risk Reversal',       desc: 'Money back, named conditions.' },
    { stage: 'BOFU', name: 'Bundle Math',         desc: 'Show the per-unit savings.' },
    { stage: 'BOFU', name: 'Scarcity Honest',     desc: 'A real reason, not a fake clock.' },
    { stage: 'BOFU', name: 'Social Stack',        desc: 'Press logos + 3 stats above the fold.' },
    { stage: 'BOFU', name: 'Last Objection',      desc: 'Name the doubt, answer it cold.' },
  ];
  const [filter, setFilter] = useS('All');
  const filtered = filter === 'All' ? formats : formats.filter(f => f.stage === filter);
  const counts = formats.reduce((a, f) => (a[f.stage] = (a[f.stage] || 0) + 1, a), {});

  return (
    <section style={{
      paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)',
      borderTop: '1px solid var(--border)',
    }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 24, marginBottom: 36 }}>
          <div>
            <Eyebrow num={3}>Format library</Eyebrow>
            <h2 style={{
              fontSize: 'clamp(36px, 4.6vw, 56px)', fontWeight: 600,
              letterSpacing: '-0.03em', lineHeight: 1.02,
              margin: '18px 0 0', maxWidth: 760, textWrap: 'balance',
            }}>
              20 battle-tested formats, grouped by funnel stage.
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'TOFU', 'MOFU', 'BOFU'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '8px 12px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 600,
                border: '1px solid ' + (filter === f ? 'var(--accent)' : 'var(--border)'),
                background: filter === f ? 'var(--accent-dim)' : 'transparent',
                color: filter === f ? 'var(--accent)' : 'var(--text-2)',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                transition: 'all 120ms ease',
              }}>
                {f} {f !== 'All' && (
                  <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[f]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-4">
          {filtered.map((f, i) => (
            <Card key={f.name} hoverGlow style={{
              padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
              minHeight: 144,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <FunnelBadge stage={f.stage} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-4)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{f.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.45 }}>{f.desc}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Sample ads ───────────────────────────────────────────────────────────
function SampleAds() {
  const ads = [
    { p: 'sage',   h: 'Your moisturizer is making it worse.',     s: '73% of post-30 breakouts are barrier issues.', stage: 'MOFU', score: 9 },
    { p: 'blush',  h: 'Stop layering. Start replacing.',          s: '12-step routines fail 4 out of 5 buyers.',     stage: 'TOFU', score: 9 },
    { p: 'cream',  h: 'I sold the rest of my routine.',            s: 'Founder · 38 · Brooklyn',                       stage: 'MOFU', score: 8 },
    { p: 'moss',   h: 'The serum that pays for the others.',     s: 'Bundle math: $74 → $148 of value.',              stage: 'BOFU', score: 9 },
    { p: 'rose',   h: 'Clean beauty failed me twice.',             s: 'Then I read the back of the bottle.',          stage: 'TOFU', score: 9 },
    { p: 'sand',   h: 'Made for skin that\'s been through it.',  s: '30-day guarantee. No restocking fee.',          stage: 'BOFU', score: 9 },
  ];
  return (
    <section style={{ paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)' }}>
      <div className="container">
        <div style={{ marginBottom: 48, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 24 }}>
          <div>
            <Eyebrow num={4}>Sample output</Eyebrow>
            <h2 style={{
              fontSize: 'clamp(36px, 4.6vw, 56px)', fontWeight: 600,
              letterSpacing: '-0.03em', lineHeight: 1.02, margin: '18px 0 0',
              maxWidth: 760, textWrap: 'balance',
            }}>
              The work speaks for itself.
            </h2>
            <p style={{ marginTop: 14, color: 'var(--text-2)', maxWidth: 540, fontSize: 16 }}>
              Real generations from a Maren Skin test brand. Copy, image, and critique
              all generated in under 7 seconds per ad.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" size="md" href={APP_URL}>Try it on your brand →</Btn>
          </div>
        </div>

        <div className="grid-3">
          {ads.map((a, i) => (
            <Card key={i} hoverGlow style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <MockAd palette={a.p} fluid headline={a.h} sub={a.s} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 0' }}>
                <FunnelBadge stage={a.stage} />
                <ScoreChip label="overall" score={a.score} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pricing ──────────────────────────────────────────────────────────────
function Pricing() {
  const tiers = [
    {
      name: 'Solo', price: 19, credits: 200,
      tag: 'For 1 brand, 1 founder',
      features: ['1 brand · 200 credits/mo', 'All 20 formats', 'Image + copy generation', 'Critic pass on every ad', 'CSV export'],
      cta: 'Start free trial',
    },
    {
      name: 'Operator', price: 49, credits: 600, popular: true,
      tag: 'Most teams pick this',
      features: ['3 brands · 600 credits/mo', 'Everything in Solo', 'Side-by-side compare', 'Library multi-select export', 'Priority generation queue', 'Slack notifications'],
      cta: 'Start free trial',
    },
    {
      name: 'Studio', price: 149, credits: 2000,
      tag: 'Agencies, 3-15 brands',
      features: ['15 brands · 2,000 credits/mo', 'Everything in Operator', 'Workspace roles', 'Brand voice profiles', 'White-label PDF reports', 'Webhooks'],
      cta: 'Start free trial',
    },
    {
      name: 'Scale', price: 'Custom', credits: 'Pooled',
      tag: 'In-house perf teams',
      features: ['Unlimited brands', 'Pooled credits across team', 'API access', 'Custom format library', 'Dedicated CSM', 'SOC 2 + DPA'],
      cta: 'Talk to founder',
    },
  ];

  const [annual, setAnnual] = useS(true);

  return (
    <section id="pricing" style={{
      paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)',
      borderTop: '1px solid var(--border)',
    }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Eyebrow num={5}>Pricing</Eyebrow>
          <h2 style={{
            fontSize: 'clamp(36px, 4.6vw, 56px)', fontWeight: 600,
            letterSpacing: '-0.03em', lineHeight: 1.02, margin: '18px 0 0',
            textWrap: 'balance',
          }}>
            Pay for ads, not per seat.
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: 16, marginTop: 14 }}>
            Credits cover copy + image + critique. ~$0.12/ad on Operator.
          </p>

          <div style={{
            display: 'inline-flex', marginTop: 28, padding: 4,
            borderRadius: 999, background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}>
            {[['Monthly', false], ['Annual · save 20%', true]].map(([l, v]) => (
              <button key={l} onClick={() => setAnnual(v)} style={{
                padding: '7px 16px', borderRadius: 999,
                fontSize: 12.5, fontWeight: 600,
                background: annual === v ? 'var(--accent)' : 'transparent',
                color: annual === v ? 'var(--accent-on)' : 'var(--text-2)',
                transition: 'all 160ms',
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div className="grid-4" style={{ alignItems: 'stretch' }}>
          {tiers.map(t => {
            const price = typeof t.price === 'number'
              ? Math.round(t.price * (annual ? 0.8 : 1))
              : t.price;
            return (
              <div key={t.name} style={{
                position: 'relative',
                background: t.popular ? 'var(--surface)' : 'var(--surface)',
                border: t.popular
                  ? '1px solid color-mix(in oklab, var(--accent) 60%, var(--border))'
                  : '1px solid var(--border)',
                borderRadius: 14, padding: 24,
                display: 'flex', flexDirection: 'column', gap: 18,
                boxShadow: t.popular
                  ? '0 0 0 4px var(--accent-dim), 0 24px 48px -16px rgba(0,0,0,0.4)'
                  : 'none',
              }}>
                {t.popular && (
                  <span style={{
                    position: 'absolute', top: -10, left: 24,
                    padding: '3px 10px', borderRadius: 999,
                    background: 'var(--accent)', color: 'var(--accent-on)',
                    fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700,
                    letterSpacing: '0.06em',
                  }}>POPULAR</span>
                )}
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{t.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>{t.tag}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  {typeof price === 'number' ? (
                    <>
                      <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.025em' }}>${price}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/mo</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>{price}</span>
                  )}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-3)',
                  paddingBottom: 14, borderBottom: '1px solid var(--border)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {typeof t.credits === 'number' ? `${t.credits.toLocaleString()} credits / mo` : `${t.credits} credits`}
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                  {t.features.map(f => (
                    <li key={f} style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                      fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.45,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0, marginTop: 3 }}>
                        <path d="M3 8.2 L6.5 11.5 L13 4.5" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Btn
                  variant={t.popular ? 'primary' : 'soft'}
                  size="md"
                  href={t.cta === 'Talk to founder' ? `mailto:${FOUNDER_EMAIL}` : APP_URL}
                >{t.cta}</Btn>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────
function FAQ() {
  const items = [
    { q: 'How does it actually work?', a: 'You give us a URL and any brand docs. We crawl your site, extract products and voice, mine your reviews, and build a brief. From the brief we generate 20 testing angles. You pick what to run; we draft copy, critique it, regenerate weak parts, and produce the image.' },
    { q: 'Will it sound like my brand?', a: 'Yes — we extract your voice from your existing copy and reviews before generating anything. Every ad is critiqued on a "voice" axis and rewritten if it scores below 7/10.' },
    { q: 'What does it cost per ad?', a: 'A standard ad on Operator runs ~$0.12 — that\'s 4 credits for copy, critique, and a high-quality square image. Higher-quality images cost more credits; copy-only generations cost less.' },
    { q: 'Can I edit what it generates?', a: 'Every field is inline-editable. There\'s also an AI-edit popover on every text field — say "punchier" or "shorter" and it rewrites just that field for ~1 credit.' },
    { q: 'How is this different from a ChatGPT prompt?', a: 'Three things: a brand brief built from your real site (not "imagine you sell skincare"), a 20-angle library rooted in your customer language, and a critic pass that catches the slop before you see it.' },
    { q: 'Do you train on my data?', a: 'No. Your brand brief, ads, and uploads are stored encrypted, used only for your account, and deleted on request. We don\'t fine-tune on customer data.' },
    { q: 'Can I export to Meta Ads Manager?', a: 'Yes. Library has multi-select export to a Meta-formatted CSV: headline, primary text, description, CTA, image URL, per row.' },
    { q: 'What if I\'m an agency with 8 brands?', a: 'Studio is built for you. 15 brands in one workspace, pooled credits, white-label PDF reports for client review, role-based permissions.' },
  ];
  const [open, setOpen] = useS(0);
  return (
    <section style={{ paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)' }}>
      <div className="container grid-2" style={{
        alignItems: 'start',
      }}>
        <div style={{ position: 'sticky', top: 100 }}>
          <Eyebrow num={6}>FAQ</Eyebrow>
          <h2 style={{
            fontSize: 'clamp(34px, 4.2vw, 48px)', fontWeight: 600,
            letterSpacing: '-0.03em', lineHeight: 1.05,
            margin: '18px 0 18px', textWrap: 'balance',
          }}>
            Questions performance marketers ask first.
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: 15, lineHeight: 1.55, margin: 0 }}>
            Still on the fence? Email{' '}
            <a href="mailto:support@hermesorbit.com" style={{ color: 'var(--accent)' }}>support@hermesorbit.com</a>{' '}
            — replies usually under 4 hours.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)' }}>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <button key={i} onClick={() => setOpen(isOpen ? -1 : i)} style={{
                textAlign: 'left', borderBottom: '1px solid var(--border)',
                padding: '22px 0', display: 'block', cursor: 'pointer',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
                }}>
                  <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.015em', color: 'var(--text)' }}>
                    {it.q}
                  </span>
                  <span style={{
                    width: 22, height: 22, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isOpen ? 'var(--accent)' : 'var(--text-3)',
                    transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
                    transition: 'transform 200ms, color 160ms',
                    fontSize: 22, lineHeight: 1, fontWeight: 300,
                  }}>+</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateRows: isOpen ? '1fr' : '0fr',
                  transition: 'grid-template-rows 240ms ease',
                }}>
                  <div style={{ overflow: 'hidden' }}>
                    <p style={{
                      margin: '14px 0 0', color: 'var(--text-2)', fontSize: 15,
                      lineHeight: 1.6, maxWidth: 640,
                    }}>
                      {it.a}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Final CTA + Footer ───────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="grid-bg" style={{
      paddingTop: 'var(--section-py)', paddingBottom: 'var(--section-py)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(closest-side, color-mix(in oklab, var(--accent) 16%, transparent), transparent 60%)',
        top: '40%', left: '50%', width: 800, height: 500,
        transform: 'translate(-50%, -50%)', filter: 'blur(60px)',
      }} />
      <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
        <h2 style={{
          fontSize: 'clamp(48px, 6vw, 84px)', fontWeight: 600,
          letterSpacing: '-0.035em', lineHeight: 0.98,
          margin: 0, textWrap: 'balance', maxWidth: 900, marginInline: 'auto',
        }}>
          Stop fixing AI slop.<br />
          <span style={{ color: 'var(--accent)' }}>Start shipping</span> ads.
        </h2>
        <p style={{
          maxWidth: 520, margin: '24px auto 0', fontSize: 17, color: 'var(--text-2)', lineHeight: 1.5,
        }}>
          30 free credits. No card. Generate your first 8 ads in the next 5 minutes.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32 }}>
          <Btn variant="primary" size="lg" href={APP_URL}>Start free trial →</Btn>
          <Btn variant="soft" size="lg" href={`mailto:${FOUNDER_EMAIL}?subject=Hermes%20walkthrough`}>Book a 15-min walkthrough</Btn>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', padding: '56px 0 40px' }}>
      <div className="container" style={{
        display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 48,
      }}>
        <div>
          <Logo size={26} />
          <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.55, marginTop: 14, maxWidth: 280 }}>
            AI ad generation for DTC brands that ship.
          </p>
          <div style={{ marginTop: 18, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>
            <span style={{ color: 'var(--success)' }}>● </span>
            All systems normal
          </div>
        </div>
        {[
          ['Product', [
            { l: 'Features',     h: '#features' },
            { l: 'Pricing',      h: '#pricing' },
            { l: 'Sign up',      h: APP_URL },
            { l: 'Login',        h: APP_URL },
          ]],
          ['Company', [
            { l: 'Founder note', h: '#founder' },
            { l: 'Contact',      h: `mailto:${FOUNDER_EMAIL}` },
          ]],
          ['Legal', [
            { l: 'Privacy',      h: 'privacy.html' },
            { l: 'Terms',        h: 'terms.html' },
          ]],
        ].map(([h, ls]) => (
          <div key={h}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14,
            }}>{h}</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ls.map(({ l, h: href }) => (
                <li key={l}>
                  <a href={href} style={{ color: 'var(--text-2)', fontSize: 14 }}>{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="container" style={{
        marginTop: 56, paddingTop: 24, borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 12.5, color: 'var(--text-4)',
      }}>
        <span>© 2026 Hermes, Inc.</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>v0.18.2 · build a4f1c0</span>
      </div>
    </footer>
  );
}

Object.assign(window, {
  Nav, Hero, ProofStrip, FounderStory, HowItWorks,
  FormatLibrary, SampleAds, Pricing, FAQ, FinalCTA, Footer,
});

// app.jsx — root + tweaks wiring

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "regular",
  "accent": "orbit"
}/*EDITMODE-END*/;

const ACCENTS = {
  orbit:   { dark: { a: '#55d6e0', a2: '#2f7dff', dim: 'rgba(85,214,224,0.12)', on: '#0a0a0a' },
             light:{ a: '#0f74c9', a2: '#2558ff', dim: 'rgba(15,116,201,0.12)', on: '#ffffff' } },
  lime:    { dark: { a: '#c5ff3d', a2: '#a5e62a', dim: 'rgba(197,255,61,0.12)', on: '#0a0a0a' },
             light:{ a: '#7cc814', a2: '#69ad0d', dim: 'rgba(124,200,20,0.12)', on: '#ffffff' } },
  electric:{ dark: { a: '#7cf0ff', a2: '#5ad6e8', dim: 'rgba(124,240,255,0.12)', on: '#0a0a0a' },
             light:{ a: '#0aa9c4', a2: '#088fa6', dim: 'rgba(10,169,196,0.12)', on: '#ffffff' } },
  ember:   { dark: { a: '#ff8a3d', a2: '#e07025', dim: 'rgba(255,138,61,0.12)', on: '#0a0a0a' },
             light:{ a: '#d35a0e', a2: '#b54a08', dim: 'rgba(211,90,14,0.12)', on: '#ffffff' } },
  iris:    { dark: { a: '#c79bff', a2: '#a878e6', dim: 'rgba(199,155,255,0.12)', on: '#0a0a0a' },
             light:{ a: '#7438c9', a2: '#5e2bb0', dim: 'rgba(116,56,201,0.12)', on: '#ffffff' } },
};

function applyTweaks(t) {
  const root = document.documentElement;
  root.dataset.theme = t.theme;
  root.dataset.density = t.density;
  const a = ACCENTS[t.accent]?.[t.theme] || ACCENTS.orbit.dark;
  root.style.setProperty('--accent', a.a);
  root.style.setProperty('--accent-2', a.a2);
  root.style.setProperty('--accent-dim', a.dim);
  root.style.setProperty('--accent-on', a.on);
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => { applyTweaks(t); }, [t]);

  return (
    <>
      <Nav />
      <Hero />
      {/* ProofStrip — hidden until real customer logos / counts exist.
          Re-enable once you have 5+ named brands using Ultemir. */}
      {/* <ProofStrip /> */}
      <FounderStory />
      <HowItWorks />
      <FormatLibrary />
      <SampleAds />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme" />
        <TweakRadio label="Mode" value={t.theme}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(v) => setTweak('theme', v)} />
        <TweakSelect label="Accent" value={t.accent}
          options={[
            { value: 'orbit', label: 'Orbit cyan (default)' },
            { value: 'lime', label: 'Lime' },
            { value: 'electric', label: 'Electric blue' },
            { value: 'ember', label: 'Ember orange' },
            { value: 'iris', label: 'Iris purple' },
          ]}
          onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'regular', label: 'Regular' },
            { value: 'comfortable', label: 'Roomy' },
          ]}
          onChange={(v) => setTweak('density', v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

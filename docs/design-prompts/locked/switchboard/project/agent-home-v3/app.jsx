// Shared app — both Alex Home and Riley Home use this.
// Reads window.AGENT.canvas for title/subtitle/states/variant-options,
// and window.STATES for the data keyed by state.
//
// The diff between Alex Home v2.html and Riley Home v2.html is just the
// agent-specific script imports (sprites + config + data) loaded before this.

const STATE_KEYS = (window.AGENT && window.AGENT.canvas && window.AGENT.canvas.states.map(s => s.key)) || [];
const STATE_META = {};
((window.AGENT && window.AGENT.canvas && window.AGENT.canvas.states) || []).forEach(s => { STATE_META[s.key] = s; });

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "default",
  "showOne": "all",
  "showMobile": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(DEFAULTS);
  const AC = (window.AGENT && window.AGENT.canvas) || {};
  const variantOptions = AC.variantOptions || [{ value: 'default', label: 'Default' }];
  const variant = t.variant === 'default' ? variantOptions[0].value
                : variantOptions.find(o => o.value === t.variant) ? t.variant
                : variantOptions[0].value;
  const focus = t.showOne || 'all';
  const showMobile = t.showMobile !== false;
  const visible = focus === 'all' ? STATE_KEYS : [focus];

  return (
    <React.Fragment>
      <DesignCanvas
        title={AC.title || 'Agent cockpit'}
        subtitle={AC.subtitle || ''}
        bg={AC.bg || '#ECE7DA'}
      >
        <DCSection id="desktop" title="Desktop · 1180 wide">
          {visible.map(k => (
            <DCArtboard key={k} id={`d-${k}`}
              label={STATE_META[k]?.label || k}
              width={1180}
              height={STATE_META[k]?.desktopHeight || 1080}>
              <AgentHome stateKey={k} variant={variant} mode="desktop" />
            </DCArtboard>
          ))}
        </DCSection>
        {showMobile && (
          <DCSection id="mobile" title="Mobile · 390 wide">
            {visible.map(k => (
              <DCArtboard key={k} id={`m-${k}`}
                label={STATE_META[k]?.label || k}
                width={390}
                height={STATE_META[k]?.mobileHeight || 1480}>
                <AgentHome stateKey={k} variant={variant} mode="mobile" />
              </DCArtboard>
            ))}
          </DCSection>
        )}
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Show">
          <TweakSelect label="State" value={focus}
            options={[
              { value: 'all', label: 'All side by side' },
              ...STATE_KEYS.map(k => ({ value: k, label: STATE_META[k]?.label || k })),
            ]}
            onChange={(v) => setTweak('showOne', v)} />
          <TweakToggle label="Show mobile artboards" value={showMobile} onChange={(v) => setTweak('showMobile', v)} />
        </TweakSection>
        <TweakSection label="Avatar">
          <TweakRadio label="Sprite" value={variant}
            options={variantOptions}
            onChange={(v) => setTweak('variant', v)} />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

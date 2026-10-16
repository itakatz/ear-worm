'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const DEGREES = ['1', '♭9', '9', '♭3', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7'];
const TRIADS = {
  major: { label: 'Major', tones: [0, 4, 7] }, minor: { label: 'Minor', tones: [0, 3, 7] },
  diminished: { label: 'Diminished', tones: [0, 3, 6] }, augmented: { label: 'Augmented', tones: [0, 4, 8] },
} as const;
const EXTRAS = {
  none: { label: 'None', interval: null }, seven: { label: 'Major 7', interval: 11 }, flat7: { label: '7', interval: 10 },
} as const;
type Triad = keyof typeof TRIADS;
type Extra = keyof typeof EXTRAS;
const chordIntervals = (triad: Triad, extra: Extra): number[] => [...TRIADS[triad].tones, ...(EXTRAS[extra].interval === null ? [] : [EXTRAS[extra].interval])];
const PRESETS: Record<string, { label: string; intervals: number[]; triad?: Triad; extra?: Extra }> = {
  chord: { label: 'Chord tones', intervals: [0, 4, 7] },
  major: { label: 'Major / Ionian', intervals: [0, 2, 4, 5, 7, 9, 11], triad: 'major', extra: 'seven' },
  mixolydian: { label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], triad: 'major', extra: 'flat7' },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], triad: 'minor', extra: 'flat7' },
  minor: { label: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10], triad: 'minor', extra: 'flat7' },
  harmonic: { label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11], triad: 'minor', extra: 'seven' },
  blues: { label: 'Minor blues', intervals: [0, 3, 5, 6, 7, 10], triad: 'minor', extra: 'flat7' },
  chromatic: { label: 'Chromatic', intervals: Array.from({ length: 12 }, (_, i) => i) },
};
const INSTRUMENTS = [
  { label: 'Concert pitch', shift: 0 }, { label: 'B♭ instrument', shift: -2 },
  { label: 'E♭ instrument', shift: -9 }, { label: 'F instrument', shift: -7 },
];
type Phase = 'idle' | 'prepare' | 'listen' | 'repeat';
type AdvanceMode = 'auto' | 'manual';
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const mod12 = (value: number) => (value % 12 + 12) % 12;

export default function Home() {
  const [root, setRoot] = useState(7), [triad, setTriad] = useState<Triad>('major'), [extra, setExtra] = useState<Extra>('flat7');
  const [preset, setPreset] = useState('mixolydian'), [pool, setPool] = useState<number[]>(PRESETS.mixolydian.intervals);
  const [length, setLength] = useState(3), [pace, setPace] = useState(1), [replyTime, setReplyTime] = useState(7);
  const [transpose, setTranspose] = useState(0), [volume, setVolume] = useState(.5), [droneLevel, setDroneLevel] = useState(.8);
  const [advanceMode, setAdvanceMode] = useState<AdvanceMode>('auto');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [phase, setPhase] = useState<Phase>('idle'), [phraseNo, setPhraseNo] = useState(0);
  const [active, setActive] = useState<number | null>(null), [countdown, setCountdown] = useState(0);
  const ctx = useRef<AudioContext | null>(null), drone = useRef<{ oscs: OscillatorNode[]; gain: GainNode } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]), running = useRef(false);
  const lastPhrase = useRef<number[]>([]), noteDrought = useRef<Record<number, number>>({}), runPhraseRef = useRef<() => void>(() => {});
  const state = useRef({ root, triad, extra, pool, length, pace, replyTime, transpose, volume, droneLevel, advanceMode });
  useEffect(() => {
    state.current = { root, triad, extra, pool, length, pace, replyTime, transpose, volume, droneLevel, advanceMode };
  }, [root, triad, extra, pool, length, pace, replyTime, transpose, volume, droneLevel, advanceMode]);
  const qualityLabel = `${TRIADS[triad].label}${extra === 'none' ? '' : ` · ${EXTRAS[extra].label}`}`;
  const label = `${NOTES[root]} ${qualityLabel}`;
  const poolNames = useMemo(() => pool.map(i => NOTES[(root + i) % 12]).join(' · '), [pool, root]);
  const canStart = pool.length >= (length > 1 ? 2 : 1);

  const audio = useCallback(async () => {
    if (!ctx.current || ctx.current.state === 'closed') ctx.current = new AudioContext();
    if (ctx.current.state === 'suspended') await ctx.current.resume();
    return ctx.current;
  }, []);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const stopDrone = useCallback(() => {
    if (!drone.current || !ctx.current) return;
    drone.current.gain.gain.setTargetAtTime(0, ctx.current.currentTime, .1);
    drone.current.oscs.forEach(o => { try { o.stop(ctx.current!.currentTime + .6); } catch {} });
    drone.current = null;
  }, []);
  const startDrone = useCallback(async () => {
    const ac = await audio(); stopDrone(); const s = state.current;
    const master = ac.createGain(), filter = ac.createBiquadFilter();
    master.gain.setValueAtTime(.0001, ac.currentTime); master.gain.exponentialRampToValueAtTime(.13 * s.droneLevel, ac.currentTime + .6);
    filter.type = 'lowpass'; filter.frequency.value = 760; filter.Q.value = .45; filter.connect(master).connect(ac.destination);
    const oscs = chordIntervals(s.triad, s.extra).flatMap((interval, i) => ['sine', 'triangle'].map((type, layer) => {
      const osc = ac.createOscillator(), gain = ac.createGain(); osc.type = type as OscillatorType;
      osc.frequency.value = freq(48 + s.root + s.transpose + interval - (i === 0 && layer === 1 ? 12 : 0));
      osc.detune.value = layer ? -4 : 0; gain.gain.value = layer ? .065 : .23; osc.connect(gain).connect(filter); osc.start(); return osc;
    }));
    drone.current = { oscs, gain: master };
  }, [audio, stopDrone]);
  const playNote = useCallback(async (midi: number, seconds: number) => {
    const ac = await audio(), now = ac.currentTime, gain = ac.createGain(), filter = ac.createBiquadFilter();
    const a = ac.createOscillator(), b = ac.createOscillator(), aGain = ac.createGain(), bGain = ac.createGain();
    a.type = 'sine'; b.type = 'triangle'; a.frequency.value = freq(midi); b.frequency.value = freq(midi) * 2;
    aGain.gain.value = .86; bGain.gain.value = .08; filter.type = 'lowpass'; filter.frequency.value = 1500; filter.Q.value = .35;
    const fade = Math.min(.3, seconds * .44), peak = .2 * state.current.volume ** 2;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(peak, now + fade);
    gain.gain.setValueAtTime(peak * .88, now + Math.max(fade, seconds - fade)); gain.gain.linearRampToValueAtTime(0, now + seconds);
    a.connect(aGain).connect(filter); b.connect(bGain).connect(filter); filter.connect(gain).connect(ac.destination);
    a.start(); b.start(); a.stop(now + seconds + .03); b.stop(now + seconds + .03);
  }, [audio]);
  const makePhrase = useCallback(() => {
    const s = state.current;
    const selectedChordTones = new Set(
      chordIntervals(s.triad, s.extra).filter(interval => s.pool.includes(interval)),
    );
    const intervalOf = (midi: number) => mod12(midi - s.transpose - s.root);
    const candidates = Array.from({ length: 24 }, (_, i) => 60 + i)
      .filter(midi => s.pool.includes(intervalOf(midi)));
    const previousShape = lastPhrase.current.map(intervalOf);

    const weightedPick = (list: number[]) => {
      const weights = list.map(midi => {
        const interval = intervalOf(midi);
        const coverageWeight = 1 + Math.min(noteDrought.current[interval] ?? 0, 8) * .9;
        const harmonyWeight = selectedChordTones.has(interval) ? 1.45 : 1;
        return coverageWeight * harmonyWeight;
      });
      let cursor = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
      for (let i = 0; i < list.length; i++) {
        cursor -= weights[i];
        if (cursor <= 0) return list[i];
      }
      return list[list.length - 1];
    };

    const generate = (differentFirst = false) => {
      const result: number[] = [];
      for (let i = 0; i < s.length; i++) {
        const differentPitch = candidates.filter(midi =>
          (i === 0 || intervalOf(midi) !== intervalOf(result[i - 1])) &&
          (!differentFirst || i > 0 || intervalOf(midi) !== previousShape[0]));
        const singable = differentPitch.filter(midi => i === 0 || Math.abs(midi - result[i - 1]) <= 7);
        result.push(weightedPick(singable.length ? singable : differentPitch));
      }
      return result;
    };

    let result = generate();
    const sameAsPrevious = (phrase: number[]) => previousShape.length === phrase.length &&
      phrase.every((midi, i) => intervalOf(midi) === previousShape[i]);
    for (let attempt = 0; sameAsPrevious(result) && attempt < 20; attempt++) result = generate();
    if (sameAsPrevious(result) && s.pool.length > 1) result = generate(true);

    const heard = new Set(result.map(intervalOf));
    s.pool.forEach(interval => {
      noteDrought.current[interval] = heard.has(interval) ? 0 : (noteDrought.current[interval] ?? 0) + 1;
    });
    return result;
  }, []);
  const playPhrase = useCallback((phrase: number[], countAsNew: boolean) => {
    if (!running.current) return; clearTimers(); const s = state.current;
    setPhase('listen'); if (countAsNew) setPhraseNo(n => n + 1); setCountdown(0);
    phrase.forEach((midi, i) => timers.current.push(setTimeout(() => { setActive(i); void playNote(midi, s.pace * 1.08); }, i * s.pace * 1000)));
    const listenMs = phrase.length * s.pace * 1000 + 350;
    timers.current.push(setTimeout(() => {
      setActive(null); setPhase('repeat');
      if (s.advanceMode === 'auto') {
        setCountdown(s.replyTime); let left = s.replyTime;
        const id = setInterval(() => { left--; setCountdown(Math.max(0, left)); if (!left) clearInterval(id); }, 1000);
        timers.current.push(id as unknown as ReturnType<typeof setTimeout>);
      } else setCountdown(0);
    }, listenMs));
    if (s.advanceMode === 'auto') timers.current.push(setTimeout(() => runPhraseRef.current(), listenMs + s.replyTime * 1000));
  }, [clearTimers, playNote]);
  const runPhrase = useCallback(() => {
    const phrase = makePhrase(); lastPhrase.current = phrase; playPhrase(phrase, true);
  }, [makePhrase, playPhrase]);
  useEffect(() => { runPhraseRef.current = runPhrase; }, [runPhrase]);
  const repeatPhrase = useCallback(() => { if (lastPhrase.current.length) playPhrase(lastPhrase.current, false); }, [playPhrase]);
  const start = useCallback(async () => {
    if (!canStart) return;
    running.current = true; lastPhrase.current = []; noteDrought.current = {}; setPhraseNo(0); setActive(null); setPhase('prepare');
    await startDrone();
    timers.current.push(setTimeout(() => runPhraseRef.current(), 2500));
  }, [canStart, startDrone]);
  const stop = useCallback(() => { running.current = false; clearTimers(); stopDrone(); setPhase('idle'); setActive(null); setCountdown(0); }, [clearTimers, stopDrone]);
  useEffect(() => { if (running.current && !canStart) stop(); }, [canStart, stop]);
  useEffect(() => () => {
    running.current = false; clearTimers(); stopDrone();
    const currentContext = ctx.current; ctx.current = null;
    if (currentContext && currentContext.state !== 'closed') void currentContext.close();
  }, [clearTimers, stopDrone]);
  const harmony = (r: number, t: Triad, x: Extra) => {
    setRoot(r); setTriad(t); setExtra(x);
    if (preset === 'chord') setPool(chordIntervals(t, x));
    if (running.current) setTimeout(() => void startDrone(), 0);
  };
  const applyPreset = (key: string) => {
    const next = PRESETS[key], nextTriad = next.triad ?? triad, nextExtra = next.extra ?? extra;
    setPreset(key); setTriad(nextTriad); setExtra(nextExtra);
    setPool(key === 'chord' ? chordIntervals(nextTriad, nextExtra) : next.intervals);
  };
  const toggle = (i: number) => { setPreset('custom'); setPool(p => p.includes(i) ? p.filter(n => n !== i) : [...p, i].sort((a, b) => a - b)); };

  return <main data-theme={theme}>
    <header className="topbar"><div className="brand"><span>e</span>Earworm</div><p>Phrase training over harmony</p><div className="header-actions"><button className="theme-toggle" aria-pressed={theme === 'dark'} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Dark' : 'Light'} theme</button><a className="setup-link" href="#setup">Setup <span>↓</span></a></div></header>
    <div className="shell">
      <section className="practice">
        <div className="eyebrow"><i /> Practice room</div>
        <div className="stage">
          <div className={`orb ${phase !== 'idle' ? 'playing' : ''}`}><div><b>{NOTES[root]}</b><small>{qualityLabel}</small></div>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>
          <div className="phase" aria-live="polite"><small>{phase === 'idle' ? 'Ready when you are' : phase === 'prepare' ? 'The drone is sounding' : `Phrase ${phraseNo}`}</small><h1>{phase === 'idle' ? 'Train your inner ear.' : phase === 'prepare' ? 'Find the harmony…' : phase === 'listen' ? 'Listen…' : 'Your turn'}</h1><p>{phase === 'idle' ? 'Hear it. Hold it. Play it back.' : phase === 'prepare' ? 'Your first phrase begins in 2.5 seconds' : phase === 'listen' ? `${length} notes over ${label}` : advanceMode === 'auto' ? `Play the phrase back · ${countdown}s` : 'Play it back, then continue when ready'}</p></div>
          <div className="dots">{Array.from({ length }, (_, i) => <span className={active === i ? 'active' : ''} key={i}>{i + 1}</span>)}</div>
          {phase === 'repeat' && <div className="wait-actions"><button className="repeat-phrase" onClick={repeatPhrase}>↻ Repeat</button>{advanceMode === 'manual' && <button className="next-phrase" onClick={runPhrase}>Next phrase <span>→</span></button>}</div>}
        </div>
        <div className="transport"><button className="speed" onClick={() => setPace(v => Math.min(3, +(v + .15).toFixed(2)))}>−<small>slower</small></button><button className="play" disabled={!canStart} onClick={phase === 'idle' ? start : stop}>{phase === 'idle' ? '▶  Start session' : '■  Stop session'}</button><button className="speed" onClick={() => setPace(v => Math.max(.45, +(v - .15).toFixed(2)))}>+<small>faster</small></button></div><p className="tempo">About {pace.toFixed(2)} sec per note</p>
      </section>
      <aside className="controls" id="setup">
        <div className="panel-head"><div><span className="eyebrow">Session setup</span><h2>Shape the exercise</h2></div><small>Browser audio</small></div>
        <section><Title n="01" title="Harmony" sub="The drone underneath your phrase"/><div className="harmony-grid"><label>Root<select value={root} onChange={e => harmony(+e.target.value, triad, extra)}>{NOTES.map((n, i) => <option value={i} key={n}>{n}</option>)}</select></label><label>Triad<select value={triad} onChange={e => harmony(root, e.target.value as Triad, extra)}>{Object.entries(TRIADS).map(([k, v]) => <option value={k} key={k}>{v.label}</option>)}</select></label><label>Extra note<select value={extra} onChange={e => harmony(root, triad, e.target.value as Extra)}>{Object.entries(EXTRAS).map(([k, v]) => <option value={k} key={k}>{v.label}</option>)}</select></label></div><div className="chord"><b>∿∿∿</b><span><small>DRONE</small><strong>{label}</strong></span><em>sustained</em></div></section>
        <section><Title n="02" title="Phrase" sub="Choose length and available notes"/><div className="phrase-row"><label>Notes per phrase</label><div className="segments">{[1,2,3,4,5,6].map(n => <button className={length === n ? 'selected' : ''} onClick={() => setLength(n)} key={n}>{n}</button>)}</div></div><label>Note collection<select value={preset} onChange={e => applyPreset(e.target.value)}><option value="custom">Custom selection</option>{Object.entries(PRESETS).map(([k,v]) => <option value={k} key={k}>{v.label}</option>)}</select></label><div className="note-grid">{Array.from({ length: 12 }, (_, i) => { const chosen = pool.includes(i), chordTone = chordIntervals(triad, extra).includes(i), note = NOTES[(root+i)%12]; return <button key={i} aria-label={`${note}, degree ${DEGREES[i]}${chordTone ? ', chord tone' : ''}`} aria-pressed={chosen} className={`${chosen ? 'selected' : ''} ${chordTone ? 'chord-tone' : ''}`} onClick={() => toggle(i)}><b>{note}</b><small>{DEGREES[i]}</small></button>; })}</div>{!canStart && <p className="warning">Choose {length > 1 ? 'at least two notes' : 'a note'} to begin.</p>}</section>
        <section><Title n="03" title="Timing & instrument" sub="Leave room to play it back"/>
          <label className="mode-label">Continue with</label><div className="advance-mode"><button className={advanceMode === 'auto' ? 'selected' : ''} onClick={() => setAdvanceMode('auto')}>After a pause</button><button className={advanceMode === 'manual' ? 'selected' : ''} onClick={() => setAdvanceMode('manual')}>Next phrase button</button></div>
          {advanceMode === 'auto' && <label className="range"><span>Time to repeat <b>{replyTime}s</b></span><input type="range" min="3" max="15" value={replyTime} onChange={e => setReplyTime(+e.target.value)}/></label>}
          <div className="two"><label>Instrument<select value={transpose} onChange={e => { setTranspose(+e.target.value); if (running.current) setTimeout(() => void startDrone(), 0); }}>{INSTRUMENTS.map(x => <option value={x.shift} key={x.label}>{x.label}</option>)}</select></label><label>Note volume · {Math.round(volume * 100)}%<input className="volume" type="range" min=".05" max="1" step=".05" value={volume} onChange={e => setVolume(+e.target.value)}/></label></div>
          <label className="range drone-level"><span>Chord level <b>{Math.round(droneLevel * 100)}%</b></span><input type="range" min=".15" max="1.4" step=".05" value={droneLevel} onChange={e => { setDroneLevel(+e.target.value); if (running.current) setTimeout(() => void startDrone(), 0); }}/></label>
          <p className="hint">Notes are shown as written for your instrument; playback is transposed to concert pitch.</p>
        </section>
      </aside>
    </div><footer><span>{poolNames}</span><span>Runs entirely in your browser</span></footer>
  </main>;
}

function Title({ n, title, sub }: { n: string; title: string; sub: string }) { return <div className="section-title"><span>{n}</span><div><h3>{title}</h3><p>{sub}</p></div></div>; }

import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, GameSnapshot, ShaftEngine } from "./engine";

const STORAGE_KEY = "shaft-best-floor-v1";
const initial: GameSnapshot = { status: "ready", life: CONFIG.maxLife, floor: 0, best: 0, reason: null };

function createBeep() {
  let audio: AudioContext | null = null;
  return (event: "land" | "hurt" | "spring" | "break" | "over") => {
    if (event === "land") return;
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const map = { hurt: [90, .12], spring: [520, .1], break: [155, .07], over: [62, .32] } as const;
    const [frequency, duration] = map[event];
    oscillator.type = event === "spring" ? "square" : "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    gain.gain.setValueAtTime(.05, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration);
  };
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ShaftEngine | null>(null);
  const [state, setState] = useState(initial);
  const soundRef = useRef<ReturnType<typeof createBeep> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stored = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10) || 0;
    soundRef.current = createBeep();
    const engine = new ShaftEngine(canvas, stored, (next) => {
      setState(next);
      if (next.best > stored) localStorage.setItem(STORAGE_KEY, String(next.best));
    }, (event) => soundRef.current?.(event));
    engineRef.current = engine;
    let animation = 0;
    const loop = (time: number) => { engine.frame(time); animation = requestAnimationFrame(loop); };
    animation = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(animation); engineRef.current = null; };
  }, []);

  const start = useCallback(() => engineRef.current?.start(), []);
  const pause = useCallback(() => engineRef.current?.togglePause(), []);

  useEffect(() => {
    const direction = (code: string) => code === "ArrowLeft" || code === "KeyA" ? "left" : code === "ArrowRight" || code === "KeyD" ? "right" : null;
    const down = (event: KeyboardEvent) => {
      const key = direction(event.code);
      if (key) { event.preventDefault(); engineRef.current?.setKey(key, true); }
      if ((event.code === "Enter" || event.code === "Space") && (state.status === "ready" || state.status === "gameover")) { event.preventDefault(); start(); }
      if ((event.code === "Escape" || event.code === "KeyP") && (state.status === "running" || state.status === "paused")) { event.preventDefault(); pause(); }
    };
    const up = (event: KeyboardEvent) => { const key = direction(event.code); if (key) engineRef.current?.setKey(key, false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pause, start, state.status]);

  const heading = state.status === "gameover" ? "挑战结束" : state.status === "paused" ? "暂停中" : "准备下井";
  const message = state.status === "gameover" ? (state.reason === "fell" ? "你消失在井底的黑暗里。" : "尖刺耗尽了你的生命。") : state.status === "paused" ? "喘口气，矿井不会等你太久。" : "从一块平台落向下一块。别被顶上去，也别掉得太急。";

  return (
    <main className="game-page">
      <section className="intro" aria-labelledby="game-title">
        <p className="eyebrow">NOSTALGIC WEB REMAKE · 2026</p>
        <h1 className="title" id="game-title">是男人就下<span>100 层</span></h1>
        <p className="lede">两枚方向键，一条没有尽头的竖井。平台不断升起，你唯一能做的，就是在尖刺落下前继续向下。</p>
        <div className="ledge" aria-hidden="true" />
      </section>

      <section className="machine" data-testid="game-shell" data-status={state.status} aria-label="是男人就下100层游戏机">
        <div className="hud">
          <div className="health-row">
            <div><span className="hud-label">LIFE</span><div className="hearts" aria-label={`生命值 ${state.life}/${CONFIG.maxLife}`}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={`heart ${state.life > index * 2 ? "active" : ""}`} />)}</div></div>
          </div>
          <div className="floor-count"><span className="hud-label">FLOOR</span><span data-testid="floor-count">{String(state.floor).padStart(3, "0")}</span></div>
        </div>
        <div className="screen">
          <canvas ref={canvasRef} width={CONFIG.width} height={CONFIG.height} role="img" aria-label="无尽矿井游戏画面" />
          <div className="scanlines" aria-hidden="true" />
          {state.status !== "running" && <div className="overlay"><div className="overlay-card">
            <p className="overlay-kicker">{state.status === "gameover" ? `本次到达 ${state.floor} 层` : "DIVE INTO THE SHAFT"}</p>
            <h2>{heading}</h2><p>{message}</p>
            <button className="start-button" type="button" onClick={state.status === "paused" ? pause : start}>{state.status === "paused" ? "继续下降" : state.status === "gameover" ? "再来一局" : "开始挑战"}</button>
          </div></div>}
        </div>
        <div className="machine-footer"><span>100 层不是终点</span><button className="pause-button" type="button" onClick={pause} disabled={state.status === "ready" || state.status === "gameover"}>{state.status === "paused" ? "继续 P" : "暂停 P"}</button></div>
        <output className="sr-only" data-testid="game-state">{state.status}:{state.life}:{state.floor}:{state.best}</output>
      </section>

      <aside className="guide" aria-label="操作与平台说明">
        <h2>{"// 操作说明"}</h2>
        <div className="key-row"><span><kbd>←</kbd> <kbd>A</kbd></span><span>向左移动</span></div>
        <div className="key-row"><span><kbd>→</kbd> <kbd>D</kbd></span><span>向右移动</span></div>
        <div className="key-row"><span><kbd>P</kbd></span><span>暂停 / 继续</span></div>
        <div className="legend">
          <div className="legend-item"><i className="swatch" /><span>普通平台 · 恢复生命</span></div>
          <div className="legend-item"><i className="swatch spike" /><span>尖刺平台 · 扣除生命</span></div>
          <div className="legend-item"><i className="swatch belt" /><span>传送带 · 改变位置</span></div>
          <div className="legend-item"><i className="swatch spring" /><span>跳板 · 向上弹起</span></div>
          <div className="legend-item"><i className="swatch fragile" /><span>易碎平台 · 短暂落脚</span></div>
        </div>
        <p className="best">本机纪录<br /><strong data-testid="best-count">{String(state.best).padStart(3, "0")}</strong> 层</p>
      </aside>
    </main>
  );
}

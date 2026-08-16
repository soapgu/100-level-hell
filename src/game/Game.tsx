import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createGameAudio } from "./audio";
import { CONFIG, GameSnapshot, ShaftEngine } from "./engine";
import { DirectionInputController, type InputDirection } from "./input";

const STORAGE_KEY = "shaft-best-floor-v1";
const POSTER_URL = `${import.meta.env.BASE_URL}og.png`;
const initial: GameSnapshot = { status: "ready", life: CONFIG.maxLife, floor: 0, best: 0, reason: null };
export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ShaftEngine | null>(null);
  const [inputController] = useState(() => new DirectionInputController());
  const [state, setState] = useState(initial);
  const [mobileLandscape, setMobileLandscape] = useState(false);

  useEffect(() => {
    inputController.setOnChange((direction, pressed) => engineRef.current?.setKey(direction, pressed));
    return () => inputController.setOnChange(() => {});
  }, [inputController]);

  const releaseAllInputs = useCallback(() => {
    inputController.releaseAll();
  }, [inputController]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stored = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10) || 0;
    const sound = createGameAudio();
    const engine = new ShaftEngine(canvas, stored, (next) => {
      setState(next);
      if (next.best > stored) localStorage.setItem(STORAGE_KEY, String(next.best));
    }, sound.play);
    engineRef.current = engine;
    setState(engine.getSnapshot());
    let animation = 0;
    const loop = (time: number) => { engine.frame(time); animation = requestAnimationFrame(loop); };
    animation = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(animation); releaseAllInputs(); engineRef.current = null; sound.dispose(); };
  }, [releaseAllInputs]);

  const start = useCallback(() => engineRef.current?.start(), []);
  const pause = useCallback(() => engineRef.current?.togglePause(), []);

  useEffect(() => {
    const direction = (code: string) => code === "ArrowLeft" || code === "KeyA" ? "left" : code === "ArrowRight" || code === "KeyD" ? "right" : null;
    const down = (event: KeyboardEvent) => {
      const key = direction(event.code);
      if (key) { event.preventDefault(); inputController.setKeyboard(key, true); }
      if ((event.code === "Enter" || event.code === "Space") && (state.status === "ready" || state.status === "gameover")) { event.preventDefault(); start(); }
      if ((event.code === "Escape" || event.code === "KeyP") && (state.status === "running" || state.status === "paused")) { event.preventDefault(); pause(); }
    };
    const up = (event: KeyboardEvent) => { const key = direction(event.code); if (key) inputController.setKeyboard(key, false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [inputController, pause, start, state.status]);

  useEffect(() => {
    const releaseWhenHidden = () => { if (document.visibilityState === "hidden") releaseAllInputs(); };
    window.addEventListener("blur", releaseAllInputs);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      window.removeEventListener("blur", releaseAllInputs);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
    };
  }, [releaseAllInputs]);

  useEffect(() => {
    if (state.status !== "running") releaseAllInputs();
  }, [releaseAllInputs, state.status]);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse) and (orientation: landscape) and (max-width: 1024px)");
    const updateOrientation = () => {
      setMobileLandscape(media.matches);
      if (!media.matches) return;
      releaseAllInputs();
      if (engineRef.current?.getSnapshot().status === "running") engineRef.current.togglePause();
    };
    updateOrientation();
    media.addEventListener("change", updateOrientation);
    return () => media.removeEventListener("change", updateOrientation);
  }, [releaseAllInputs]);

  const pressTouch = useCallback((direction: InputDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (engineRef.current?.getSnapshot().status !== "running") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    inputController.addPointer(direction, event.pointerId);
  }, [inputController]);

  const releaseTouch = useCallback((direction: InputDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    inputController.removePointer(direction, event.pointerId);
  }, [inputController]);

  const heading = state.status === "gameover" ? "挑战结束" : state.status === "paused" ? "暂停中" : "准备下井";
  const message = state.status === "gameover" ? (state.reason === "fell" ? "你消失在井底的黑暗里。" : "尖刺耗尽了你的生命。") : state.status === "paused" ? "喘口气，矿井不会等你太久。" : "从一块平台落向下一块。别被顶上去，也别掉得太急。";
  const isReady = state.status === "ready";
  const showOverlay = state.status === "ready" || state.status === "paused" || state.status === "gameover";

  return (
    <>
    <main className="game-page" aria-hidden={mobileLandscape || undefined}>
      <section className="intro" aria-labelledby="game-title">
        <p className="eyebrow">NOSTALGIC WEB REMAKE · 2026</p>
        <h1 className="title" id="game-title">是男人就下<span>100 层</span></h1>
        <p className="lede">两枚方向键，一条没有尽头的竖井。平台不断升起，你唯一能做的，就是在尖刺落下前继续向下。</p>
        <div className="ledge" aria-hidden="true" />
      </section>

      <section className="machine" data-testid="game-shell" data-status={state.status} aria-label="是男人就下100层游戏机">
        <div className="hud">
          <div className="health-row">
            <div><span className="hud-label">LIFE</span><div className="hearts" aria-label={`生命值 ${state.life}/${CONFIG.maxLife}`}>{Array.from({ length: Math.ceil(CONFIG.maxLife / 2) }, (_, index) => <i key={index} className={`heart ${state.life > index * 2 ? "active" : ""}`} />)}</div></div>
          </div>
          <div className="floor-count"><span className="hud-label">FLOOR</span><span data-testid="floor-count">{String(state.floor).padStart(3, "0")}</span></div>
        </div>
        <div className="screen" style={{ aspectRatio: `${CONFIG.width} / ${CONFIG.height}` }}>
          <canvas ref={canvasRef} width={CONFIG.width} height={CONFIG.height} role="img" aria-label="无尽矿井游戏画面" />
          <div className="scanlines" aria-hidden="true" />
          <div className="touch-controls" role="group" aria-label="触控方向键">
            <button
              className="touch-control touch-control--left"
              type="button"
              aria-label="向左移动（触控）"
              data-testid="touch-left"
              disabled={state.status !== "running" || mobileLandscape}
              onPointerDown={(event) => pressTouch("left", event)}
              onPointerUp={(event) => releaseTouch("left", event)}
              onPointerCancel={(event) => releaseTouch("left", event)}
              onLostPointerCapture={(event) => releaseTouch("left", event)}
              onContextMenu={(event) => event.preventDefault()}
            ><span aria-hidden="true">◀</span></button>
            <button
              className="touch-control touch-control--right"
              type="button"
              aria-label="向右移动（触控）"
              data-testid="touch-right"
              disabled={state.status !== "running" || mobileLandscape}
              onPointerDown={(event) => pressTouch("right", event)}
              onPointerUp={(event) => releaseTouch("right", event)}
              onPointerCancel={(event) => releaseTouch("right", event)}
              onLostPointerCapture={(event) => releaseTouch("right", event)}
              onContextMenu={(event) => event.preventDefault()}
            ><span aria-hidden="true">▶</span></button>
          </div>
          {showOverlay && <div className="overlay"><div className={`overlay-card${isReady ? " overlay-card--poster" : ""}`}>
            {isReady && <img className="start-poster" src={POSTER_URL} alt="" aria-hidden="true" />}
            <div className="overlay-card-body">
              <p className="overlay-kicker">{state.status === "gameover" ? `本次到达 ${state.floor} 层` : "DIVE INTO THE SHAFT"}</p>
              <h2>{heading}</h2><p>{message}</p>
              <button className="start-button" type="button" onClick={state.status === "paused" ? pause : start}>{state.status === "paused" ? "继续下降" : state.status === "gameover" ? "再来一局" : "开始挑战"}</button>
            </div>
          </div></div>}
        </div>
        <div className="machine-footer"><span>100 层不是终点</span><button className="pause-button" type="button" onClick={pause} disabled={state.status !== "running" && state.status !== "paused"}>{state.status === "paused" ? "继续 P" : "暂停 P"}</button></div>
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
          <div className="legend-item"><i className="swatch belt" /><span>传送带 · 拖动位置，恢复生命</span></div>
          <div className="legend-item"><i className="swatch spring" /><span>跳板 · 向上弹起</span></div>
          <div className="legend-item"><i className="swatch fragile" /><span>易碎平台 · 短暂停留，恢复生命</span></div>
        </div>
        <p className="best">本机纪录<br /><strong data-testid="best-count">{String(state.best).padStart(3, "0")}</strong> 层</p>
      </aside>
    </main>
    {mobileLandscape && <div className="rotate-notice" role="dialog" aria-modal="true" aria-label="请将手机竖屏" data-testid="rotate-notice">
        <span className="rotate-phone" aria-hidden="true" />
        <strong>请将手机竖屏</strong>
        <small>游戏已暂停，旋转后手动继续</small>
      </div>}
    </>
  );
}

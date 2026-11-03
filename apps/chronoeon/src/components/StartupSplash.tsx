import "../styles/startup.css";

/** SVG strokes and composited transforms only; no frame loop or raster assets. */
export function StartupSplash() {
  return <div className="startup-splash" role="status" aria-label="时元 · ChronoEon">
    <div className="startup-emblem">
      <svg viewBox="0 0 1024 1024" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g className="startup-pi" stroke="#24C8DB" strokeWidth="54">
            <path d="M354 462H670" /><path d="M430 462V620Q430 678 372 678M594 462V620Q594 678 652 678" />
          </g>
          <path className="startup-gold-bar" d="M420 324H604" stroke="#FFC131" strokeWidth="54" />
          <path className="startup-orbit" d="M785 326A330 330 0 1 0 829 420" stroke="#24C8DB" strokeWidth="56" pathLength="1" />
        </g>
        <circle className="startup-gold-dot" cx="817" cy="324" r="35" fill="#FFC131" />
      </svg>
      <div className="startup-wordmark"><span lang="zh-CN">时元</span><i>·</i><span lang="en">ChronoEon</span></div>
    </div>
  </div>;
}

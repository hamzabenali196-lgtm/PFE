import { Crosshair } from 'lucide-react';

export default function HeadControls({ headPos, onHeadMove }) {
  function centerHead() {
    onHeadMove('oz', 90);
    onHeadMove('oy', 60);
  }

  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <h2>Head Camera</h2>
      </div>

      <div className="head-section" style={{ paddingTop: 0, borderTop: 'none' }}>
        <div className="head-section-label">
          <span>Orientation</span>
          <button type="button" className="head-center-btn" onClick={centerHead} aria-label="Center head">
            <Crosshair size={14} />
            Center
          </button>
        </div>

        <div className="head-sliders-layout">
          <div className="head-slider-row">
            <div className="head-slider-header">
              <span className="head-slider-label">Pan (Left / Right)</span>
              <strong className="head-slider-val">{headPos.pan}°</strong>
            </div>
            <input
              type="range" min="30" max="150" step="1"
              value={headPos.pan}
              onChange={(e) => onHeadMove('oz', Number(e.target.value))}
              className="head-slider"
              style={{ '--pct': `${(headPos.pan - 30) / 120 * 100}%` }}
              aria-label="Head pan"
            />
            <div className="head-slider-markers"><span>Left</span><span>Right</span></div>
          </div>

          <div className="head-slider-row head-slider-row--tilt">
            <div className="head-slider-header">
              <span className="head-slider-label">Tilt (Up / Down)</span>
              <strong className="head-slider-val">{headPos.tilt}°</strong>
            </div>
            <div className="head-slider-vertical-wrap">
              <span className="head-slider-vlabel">Up</span>
              <div className="head-slider-vertical-track">
                <input
                  type="range" min="0" max="120" step="1"
                  value={headPos.tilt}
                  onChange={(e) => onHeadMove('oy', Number(e.target.value))}
                  className="head-slider head-slider--vertical"
                  style={{ '--pct': `${headPos.tilt / 120 * 100}%` }}
                  aria-label="Head tilt"
                />
              </div>
              <span className="head-slider-vlabel">Down</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

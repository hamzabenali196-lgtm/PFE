import { Hand, SlidersHorizontal } from 'lucide-react';

export default function ServoControls({ onHello }) {
  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Control</p>
          <h2>Motion Control</h2>
        </div>
        <SlidersHorizontal size={22} aria-hidden="true" />
      </div>

      <div className="button-row">
        <button type="button" className="button-primary" onClick={onHello} title="Wave" aria-label="Wave">
          <Hand size={18} aria-hidden="true" />
          <span>Wave</span>
        </button>
      </div>
    </section>
  );
}

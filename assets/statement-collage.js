import { Component } from '@theme/component';

/**
 * @typedef {object} Refs
 * @property {HTMLElement} photos - Wrapper holding the scattered photos.
 */

/**
 * Drifts the photos around a statement as the section crosses the viewport.
 *
 * Each photo carries its own `--collage-speed`; this writes `--collage-shift`
 * so the tilt set in the editor is preserved (the transform composes both).
 * Scroll is sampled on rAF rather than per event, and motion is skipped
 * entirely when the visitor asks for reduced motion.
 *
 * @extends {Component<Refs>}
 */
class StatementCollageComponent extends Component {
  requiredRefs = ['photos'];

  #frame = 0;
  #visible = false;

  /** @type {IntersectionObserver | null} */
  #observer = null;

  connectedCallback() {
    super.connectedCallback();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Only the section on screen pays for the scroll math
    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) this.#visible = entry.isIntersecting;
      if (this.#visible) this.#schedule();
    });
    this.#observer.observe(this);

    window.addEventListener('scroll', this.#schedule, { passive: true });
    window.addEventListener('resize', this.#schedule, { passive: true });
    this.#apply();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#observer?.disconnect();
    window.removeEventListener('scroll', this.#schedule);
    window.removeEventListener('resize', this.#schedule);
    cancelAnimationFrame(this.#frame);
  }

  #schedule = () => {
    if (!this.#visible) return;
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(this.#apply);
  };

  #apply = () => {
    const { top, height } = this.getBoundingClientRect();
    // 0 as the section enters from below, 1 as it leaves past the top
    const progress = (window.innerHeight - top) / (window.innerHeight + height);
    const travel = progress - 0.5;

    for (const photo of this.refs.photos.children) {
      if (!(photo instanceof HTMLElement)) continue;
      const speed = Number(getComputedStyle(photo).getPropertyValue('--collage-speed')) || 0;
      photo.style.setProperty('--collage-shift', `${(travel * speed * -16).toFixed(1)}px`);
    }
  };
}

if (!customElements.get('statement-collage-component')) {
  customElements.define('statement-collage-component', StatementCollageComponent);
}

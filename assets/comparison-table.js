/**
 * Advances the mobile comparison carousel one competitor column per tap of the
 * chevron button, wrapping back to the first column at the end. Desktop shows
 * every column at once, so the button is hidden there by CSS.
 */
class ComparisonTableComponent extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this.#handleClick);
  }

  #handleClick = (event) => {
    const button = /** @type {Element} */ (event.target).closest('.comparison__scroll-hint');
    if (!button) return;

    const columns = this.querySelector('.comparison__columns');
    const first = columns?.firstElementChild;
    if (!columns || !first) return;

    const gap = parseFloat(getComputedStyle(columns).columnGap || '0') || 0;
    const step = first.getBoundingClientRect().width + gap;
    const maxScroll = columns.scrollWidth - columns.clientWidth;
    const atEnd = columns.scrollLeft >= maxScroll - step / 2;

    columns.scrollTo({ left: atEnd ? 0 : columns.scrollLeft + step, behavior: 'smooth' });
  };
}

if (!customElements.get('comparison-table-component')) {
  customElements.define('comparison-table-component', ComparisonTableComponent);
}

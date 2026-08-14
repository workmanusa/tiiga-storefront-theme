/**
 * Keeps the flavor & nutrition section in sync with the variant picker.
 *
 * The section renders one panel per flavor; the panel matching the
 * server-selected variant is visible on load. When the shopper picks a
 * different flavor anywhere on the page, the matching panel is shown and the
 * rest are hidden. The section lives outside product-information, so the
 * picker's change events are observed at the document level.
 */

/**
 * Mirror of Liquid's handleize filter, so panel data attributes written with
 * `| handleize` can be matched against raw option values.
 *
 * @param {string} value
 * @returns {string}
 */
const handleize = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

class FlavorNutritionPanels extends HTMLElement {
  #abortController = new AbortController();

  connectedCallback() {
    document.addEventListener('change', this.#handleChange, { signal: this.#abortController.signal });

    // Server-side, each panel only knows whether it matches the selected
    // flavor. If none matched (product variant has no panel), show the first
    // panel rather than an empty section.
    if (!this.querySelector('.flavor-nutrition__panel:not([hidden])')) {
      const first = this.querySelector('.flavor-nutrition__panel');
      if (first) first.hidden = false;
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  /** @param {Event} event */
  #handleChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.checked) return;

    const optionName = target.dataset.optionName;
    if (!optionName || !optionName.toLowerCase().includes('flavor')) return;

    // The homepage flavor selector reuses the same picker markup — only the
    // PDP's own picker should drive this section.
    if (target.closest('featured-product-information')) return;

    this.#show(handleize(target.value));
  };

  /** @param {string} handle */
  #show(handle) {
    const panels = this.querySelectorAll('.flavor-nutrition__panel');
    const match = [...panels].find((panel) => panel instanceof HTMLElement && panel.dataset.flavorHandle === handle);
    if (!match) return; // no panel for this flavor — keep showing the current one

    for (const panel of panels) {
      panel.hidden = panel !== match;
    }
  }
}

if (!customElements.get('flavor-nutrition-panels')) {
  customElements.define('flavor-nutrition-panels', FlavorNutritionPanels);
}

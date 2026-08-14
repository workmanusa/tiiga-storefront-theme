/**
 * Tab bar that shows one of the featured-product panels that follow it.
 *
 * The component lives in its own section. On connect it collects the
 * `.shopify-section` wrappers of every `featured-product-information` section
 * that immediately follows its own section, pairs them with its tab buttons in
 * order, and toggles visibility. Without JS all panels render stacked, so the
 * content stays reachable.
 */
class FlavorTabsComponent extends HTMLElement {
  /** @type {HTMLElement[]} */
  #panels = [];

  connectedCallback() {
    this.#collectPanels();

    const tabs = this.#tabs;

    for (const [index, tab] of tabs.entries()) {
      const panel = this.#panels[index];

      if (!panel) {
        // More tabs than panels — hide the extras.
        tab.hidden = true;
        continue;
      }

      if (!panel.id) panel.id = `FlavorTabPanel-${index}`;
      panel.classList.add('flavor-tab-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.setAttribute('aria-controls', panel.id);

      // The panel gallery is one still image. The CSS hides the arrows and
      // blocks native scrolling; this stops the component's own pointer-drag,
      // which scrolls programmatically and sails past overflow: hidden.
      for (const slideshow of panel.querySelectorAll('slideshow-component')) {
        slideshow.setAttribute('disabled', 'true');
      }

      tab.addEventListener('click', () => this.#select(index));
      tab.addEventListener('keydown', (event) => this.#handleKeydown(event, index));
    }

    this.#select(0);
  }

  get #tabs() {
    return /** @type {HTMLButtonElement[]} */ (Array.from(this.querySelectorAll('[role="tab"]')));
  }

  #collectPanels() {
    this.#panels = [];

    let node = this.closest('.shopify-section')?.nextElementSibling;

    while (node instanceof HTMLElement && this.#panels.length < this.#tabs.length) {
      if (!node.querySelector('featured-product-information')) break;
      this.#panels.push(node);
      node = node.nextElementSibling;
    }
  }

  /**
   * @param {number} index - Tab index to activate.
   */
  #select(index) {
    for (const [i, tab] of this.#tabs.entries()) {
      const active = i === index;

      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;

      const panel = this.#panels[i];
      if (panel) panel.hidden = !active;
    }
  }

  /**
   * @param {KeyboardEvent} event - Keydown event on a tab.
   * @param {number} index - Index of the tab that received the event.
   */
  #handleKeydown(event, index) {
    const tabs = this.#tabs;
    let target = null;

    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;

    if (target === null) return;

    event.preventDefault();
    this.#select(target);
    tabs[target]?.focus();
  }
}

if (!customElements.get('flavor-tabs-component')) {
  customElements.define('flavor-tabs-component', FlavorTabsComponent);
}

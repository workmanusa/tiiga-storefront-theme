import { Component } from '@theme/component';

/**
 * @typedef {Object} Refs
 * @property {HTMLAnchorElement[]} navLinks - Anchor links in the sticky "Shop by" bar.
 * @property {HTMLElement[]} rows - Collection row sections the links target.
 */

/**
 * The unified shop page: a sticky "Shop by" bar whose links smooth-scroll to
 * collection rows on the same page, with the active link tracked from scroll
 * position. Navigation never leaves the page, so every /collections URL keeps
 * rendering the same content.
 *
 * @extends {Component<Refs>}
 */
class ShopCollections extends Component {
  /** @type {IntersectionObserver | undefined} */
  #observer;

  /** @type {Set<Element>} */
  #visibleRows = new Set();

  connectedCallback() {
    super.connectedCallback();

    const rows = this.refs.rows ?? [];
    if (rows.length === 0) return;

    // A band around the vertical center of the viewport decides the active
    // row, which works no matter which element is the scroll container
    // (Horizon scrolls .page-wrapper on desktop, the window on mobile).
    this.#observer = new IntersectionObserver((entries) => this.#handleIntersections(entries), {
      rootMargin: '-35% 0px -55% 0px',
    });

    for (const row of rows) this.#observer.observe(row);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#observer?.disconnect();
    this.#visibleRows.clear();
  }

  /**
   * Smooth-scrolls to the row for a clicked nav link instead of letting the
   * browser jump, keeping the URL free of full navigations.
   *
   * @param {MouseEvent} event
   */
  handleNavClick = (event) => {
    // The delegated listener proxies `target` to the element carrying the
    // on:click attribute, so this is the anchor even for descendant hits.
    const link = event.target;
    if (!(link instanceof HTMLAnchorElement)) return;

    const targetId = link.hash.slice(1);
    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', link.hash);
    this.#setActiveLink(targetId);
  };

  /**
   * @param {IntersectionObserverEntry[]} entries
   */
  #handleIntersections(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        this.#visibleRows.add(entry.target);
      } else {
        this.#visibleRows.delete(entry.target);
      }
    }

    const rows = this.refs.rows ?? [];
    const topmost = rows.find((row) => this.#visibleRows.has(row));
    if (topmost) this.#setActiveLink(topmost.id);
  }

  /**
   * @param {string} rowId
   */
  #setActiveLink(rowId) {
    for (const link of this.refs.navLinks ?? []) {
      if (link.hash.slice(1) === rowId) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }
}

if (!customElements.get('shop-collections')) {
  customElements.define('shop-collections', ShopCollections);
}

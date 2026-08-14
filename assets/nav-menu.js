import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { lockScroll, unlockScroll } from '@theme/utilities';

/**
 * The Tiiga navigation menu.
 *
 * One DOM tree serves two presentations (see blocks/_nav-menu.liquid):
 * - Drawer mode (small screens / touch devices): a hamburger button opens a
 *   slide-out panel where each `details` menu item behaves as an accordion.
 * - Menu mode (desktop): items render inline in the header and each `details`
 *   opens a full-width mega panel below the header row.
 *
 * This component owns the drawer open/close state and closes open mega panels
 * on outside clicks and Escape. Accordion behavior itself is native
 * `details`/`summary` (exclusive via the `name` attribute).
 *
 * @typedef {object} Refs
 * @property {HTMLButtonElement} [hamburger] - The drawer trigger button.
 * @property {HTMLElement} panel - The drawer panel / inline menu wrapper.
 *
 * @extends {Component<Refs>}
 */
class NavMenu extends Component {
  requiredRefs = ['panel'];

  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    document.addEventListener('pointerdown', this.#onDocumentPointerDown, { signal });
    this.addEventListener('keydown', this.#onKeyDown, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  get isOpen() {
    return this.classList.contains('nav-menu--open');
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  open() {
    this.classList.add('nav-menu--open');
    this.refs.hamburger?.setAttribute('aria-expanded', 'true');
    lockScroll(this);

    // Expand the merchant-chosen default section (e.g. Shop) when the drawer opens.
    const defaultOpen = this.querySelector('details[data-default-open]');
    if (defaultOpen instanceof HTMLDetailsElement) defaultOpen.open = true;

    trapFocus(this.refs.panel);
  }

  close() {
    if (!this.isOpen) {
      this.#closeSubmenus();
      return;
    }

    this.classList.remove('nav-menu--open');
    this.refs.hamburger?.setAttribute('aria-expanded', 'false');
    unlockScroll(this);
    removeTrapFocus();
    this.#closeSubmenus();
    this.refs.hamburger?.focus();
  }

  #closeSubmenus() {
    for (const details of this.querySelectorAll('details[open]')) {
      details.removeAttribute('open');
    }
  }

  /**
   * Close open mega panels when clicking outside the menu (desktop).
   * @param {PointerEvent} event
   */
  #onDocumentPointerDown = (event) => {
    if (this.isOpen) return;
    if (event.target instanceof Node && this.contains(event.target)) return;

    this.#closeSubmenus();
  };

  /**
   * @param {KeyboardEvent} event
   */
  #onKeyDown = (event) => {
    if (event.key !== 'Escape') return;

    if (this.isOpen) {
      this.close();
      return;
    }

    const openDetails = this.querySelector('details[open]');
    if (openDetails) {
      openDetails.removeAttribute('open');
      openDetails.querySelector('summary')?.focus();
    }
  };
}

if (!customElements.get('nav-menu')) {
  customElements.define('nav-menu', NavMenu);
}

/**
 * Disclosure-style tab group for the shop mega panel: "browse" toggles that
 * reveal one product grid at a time. Rendered as pills in drawer mode and as
 * a sidebar list in desktop menu mode.
 *
 * Server markup renders every panel; on connect the first tab is activated
 * and the rest are hidden (CSS hides all but the first before that, so
 * no-JS visitors still see the first grid).
 *
 * @extends {Component<{}>}
 */
class NavShopTabs extends Component {
  connectedCallback() {
    super.connectedCallback();

    const [first] = this.buttons;
    if (first) this.#activate(first);
    this.setAttribute('data-initialized', '');
  }

  get buttons() {
    return Array.from(this.querySelectorAll('[data-nav-tab]'));
  }

  /**
   * Activate the clicked tab.
   * @param {Event} event
   */
  select(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-nav-tab]') : null;
    if (button) this.#activate(button);
  }

  /**
   * @param {Element} active - The tab button to activate.
   */
  #activate(active) {
    for (const button of this.buttons) {
      const expanded = button === active;
      button.setAttribute('aria-expanded', String(expanded));

      const panelId = button.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !expanded;
    }
  }
}

if (!customElements.get('nav-shop-tabs')) {
  customElements.define('nav-shop-tabs', NavShopTabs);
}

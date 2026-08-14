import { CartLinesUpdateEvent } from '@shopify/events';

/**
 * Flavor mode switch and bundle builder.
 *
 * In `single` mode this component does nothing but stay out of the way —
 * Horizon's variant picker and product form handle the sale. In `bundle` mode
 * it hides the picker, collects up to N flavors into slots, and takes over
 * add-to-cart so the selection goes in as one line item per flavor.
 *
 * The bundle discount itself is NOT applied here: it has to be an automatic
 * discount (or a Shopify Function) configured in admin. The savings badge is
 * merchant-entered copy.
 */
class FlavorBundleComponent extends HTMLElement {
  /** @type {Array<{variantId: string, label: string, image: string, price: number, planPrice: number, plans: Record<string, number> | null}>} */
  #slots = [];

  /** @type {'single' | 'bundle'} */
  #mode = 'single';

  /** The single-mode delivery frequency stashed while bundle mode holds 4 weeks @type {string | null} */
  #planBeforeBundle = null;

  #abortController = new AbortController();

  connectedCallback() {
    const { signal } = this.#abortController;

    this.addEventListener('click', this.#handleClick, { signal });

    // Capture phase at the document: the add-to-cart button is driven by
    // Horizon's own component, so the click has to be intercepted before it
    // reaches any listener bound on the button or the form.
    document.addEventListener('click', this.#interceptAddToCart, { capture: true, signal });
    document.addEventListener('submit', this.#interceptSubmit, { capture: true, signal });

    // Picking a flavor swaps the gallery art, which is above the buy box on
    // small screens — return to the top so the new pack is actually seen.
    this.#section?.addEventListener('change', this.#handleVariantChange, { signal });

    this.#render();
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  get #maxFlavors() {
    return Number(this.dataset.maxFlavors) || 4;
  }

  get #minFlavors() {
    return Math.min(Number(this.dataset.minFlavors) || 2, this.#maxFlavors);
  }

  get #section() {
    return this.closest('.product-information');
  }

  /** @param {Event} event */
  #handleClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const mode = target.closest('[data-mode]');
    if (mode instanceof HTMLElement) {
      this.#setMode(mode.dataset.mode === 'bundle' ? 'bundle' : 'single');
      return;
    }

    // Only the X removes — clicking the tile itself shouldn't drop a choice
    const remove = target.closest('.flavor-bundle__slot-remove');
    if (remove) {
      const slot = remove.closest('.flavor-bundle__slot');
      if (slot instanceof HTMLElement) {
        const index = Number(slot.dataset.slot);
        if (this.#slots[index]) {
          this.#slots.splice(index, 1);
          this.#render();
        }
      }
      return;
    }

    const flavor = target.closest('.flavor-bundle__flavor');
    if (flavor instanceof HTMLElement) {
      if (this.#slots.length >= this.#maxFlavors) return;
      const { variantId, label, image, price, planPrice, plans } = flavor.dataset;
      if (!variantId) return;
      this.#slots.push({
        variantId,
        label: label ?? '',
        image: image ?? '',
        price: Number(price) || 0,
        planPrice: Number(planPrice) || Number(price) || 0,
        plans: this.#parsePlans(plans),
      });
      this.#render();
    }
  };

  /** @param {Event} event */
  #handleVariantChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.optionName) return;

    // The PDP headline IS the flavor name, and _pdp-header is not part of
    // Horizon's variant morph set, so it would otherwise keep the old flavor.
    if (target.dataset.optionName.toLowerCase().includes('flavor')) {
      const title = this.#section?.querySelector('.pdp-header__title');
      if (title) title.textContent = target.value;
    }

    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    // Horizon scrolls .page-wrapper, not the window, on larger viewports
    const wrapper = document.querySelector('.page-wrapper');
    if (wrapper && wrapper.scrollTop > 0) wrapper.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
  };

  /** @param {'single' | 'bundle'} mode */
  #setMode(mode) {
    const previousMode = this.#mode;
    this.#mode = mode;

    for (const button of this.querySelectorAll('[data-mode]')) {
      const isActive = button instanceof HTMLElement && button.dataset.mode === mode;
      button.classList.toggle('flavor-bundle__mode--active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }

    const panel = this.querySelector('[data-ref="panel"]');
    if (panel instanceof HTMLElement) panel.hidden = mode !== 'bundle';

    // Drives the picker/purchase-option visibility from CSS
    this.#section?.setAttribute('data-flavor-mode', mode);

    this.#syncPlanToMode(previousMode, mode);
    this.#render();
  }

  /**
   * The bundle always defaults to the 4-week plan, whatever frequency the
   * size's own default set — and the shopper's single-mode choice comes back
   * when they leave bundle mode.
   * @param {'single' | 'bundle'} previousMode
   * @param {'single' | 'bundle'} mode
   */
  #syncPlanToMode(previousMode, mode) {
    if (previousMode === mode) return;
    const planSelect = this.#section?.querySelector('.purchase-options__plan-select');
    if (!(planSelect instanceof HTMLSelectElement)) return;

    if (mode === 'bundle') {
      // Leading space so ' 4 week' can't match inside '14 weeks'
      const fourWeekOption = [...planSelect.options].find((option) =>
        ` ${option.textContent?.trim().toLowerCase() ?? ''}`.includes(' 4 week')
      );
      if (!fourWeekOption || fourWeekOption.value === planSelect.value) return;
      this.#planBeforeBundle = planSelect.value;
      planSelect.value = fourWeekOption.value;
    } else {
      if (this.#planBeforeBundle == null) return;
      planSelect.value = this.#planBeforeBundle;
      this.#planBeforeBundle = null;
    }

    // Bubbles to purchase-options-component, which re-syncs the hidden
    // selling_plan input from the select.
    planSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  #render() {
    const slots = this.querySelectorAll('.flavor-bundle__slot');
    for (const [index, slot] of [...slots].entries()) {
      const entry = this.#slots[index];
      slot.classList.toggle('flavor-bundle__slot--filled', Boolean(entry));
      slot.removeAttribute('data-flavor');

      const label = slot.querySelector('.flavor-bundle__slot-label');
      const media = slot.querySelector('.flavor-bundle__slot-media');
      const remove = slot.querySelector('.flavor-bundle__slot-remove');

      if (entry) {
        slot.setAttribute('data-flavor', entry.label);
        if (label) label.textContent = entry.label;
        if (media) media.innerHTML = entry.image ? `<img src="${entry.image}" alt="">` : '';
        if (remove instanceof HTMLElement) {
          remove.hidden = false;
          remove.setAttribute('aria-label', `${this.dataset.removeLabel ?? ''} ${entry.label}`.trim());
        }
      } else {
        if (label) label.textContent = this.#addFlavorLabel;
        if (media) media.innerHTML = '';
        if (remove instanceof HTMLElement) remove.hidden = true;
      }
    }

    const counts = this.#counts();
    for (const flavor of this.querySelectorAll('.flavor-bundle__flavor')) {
      if (!(flavor instanceof HTMLButtonElement)) continue;
      flavor.disabled = this.#slots.length >= this.#maxFlavors;
      const count = counts.get(flavor.dataset.variantId ?? '') ?? 0;
      flavor.classList.toggle('flavor-bundle__flavor--added', count > 0);
      const badge = flavor.querySelector('.flavor-bundle__flavor-count');
      if (badge instanceof HTMLElement) {
        badge.hidden = count === 0;
        badge.textContent = String(count);
      }
    }

    const progress = this.querySelector('[data-ref="progress"]');
    if (progress instanceof HTMLElement) {
      progress.style.width = `${(this.#slots.length / this.#maxFlavors) * 100}%`;
      progress.classList.toggle('flavor-bundle__progress-bar--complete', this.#tierState().isMax);
    }

    const status = this.querySelector('[data-ref="status"]');
    if (status instanceof HTMLElement) {
      status.textContent = this.#statusText;
    }

    this.#syncAddToCartState();
    this.#updatePurchaseTotals();
  }

  get #addFlavorLabel() {
    return this.dataset.addFlavorLabel || 'Add flavor';
  }

  /** @returns {Array<{count: number, percent: number}>} ascending by count */
  get #tiers() {
    return (this.dataset.tiers ?? '')
      .split(',')
      .map((pair) => pair.split(':').map((part) => Number(part.trim())))
      .filter(([count, percent]) => Number.isFinite(count) && Number.isFinite(percent))
      .map(([count, percent]) => ({ count, percent }))
      .sort((a, b) => a.count - b.count);
  }

  /** Best tier already earned, and the next one still reachable. */
  #tierState() {
    const tiers = this.#tiers;
    const earned = tiers.filter((tier) => this.#slots.length >= tier.count).at(-1) ?? null;
    const next = tiers.find((tier) => tier.count > this.#slots.length) ?? null;
    return { earned, next, isMax: Boolean(earned) && !next };
  }

  get #statusText() {
    if (!this.#isValid) return this.dataset.statusMin ?? '';

    const { earned, next, isMax } = this.#tierState();
    if (!earned) return this.dataset.statusReady ?? '';

    if (isMax) {
      return (this.dataset.statusMax ?? '').replace('[percent]', String(earned.percent));
    }

    return (this.dataset.statusTier ?? '')
      .replace('[percent]', String(earned.percent))
      .replace('[remaining]', String(next ? next.count - this.#slots.length : 0))
      .replace('[next]', String(next?.percent ?? ''));
  }

  /** Bundle subtotals, so the purchase rows stop quoting a single unit. */
  #updatePurchaseTotals() {
    const rows = this.#section?.querySelectorAll('.purchase-options__option');
    if (!rows?.length) return;

    const { earned } = this.#tierState();

    for (const row of rows) {
      const now = row.querySelector('.purchase-options__price-now');
      const was = row.querySelector('.purchase-options__price-was');
      const badge = row.querySelector('.purchase-options__badge');
      if (!(now instanceof HTMLElement)) continue;

      if (!now.dataset.singlePrice) now.dataset.singlePrice = now.textContent ?? '';
      if (was instanceof HTMLElement && !was.dataset.singlePrice) {
        was.dataset.singlePrice = was.textContent ?? '';
      }
      // The Liquid-rendered badge carries the base subscription discount,
      // computed from the Recharge selling-plan allocation — stash it so the
      // tier badge can hand back to it outside bundle mode.
      if (badge instanceof HTMLElement && !badge.dataset.singleLabel) {
        badge.dataset.singleLabel = badge.textContent ?? '';
      }

      if (this.#mode !== 'bundle' || this.#slots.length === 0) {
        now.textContent = now.dataset.singlePrice;
        if (was instanceof HTMLElement) was.textContent = was.dataset.singlePrice;
        if (badge instanceof HTMLElement) badge.textContent = badge.dataset.singleLabel;
        continue;
      }

      const subscribe = row.querySelector('input[value="subscribe"]') !== null;
      const listTotal = this.#slots.reduce((sum, slot) => sum + slot.price, 0);
      // An earned bundle tier supersedes the per-line plan price on the
      // subscribe row; below the first tier the Recharge base rate stands.
      let total = this.#slots.reduce((sum, slot) => sum + (subscribe ? slot.planPrice : slot.price), 0);
      if (subscribe && earned) {
        total = Math.round(listTotal * (1 - earned.percent / 100));
      }

      now.textContent = this.#money(total);
      if (was instanceof HTMLElement && listTotal > total) was.textContent = this.#money(listTotal);

      if (badge instanceof HTMLElement && subscribe) {
        const tierLabel = (this.dataset.saveLabel ?? '').replace('[percent]', String(earned?.percent ?? ''));
        badge.textContent = earned && tierLabel ? tierLabel : badge.dataset.singleLabel;
      }
    }
  }

  /** @param {number} cents */
  #money(cents) {
    const amount = (cents / 100).toFixed(2);
    return `$${amount.replace(/\B(?=(\d{3})+(?!\d))/, ',')}`;
  }

  /**
   * Parses a chip's `data-plans` map of "plan name:selling plan id" pairs.
   * The name is everything before the LAST colon, so plan names containing
   * a colon still parse.
   *
   * @param {string | undefined} raw
   * @returns {Record<string, number> | null}
   */
  #parsePlans(raw) {
    if (!raw) return null;
    /** @type {Record<string, number>} */
    const plans = {};
    for (const pair of raw.split(',')) {
      const divider = pair.lastIndexOf(':');
      if (divider < 1) continue;
      const id = Number(pair.slice(divider + 1));
      if (Number.isFinite(id)) plans[pair.slice(0, divider).trim()] = id;
    }
    return Object.keys(plans).length ? plans : null;
  }

  /** @returns {Map<string, number>} variant id → quantity */
  #counts() {
    const counts = new Map();
    for (const { variantId } of this.#slots) {
      counts.set(variantId, (counts.get(variantId) ?? 0) + 1);
    }
    return counts;
  }

  get #isValid() {
    return this.#slots.length >= this.#minFlavors;
  }

  #syncAddToCartState() {
    const button = this.#addToCartButton;
    if (!(button instanceof HTMLButtonElement)) return;

    if (this.#mode !== 'bundle') {
      if (button.dataset.bundleDisabled === 'true') {
        button.disabled = false;
        delete button.dataset.bundleDisabled;
      }
      return;
    }

    button.disabled = !this.#isValid;
    button.dataset.bundleDisabled = String(!this.#isValid);
  }

  get #addToCartButton() {
    return this.#section?.querySelector('.product-details .add-to-cart-button') ?? null;
  }

  /** @param {Event} event */
  #interceptSubmit = (event) => {
    if (this.#mode !== 'bundle') return;
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !this.#section?.contains(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#addBundleToCart();
  };

  /** @param {Event} event */
  #interceptAddToCart = (event) => {
    if (this.#mode !== 'bundle') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.add-to-cart-button');
    if (!button || button !== this.#addToCartButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.#addBundleToCart();
  };

  async #addBundleToCart() {
    if (!this.#isValid) return;

    // Purchase options still apply in bundle mode — but selling plan ids are
    // per-product, and a bundle can mix variants from sibling products (the
    // variety packs). The page's hidden selling_plan input only covers its own
    // product, so resolve the chosen plan per line by NAME from each chip's
    // data-plans map instead of stamping one id onto every line.
    const sellingPlanInput = this.#section?.querySelector('input[name="selling_plan"]');
    const sellingPlan =
      sellingPlanInput instanceof HTMLInputElement && sellingPlanInput.value
        ? Number(sellingPlanInput.value)
        : null;
    const planSelect = this.#section?.querySelector('.purchase-options__plan-select');
    const planName =
      planSelect instanceof HTMLSelectElement
        ? (planSelect.selectedOptions[0]?.textContent?.trim().toLowerCase() ?? '')
        : '';

    /** @type {Map<string, Record<string, number> | null>} */
    const plansByVariant = new Map(this.#slots.map((slot) => [slot.variantId, slot.plans]));

    const items = [...this.#counts()].map(([id, quantity]) => {
      /** @type {{id: number, quantity: number, selling_plan?: number}} */
      const item = { id: Number(id), quantity };
      if (sellingPlan) {
        const plans = plansByVariant.get(id);
        const mapped = plans ? plans[planName] : undefined;
        if (mapped) {
          item.selling_plan = mapped;
        } else if (!plans) {
          // Chip without a plan map — keep the old single-product behavior
          item.selling_plan = sellingPlan;
        }
        // A chip WITH a map but no matching plan name goes in as one-time
        // rather than failing the whole add with a foreign plan id.
      }
      return item;
    });
    const sectionIds = [...document.querySelectorAll('cart-items-component')]
      .map((element) => (element instanceof HTMLElement ? element.dataset.sectionId : null))
      .filter(Boolean);

    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: items.map((item) => ({ merchandiseId: String(item.id), quantity: item.quantity })),
        promise: deferred.promise,
      })
    );

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, sections: sectionIds.join(',') }),
      });
      const result = await response.json();
      if (result.status) throw new Error(result.description || result.message || 'Add to cart failed');

      deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(await this.#fetchCart()) });

      this.#slots = [];
      this.#render();
    } catch (error) {
      console.error('[flavor-bundle]', error);
      deferred.reject(error);
    }
  }

  async #fetchCart() {
    /** @type {any} */
    const cartItems = document.querySelector('cart-items-component');
    if (cartItems) {
      await customElements.whenDefined('cart-items-component');
      return cartItems.fetchCartData();
    }
    const response = await fetch(`${Theme.routes.cart_url}.json`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    return response.json();
  }
}

if (!customElements.get('flavor-bundle-component')) {
  customElements.define('flavor-bundle-component', FlavorBundleComponent);
}

import { StandardEvents } from '@shopify/events';

/**
 * Subscribe & save / one-time purchase selector.
 *
 * Sets the `selling_plan` value on the product form via a hidden input, keeps
 * the row styling and the add-to-cart button price in sync with the current
 * selection, and re-renders itself from the fetched section HTML when the
 * variant changes (same source product-price morphs from).
 *
 * All lookups are live queries and the change listener is delegated on the
 * host element, so replacing the children after a variant morph needs no
 * rebinding — a cached-refs approach here previously applied state to
 * detached pre-morph nodes.
 */
class PurchaseOptionsComponent extends HTMLElement {
  connectedCallback() {
    this.#section = this.closest('.shopify-section, dialog');
    this.#section?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect);
    this.addEventListener('change', this.#apply);
    this.#apply();
  }

  disconnectedCallback() {
    this.#section?.removeEventListener(StandardEvents.productSelect, this.#handleProductSelect);
  }

  /** @type {Element | null} */
  #section = null;

  get #modeInputs() {
    return /** @type {HTMLInputElement[]} */ ([...this.querySelectorAll('input[type="radio"]')]);
  }

  get #planSelect() {
    return /** @type {HTMLSelectElement | null} */ (
      this.querySelector('.purchase-options__plan-select')
    );
  }

  get #selectedMode() {
    return this.#modeInputs.find((input) => input.checked)?.value ?? 'one-time';
  }

  #apply = () => {
    const subscribe = this.#selectedMode === 'subscribe';
    const planSelect = this.#planSelect;

    const sellingPlanInput = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input[name="selling_plan"]')
    );
    if (sellingPlanInput) {
      sellingPlanInput.value = subscribe && planSelect ? planSelect.value : '';
    }

    for (const input of this.#modeInputs) {
      input
        .closest('.purchase-options__option')
        ?.classList.toggle('purchase-options__option--selected', input.checked);
    }

    this.#updateAddButtonPrice();
  };

  #updateAddButtonPrice() {
    const button = this.closest('.product-details')?.querySelector('.add-to-cart-button');
    if (!button) return;

    const selectedInput = this.#modeInputs.find((input) => input.checked);
    const row = selectedInput?.closest('.purchase-options__option');
    let price = row?.getAttribute('data-price') ?? '';

    if (this.#selectedMode === 'subscribe') {
      const planOption = this.#planSelect?.selectedOptions[0];
      price = planOption?.getAttribute('data-price') || price;
    }

    let priceElement = button.querySelector('.purchase-options__add-price');

    if (!price) {
      priceElement?.remove();
      return;
    }

    if (!priceElement) {
      priceElement = document.createElement('span');
      priceElement.className = 'purchase-options__add-price';
      button.querySelector('.add-to-cart__added')?.before(priceElement);
    }

    priceElement.textContent = ` · ${price}`;
  }

  /**
   * Re-render from the updated section HTML after a variant change, keeping
   * the shopper's subscribe / one-time choice.
   * @param {CustomEvent & { promise?: Promise<{ detail?: { html?: Document, productId?: string } }> }} event
   */
  #handleProductSelect = (event) => {
    event.promise?.then(({ detail }) => {
      const html = detail?.html;
      if (!html) return;
      if (detail?.productId && detail.productId !== this.dataset.productId) return;

      const replacement = html.querySelector(
        `purchase-options-component[data-block-id="${this.dataset.blockId}"]`
      );
      if (!replacement) return;

      const previousMode = this.#selectedMode;
      const previousPlan = this.#planSelect?.value;

      this.replaceChildren(.../** @type {Element} */ (replacement.cloneNode(true)).childNodes);

      for (const input of this.#modeInputs) {
        input.checked = input.value === previousMode;
      }
      const planSelect = this.#planSelect;
      if (planSelect && previousPlan) {
        if ([...planSelect.options].some((option) => option.value === previousPlan)) {
          planSelect.value = previousPlan;
        }
      }

      this.#apply();

      // The buy-buttons block may re-render its button on the same event;
      // re-inject the price after the current frame.
      requestAnimationFrame(() => this.#updateAddButtonPrice());
    });
  };
}

if (!customElements.get('purchase-options-component')) {
  customElements.define('purchase-options-component', PurchaseOptionsComponent);
}

/**
 * Product gallery lightbox.
 *
 * Horizon's own zoom dialog is a full-screen drag-zoom viewer with a thumbnail
 * strip; the Tiiga design calls for a contained image on a scrim with arrows
 * and a counter, so the gallery block's `zoom` setting is off and this takes
 * over instead.
 *
 * Images are read from the rendered media grid rather than passed in from
 * Liquid, so the lightbox stays correct after a variant swap re-renders the
 * gallery — the list is rebuilt every time it opens.
 */
class PdpLightbox extends HTMLElement {
  /** @type {Array<{src: string, alt: string}>} */
  #slides = [];

  #index = 0;

  #abortController = new AbortController();

  /** @type {{x: number, y: number} | null} */
  #pointerStart = null;

  /** Set when a pointer gesture resolved as a swipe, so the click that follows
   *  it isn't mistaken for a tap on the scrim (which closes). */
  #swiped = false;

  connectedCallback() {
    const { signal } = this.#abortController;
    this.addEventListener('click', this.#handleClick, { signal });
    this.#dialog?.addEventListener('keydown', this.#handleKeydown, { signal });
    this.#dialog?.addEventListener('pointerdown', this.#handlePointerDown, { signal });
    this.#dialog?.addEventListener('pointerup', this.#handlePointerUp, { signal });
    // Delegated at the document: this block renders before the gallery, so at
    // connect time there is nothing to bind to yet.
    document.addEventListener('click', this.#handleGalleryClick, { signal });
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  get #dialog() {
    return /** @type {HTMLDialogElement | null} */ (this.querySelector('[data-ref="dialog"]'));
  }

  get #gallery() {
    for (const grid of document.querySelectorAll('.media-gallery__grid')) {
      if (!grid.closest('featured-product-information')) return grid;
    }
    return null;
  }

  /** Largest candidate in a srcset, falling back to the plain src. */
  #bestSource(img) {
    const candidates = (img.getAttribute('srcset') ?? '')
      .split(',')
      .map((part) => part.trim().split(/\s+/))
      .filter(([url, descriptor]) => url && descriptor?.endsWith('w'))
      .map(([url, descriptor]) => ({ url, width: parseInt(descriptor, 10) }))
      .sort((a, b) => b.width - a.width);

    return candidates[0]?.url ?? img.currentSrc ?? img.src;
  }

  #collect() {
    const images = this.#gallery?.querySelectorAll('.product-media-container img') ?? [];
    this.#slides = [...images].map((img) => ({ src: this.#bestSource(img), alt: img.alt ?? '' }));
  }

  /** @param {MouseEvent} event */
  #handleGalleryClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const container = target.closest('.product-media-container');
    if (!container) return;

    const grid = container.closest('.media-gallery__grid');
    if (!grid || grid.closest('featured-product-information')) return;

    event.preventDefault();
    this.#collect();
    const containers = [...grid.querySelectorAll('.product-media-container')];
    this.open(Math.max(0, containers.indexOf(/** @type {Element} */ (container))));
  };

  /** @param {number} index */
  open(index = 0) {
    if (!this.#slides.length) this.#collect();
    if (!this.#slides.length) return;

    this.#index = index;
    this.#render();
    this.#dialog?.showModal();
  }

  /** @param {PointerEvent} event */
  #handlePointerDown = (event) => {
    this.#pointerStart = { x: event.clientX, y: event.clientY };
  };

  /** @param {PointerEvent} event */
  #handlePointerUp = (event) => {
    const start = this.#pointerStart;
    this.#pointerStart = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;

    this.#swiped = true;
    this.#step(dx < 0 ? 1 : -1);
  };

  /** @param {MouseEvent} event */
  #handleClick = (event) => {
    if (this.#swiped) {
      this.#swiped = false;
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="close"]')) {
      this.#dialog?.close();
      return;
    }

    const nav = target.closest('[data-step]');
    if (nav instanceof HTMLElement) {
      this.#step(Number(nav.dataset.step));
      return;
    }

    // Clicking the scrim (the dialog itself, outside the figure) closes
    if (target === this.#dialog) this.#dialog?.close();
  };

  /** @param {KeyboardEvent} event */
  #handleKeydown = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.#step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.#step(-1);
    }
  };

  /** @param {number} delta */
  #step(delta) {
    const total = this.#slides.length;
    if (!total) return;
    this.#index = (this.#index + delta + total) % total;
    this.#render();
  }

  #render() {
    const slide = this.#slides[this.#index];
    if (!slide) return;

    const image = this.querySelector('[data-ref="image"]');
    if (image instanceof HTMLImageElement) {
      image.src = slide.src;
      image.alt = slide.alt;
    }

    const counter = this.querySelector('[data-ref="counter"]');
    if (counter instanceof HTMLElement) {
      counter.textContent = `${this.#index + 1} / ${this.#slides.length}`;
    }

    const single = this.#slides.length < 2;
    for (const nav of this.querySelectorAll('[data-step]')) {
      if (nav instanceof HTMLElement) nav.hidden = single;
    }
    if (counter instanceof HTMLElement) counter.hidden = single;
  }
}

if (!customElements.get('pdp-lightbox')) {
  customElements.define('pdp-lightbox', PdpLightbox);
}

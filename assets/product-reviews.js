/**
 * Product reviews: media dialogs + live Klaviyo hydration.
 *
 * Server-rendered review blocks (and their pre-rendered <dialog>s) work with
 * no JS beyond open/close. When the section carries data-klaviyo-company and
 * data-product-id, this element also fetches live reviews from Klaviyo's
 * client reviews endpoint (the same one their widget uses), then replaces the
 * sample list, summary numbers, histogram and photo rail with real data.
 * Photo reviews get dialogs built on demand from the fetched payload.
 *
 * Endpoint notes (reverse-engineered from the widget bundle, so pinned here):
 * - GET fast.a.klaviyo.com/reviews/api/client_reviews/{shopifyProductId}/
 *   with company_id, limit/offset paging; `media=true` filters photo reviews.
 * - summary.rating_histogram is ordered 1★ → 5★.
 * - Images live at klaviyo.s3.amazonaws.com/reviews/images/{image_uuid} and
 *   are resized through reviews-media.services.klaviyo.com.
 */

const KLAVIYO_API_BASE = 'https://fast.a.klaviyo.com/reviews/api/client_reviews';
const KLAVIYO_IMAGE_BASE = 'https://klaviyo.s3.amazonaws.com/reviews/images/';
const KLAVIYO_RESIZE_BASE = 'https://reviews-media.services.klaviyo.com/abc';
const MEDIA_RAIL_LIMIT = 12;

class ProductReviews extends HTMLElement {
  #abortController = new AbortController();

  /** @type {HTMLDialogElement | null} */
  #dialog = null;

  #index = 0;

  /** Live-mode state; stays inert when Klaviyo attributes are absent. */
  #live = false;

  #offset = 0;

  #pageSize = 6;

  #hasMore = false;

  #loading = false;

  /** @type {Map<string, {author: string, rating: number, title: string | null, content: string, createdAt: string, verified: boolean, imageUuid: string}>} */
  #mediaReviews = new Map();

  /** @type {Record<string, string>} */
  #strings = {};

  connectedCallback() {
    const { signal } = this.#abortController;
    this.addEventListener('click', this.#handleClick, { signal });
    this.addEventListener('keydown', this.#handleKeydown, { signal });

    if (this.dataset.klaviyoCompany && this.dataset.productId) {
      const strings = this.querySelector('[data-ref="klaviyo-strings"]');
      try {
        this.#strings = JSON.parse(strings?.textContent ?? '{}');
      } catch {
        this.#strings = {};
      }
      this.#hydrate();
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  /** @param {Record<string, string | number>} values */
  #t(key, values = {}) {
    let text = this.#strings[key] ?? '';
    for (const [name, value] of Object.entries(values)) {
      text = text.replace(`__${name.toUpperCase()}__`, String(value));
    }
    return text;
  }

  #apiUrl(offset, limit, mediaOnly) {
    const params = new URLSearchParams({
      product_id: this.dataset.productId ?? '',
      company_id: this.dataset.klaviyoCompany ?? '',
      limit: String(limit),
      offset: String(offset),
      sort: '3',
      filter: '',
      type: 'reviews',
      media: mediaOnly ? 'true' : 'false',
      kl_review_uuid: '',
      subtype: 'all',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    });
    return `${KLAVIYO_API_BASE}/${this.dataset.productId}/?${params}`;
  }

  /**
   * @param {string} uuid
   * @param {string} resize e.g. 'width:260/height:260/resizing_type:fill'
   */
  #imageUrl(uuid, resize) {
    return `${KLAVIYO_RESIZE_BASE}/${resize}/plain/${KLAVIYO_IMAGE_BASE}${uuid}`;
  }

  async #hydrate() {
    const visible = this.querySelectorAll('.product-reviews__review').length;
    this.#pageSize = Math.max(visible, 3);

    try {
      const [page, media] = await Promise.all([
        this.#fetchPage(0, this.#pageSize, false),
        this.#fetchPage(0, MEDIA_RAIL_LIMIT, true),
      ]);

      this.#live = true;
      this.#renderSummary(page.summary);
      this.#renderList(page.reviews, { replace: true });
      this.#offset = page.reviews.length;
      this.#hasMore = Boolean(page.has_more);
      this.#syncShowMore();
      this.#renderMediaRail(media.reviews);
    } catch {
      // Network/API failure: the server-rendered sample content stays up.
    }
  }

  async #fetchPage(offset, limit, mediaOnly) {
    const response = await fetch(this.#apiUrl(offset, limit, mediaOnly), {
      signal: this.#abortController.signal,
    });
    if (!response.ok) throw new Error(`Klaviyo reviews request failed: ${response.status}`);
    return response.json();
  }

  /** @param {{star_rating?: number, review_count?: number, rating_histogram?: number[]}} summary */
  #renderSummary(summary) {
    if (!summary) return;

    const rating = Math.round((summary.star_rating ?? 0) * 10) / 10;
    const count = summary.review_count ?? 0;

    const value = this.querySelector('[data-ref="averageValue"]');
    if (value) value.textContent = String(rating);

    const fill = this.querySelector('[data-ref="averageFill"]');
    if (fill instanceof HTMLElement) fill.style.width = `${Math.min(rating * 20, 100)}%`;

    const stars = this.querySelector('[data-ref="averageStars"]');
    if (stars) stars.setAttribute('aria-label', this.#t('starsLabel', { rating }));

    const basedOn = this.querySelector('[data-ref="basedOn"]');
    if (basedOn) basedOn.textContent = this.#t('basedOn', { count });

    // The buy-box header renders a static fallback rating; hydrate it with the
    // same summary so the two never disagree. (Lives outside this element.)
    const headerValue = document.querySelector('[data-pdp-rating-value]');
    if (headerValue) headerValue.textContent = String(rating);
    const headerCount = document.querySelector('[data-pdp-rating-count]');
    if (headerCount) headerCount.textContent = `(${this.#t('countLabel', { count })})`;

    const histogram = summary.rating_histogram ?? [];
    const total = histogram.reduce((sum, n) => sum + n, 0);
    for (const row of this.querySelectorAll('.product-reviews__histogram-row')) {
      if (!(row instanceof HTMLElement)) continue;
      const star = Number(row.dataset.star);
      const rowCount = histogram[star - 1] ?? 0;
      const rowFill = row.querySelector('.product-reviews__histogram-fill');
      if (rowFill instanceof HTMLElement) {
        rowFill.style.width = total > 0 ? `${Math.round((rowCount / total) * 100)}%` : '0%';
      }
      const countEl = row.querySelector('.product-reviews__histogram-count');
      if (countEl) countEl.textContent = String(rowCount);
    }
  }

  /**
   * @param {HTMLElement} parent
   * @param {string} tag
   * @param {string} className
   * @param {string} [text]
   */
  #el(parent, tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /**
   * @param {HTMLElement} parent
   * @param {number} rating
   */
  #renderStars(parent, rating) {
    const filled = Math.max(0, Math.min(5, Math.round(rating)));
    const stars = this.#el(parent, 'span', 'product-reviews__stars', '★'.repeat(filled));
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', this.#t('starsLabel', { rating }));
    if (filled < 5) {
      const empty = this.#el(stars, 'span', 'product-reviews__stars-empty', '★'.repeat(5 - filled));
      empty.setAttribute('aria-hidden', 'true');
    }
    return stars;
  }

  /** @param {string} iso */
  #formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium' }).format(date);
  }

  /** @param {object} review */
  #reviewKey(review) {
    return `kl-${review.id}`;
  }

  get #combined() {
    return this.dataset.productId === 'all';
  }

  /** Remember a photo review so its dialog can be built on demand. */
  #trackMediaReview(review) {
    if (!review.image_uuid) return;
    this.#mediaReviews.set(this.#reviewKey(review), {
      author: review.author ?? '',
      rating: review.rating ?? 0,
      title: review.title ?? null,
      content: review.content ?? '',
      createdAt: review.created_at ?? '',
      verified: Boolean(review.verified),
      imageUuid: review.image_uuid,
      productName: review.product?.name ?? '',
    });
  }

  /**
   * @param {object[]} reviews
   * @param {{replace?: boolean}} options
   */
  #renderList(reviews, { replace = false } = {}) {
    const list = this.querySelector('[data-ref="list"]');
    if (!(list instanceof HTMLElement)) return;

    if (replace) list.replaceChildren();

    for (const review of reviews ?? []) {
      this.#trackMediaReview(review);

      const article = this.#el(list, 'article', 'product-reviews__review');

      const reviewer = this.#el(article, 'div', 'product-reviews__reviewer');
      const avatar = this.#el(reviewer, 'span', 'product-reviews__avatar', (review.author ?? '').slice(0, 1));
      avatar.setAttribute('aria-hidden', 'true');
      const meta = this.#el(reviewer, 'div', 'product-reviews__reviewer-meta');
      this.#el(meta, 'span', 'product-reviews__author', review.author ?? '');
      if (review.verified) {
        this.#el(meta, 'span', 'product-reviews__verified', this.#t('verified'));
      }

      const body = this.#el(article, 'div', 'product-reviews__body');
      const header = this.#el(body, 'div', 'product-reviews__review-header');
      this.#renderStars(header, review.rating ?? 0);
      if (review.title) {
        this.#el(header, 'h3', 'product-reviews__review-title', review.title);
      }
      if (review.content) {
        this.#el(body, 'p', 'product-reviews__review-text', review.content);
      }

      if (this.#combined && review.product?.name) {
        this.#el(body, 'span', 'product-reviews__review-product', this.#t('onProduct', { product: review.product.name }));
      }

      if (review.image_uuid) {
        const thumbs = this.#el(body, 'div', 'product-reviews__review-thumbs');
        const thumb = this.#el(thumbs, 'button', 'product-reviews__review-thumb');
        thumb.type = 'button';
        thumb.dataset.openReview = this.#reviewKey(review);
        thumb.setAttribute('aria-label', this.#t('openReview', { author: review.author ?? '' }));
        const img = this.#el(thumb, 'img', 'product-reviews__review-thumb-image');
        if (img instanceof HTMLImageElement) {
          img.src = this.#imageUrl(review.image_uuid, 'width:160/height:160/resizing_type:fill');
          img.alt = '';
          img.loading = 'lazy';
        }
      }

      if (review.created_at) {
        this.#el(article, 'span', 'product-reviews__date', this.#formatDate(review.created_at));
      }
    }
  }

  /** @param {object[]} reviews */
  #renderMediaRail(reviews) {
    const rail = this.querySelector('[data-ref="liveMedia"]');
    const section = this.querySelector('[data-ref="mediaSection"]');
    if (!(rail instanceof HTMLElement) || !(section instanceof HTMLElement)) return;

    const withImages = (reviews ?? []).filter((review) => review.image_uuid);
    if (!withImages.length) {
      section.hidden = true;
      return;
    }

    rail.replaceChildren();
    for (const review of withImages) {
      this.#trackMediaReview(review);
      const thumb = this.#el(rail, 'button', 'product-reviews__media-thumb');
      thumb.type = 'button';
      thumb.dataset.openReview = this.#reviewKey(review);
      thumb.setAttribute('aria-label', this.#t('openReview', { author: review.author ?? '' }));
      const img = this.#el(thumb, 'img', 'product-reviews__media-image');
      if (img instanceof HTMLImageElement) {
        img.src = this.#imageUrl(review.image_uuid, 'width:400/height:334/resizing_type:fill');
        img.alt = '';
        img.loading = 'lazy';
      }
    }

    // Live data replaces the sample slideshow rail entirely
    const sampleRail = section.querySelector('.product-reviews__media-slideshow');
    if (sampleRail instanceof HTMLElement) sampleRail.hidden = true;
    rail.hidden = false;
    section.hidden = false;
  }

  /** Build (once) the dialog for a live photo review. */
  #ensureLiveDialog(key) {
    const existing = this.querySelector(`dialog[data-review-dialog="${CSS.escape(key)}"]`);
    if (existing) return existing;

    const review = this.#mediaReviews.get(key);
    if (!review) return null;

    const dialog = document.createElement('dialog');
    dialog.className = 'review-dialog';
    dialog.dataset.reviewDialog = key;
    dialog.setAttribute('aria-label', this.#t('reviewBy', { author: review.author }));

    const close = this.#el(dialog, 'button', 'review-dialog__close');
    close.type = 'button';
    close.dataset.action = 'close';
    close.setAttribute('aria-label', this.#t('close'));
    close.textContent = '✕';

    const layout = this.#el(dialog, 'div', 'review-dialog__layout');
    const media = this.#el(layout, 'div', 'review-dialog__media');
    const img = this.#el(media, 'img', 'review-dialog__image');
    if (img instanceof HTMLImageElement) {
      img.src = this.#imageUrl(review.imageUuid, 'width:1000');
      img.alt = '';
      img.setAttribute('data-review-image', '');
    }

    const content = this.#el(layout, 'div', 'review-dialog__content');
    const header = this.#el(content, 'div', 'review-dialog__header');
    const avatar = this.#el(header, 'span', 'review-dialog__avatar', review.author.slice(0, 1));
    avatar.setAttribute('aria-hidden', 'true');
    const reviewer = this.#el(header, 'div', 'review-dialog__reviewer');
    this.#el(reviewer, 'span', 'review-dialog__author', review.author);
    if (review.verified) {
      this.#el(reviewer, 'span', 'review-dialog__verified', this.#t('verified'));
    }
    if (review.createdAt) {
      this.#el(header, 'span', 'review-dialog__date', this.#formatDate(review.createdAt));
    }

    this.#renderStars(content, review.rating);
    if (review.title) {
      this.#el(content, 'h3', 'review-dialog__title', review.title);
    }
    if (review.content) {
      this.#el(content, 'p', 'review-dialog__text', review.content);
    }
    if (this.#combined && review.productName) {
      this.#el(content, 'span', 'review-dialog__product', this.#t('onProduct', { product: review.productName }));
    }

    this.appendChild(dialog);
    return dialog;
  }

  #syncShowMore() {
    const wrapper = this.querySelector('[data-ref="showMore"]');
    if (wrapper instanceof HTMLElement) wrapper.hidden = !this.#hasMore;
  }

  async #loadMore() {
    if (this.#loading || !this.#hasMore) return;
    this.#loading = true;
    try {
      const page = await this.#fetchPage(this.#offset, this.#pageSize, false);
      this.#renderList(page.reviews);
      this.#offset += (page.reviews ?? []).length;
      this.#hasMore = Boolean(page.has_more);
      this.#syncShowMore();
    } catch {
      // Leave the button in place; the next click retries.
    } finally {
      this.#loading = false;
    }
  }

  /** @param {MouseEvent} event */
  #handleClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const opener = target.closest('[data-open-review]');
    if (opener instanceof HTMLElement && opener.dataset.openReview) {
      this.#open(opener.dataset.openReview, Number(opener.dataset.imageIndex ?? 0));
      return;
    }

    const showMore = target.closest('[data-action="show-more"]');
    if (showMore instanceof HTMLElement) {
      if (this.#live) {
        this.#loadMore();
        return;
      }
      for (const review of this.querySelectorAll('.product-reviews__review[hidden]')) {
        if (review instanceof HTMLElement) review.hidden = false;
      }
      const wrapper = showMore.closest('.product-reviews__show-more');
      if (wrapper instanceof HTMLElement) wrapper.hidden = true;
      return;
    }

    if (!this.#dialog?.open) return;

    if (target.closest('[data-action="close"]')) {
      this.#dialog.close();
      return;
    }

    const nav = target.closest('[data-step]');
    if (nav instanceof HTMLElement) {
      this.#show(this.#index + Number(nav.dataset.step));
      return;
    }

    const thumb = target.closest('[data-goto]');
    if (thumb instanceof HTMLElement) {
      this.#show(Number(thumb.dataset.goto));
      return;
    }

    // Clicking the scrim (the dialog element itself, outside the layout) closes
    if (target === this.#dialog) this.#dialog.close();
  };

  /** @param {KeyboardEvent} event */
  #handleKeydown = (event) => {
    if (!this.#dialog?.open) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.#show(this.#index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.#show(this.#index - 1);
    }
  };

  /**
   * @param {string} id
   * @param {number} index
   */
  #open(id, index) {
    const dialog = this.#mediaReviews.has(id)
      ? this.#ensureLiveDialog(id)
      : this.querySelector(`dialog[data-review-dialog="${CSS.escape(id)}"]`);
    if (!(dialog instanceof HTMLDialogElement)) return;

    this.#dialog = dialog;
    this.#show(index);
    dialog.showModal();
  }

  get #images() {
    if (!this.#dialog) return [];
    return [...this.#dialog.querySelectorAll('[data-review-image]')];
  }

  /** @param {number} index */
  #show(index) {
    const images = this.#images;
    if (!images.length || !this.#dialog) return;

    this.#index = ((index % images.length) + images.length) % images.length;

    for (const [i, image] of images.entries()) {
      if (image instanceof HTMLElement) image.hidden = i !== this.#index;
    }

    const single = images.length < 2;
    for (const nav of this.#dialog.querySelectorAll('[data-step]')) {
      if (nav instanceof HTMLElement) nav.hidden = single;
    }

    for (const thumb of this.#dialog.querySelectorAll('[data-goto]')) {
      if (thumb instanceof HTMLElement) {
        thumb.setAttribute('aria-current', thumb.dataset.goto === String(this.#index) ? 'true' : 'false');
      }
    }
  }
}

if (!customElements.get('product-reviews')) {
  customElements.define('product-reviews', ProductReviews);
}

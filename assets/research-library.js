/**
 * Category filter for the research-library section.
 *
 * On connect it collects the category tags rendered inside each research
 * claim card, builds one filter pill per distinct category (plus a
 * show-everything pill), and toggles card visibility on click. Without JS the
 * filter bar stays hidden and every card renders, so the content stays
 * reachable.
 */
class ResearchLibraryComponent extends HTMLElement {
  /** @type {string | null} Currently active category, null = show all. */
  #active = null;

  connectedCallback() {
    const filters = this.querySelector('.research-library__filters');

    if (!(filters instanceof HTMLElement) || this.#cards.length === 0) return;

    const categories = [];

    for (const card of this.#cards) {
      for (const category of this.#categoriesOf(card)) {
        if (!categories.includes(category)) categories.push(category);
      }
    }

    if (categories.length < 2) return;

    const allLabel = filters.dataset.labelAll ?? 'View all';

    for (const category of [allLabel, ...categories]) {
      const pill = document.createElement('button');

      pill.type = 'button';
      pill.className = 'research-library__filter';
      pill.textContent = category;
      pill.setAttribute('aria-pressed', category === allLabel ? 'true' : 'false');
      pill.addEventListener('click', () => {
        this.#active = category === allLabel ? null : category;
        this.#apply();
      });

      filters.append(pill);
    }

    filters.hidden = false;
  }

  get #cards() {
    return /** @type {HTMLElement[]} */ (Array.from(this.querySelectorAll('.research-claim')));
  }

  /**
   * @param {HTMLElement} card - A research claim card.
   * @returns {string[]} The card's category tag texts.
   */
  #categoriesOf(card) {
    const tags = card.querySelectorAll('.research-claim__category');
    return Array.from(tags, (tag) => tag.textContent?.trim() ?? '').filter(Boolean);
  }

  #apply() {
    let shown = 0;

    for (const card of this.#cards) {
      const match = this.#active === null || this.#categoriesOf(card).includes(this.#active);

      card.hidden = !match;
      if (match) shown += 1;
    }

    for (const pill of this.querySelectorAll('.research-library__filter')) {
      const isAll = pill === this.querySelector('.research-library__filter');
      const pressed = this.#active === null ? isAll : pill.textContent === this.#active;

      pill.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }

    const count = this.querySelector('.research-library__count');

    if (count instanceof HTMLElement) {
      const template = shown === 1 ? count.dataset.countOne : count.dataset.countOther;
      count.textContent = template?.replace('[count]', String(shown)) ?? '';
    }
  }
}

if (!customElements.get('research-library-component')) {
  customElements.define('research-library-component', ResearchLibraryComponent);
}

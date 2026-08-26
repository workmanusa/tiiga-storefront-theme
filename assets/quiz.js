/**
 * Multi-path product-match quiz.
 *
 * The section renders the shell (intro path buttons, email capture form,
 * result product cards) and embeds the question data as JSON. This component
 * drives the flow: path choice, one question at a time with progress, email
 * capture, then a product recommendation with a volume upsell.
 *
 * Answers are persisted two ways when the visitor leaves an email:
 * - Shopify: the embedded customer form is submitted via fetch with the
 *   answers encoded as customer tags (`contact[tags]`).
 * - Klaviyo: profile properties via the onsite `klaviyo.identify` when the
 *   Klaviyo snippet is present, else the public client API.
 */
class QuizComponent extends HTMLElement {
  /** @type {{ paths: QuizPath[], reasons: Record<string, string> }} */
  #data = { paths: [], reasons: {} };

  /** @type {QuizPath | null} */
  #path = null;

  /** @type {{ id: string, text: string, options: { value: string, label: string }[] }[]} */
  #questions = [];

  /** @type {string} */
  #firstName = '';

  /** @type {number} */
  #step = 0;

  /** @type {Record<string, { value: string, label: string }>} */
  #answers = {};

  /** @type {Recommendation | null} */
  #recommendation = null;

  connectedCallback() {
    const dataScript = this.querySelector('[data-quiz-data]');
    if (dataScript?.textContent) this.#data = JSON.parse(dataScript.textContent);

    for (const button of this.querySelectorAll('[data-path]')) {
      button.addEventListener('click', () => this.#startPath(button.getAttribute('data-path') ?? ''));
    }

    this.querySelector('[data-quiz-back]')?.addEventListener('click', () => this.#goBack());
    this.querySelector('[data-quiz-restart]')?.addEventListener('click', (event) => {
      event.preventDefault();
      this.#reset();
    });

    const nameForm = this.querySelector('[data-quiz-name-form]');
    nameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = nameForm.querySelector('input');
      if (!(input instanceof HTMLInputElement) || !input.checkValidity()) {
        if (input instanceof HTMLInputElement) input.reportValidity();
        return;
      }
      this.#firstName = input.value.trim();
      this.#showPanel('intro');
      const introHeading = this.querySelector('[data-quiz-panel="intro"] h2');
      if (introHeading instanceof HTMLElement) {
        introHeading.tabIndex = -1;
        introHeading.focus({ preventScroll: true });
      }
    });

    const form = this.#form;
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#submit();
    });

    for (const buyForm of this.querySelectorAll('.quiz__buy-form')) {
      buyForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (buyForm instanceof HTMLFormElement) this.#addToCart(buyForm);
      });
    }

    for (const select of this.querySelectorAll('.quiz__variant-select')) {
      select.addEventListener('change', () => {
        if (select instanceof HTMLSelectElement) this.#swapVariantImage(select);
      });
    }
  }

  /**
   * Shows the selected variant's image on the result card, when it has one.
   *
   * @param {HTMLSelectElement} select - The result card's flavor dropdown.
   */
  #swapVariantImage(select) {
    const option = select.selectedOptions[0];
    const image = select.closest('[data-quiz-result-card]')?.querySelector('.quiz__result-image');
    const source = option?.getAttribute('data-image');
    if (!(image instanceof HTMLImageElement) || !source) return;

    image.src = source;
    image.removeAttribute('srcset');
    const alt = option.getAttribute('data-image-alt');
    if (alt) image.alt = alt;
  }

  /**
   * Adds the selected variant (and selling plan) to the cart via the AJAX
   * cart, then sends the visitor to the cart page.
   *
   * @param {HTMLFormElement} form - The result card's product form.
   */
  async #addToCart(form) {
    const body = new FormData(form);
    if (!body.get('selling_plan')) body.delete('selling_plan');

    const button = form.querySelector('button[type="submit"]');
    const error = form.querySelector('[data-quiz-cart-error]');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    if (error instanceof HTMLElement) error.hidden = true;

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.description ?? '');
      }
      window.location.assign(this.getAttribute('data-cart-url') ?? '/cart');
    } catch (cause) {
      if (button instanceof HTMLButtonElement) button.disabled = false;
      if (error instanceof HTMLElement) {
        error.textContent =
          cause instanceof Error && cause.message ? cause.message : (error.getAttribute('data-fallback') ?? '');
        error.hidden = false;
      }
    }
  }

  get #form() {
    return /** @type {HTMLFormElement | null} */ (this.querySelector('[data-quiz-email] form'));
  }

  get #stage() {
    return /** @type {HTMLElement} */ (this.querySelector('[data-quiz-stage]'));
  }

  /**
   * @param {string} pathId - Id of the quiz path chosen on the intro panel.
   */
  #startPath(pathId) {
    this.#path = this.#data.paths.find((path) => path.id === pathId) ?? null;
    if (!this.#path) return;

    // The shared age question leads every path.
    this.#questions = this.#data.age_question
      ? [this.#data.age_question, ...this.#path.questions]
      : [...this.#path.questions];
    this.#step = 0;
    this.#answers = {};
    this.#showPanel('questions');
    this.#renderQuestion();
  }

  #renderQuestion() {
    if (!this.#path) return;

    const question = this.#questions[this.#step];
    if (!question) return;

    const total = this.#questions.length;
    const progress = this.querySelector('[data-quiz-progress]');
    if (progress instanceof HTMLElement) {
      progress.style.setProperty('--quiz-progress', `${((this.#step + 1) / total) * 100}%`);
    }

    const count = this.querySelector('[data-quiz-count]');
    if (count) {
      count.textContent = (count.getAttribute('data-template') ?? '')
        .replace('[current]', String(this.#step + 1))
        .replace('[total]', String(total));
    }

    const stage = this.#stage;
    stage.textContent = '';

    const heading = document.createElement('h2');
    heading.className = 'quiz__question h3';
    heading.tabIndex = -1;
    heading.textContent = question.text;
    stage.append(heading);

    const selectLabel = stage.getAttribute('data-select-label');
    if (selectLabel) {
      const microcopy = document.createElement('p');
      microcopy.className = 'quiz__microcopy';
      microcopy.textContent = selectLabel;
      stage.append(microcopy);
    }

    const list = document.createElement('div');
    list.className = 'quiz__options';

    for (const option of question.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz__option';
      button.textContent = option.label;
      if (this.#answers[question.id]?.value === option.value) {
        button.setAttribute('aria-pressed', 'true');
      }
      button.addEventListener('click', () => {
        // Brief pressed state so the choice reads before the step advances.
        for (const sibling of list.querySelectorAll('button')) {
          sibling.removeAttribute('aria-pressed');
          sibling.disabled = true;
        }
        button.disabled = false;
        button.setAttribute('aria-pressed', 'true');
        setTimeout(() => this.#answer(question.id, option), 160);
      });
      list.append(button);
    }

    stage.append(list);
    heading.focus({ preventScroll: true });
  }

  /**
   * @param {string} questionId - Id of the answered question.
   * @param {{ value: string, label: string }} option - The chosen option.
   */
  #answer(questionId, option) {
    this.#answers[questionId] = option;

    if (!this.#path) return;

    if (this.#step < this.#questions.length - 1) {
      this.#step += 1;
      this.#renderQuestion();
    } else {
      this.#recommendation = this.#recommend();
      this.#showPanel('email');
      const emailPanel = this.querySelector('[data-quiz-email] h2');
      if (emailPanel instanceof HTMLElement) {
        emailPanel.tabIndex = -1;
        emailPanel.focus({ preventScroll: true });
      }
    }
  }

  #goBack() {
    if (this.#step > 0) {
      this.#step -= 1;
      this.#renderQuestion();
    } else {
      this.#showPanel('intro');
    }
  }

  #reset() {
    this.#path = null;
    this.#questions = [];
    this.#step = 0;
    this.#answers = {};
    this.#recommendation = null;
    this.#showPanel('intro');
  }

  /**
   * @param {'name' | 'intro' | 'questions' | 'email' | 'result'} name - Panel to show.
   */
  #showPanel(name) {
    for (const panel of this.querySelectorAll('[data-quiz-panel]')) {
      if (panel instanceof HTMLElement) panel.hidden = panel.getAttribute('data-quiz-panel') !== name;
    }

    const header = this.querySelector('[data-quiz-header]');
    if (header instanceof HTMLElement) header.hidden = name !== 'questions';
  }

  /**
   * Maps the recorded answers onto a product recommendation. Encodes the
   * outcome mapping from the Tiiga quiz brief: higher activity or bulk-buying
   * intent upgrades the pick to the 30-serving tub (buy more, save more).
   *
   * @returns {Recommendation}
   */
  #recommend() {
    const a = /** @type {Record<string, string>} */ ({});
    for (const [id, option] of Object.entries(this.#answers)) a[id] = option.value;

    const pathId = this.#path?.id ?? 'general';
    let product = 'packs';
    let subscription = false;
    let reason = 'hydration';
    let upsell = false;

    if (pathId === 'womens') {
      const byConcern = {
        bloating: { product: 'packs', subscription: true, reason: 'gut' },
        energy: { product: 'tub', subscription: false, reason: 'energy' },
        hydration: { product: 'packs', subscription: false, reason: 'hydration' },
        immune: { product: 'packs', subscription: false, reason: 'immune' },
      };
      ({ product, subscription, reason } = byConcern[a.concern] ?? byConcern.hydration);
      if ((a.day === 'active' || a.water === 'cups8plus') && product !== 'tub') {
        product = 'tub';
        upsell = true;
      }
    }

    if (pathId === 'mens') {
      const byGoal = {
        performance: { product: 'tub', reason: 'performance' },
        energy: { product: 'tub', reason: 'energy' },
        gut: { product: 'packs', reason: 'gut' },
        sugar: { product: 'packs', reason: 'sugar' },
      };
      ({ product, reason } = byGoal[a.goal] ?? byGoal.energy);
      if (a.format === 'packs') product = 'packs';
      if (a.format === 'tub') product = 'tub';
      if (a.format === 'autoship') subscription = true;
      // An explicit stick-pack preference wins over the volume upsell.
      if (
        a.format !== 'packs' &&
        (a.workouts === 'daily' || a.workouts === 'threetofive') &&
        product !== 'tub'
      ) {
        product = 'tub';
        upsell = true;
      }
    }

    if (pathId === 'general') {
      const byShop = {
        tryfirst: { product: 'packs', reason: 'first_timer' },
        subscribe: { product: 'packs', subscription: true, reason: 'value' },
        bulk: { product: 'tub', reason: 'value' },
      };
      ({ product, subscription = false, reason } = byShop[a.shop] ?? byShop.tryfirst);
      if (a.matters === 'taste') reason = 'taste';
      if (a.matters === 'clean') reason = 'clean';
      if (a.matters === 'value') {
        reason = 'value';
        // "Try it first" is an explicit one-time choice; don't override it.
        if (!subscription && a.shop !== 'tryfirst') {
          product = 'tub';
          upsell = true;
        }
      }
    }

    if (pathId === 'active') {
      const byTiming = {
        pre: { product: 'tub', reason: 'performance' },
        during: { product: 'packs', reason: 'portable' },
        post: { product: 'tub', reason: 'recovery' },
        // A daily habit means volume: the tub, on subscription. Only the
        // explicit portable answer ('during') keeps the sticks.
        daily: { product: 'tub', subscription: true, reason: 'value' },
      };
      ({ product, subscription = false, reason } = byTiming[a.timing] ?? byTiming.pre);
      // "During, portable" is an explicit stick-pack choice; don't override it.
      if (
        a.timing !== 'during' &&
        (a.challenge === 'recovery' || a.challenge === 'cramps') &&
        product !== 'tub'
      ) {
        product = 'tub';
        upsell = true;
        reason = a.challenge === 'recovery' ? 'recovery' : 'performance';
      }
    }

    return { product, subscription, reason, upsell };
  }

  async #submit() {
    const form = this.#form;
    const emailInput = form?.querySelector('input[type="email"]');
    if (!form || !(emailInput instanceof HTMLInputElement) || !emailInput.checkValidity()) {
      emailInput?.reportValidity();
      return;
    }

    const email = emailInput.value.trim();
    const tagsInput = form.querySelector('input[name="contact[tags]"]');
    if (tagsInput instanceof HTMLInputElement) tagsInput.value = this.#tags().join(', ');
    const firstNameInput = form.querySelector('[data-quiz-first-name]');
    if (firstNameInput instanceof HTMLInputElement) firstNameInput.value = this.#firstName;

    const button = form.querySelector('button[type="submit"]');
    if (button instanceof HTMLButtonElement) button.disabled = true;

    // Fire-and-forget: the result should show even if either network call fails.
    try {
      await fetch(form.action, { method: 'POST', body: new FormData(form) });
    } catch {
      // Ignored: Shopify sign-up failure must not block the quiz result.
    }
    this.#pushToKlaviyo(email);

    this.#showResult();
  }

  /**
   * @returns {string[]} Customer tags encoding the quiz outcome and answers.
   */
  #tags() {
    const pathId = this.#path?.id ?? 'unknown';
    const tags = ['tiiga-quiz', `quiz-path-${pathId}`];

    for (const [id, option] of Object.entries(this.#answers)) {
      // Age is shared across paths, so its tag stays path-agnostic.
      tags.push(id === 'age' ? `quiz-age-${option.value}` : `quiz-${pathId}-${id}-${option.value}`);
    }

    const reco = this.#recommendation;
    if (reco) {
      tags.push(`quiz-reco-${reco.product}`);
      if (reco.subscription) tags.push('quiz-reco-subscription');
    }

    return tags;
  }

  /**
   * @param {string} email - Email the visitor left on the capture step.
   */
  #pushToKlaviyo(email) {
    const pathId = this.#path?.id ?? 'unknown';
    const reco = this.#recommendation;

    /** @type {Record<string, string | boolean>} */
    const properties = {
      quiz_path: pathId,
      quiz_completed_at: new Date().toISOString(),
    };
    if (this.#firstName) properties.quiz_first_name = this.#firstName;
    for (const [id, option] of Object.entries(this.#answers)) {
      if (id === 'age') {
        properties.quiz_age = option.value;
      } else {
        properties[`quiz_${pathId}_${id}`] = option.value;
      }
    }
    if (reco) {
      properties.quiz_recommendation = reco.product;
      properties.quiz_recommend_subscription = reco.subscription;
    }

    const onsite = /** @type {{ identify?: Function } | undefined} */ (window.klaviyo);
    if (onsite?.identify) {
      const identity = { $email: email, ...properties };
      if (this.#firstName) identity.$first_name = this.#firstName;
      onsite.identify(identity);
      return;
    }

    const companyId = this.getAttribute('data-klaviyo-key');
    if (!companyId) return;

    fetch(`https://a.klaviyo.com/client/profiles/?company_id=${encodeURIComponent(companyId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', revision: '2024-10-15' },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: this.#firstName
            ? { email, first_name: this.#firstName, properties }
            : { email, properties },
        },
      }),
    }).catch(() => {
      // Ignored: Klaviyo failure must not block the quiz result.
    });
  }

  #showResult() {
    const reco = this.#recommendation ?? this.#recommend();
    this.#showPanel('result');

    const eyebrow = this.querySelector('[data-quiz-result-eyebrow]');
    if (eyebrow instanceof HTMLElement && this.#firstName) {
      const template = eyebrow.getAttribute('data-template') ?? '';
      const name = this.#firstName.charAt(0).toUpperCase() + this.#firstName.slice(1);
      if (template.includes('[name]')) eyebrow.textContent = template.replace('[name]', name);
    }

    for (const card of this.querySelectorAll('[data-quiz-result-card]')) {
      if (card instanceof HTMLElement) {
        card.hidden = card.getAttribute('data-quiz-result-card') !== reco.product;
      }
    }

    const activeCard = this.querySelector(`[data-quiz-result-card="${reco.product}"]`);
    const reasonSlot = activeCard?.querySelector('[data-quiz-reason]');
    if (reasonSlot) reasonSlot.textContent = this.#data.reasons[reco.reason] ?? '';

    const subscriptionTip = activeCard?.querySelector('[data-quiz-subscription-tip]');
    if (subscriptionTip instanceof HTMLElement) subscriptionTip.hidden = !reco.subscription;

    const resultHeading = this.querySelector('[data-quiz-panel="result"] h2');
    if (resultHeading instanceof HTMLElement) {
      resultHeading.tabIndex = -1;
      resultHeading.focus({ preventScroll: true });
    }
  }
}

if (!customElements.get('quiz-component')) {
  customElements.define('quiz-component', QuizComponent);
}

/**
 * @typedef {object} QuizPath
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {{ id: string, text: string, options: { value: string, label: string }[] }[]} questions
 */

/**
 * @typedef {object} Recommendation
 * @property {string} product - 'packs' or 'tub'.
 * @property {boolean} subscription - Whether to nudge toward subscribing.
 * @property {string} reason - Key into the reasons copy map.
 * @property {boolean} upsell - Whether the pick was upgraded for volume.
 */

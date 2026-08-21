import { Component } from '@theme/component';

/**
 * @typedef {object} Refs
 * @property {HTMLElement} frame - Wrapper holding the rendered `<video>`.
 * @property {HTMLButtonElement} trigger - Poster overlay that starts playback.
 */

/**
 * A customer testimonial tile in the reviews carousel.
 *
 * The clip renders paused behind its poster so the carousel stays quiet; the
 * first click starts it with sound and hands over to the native controls, so
 * scrubbing, volume, and fullscreen need no custom UI.
 *
 * @extends {Component<Refs>}
 */
class ReviewVideoComponent extends Component {
  requiredRefs = ['frame', 'trigger'];

  /** Starts the clip and reveals the native controls. */
  play() {
    const video = this.refs.frame.querySelector('video');

    if (!video) return;

    this.classList.add('review-video--playing');
    video.controls = true;
    video.play();
    video.focus();
  }
}

if (!customElements.get('review-video-component')) {
  customElements.define('review-video-component', ReviewVideoComponent);
}

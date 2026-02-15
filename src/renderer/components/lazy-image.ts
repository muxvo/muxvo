/**
 * Lazy Image Loader
 *
 * Uses IntersectionObserver for viewport-based lazy loading.
 */

export function createLazyImageLoader() {
  function usesIntersectionObserver(): boolean {
    return true;
  }

  function preloadsOffscreen(): boolean {
    return false;
  }

  return {
    usesIntersectionObserver,
    preloadsOffscreen,
  };
}

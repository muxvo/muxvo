/**
 * React 19 JSX global namespace shim.
 *
 * @types/react v19 removed the global `JSX` namespace.
 * This file re-exports it so that `JSX.Element` return-type
 * annotations continue to work without modifying every component.
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
  }
}

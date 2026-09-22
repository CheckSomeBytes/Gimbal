import { useCallback, useRef } from 'react';

/**
 * Click-outside dismissal for a modal/popup overlay that survives dragging.
 *
 * The obvious approach - `onClick` on the overlay plus `stopPropagation` on the
 * inner box - closes the popup when a drag starts inside it and ends outside.
 * A `click` event fires on the nearest common ancestor of the mousedown and
 * mouseup targets, so releasing over the backdrop dispatches `click` on the
 * overlay itself and the inner handler never runs. Selecting text in a field
 * and overshooting the edge was enough to lose whatever was being typed.
 *
 * Instead, track where the press started and only dismiss when both the press
 * and the release land on the overlay - a real click on the backdrop.
 *
 * Usage:
 *   const overlay = useOverlayDismiss(onClose);
 *   <div className="my-overlay" {...overlay}>
 *     <div className="my-popup">...</div>
 *   </div>
 *
 * The inner box no longer needs an `onClick` guard, though leaving one is
 * harmless.
 */
export function useOverlayDismiss(onDismiss: () => void) {
  // Whether the current press started on the backdrop rather than inside the
  // popup. A ref, not state: this must not trigger a re-render mid-drag.
  const pressStartedOnOverlay = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // currentTarget is the overlay; target is what was actually pressed.
    pressStartedOnOverlay.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const startedOutside = pressStartedOnOverlay.current;
      pressStartedOnOverlay.current = false;
      // Only a press and release both on the backdrop counts as dismissing.
      if (startedOutside && e.target === e.currentTarget) {
        onDismiss();
      }
    },
    [onDismiss]
  );

  return { onMouseDown, onMouseUp };
}

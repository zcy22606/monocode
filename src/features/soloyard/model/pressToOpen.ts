type Press = {
  button: number;
  detail: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * Soloyard: a session row opens on the press, like a macOS sidebar, instead of
 * on the release, which added the ~100 ms the button is held to every switch.
 * Only a plain left press opens; modifier clicks keep their click behaviour.
 */
export function opensOnPress(event: Omit<Press, "detail">): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** A click the press already opened. Keyboard activation (`detail` 0) is not. */
export function openedOnPress(event: Press): boolean {
  return event.detail > 0 && opensOnPress(event);
}

/** Row handlers: open on a plain press, on click for keyboard activation. */
export function pressToOpen(open: () => void) {
  return {
    onMouseDown: (event: Press) => {
      if (opensOnPress(event)) open();
    },
    onClick: (event: Press) => {
      if (!openedOnPress(event)) open();
    },
  };
}

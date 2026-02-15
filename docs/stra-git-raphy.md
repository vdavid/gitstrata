The landing logo thing is a **state machine with 6 phases** managing the interactive hover behavior:

1. **`initial`**: the CSS animation is playing (tig→git on page load). No hover reactions.
2. **`showing-git`**: default state after the initial animation. Waiting for interaction. The mouse must leave and
   re-enter to arm the hover trigger (`needsFreshEnter` flag).
3. **`hover-pending`**: mouse is over "git", 1-sec timer running. If the mouse leaves before 1s, cancels and goes back
   to `showing-git`.
4. **`animating-to-tig`**: git→tig reverse animation running (2s). All hover events ignored.
5. **`showing-tig`**: text reads "Stratigraphy". Hovering cancels the revert timer; leaving starts/restarts the 5-sec
   revert timer.
6. **`animating-to-git`**: tig→git forward animation running (2s). All hover events ignored. On finish, goes to
   `showing-git` with `needsFreshEnter = true` (mouse must leave and re-enter).

The subsequent animations use the **Web Animations API** (`element.animate()`) to interpolate the registered
`@property --tig-swap`, so the same CSS `sin()`/`cos()` transforms drive the circular path in both directions.
`prefers-reduced-motion` is respected (animations become near-instant).

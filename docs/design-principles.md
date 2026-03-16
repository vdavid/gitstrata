# Design principles

- Prefer an elegant architecture over quick hacks. We have time to do outstanding work, and we are in this for the long
  run.
- Always apply radical transparency: make the internals of what's happening available. Like, don't just put a "Syncing"
  spinner but write exactly what's happening. Don't overshare/overcomplicate, but the user must understand what's
  happening to an extent that they could explain it to someone else if asked.
- Always make features extremely user-friendly. The UI should help the user accomplish their goals with minimal
  friction.
- For longer processes:
    1. Always run the process in the background. Blocking the UI or other actions is an absolute no-go.
    2. Show some animation to communicate that the app is doing something.
    3. If we know what the end state looks like and we can quantify the progress, show a progress bar and counter.
    4. If we have a guess how long the operation will take, show an ETA.
    5. Progress bars staying longer at 100% than at 99% or any other percentage is NOT allowed. The bar should reach
       100% at the exact moment the operation is complete. If the operation ends up taking longer than expected, slow
       down the bar instead. Better to stay at 80% for a while than to hit 100% and then keep waiting.
- All actions longer than ~1 second should be immediately cancelable, canceling not just the UI but any background
  processes as well, to avoid wasting the user's resources. If rolling back is an option, we should consider that too.
- Always keep accessibility in mind. Features should be available to people with impaired vision, hearing, and cognitive
  disabilities.

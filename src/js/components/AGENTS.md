# Components, styling and theme

App-owned custom elements live here, **with one deliberate exception**:
`../remote-playback/control.js`. It lives with the feature it belongs to rather
than with its siblings, because remote playback is a plugin that has to be
deletable as a directory — a control filed under `components/` would leave the
feature spread across two places and the deletion story a half-truth. The rule
to take from this is the reason, not the exception: an element that belongs to
one detachable feature goes with that feature; everything the app itself owns
goes in `components/`. `component-contract.test.js` checks the exception by name
rather than by scanning the directory — a sweep that finds elements by folder
stops covering one the moment it moves, which is precisely what happened when
this one did.

## Custom elements

The rules below apply to every app custom element, wherever it sits.

- Build components in light DOM (ordinary markup in the page, visible to normal
  CSS and DevTools) with an inline `@scope` style block, which confines the
  rules inside it to that component's subtree. This keeps component markup easy
  to inspect, test and integrate, while stopping its selectors leaking out into
  the rest of the page.
- Keep selectors inside `@scope` short and component-local. Reserve `style.css`
  for app-wide styling, not component internals.
- **No backticks anywhere inside a component's markup or CSS, comments
  included.** The whole of `render()` is one template literal, so a backtick
  quoting a property name ends it, and the file stops parsing — which takes the
  module, and with it the app, not just the component. Write the name bare.
  Nothing catches this but running the app: `npm test` reports it as every
  app-harness test failing to import at once, which reads like anything except a
  punctuation mark in a comment.
- Do not use Shadow DOM (which hides a component's markup and styles from the
  page) for normal app components. If a change seems to need it, raise the
  reason first; the app is internal and should stay easy to inspect and style.
- **A panel that floats over the page is a native `popover`.** Opening it is the
  invoker's job, dismissing it is the browser's, and the component keeps no
  state of its own about either. `app-menu` is the pattern, and carries the
  reasoning — including why it no longer opens on hover. The panel hangs off its
  button by CSS anchor positioning, falling back to the browser's centred
  placement where that is unsupported, and the button sets no `aria-expanded`:
  `popovertarget` already reports it, and a static one would override the live
  state.

## Theme and colour

These govern `../../style.css` and `../theme-utils.js` as much as the components
themselves; `component-contract.test.js` checks both rules.

- **Never give an element its own colour transition for the theme's sake.** A
  theme change is animated once, for the whole surface: `theme-utils.js` swaps
  it inside a view transition, under a `data-theme-switching` mark that
  `style.css` uses to suppress every transition. Light and dark here are
  inverses, so a pair of text and ground easing separately passes through the
  middle where the two are the same grey and the words vanish.
- **`--color-change-duration`** (0.18s, 0s under `prefers-reduced-motion`) is
  for the colour changes a *reader* causes — a hover, a focus ring. Form
  controls get it by default; nothing else needs it.

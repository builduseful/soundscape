# Repository Guidelines

## Custom Elements

- App-owned custom elements live in `src/components`.
- Use light DOM with an inline `@scope` style block by default. This keeps component markup easy to inspect, test, and integrate while preventing component selectors from leaking outward.
- Keep selectors inside `@scope` short and component-local. Reserve `style.css` for app-wide styling, not component internals.
- Do not use Shadow DOM for normal app components. If a change seems to need Shadow DOM, raise the reason first; the app is internal and should stay easy to inspect and style.

## Audio Invariants

- Soundscape intentionally has two coordinated playback surfaces: one long-lived `HTMLAudioElement` for browser-observable playback, and decoded Web Audio buffers for audible playback.
- The `HTMLAudioElement` exists for platform integration, not sound output or visible UI. Browser and OS media controls, notifications, autoplay policy, audio focus, and source/preload state all depend on browser-observable media plumbing; Web Audio alone is not a reliable substitute.
- Keep the media element loaded and play/pause it with app state. Route it through zero gain so platform media plumbing observes playback without doubling the audible output.
- Audible looping comes from decoded `AudioBufferSourceNode`s. These ambience tracks need seamless loop points, and native `HTMLAudioElement.loop` has produced audible gaps or discontinuities on short loops.
- Create and resume `AudioContext` from the playback flow, not page load, so browser user-gesture policy stays intact.
- Preserve stale-request guards around track changes. Buffer fetch/decode work can finish out of order, and older requests must not replace newer playback.
- Treat Media Session and Audio Session APIs as progressive enhancements. When available, keep metadata, playback state, actions, and decoded-buffer position state in sync; when unavailable, playback should still work.

## Development

- Start the local dev server with `npm start` (see `package.json` for the exact command).
- **Agents only:** The shell tool has a timeout, so `npm start` will be killed before the server is ready. To start the server in a detached background process, use:
  ```powershell
  Start-Process -FilePath "pwsh" -ArgumentList "-Command", "npx serve@14.2.6 . --listen 4321 --no-port-switching" -WindowStyle Hidden -PassThru
  ```
  Then navigate the browser — the browser will retry until the server is ready.
  - To stop the server:
    ```powershell
    Get-NetTCPConnection -LocalPort 4321 -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' } |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue }
    ```
    If the command returns no output, the process may have already dropped its listening socket but still be running. Verify with `Get-Process -Name "node"` or `Get-NetTCPConnection -LocalPort 4321` and force-kill the remaining node process if needed.
  - The app uses a service worker, so the browser may display a cached version of the page after the server is stopped. To confirm the server is actually running, use the browser's Network panel or perform a hard reload (`Ctrl+Shift+R`).
- Do not open `index.html` directly via `file://`; the app requires HTTP for module loading and service worker support.

## Testing

- Run `npm test` for the dependency-free unit tests (see `package.json` for the exact command).

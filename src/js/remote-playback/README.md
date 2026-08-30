# Remote playback

How Soundscape plays on a Chromecast or an AirPlay speaker. This is a
**detachable plugin**: everything in this directory can be deleted, and the app
still boots, plays and passes every non-remote test.

Read this before changing anything under `src/js/remote-playback/`. Most of what
follows is measured platform behaviour — browser bugs, silent rejections and
device-only failures that cost real debugging to find and are invisible to the
test suite. It is expensive to rediscover and easy to undo by tidying.

## Invariants

### The shape

The module headers carry the reasoning — `playback-output.js` for the port,
`index.js` for the registry, `control.js` for the component. This section is the
rules themselves, and the evidence you cannot get from reading the code.

- **The core knows there may be more than one output, and nothing about what any
  of them are.** Everything it does to "the thing that is playing" goes through
  `activeOutput()`. `AudioPlayer` implements the same port as every remote, and
  the contract suite runs against all four implementations — an interface only
  remotes implement is a cast API wearing a costume.
- **`activeOutput()` is derived, never assigned.** A variable holding "who owns
  playback" goes stale in the window between a provider flipping and the app's
  handler running — and the local element's own `pause` event, fired *by the
  handover itself*, re-enters during exactly that window. Two of the four
  device-only bugs in this feature's history were a second copy of a fact going
  stale.
- **The handover is core, not plugin.** A provider reports that a connection
  changed; what that *means* for the soundscape — who pauses, who resumes, what
  the listener is told — is the app's. A provider that could move the audio would
  be a second answer to "which output owns it", and there is deliberately one.
- **Casting is not a second output the app mixes into.** Nothing in the browser
  can route an `AudioContext` to a cast target, so exactly one of `localOutput`
  and `remotePlayback` drives playback at any moment. While a cast is connected
  the local element is parked and the `AudioContext` is suspended.
- **Selection happens once, at boot, and `null` is an ordinary answer** — Firefox
  and Samsung Internet get it. A browser cannot grow a cast API while the page is
  open, so nothing re-asks and nothing downstream branches on which provider it
  got. The registry's order is load-bearing (Cast SDK first, then the media
  element path) and the two capability checks are pointed at each other on
  purpose; see the `isCastSdkCapable` bullet below.
- **Everything about playing somewhere else lives in `src/js/remote-playback/` —
  one directory, the control included.** The test of that claim is executable:
  delete the directory and its test files, then the references, and the app
  boots, plays, and passes every non-remote test. Outside `script.js` the
  references are the `<remote-playback>` tag and `#remoteTransportElement` in
  `index.html`, the `sw.js` precache entries, and the `.m4a` bypass. Run it on a
  scratch branch before believing it again.
  - **The claim is about *files*, not lines, and `script.js` is where the
    difference shows.** Deleting the two imports is not enough on its own: with
    `remotePlayback` gone, everything that reads it goes too. That is the whole
    handover region, plus four sites outside it that a search for
    `remotePlayback`/`isRemoteActive`/`activeOutput` finds in one pass — the
    volume-persistence guard in the slider listener, the failed-skip rollback in
    `changeTrack`, the transport refresh in `playCurrentTrack`, and
    `syncVolumeControlForRemote`. `activeOutput()` then collapses to
    `localOutput` and `isRemoteActive()` to `false`, which is a mechanical
    substitution rather than an untangling.
  - What the claim buys is that the deletion stops there. `tracks.js`,
    `audio-player.js`, `style.css` and the rest of `index.html` are untouched,
    and no remote-only fact has to be dug out of any of them — which is what the
    catalog and the stylesheet each used to cost before the restructure.
  - The control is **not** re-exported from `index.js`: `control.js` extends
    `HTMLElement` at import time, which would make the registry unloadable
    outside a browser. Two imports from one directory is the cheaper price, and
    both still start `remote-playback/`.
- **The control cannot connect, read a connection, or move audio.** It gets a
  four-function facade (`prompt`, `prepare`, `isTransportReady`, `onUnavailable`)
  and owns everything the user sees. With no provider it removes itself, so a
  browser that cannot cast ships no remote markup at all.

### The platform facts
- **Casting is three mechanisms, not one, and the difference decides everything
  below.** Chrome on Android *flings*: the receiver is handed the URL and fetches
  it. Chrome on desktop (121+) *remotes*: the browser demuxes locally and streams
  encoded frames over the Cast mirroring protocol — `MediaRouterDesktop::
  GetFlingingController` returns `nullptr`, so there is no flinging path there at
  all. Safari (13.1+, which does implement the Remote Playback API — the AirPlay
  backend is now a fallback for older WebKit only) drives AirPlay audio, where
  the Mac or iPhone decodes and streams to the speaker. Two of the three fetch
  the twin *through the page*, and only the first could loop without the browser.
- Because the local element is parked on purpose, its own `play`/`pause` events
  say nothing about what the listener hears. `handleBrowserPlaybackStart` and
  `handleBrowserPlaybackPause` must stay guarded by `isRemoteActive()`, or parking
  the element reads as "the user paused" and stops the receiver too. Same for
  `handleVisibilityChange`: a cast keeps playing whether the tab is visible or not.
  These are two of the three paths entitled to name the local player rather than
  ask `activeOutput()` — they are *about* that element, not about whatever is
  currently making sound.
- **The transport element's `play`/`pause` events are the exact opposite, so do not
  make the two symmetrical.** The receiver has its own controls and the person
  holding them is not this page; the Remote Playback API reports nothing about
  them, so those events are the app's only word that the room went quiet. They
  drive `onPlaybackChange` → `syncPlaybackState`, which **re-reads** the transport
  rather than trusting the event, and which never drives the transport back. Both
  properties are load-bearing: assigning `src` runs the media load algorithm,
  which pauses the element and fires `pause`, so every track change while casting
  emits one for a cast that is not stopping at all. A handler that trusted the
  event would clear the intent the very next `play()` had just set.
  `app-remote-playback.test.js` pins both.
- **The two transports answer a device's own pause differently, and the
  asymmetry is in *what tells the two apart*, not in whether the intent moves.**
  Both handlers mirror the receiver's settled state into `playbackRequested`,
  because without it nothing outside the app ever lowers the intent, and ending a
  cast that had been paused on the speaker started the soundscape on this machine
  instead of leaving the room quiet. What differs is the discriminator each one
  has available:
  - On the SDK path it is the player state: a settled `PAUSED` clears, while
    `BUFFERING` or `IDLE` — a receiver in the middle of something — does not.
    `providers/cast-sdk.test.js` pins both halves.
  - On the media element path there is no player state, only the element, so the
    discriminator is `readyState`. The media load algorithm drops it to
    `HAVE_NOTHING` *before* queueing the spurious `pause`, so an element with no
    header is reporting its own reload and is ignored; one that has read its
    metadata is reporting the room. That gate is
    `MediaElementController.handleTransportPlaybackChange`, and removing it is
    how the speaker-pause bug comes back. `app-remote-playback.test.js` pins each
    side — "the pause a source change fires cannot clear the intent" and "a pause
    pressed on the device hands back silence, not sound".

  The contract suite deliberately pins neither as universal: the *rule* is
  shared, the evidence each transport can offer for it is not.
- **One press, one `loadMedia`, and never two open at once.** A single track
  change reaches `CastSdkController.loadTrack` three times — the app keeps the
  transport current, `startTrack` sets it again, and `play()` asks a third time.
  Each is a full load and a real receiver re-fetches the file for every one, so a
  skip restarted the soundscape twice before settling. The media element path has
  never needed any of this: `applyElementSource` compares and assigns in the same
  turn.
  - **Ask `targetUrl()` — where the receiver is *going* — never `loadedUrl`.**
    `loadedUrl` is written when the receiver answers, so for the length of a
    round trip it names the track being *left*, and that window is where a person
    pressing skip twice lives. Both skip bugs this feature has had were that one
    mistake from opposite sides: asking `loadedUrl` meant *next then previous*
    read as "already loaded" and sent nothing, leaving the room on the soundscape
    the app had navigated away from under a title naming the other one; and
    `sendLoad` writing `loadedUrl` unconditionally meant two skips the same way
    round opened two `loadMedia` calls, which a receiver may answer in either
    order, so the older landing last recorded a track the room had left and the
    next press of play re-loaded it over what was playing. Both were invisible
    from the app's side: every skip had gone exactly to plan.
  - Loads are therefore **coalesced, not parallel**. `drainLoads` keeps one
    request open, `pendingTrack` is a slot holding only the newest destination,
    and anything superseded while still queued is never sent — so a run of
    presses costs the room one restart plus whatever was already in flight.
    `loadedUrl` is written only on success, by the one open request, which is
    what makes it trustworthy.
  - The slot holds the **track**, and `targetUrl()` derives the URL from it. Two
    fields for one destination is the same second-copy-going-stale that the
    bullets above are made of.
  - A superseded load's failure is reported to nobody: its caller has been
    navigated away from (the app discards it by generation anyway), and the newer
    caller must not be handed a failure belonging to a soundscape it never asked
    for, nor lose its own load to it. A failure that is *not* superseded empties
    the slot before it propagates, or the retry that follows reads as a request
    already under way and never reaches the device.
    `providers/cast-sdk.test.js` pins each of these.
- Cast plays the `.m4a` twin, never the `.opus` original. Safari could not decode
  Ogg Opus at all before 18.4, and desktop remoting only carries Opus if the sink
  advertises it — AAC in MP4 is the one format every path accepts, and one shared
  format keeps a single code path for every backend rather than per-platform
  codec selection. `remote-playback/track-source.js` derives the twin's name from
  the track *id* — never from the local file, which is itself chosen per browser
  and on a fallback would name a file that does not exist — and it lives there
  rather than in
  `tracks.js` so the catalog carries no remote-only fact — delete the plugin and
  `tracks.js` is untouched. `remote-playback-assets.test.js` checks every twin
  exists on disk, has no orphans, and is never the `.opus` original.
- Everything platform-specific lives in the two backend objects in `providers/media-element.js`, and
  it comes to only two things: how you open the picker, and how you observe the
  connection. Once connected, both platforms are driven by plain
  `src`/`play`/`pause`. Keep it that way — new targets should be a backend, not a
  branch in the controller.
- **`remotePlaybackBackend.isSupported` also refuses Chromium, and that is not a
  bug.** Chromium ships the whole Remote Playback API and never opens a picker
  for this app's audio — measured on Chrome desktop, Chrome for Android and
  Samsung Internet — so feature detection cannot tell a working implementation
  from a decorative one; only the engine can. Chrome never reaches this backend
  (it takes the Cast SDK), so the check decides one case: a Chromium browser with
  no Cast SDK to fall back on. That is Samsung Internet, where the button
  appeared and did nothing at all, and where it is now correctly absent. The
  probe is `navigator.userAgentData.brands`, which is Chromium-only — Safari and
  Firefox have no `userAgentData`, so they cannot be caught by it by accident.
  `providers/cast-sdk.js`'s `isCastSdkCapable` narrows with the same brand signal in the
  other direction — requiring `"Google Chrome"` rather than excluding
  `"Chromium"` — because the Presentation API and secure-context checks alone
  are Chromium-wide too, and Samsung Internet passes both; without the brand
  check it would reach the Cast SDK controller instead of falling through to
  this one, get a button, and fail on press instead of having none. Keep the two
  checks pointed at each other.
- **Do not "tidy" `remotePlaybackBackend.isSupported`.** It probes
  `watchAvailability`, a method the module deliberately never calls, and that is
  not an oversight. Because Safari 13.1+ implements part of the Remote Playback
  API, the member being probed is what decides whether modern Safari selects that
  backend or the AirPlay one — so narrowing the check to the methods actually used
  could silently re-route Safari onto an untested path, on the one platform this
  repo cannot test.
- Chrome needs the Google Cast Web Sender SDK because the standards-track answer
  does not work there: `remote.prompt()` never opened a picker on desktop or
  Android, since Chrome only offers devices once its Media Router judges the
  media "remotable" and that judgement never engaged for a plain audio file.
  `providers/cast-sdk.js` records the SDK-free routes tried first. The script is
  fetched from `gstatic.com`, so it is not precached and nothing loads it until
  the button is pressed — a visitor who never casts never contacts Google.
- Do not replace the twins with an HLS playlist that lists one short segment
  hundreds of times. It is a real technique and it looks tailor-made for this
  problem — one 30 s segment on disk, a text playlist, hours of seamless output,
  every repeat an HTTP cache hit — but it does not survive the three-mechanism
  split above. Only Chrome *Android* hands the URL to a receiver that can parse
  HLS. Chrome on **desktop** demuxes the media in the browser and streams frames,
  and Blink has no native HLS demuxer at all: without MSE and a JS library, the
  playlist simply fails to load, so the platform with the most cast devices
  attached would be the one that stopped working. Safari would play it, and
  AirPlay-to-a-speaker would have the *sending* device fetch it anyway, where
  AVFoundation's caching is not something to rely on. A single self-contained
  file is the only shape all three mechanisms read the same way, and the lever on
  seam frequency is `REPEAT_TO_SECONDS`, which costs bytes and nothing else.
- Sonos needs no code of its own. Modern models (One, Beam, Arc, Five, Move,
  Roam on S2) are AirPlay 2 targets and appear in the AirPlay picker.
- **The app never asks whether a cast device exists. Do not reintroduce
  availability watching.** Both platforms discover devices inside their own
  picker, so asking in advance bought one thing — a conditionally visible button
  — at the price of continuous local-network scanning for the life of the page,
  which Apple documents as a battery cost. `prompt()` needs no prior
  `watchAvailability` call: `RemotePlayback::prompt()` only consults
  `availability_` to *reject early*, and it sits at `UNKNOWN` when nothing is
  watching. A machine with no devices gets the browser's own picker rather than
  an error to report, so there is nothing to hand-roll for that case either.
  `providers/media-element.test.js` asserts neither backend registers a scan.
  What is **not** optional is metadata: see the `prompt()` bullet below.
- The control is therefore always present when it exists at all, decided once at
  boot. There is no path that re-hides an attached control, which is what makes
  "a live cast can never lose its stop button" true by construction rather than
  by a guard.
- **The pulse's `@keyframes` sits outside the component's `@scope` block**, inside
  the same `<style>`. `@keyframes` is not a style rule, so scoping it leaves the
  `animation` property naming keyframes that do not exist — and the wait simply
  never animates, silently. Pinned by the contract test.
- `prompt()` rejects as part of normal use: `NotAllowedError` (picker dismissed),
  `NotFoundError` (no device found, or it went away), `OperationError` (a second
  prompt raced the first), and `AbortError` (not in the spec, but Chromium has
  used it for dismissal). These are swallowed — but only once the transport has
  metadata, for the reason in the next bullet; without it `NotAllowedError` means
  the opposite thing. Only genuinely unexpected failures are logged. The common
  cause of that race — a double-click on the button — is
  refused outright by `MediaElementController.prompt()` rather than absorbed after the
  fact. There is no
  `disconnect()` in the Remote Playback API by design; prompting again while
  connected is what offers "stop casting".
- **Neither engine will open a picker on an element that has not read its
  header, and Chromium's way of saying so is silent.**
  `RemotePlayback::UpdateAvailabilityUrlsAndStartListening()` clears
  `availability_urls_` whenever `duration()` is `NaN` or at or under
  `kMinRemotingMediaDurationInSec`, and `PromptInternal()` with an empty list
  never contacts the presentation service — it posts `PromptCancelled()`, which
  rejects as `NotAllowedError` *"The prompt was dismissed."* Byte-for-byte the
  rejection a real dismissal produces. Safari reaches the same place from the
  other side, rejecting below `HAVE_METADATA` with `NotSupportedError`. Symptom:
  the cast button does nothing, on desktop and Android alike, with a clean
  console. Hence the metadata wait in `MediaElementController.prompt()`,
  `preload="metadata"` on the element, `+faststart` on the twins, and the service
  worker leaving `.m4a` alone.
  - The wait is capped (`TRANSPORT_METADATA_WAIT_MS`, 2.5 s) because `prompt()`
    must still be inside the browser's transient user activation window when it
    finally runs — five seconds in Chromium. Do not raise it past that.
  - **Never load the source inside `prompt()`.** A fresh `src` resets
    `readyState`, which is the state neither engine will open a picker on, so it
    would break the very call it was meant to serve. This is the single most
    tempting change in the file and it has been made twice.
  - One Chromium gate the app cannot work around: `IsLowEndDevice()` disables
    availability URL generation entirely, so on a low-RAM Android device
    `prompt()` never reaches a picker no matter what the element holds.
- **`preload="metadata"` is a hint, not a budget — do not assume that read is
  cheap.** Measured in Chrome against a ~1 MB twin, the first load buffers ~90% of
  the file and later track changes tens of KB each. That is what the two gates in
  `syncElementSource` are for: no backend, no source (Firefox spends zero bytes),
  and no gesture, no source (a restored tab nobody touches spends zero too).
  `app-remote-playback.test.js` pins them.
- Chromium refuses to *remote* media of 15 seconds or less
  (`kMinRemotingMediaDurationInSec`). Every twin must clear it — which the
  repeat-to-two-minutes rule below does with room to spare, but a new soundscape
  shorter than that would silently fail to cast on desktop Chrome. This no longer
  shows up as a missing button, since the button no longer depends on discovery;
  it would show up as a picker that lists nothing.
- Cast twins are the one asset the service worker does not handle — neither
  precached nor cached at runtime. They are identified by their directory
  (`resources/soundscapes/cast/`), not their extension: a local fallback may
  also be `.m4a`, and that one must stay cacheable or offline playback
  disappears for exactly the browsers needing the fallback. It is not a caching preference: `cacheIfOk`
  buffers the whole body and `handleRangeRequest` upgrades a range miss to a full
  fetch, so every partial read the transport element makes would become a whole
  megabyte. Passing them through leaves the browser fetching the bytes it
  actually asked for. `test/pwa.test.js` excludes everything under
  `resources/soundscapes/` from the precache, and separately proves the
  exemption admits `cast/` and refuses both local variants. The consequence to accept: casting needs the network,
  which is true of the Android path regardless, since there the receiver does the
  fetching.
- **`playCurrentTrack` checks the track generation before `finishTrackChange`, for
  every output and not just a remote one.** Two quick skips leave two changes in
  flight and a receiver can answer the first one last; the older skip would then
  write its captured track into the OS media UI while the receiver and the
  on-screen title are on the newer one. `AudioPlayer`'s own stale-request guard is
  **not** the same question and is deliberately no longer consulted here — it stops
  an older decode replacing the active source, which is not the same as whether
  this caller may write OS metadata — and a remote has no equivalent at all,
  because the whole point is that it is driven by plain `src`/`play`/`pause`. One
  guard, one site, impossible to forget per provider. Everything else in the
  playback tail re-reads live state and is self-correcting; `finishTrackChange(track)`
  is the one call carrying a value captured before the await. `app-remote-playback.test.js`
  pins it.
- **`playAudio` resumes on `holdsTrack(getCurrentTrack())`, not "is anything
  loaded".** Rejoining a session moves the app's current track to whatever the
  receiver is playing (see `adoptRemoteTrack`), so either output can be holding a
  soundscape the app is no longer on — and answering a press of play by resuming
  it would play the wrong thing. Asking whether *this* track is held sends both
  paths to `startTrack` when they disagree.
- The handover reads `AudioPlayer.wantsPlayback()`, not `isPlaybackRequested()`.
  A device connecting while the *first* track is still decoding finds
  `hasTrack()` false, which the ANDed reading would take for "the user wasn't
  playing" — handing the receiver silence after an explicit press of play.
  `playback-output.js` states the invariant and why the two must stay apart.
- `takeOverOutput` checks `remoteTransitionId` before **everything** it writes, not
  just the last line. A connect and a disconnect close together leave two
  transitions in flight; the stale one clearing or posting a playback error would
  overwrite the message belonging to the one still running. The log still happens
  either way — a failure is worth a developer's attention whether or not it is
  still worth the user's.
- **Volume is a per-transport capability, asked as `canControlVolume()`.** AirPlay
  answers false — element volume is forwarded to the receiver as a *stream* volume
  change that outlives the session, so there is no session-scoped way to set it —
  and the Cast SDK answers true, because `setVolumeLevel` is an explicit request.
  The app shows one of two honest shapes and never a third: a working slider,
  relabelled to say whose level it moves, or no slider at all. Deliberately
  **not** disabled-and-greyed — that read as broken rather than absent.
- **The handover parks the local element through `pauseForHandover()`, not
  `pause()`.** The app ignores that element's own events while a remote is
  active by asking, when one arrives, whether one *is* — and the answer can flip
  first. A session that fails as it opens disconnects while the park is still in
  flight, so the pause event it caused lands after the handback has already
  resumed local playback, reads as a person pressing pause, and stops the room.
  Suppressing at the source says the one thing the live read cannot: this pause
  carries no intent, whoever owns the output by the time anyone hears about it.
  The release is scheduled rather than awaited, so the handover never waits a
  task before the receiver may start. The harness delivers the event too early to
  reproduce the race, so `app-remote-playback.test.js` covers the outcome and
  `audio-player.test.js` pins the mechanism; it was verified end to end in a
  browser.
- **`restoreSavedVolume()` falls back to the local player's level, not the
  slider's.** While a remote drives the volume the control holds the *speaker's*
  level, adopted from the room — so for a listener who has never moved the slider
  and has nothing saved, falling back to it would hand the room's level to this
  device and keep it. The local player's own level is untouched by casting, which
  is exactly the one the handback restores.
- **The device's level is adopted on connect, never pushed.** Sending the page's
  slider position to the receiver would turn the speaker in the room to wherever
  it happened to sit, and on a Cast device that change outlives the session. For
  the same reason a level set while casting is not persisted: it belongs to the
  speaker, not to this app, and the saved preference is restored on handback.
- Media Session position state is not published while casting. The receiver owns
  the position and the page cannot read it, and the local player's answer is
  worse than none: it still holds the buffer from before the cast and its context
  is suspended, so it would pin a frozen position under a "playing" state. The
  1 s polling timer stays off for the same reason.
- Never rely on `loop`, or on `ended`, or on any end-of-media event. Neither spec
  promises the attribute is honoured remotely; where a browser does honour it, it
  implements it as a seek back to zero, which flushes the receiver's buffer and
  is audible. Worse, Chrome Android reports no end at all —
  `FlingingRenderer::OnMediaStatusUpdated` drops every status that is not playing
  or paused and never calls `client_->OnEnded()`, so Blink never runs its
  end-of-media algorithm: no `ended`, no `pause`, and `loop` never applied. The
  room goes quiet with the app still showing playing. Position is the one signal
  every platform keeps, so `LoopWatchdog` polls it and asks `MediaElementController` to
  restart a cast that has stopped advancing. It is kept a separate class on
  purpose: liveness policy, knowing nothing about elements, backends or URLs. Keep
  the `ended` handler too — it is one line and covers the receivers that do
  announce it — but it is not the safety net.
- The watchdog is patient before the first advance, not silent. A receiver can
  take seconds to fetch and buffer, and a restart into that would fight the
  connection it is still making — so a position that has never moved gets ~16 s
  (`STALLED_SAMPLES_BEFORE_FIRST_START`) against the ~4 s a position that has
  moved and then stopped gets. It must stay a count and not an open-ended
  reprieve: a restart is only a request, a receiver can swallow one and stay
  quiet, and `restartLoop` deliberately returns to the un-advanced posture. If
  that posture meant "never intervene again", the first restart would disarm the
  watchdog for the session and leave the app showing playing into a silent room —
  the exact failure it exists to catch. `providers/media-element.test.js` pins the retry.
- `npm run audio -- --cast` rebuilds the AAC twins (needs `ffmpeg`/`ffprobe` on PATH;
  host-only, not in `npm test` or the Docker image). It imports the app's own
  `applyLoopCrossfade`, trims to the loop period, and writes that period
  repeatedly until the file passes `REPEAT_TO_SECONDS` (two minutes). Repetition
  is bit-exact — every internal join is the sample-adjacent seam the crossfade
  built — so the only audible seam is the one at the end of the file, and the
  file's length is the only lever on how often it comes round. Re-run after
  replacing any `.opus` source.
- The cast crossfade is **not** fixed at `LOOP_CROSSFADE_MS`; it is stretched to
  whatever length lands the loop period on a 1024-sample AAC frame boundary
  (10–31 ms in practice). A partial final frame gets padded with silence by the
  encoder, and that padding sits exactly on the loop seam — measured at ~224
  samples, it took the seam discontinuity from 0.27x to 5.18x of the signal's own
  typical sample step. The build fails loudly if the period is not frame-aligned.
  This does not touch local playback, which still uses the 10 ms runtime fade.
  Alignment matters now for the *internal* joins between repeats, which are the
  seams the listener actually crosses; keep it if a native-looping receiver ever
  appears, but do not expect one today.
- What remains unfixable is AAC *encoder priming* at the head. It is intrinsic to
  the codec — the container's edit list is the mechanism for it, and every
  gapless-aware receiver honours it. `ffprobe` confirms the twins ship `edts`/
  `elst` with `initial_padding=0`.

## Testing

**Never cast to a real device from an automated run** — see AGENTS.md's Remote
Playback section for the rule. Everything below is satisfiable without one,
except the manual checklist at the end.

### Unit tests

- **Which fake to reach for is the whole trick, and there are three.** They fake
  different things on purpose, and picking the wrong one produces a test that
  proves something about the fake:
  - `test/helpers/remote-transport-fakes.js` fakes a **platform API** — a
    `RemotePlayback` object, a `cast.framework` namespace. Use it when the subject
    is a particular controller against a particular browser API
    (`providers/media-element.test.js`, `providers/cast-sdk.test.js`).
  - `test/helpers/fake-remote-playback.js` fakes **a PlaybackOutput**. Use it when
    the subject is "some remote output" rather than a platform. It is also the
    reference implementation the contract suite is written against: if the
    contract cannot be satisfied by something that simple, the contract is wrong.
  - The harness's `FakeRemotePlaybackUi` fakes **the control**, and deliberately
    implements none of it — it records what the app *told* the control and exposes
    `press()`. The control's own behaviour (pulse, glyph, announcements) is tested
    against the real class in `remote-playback-control.test.js`, with a DOM
    stand-in instead. A fake that reproduced the pulse would make every app test
    prove things about the fake.
- `test/playback-output-contract.test.js` runs one spec against **four**
  implementations — `AudioPlayer`, both providers, and the fake. `AudioPlayer`
  being in that list is the point: it is what proves the port is a port and not a
  cast interface with a second implementation bolted on. It also carries the leak
  test (listener counts net to zero across a connect/disconnect cycle) and pins
  the `isPlaybackRequested() ⇒ wantsPlayback()` implication.
- `test/app-remote-playback.test.js` covers the transport handoff end to end via the
  harness's opt-in `startAppTestEnvironment({ castDevices: true })`, which
  attaches a fake Remote Playback object to the transport element and exposes
  `castRemote` for driving `beginConnecting` / `connect` / `disconnect`. There is
  no availability control to drive, because the app has no availability to hear
  about; the fake's `watchAvailability` exists only to satisfy feature detection
  and counts its calls so a test can prove it is never used.
- **A bare `startAppTestEnvironment()` — no `castDevices` — is the Firefox case**,
  and the detachability claim made executable: the registry returns `null`, the
  control is removed rather than hidden, no listener is registered, and nothing
  reaches the network. Assert against `elements.get("remotePlaybackUi").removed`.
- **Clocks are injected, not global.** `LoopWatchdog`, the metadata wait and the
  SDK's idle restart all resolve timers through an injected `scope`. A test that
  plays without tearing down used to leak a live `setInterval` and hang the whole
  run; pass a fake clock rather than reaching for real time.
- **The transport element carries no `src` until a gesture is reported**, so a test
  that inspects it after a bare `startAppTestEnvironment` will correctly find it
  empty. Dispatch a `pointerdown` or `keydown` on the document first — the
  `touchPage` helper in `app-remote-playback.test.js` does exactly that. In a browser, any
  real click or keypress does it.
### In a browser

The tool itself is AGENTS.md's Browser Testing section; this is what to point it
at. The host element is `#remotePlaybackUi`, the button's state is
`data-remote-state`, and the announcement is the component's `<p role="status">`.

- **Driving the component directly is safe and contacts nothing** — it is how the
  glyph, labels and announcements were verified without a device:
  ```js
  const ui = document.getElementById("remotePlaybackUi");
  ui.setConnection({ connecting: true });   // pulse + "Connecting to a device."
  ui.setConnection({ connected: true });    // filled screen + weight
  ui.setConnection({});                     // "Playback returned to this device."
  ```
  Reading `getComputedStyle(button).color` immediately after returns the *old*
  colour — the button carries a 0.18s colour transition and the computed value is
  mid-flight. Read it a moment later, or it looks like the rule did not apply.
- **To exercise the app's real handlers**, shadow the read-only state on the live
  `RemotePlayback` object and dispatch its events. Contacts nothing:
  ```js
  const r = document.getElementById("remoteTransportElement").remote;
  Object.defineProperty(r, "state", { value: "connected", configurable: true });
  r.dispatchEvent(new Event("connect"));
  ```
- **Pressing the button on a machine with no devices is safe and useful**: the
  browser opens its own picker, finds nothing, and the dismissal is swallowed as
  a benign outcome — a clean console is the pass condition. On the **Cast SDK**
  path the press opens a native dialog that will block the session, and the unit
  suite already covers every picker path, so there is no reason to take that risk
  in an agent run.

### The manual device checklist

Short enough to run by hand after any change to this feature. Each line failed at
least once against a real device while passing every test:

1. Audio actually plays on the device, and it is the soundscape on screen.
2. It is **still playing after twenty minutes** — the twins are two minutes long,
   so this is the repeat/watchdog path and nothing shorter exercises it.
3. Reopening the app rejoins the session without restarting the soundscape, and
   comes up *playing* rather than paused.
4. Changing tracks while connected moves the receiver, and the OS media UI names
   the track that is actually playing.
5. Pausing on the device itself is reflected on screen.
6. Ending the cast hands back to local playback rather than to silence.


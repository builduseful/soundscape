# Playback service

`PlaybackService` owns the engine and the `PlaybackController`, so sound
outlives the screen, and joins them to the OS. What the player decides lives in
`core` (`PlaybackController`, `AudioFocusRules`) and is tested on the JVM; this
package only delivers the OS's events to it and shows its state.

- **One owner.** The activity binds while visible and sends every action
  through `controller`; nothing else creates an engine or a controller.
- **In the foreground from the first play until stopped, paused included.** On
  API 37 a paused app outside the foreground cannot be resumed from its
  notification or a headset. Stop (notification action, swipe on 14+, the
  session's stop, or swiping the app from recents, playing or not) is the only
  way out.
- **Foreground before focus.** The service observes the controller before
  `AudioFocusRules` does, so it is in the foreground before focus is asked for.
- **No POST_NOTIFICATIONS.** A media-session notification is exempt on 13+;
  the permission is not declared, and `PlaybackServiceTest` holds the
  notification to showing without it.
- **Nothing acts after stop.** Stop deactivates the session, so the system sends
  it no more keys, and the callback drops one already queued: acting on it
  would put a service that is ending back in the foreground, which crashes the
  app (on API 26 after `onDestroy`; on 37 between stop and `onDestroy`). Playing
  again from the screen reactivates it.
- **The notification and session change only when what they show changes**:
  the track, playing, and (for the session) loading. Volume and the notice are
  the screen's.
- **Shortcuts follow listening.** `ListeningHistory` (in `core`) keeps, per
  track, plays, time listened and when it was last listened to. A listen counts
  as a play, and reorders the shortcuts, once it reaches 30 seconds. They are
  totals only, in the `listening` preferences, saved each minute while playing
  so a forced close loses at most a minute. `AppShortcuts` publishes them as
  dynamic shortcuts, four as Android advises: most recent first, then
  `shared/catalog.json`'s. It calls the system only when the order changes.
  The action and extra they send are named once, in `app/build.gradle.kts`, and
  read here through `BuildConfig`.

`PlaybackServiceTest` drives the service as the OS does: the notification,
media keys, a shortcut and their order, playing on after leaving the app, unplugging, focus
taken briefly and for good, and a key after stop.

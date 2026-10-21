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
  session's stop, or swiping the app from recents while paused) is the only way
  out.
- **Foreground before focus.** The service observes the controller before
  `AudioFocusRules` does, so it is in the foreground before focus is asked for.
- **No POST_NOTIFICATIONS.** A media-session notification is exempt on 13+;
  the permission is not declared, and `PlaybackServiceTest` holds the
  notification to showing without it.
- **Nothing acts after `onDestroy`.** A media key pressed as the service ends is
  delivered late; the session callback drops it (on API 26 acting on it
  crashed the app).
- **The notification and session change only when what they show changes**:
  the track, playing, and (for the session) loading. Volume and the notice are
  the screen's.
- **Shortcuts come from `shared/catalog.json`**, generated into
  `res/xml/shortcuts.xml`. The action and extra they send are named once, in
  `app/build.gradle.kts`, and read here through `BuildConfig`.

`PlaybackServiceTest` drives the service as the OS does: the notification,
media keys, a shortcut, playing on after leaving the app, unplugging, focus
taken briefly and for good, and a key after stop.

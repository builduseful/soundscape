/**
 * Wording shared by every remote playback provider.
 *
 * It lives here rather than in either provider because both need it and neither
 * owns it: a Cast SDK session and an AirPlay route fail in the same way as far
 * as the listener is concerned — the sound did not arrive in the room — and
 * saying so differently per platform would be a distinction without a
 * difference. It cannot live in `index.js`, which imports the providers; that
 * would be a cycle.
 *
 * The core reads it through `failureMessage()` on the port, never by importing
 * from here. This module is internal to the plugin.
 */

export const REMOTE_FAILURE_MESSAGE = "That device couldn't play this soundscape. Try connecting again.";

# Roadmap

Pins focuses on a small, useful collection of resources for active workspace work. Current features include agent maintenance, update messages, chat summaries, discovery/refresh, sections, Keep, and static repository configuration.

The following ideas are deferred, not promised release features. Capability findings below were established against Paseo 0.15.4 and may be revisited on a newer supported release.

| Idea | What remains to resolve |
| --- | --- |
| Inline chat chips | A supported way to extend inline links without replacing whole message rendering. Keep historical destinations and acknowledgment semantics. |
| Workspace files | Supported navigation from menu and chat rows, with reliable acknowledgment and native mobile behavior. |
| Paseo browser and diff destinations | Verify supported opening APIs for both menu and chat surfaces. |
| Thumbnail previews | Capture runtime, authentication, network context, and browser maintenance. The investigated plugin-owned browser approach was deferred. |
| Dynamic repository values | A supported workspace environment source. No automatic `.env` reading or executable commands. |
| Sidebar access and a numeric header badge | Revisit when useful and supported by the host APIs. |

Standalone link-health/expiry indicators were dropped: maintenance should remain agent-mediated, without asking users to triage another status system. Automatic after-turn maintenance was discussed but is not implemented or scheduled.

Any future feature must use supported plugin APIs. Changes to Paseo itself are outside this project.

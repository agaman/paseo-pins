# Development scope

This repository develops the Pins plugin, not Paseo itself. We have no interest in making changes to Paseo directly as part of this plugin's development.

- Implement features using Paseo's supported plugin APIs and extension points.
- Do not modify or patch Paseo's source, installed application, daemon, or SDK to enable plugin features. Do not work around API limits by reaching into unsupported host internals.
- Do not propose changes to Paseo or make them prerequisites in this plugin's plans. A newer Paseo release that already provides a supported capability is an acceptable option.
- When the plugin API cannot support a requested design, explain the limitation and offer alternatives within the available extension points, or defer the feature.
- Treat work on Paseo itself as a separate project requiring an explicit user request; permission to develop this plugin does not authorize it.

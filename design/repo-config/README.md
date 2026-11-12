# Repository configuration design

Selected design for automatically populated, file-owned pins. Configured and agent-managed pins share sections. The selected source treatment places a small gear and “Repo” label beside the hostname, revealing the source in a small anchored popover on hover, keyboard focus, or tap. Configured pins have no Keep action. The popover stays within the menu, leaves row positions unchanged, and dismisses on Escape or an outside press. V1 supports static HTTP(S) links only. The separate Later artboard preserves the agreed missing-variable behavior for future substitution support.

The prototype uses illustrative theme-token values for surface, foreground, accent and warning colors. Desktop and mobile layouts retain current Pins controls. It simulates interactions only; no live pin writes or network requests.

Agreed format: `.paseo/pins.json` with version 1, optional section definitions, and pins using stable keys, titles, HTTP(S) URLs, optional types, and optional section assignments. Config takes ownership of matching agent-managed pin keys. Config owns declared section names; agents may assign their pins to these sections but cannot rename or remove them. Removing a pin from valid config removes it from the list. Config loads and edits are quiet. Agents can explicitly notify configured resources independently of definition changes. Implementation is tracked in the repository code and project documentation. Workspace-variable substitution is explicitly deferred; no Pins-managed variable store is planned.

## Selected informational treatment

The source artboards move a small gear and “Repo” label beside the hostname. No background or button border is shown; source information is visually separate from the action column. Hover, keyboard focus, or tap reveals the same floating explanation. Touch retains a 44px hit target. Prior action-column designs remain for comparison. This direction is selected; the earlier action-column treatment remains for comparison.

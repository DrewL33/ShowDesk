# ShowDesk 1.1.2

ShowDesk 1.1.2 fixes a routing regression in Signal Explorer that could push signal lines far below the graph.

## Fixes

- Keep routed lines near their graph nodes and remove the aggressive lower overflow lanes.
- Keep unrelated routes and direction markers subdued while inspecting a signal path.

ShowDesk remains read-only: it monitors switcher and HyperDeck state and does not send control commands to either device.

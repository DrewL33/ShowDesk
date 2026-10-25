# ShowDesk 1.1.3

ShowDesk 1.1.3 fixes Signal Explorer route overlaps and incorrect trace highlighting.

## Fixes

- Restore staggered route lanes so long connections fan out into their own vertical space.
- Keep separate routes from sharing long straight segments.
- Highlight only the exact upstream and downstream edges connected to the inspected node.
- Keep dense route lanes close to the graph.

ShowDesk remains read-only: it monitors switcher and HyperDeck state and does not send control commands to either device.

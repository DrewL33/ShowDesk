# ShowDesk Tauri migration

This branch migrates the desktop shell without changing ShowDesk's proven ATEM behavior.

## Guardrails

- ShowDesk remains read-only.
- No ATEM control/write commands are introduced.
- Existing live normalization, AUX mapping, Signal Paths tracing, and reference parsing remain unchanged during shell migration.
- The existing Node + atem-connection backend remains the authoritative ATEM service initially.
- The beta branch remains the working browser-shell fallback.

## Migration checkpoints

1. Native Tauri window can render the existing ShowDesk frontend.
2. Bundle the existing Node ATEM service as an internal sidecar.
3. Start/stop the sidecar with the Tauri application lifecycle.
4. Point the existing transport at the local sidecar without changing normalized state.
5. Compare Tauri against the physically validated beta build on a real ATEM.
6. Only after parity is confirmed, remove the old browser-launcher packaging.

No visual redesign is part of these checkpoints.

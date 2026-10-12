# ShowDesk 1.0.0

ShowDesk 1.0 is the first stable release of the ATEM monitoring and signal-inspection companion.

## Highlights

- Live Show View with selectable M/Es, program and preview, active sources, keyer state, and recent changes.
- Signal Explorer for tracing live signal flow through M/Es, keyers, AUX buses, and output destinations.
- Inspect workspace with input inventory, route matrix, M/E bus and keyer details, reference attention, and diagnostics.
- Read-only desktop and mobile Viewer modes for sharing switcher state from a Host over a LAN or routed VPN.
- Optional comparison of supported ATEM show-reference configuration and routing values.
- Signed in-app update checks and reliable background-service cleanup when ShowDesk closes.

## Downloads

- **macOS (Apple silicon):** `ShowDesk-macOS-Installer.dmg`
- **Windows (64-bit):** `ShowDesk-Windows-Installer.exe`

Choose Host to connect directly to your ATEM, or Viewer to connect to a ShowDesk Host. For a phone or tablet, open `http://<host-computer-ip>:47822/` while ShowDesk is running in Host mode.

ShowDesk is an observability companion and does not send switcher-control commands. The mobile and desktop Viewer connections are read-only.

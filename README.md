# ShowDesk

ShowDesk gives video techs and engineers a clear, real-time view of their ATEM switcher—making it easy to trace signal routing, verify outputs, monitor switcher state, and troubleshoot problems during a live production.

## Current architecture
- Web UI served locally in the user's browser
- Node.js backend for ATEM communication
- WebSocket bridge for live state updates
- Packaged GitHub Release builds so users do not need Node.js installed

## Mobile browser viewer
When ShowDesk is running in Host Mode, open `http://<host-ip>:47822/` from a phone or tablet browser on the same LAN or a connected VPN. The page connects automatically to the Host's read-only WebSocket feed and shows compact **Show**, **Signal**, and **Inspect** tabs. Port `47822` must be allowed through the Host computer's firewall.

The mobile page is served by the ShowDesk Host itself, so it does not require a separate web deployment. The viewer feed is read-only; it does not offer switcher controls.

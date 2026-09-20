# ShowDesk

ShowDesk gives video techs and engineers a clear, real-time view of their ATEM switcher—making it easy to trace signal routing, verify outputs, monitor switcher state, and troubleshoot problems during a live production.

## Current architecture
- Web UI served locally in the user's browser
- Node.js backend for ATEM communication
- WebSocket bridge for live state updates
- Packaged GitHub Release builds so users do not need Node.js installed

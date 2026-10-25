# ShowDesk

**See your ATEM show at a glance.** ShowDesk gives your production team a read-only view of program, preview, signal routes, and switcher status.

[![Latest stable release](https://img.shields.io/github/v/release/DrewL33/ShowDesk?label=stable%20release)](https://github.com/DrewL33/ShowDesk/releases/latest)

<p align="center">
  <a href="https://github.com/DrewL33/ShowDesk/releases/latest/download/ShowDesk-macOS-Installer.dmg"><strong>Download for Mac (Apple silicon)</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/DrewL33/ShowDesk/releases/latest/download/ShowDesk-macOS-Intel-Installer.dmg"><strong>Download for Mac (Intel)</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/DrewL33/ShowDesk/releases/latest/download/ShowDesk-Windows-Installer.exe"><strong>Download for Windows (x64)</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/DrewL33/ShowDesk/releases/latest">All releases</a>
</p>

## Get started

Choose **Host** on the computer connected to your ATEM. Other computers, phones, and tablets can join as read-only **Viewers**.

<p><a href="docs/images/connection-view.png"><img src="docs/images/connection-view.png" width="460" alt="ShowDesk Host and Viewer connection screen"></a></p>

## What you can do

- **Show View:** Keep program, preview, active sources, and keyers in view for each M/E.
- **Signal Explorer:** Follow a signal through the switcher, then pin its route while you inspect it.
- **Inspect:** Review connected inputs, routes, keyers, switcher status, and items that need attention.
- **Show references:** Compare supported settings with the values reported by your switcher.
- **Session reports:** Save a summary of the connection and switcher state for your records.
- **Mobile Viewer:** Check show status from a phone or tablet. Viewers cannot control the ATEM.

## Screenshots

Screenshots are shown at a smaller size to keep the guide easy to scan. **Click any image to open its full-size preview.** Show View and Mobile Viewer use sample show data; Signal Explorer and Inspect show real app screens.

### Show View

**See program and preview, active sources, and keyer status for the selected M/E.**

<p><a href="docs/images/show-view.svg"><img src="docs/images/show-view.svg" width="460" alt="ShowDesk Show View with program, preview, sources, and keyers"></a></p>

### Signal Explorer

**Follow a signal from source to destination.** Hover to trace a route; click to pin it while you inspect the switcher.

<p><a href="docs/images/signal-explorer-overview.png"><img src="docs/images/signal-explorer-overview.png" width="460" alt="ShowDesk Signal Explorer showing live switcher routing"></a></p>

<p><a href="docs/images/signal-explorer-trace.png"><img src="docs/images/signal-explorer-trace.png" width="460" alt="ShowDesk Signal Explorer with a source route highlighted"></a></p>

### Inspect

**Check connected inputs, signal routes, keyers, and switcher health.**

<p><a href="docs/images/inspect-inventory.png"><img src="docs/images/inspect-inventory.png" width="460" alt="ShowDesk Inspect showing input inventory and status"></a></p>

<p><a href="docs/images/inspect-routing-and-diagnostics.png"><img src="docs/images/inspect-routing-and-diagnostics.png" width="460" alt="ShowDesk Inspect showing routing, M/E buses, keyers, and diagnostics"></a></p>

### Mobile Viewer

**Check show status from your phone or tablet** while it’s connected to the Host’s network.

<p><a href="docs/images/mobile-viewer.svg"><img src="docs/images/mobile-viewer.svg" width="320" alt="ShowDesk mobile Viewer"></a></p>

## Install and connect

1. Download ShowDesk for your computer using the links above.
2. On Mac, open the downloaded disk image and move ShowDesk to Applications. On Windows, run the installer.
3. Choose **Host** to connect to an ATEM, or **Viewer** to join a Host already running ShowDesk.

ShowDesk is available for Apple silicon and Intel Macs, and 64-bit Windows. Your computer and ATEM should be on the same local network. Enter the switcher’s IP address when prompted. Some features depend on the switcher model and the information it provides.

ShowDesk displays switcher status and does not send control commands. The Host connects to the ATEM; Viewers receive status from the Host.

## View the show on a phone or tablet

Start ShowDesk in **Host** mode. On a phone or tablet connected to the same network, open:

```text
http://<host-computer-ip>:47822/
```

Replace `<host-computer-ip>` with the Host computer’s IP address. If the page cannot connect, allow ShowDesk through that computer’s firewall on port **47822**. The mobile Viewer connects automatically and is read-only.

If you’re using ShowDesk BETA, use port **47832** instead.

To connect a desktop Viewer, open ShowDesk, choose **Viewer**, and enter the Host computer’s IP address. A routed VPN can also work if it allows the two computers to communicate.

## Updates and help

Check for updates in **Settings → Updates**. ShowDesk asks before installing one.

For help or to report a problem, visit [ShowDesk support](https://github.com/DrewL33/ShowDesk/issues). Include your ShowDesk version, computer operating system, ATEM model, and what you expected to happen. Remove private show names, IP addresses, and other production details from screenshots or reports.

See [release notes](https://github.com/DrewL33/ShowDesk/releases) for what changed in each version.

## Try ShowDesk BETA

Want to try features still in development? Install the BETA app alongside the regular ShowDesk app. It is a separate app, so you can keep using the regular version.

If macOS blocks the BETA app the first time you open it, go to **System Settings → Privacy & Security** and allow it to open.

- [Download ShowDesk BETA for macOS (Apple silicon)](https://github.com/DrewL33/ShowDesk/releases/download/showdesk-beta-latest/ShowDesk-BETA-macOS-Installer.dmg)
- [Download ShowDesk BETA for Windows (x64)](https://github.com/DrewL33/ShowDesk/releases/download/showdesk-beta-latest/ShowDesk-BETA-Windows-Installer.exe)
- [See what’s included in BETA](https://github.com/DrewL33/ShowDesk/releases/tag/showdesk-beta-latest)

# ShowDesk Companion module

This module connects Bitfocus Companion to ShowDesk on the same computer. It provides ready-made Stream Deck buttons for ShowDesk workspaces and M/Es, plus live variables and feedbacks for connection, switcher, M/E, and HyperDeck status.

The module connects to ShowDesk's local service on the same computer. Choose Stable (port 47821) or BETA (port 47831) in the connection settings. It does not connect to the ATEM, change switcher state, or transmit device addresses.

## Available buttons

- Open Show View, Signal Explorer, Inspect, or HyperDeck Monitoring
- Select M/E 1–4
- Show whether ShowDesk's local service is online

The workspace and M/E buttons can also be added individually from the module's Actions list. Feedbacks can indicate the active workspace and selected M/E.

## Status variables

The module exposes connection mode, connection state, switcher name, video format, current workspace, selected M/E, program and preview sources for M/E 1–4, fade-to-black state, and status/timecode for up to eight HyperDecks. Use Companion's variable picker to add these to button text.

## Install

Package this folder with the Companion module build tools, then import the resulting `.tgz` in Companion's module management page. Add a ShowDesk connection and select the Stable or BETA app running on this computer.

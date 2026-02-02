OBS (Open Broadcaster Software) — Calnix notes

Purpose
-------
Add OBS to the Calnix configuration so you can record/stream your screen and webcam.

What I changed
--------------
- Added `obs-studio` and `v4l-utils` to `environment.systemPackages` in `modules/desktop.nix`.
- Added `xdg-desktop-portal-wlr` to `xdg.portal.extraPortals` so Wayland screen capture works with PipeWire/portals.
- Added the `video` group membership for the `calvin` user so OBS can access webcams and capture devices.

Why these changes
-----------------
- On Wayland (Sway) modern screen capture goes through PipeWire + xdg-desktop-portal. `xdg-desktop-portal-wlr` implements the portal backend for wlroots-based compositors.
- `obs-studio` is the canonical app for recording/streaming.
- `v4l-utils` provides convenient tooling for verifying camera devices.
- Adding `calvin` to the `video` group ensures OBS can open /dev/video* devices (webcams, capture cards).

Quick usage notes (Wayland)
---------------------------
- Rebuild your host configuration (from the calnix repo root):

  ./rebuild.sh

- Launch OBS (`obs`) from the application menu or run `obs` in a terminal.
- To capture the screen on Wayland, add a new source: "Screen Capture (PipeWire)". When prompted, choose the screen, application window, or region to capture via the portal dialog.
- For webcam capture, add a "Video Capture Device" and select the correct `/dev/video*` device.

Troubleshooting & tips
----------------------
- If you don't see the screen options, ensure `services.pipewire` and `wireplumber` are enabled (Calnix already configures them in `modules/audio.nix`).
- If you need a virtual camera (to expose OBS output as `/dev/video*`), consider installing a v4l2loopback module or the OBS virtual camera plugin; that may require an additional kernel module / module package.
- If you use Flatpak apps and need them accessible to OBS, make sure flatpak sandbox permissions allow portal use.

If you'd like, I can:
- add an optional kernel-module module for v4l2loopback (if you use virtual cameras),
- add a small Home-Manager helper script to launch OBS with a predefined profile, or
- add an example PipeWire/OBS profile to help with streaming (bitrate, encoder settings).

If you want any of these follow-ups, tell me which one and I'll add it.

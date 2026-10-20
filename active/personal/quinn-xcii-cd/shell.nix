{ pkgs ? import <nixpkgs> { } }:

# Tools this project needs. `wodim` (from cdrkit) does the burning, ffmpeg does
# the Red Book transcode. Neither is installed system-wide on this host.
pkgs.mkShell {
  packages = with pkgs; [
    ffmpeg # transcodes everything to 44.1 kHz / 16-bit / stereo WAV
    cdrkit # wodim: writes the audio CD
    cdrtools # readcd: sanity-check the burned disc
    util-linux # eject
  ];
}

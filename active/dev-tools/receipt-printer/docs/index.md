# Receipt Printer

How the Epson TM-T88V got working, and what you can print with it.

## The hardware

An Epson TM-T88V thermal receipt printer on USB. It shows up as a plain
character device:

```
/dev/usb/lp0
```

That is the whole interface. No driver, no CUPS queue, no spooler. You write
bytes to that file and paper comes out. The byte format is **ESC/POS**, Epson's
printer command language — text plus escape sequences for bold, alignment,
cutting, and bitmaps.

The printer is 203 dpi. An 80mm roll gives 576 printable dots across; this setup
uses 58mm rolls, so treat **384 dots (32 text columns)** as the usable width.
Anything wider gets clipped on the right.

## Setup

Three things were needed.

**1. Permission to write the device.** `/dev/usb/lp0` is `root:lp`. Without
group access every write fails with `Permission denied`. Add yourself to `lp`
(log out and back in for it to take effect):

```bash
sudo usermod -a -G lp $USER
```

The scripts here instead go through `sudo`, so they work even before that
takes effect.

**2. Python and Pillow.** Python is not on this host's PATH, and image work
needs Pillow. Both come from `nix-shell`:

```bash
nix-shell -p python3 --run "python3 script.py"
nix-shell -p python3Packages.pillow --run "python3 script.py"
```

Every wrapper script below already does this for you.

**3. The helpers.** The `bin/` directory in this project holds them. Symlink
them onto your PATH:

```bash
ln -sf "$PWD"/bin/print-* ~/bin/
```

## Printing things

| Command | What it does |
|---|---|
| `print-receipt` | Test receipt. `print-receipt file.txt` prints a file. |
| `print-text FILE` | Text file, word-wrapped. `--condensed` fits more per line. |
| `print-repeat "text" 500` | Print a phrase N times. |
| `print-image FILE [w h]` | Any image, dithered for thermal. |
| `print-emoji "🐱"` | Emoji as a bitmap. |
| `print-qr "https://..."` | QR code. Captions are opt-in via `--caption`. |
| `print-joke` | Setup slip, cut, punchline slip. |
| `print-weather "Logan, UT"` | Current conditions plus a 3-day outlook. |
| `print-scripture [n]` | N random Bible verses, cut after each. |
| `print-fortune [n]` | N random fortunes, cut after each. |
| `print-random 100` | 100 characters from `/dev/random`. |
| `print-newspaper` | Headlines from BBC, NPR, and Ars Technica. |
| `print-planets` | One image of each planet. |

Examples:

```bash
print-text /etc/passwd --condensed
print-qr "https://example.com" --caption "scan me"
print-weather "Moab, UT"
print-image ~/photo.jpg 384 384
```

## Four things that will bite you

**Cutting is `GS V`, not `ESC m`.** An early version sent `ESC m` and it looked
like it worked but never actually cut. The real command is `GS V 66 0`, which
feeds past the blade then cuts.

**Never dither a QR code.** Photos want Floyd–Steinberg dithering. QR codes need
a hard threshold, because dithering destroys the module edges scanners rely on.
`print-qr` handles this; if you write your own code, pass `dither=False`.

**Write big images in chunks.** A full-page raster is around 18KB, larger than
the kernel's `usblp` buffer. One big `write()` fails or truncates. Write in
1KB pieces.

**Unicode is not free.** The printer has codepage fonts (CP437 and friends).
Emoji, em dashes, and smart quotes silently become `?`. Convert or rasterise
them — `eppos`-style helpers here use `errors="replace"` and normalise
punctuation before sending.

## If it stops working

```bash
ls -l /dev/usb/lp0          # present? permissions right?
lsusb | grep -i epson       # 04b8:0e02
```

If the device is missing entirely, the printer is off or unplugged — the USB
device only appears when powered on.

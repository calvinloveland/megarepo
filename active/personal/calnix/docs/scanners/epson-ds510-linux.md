# Epson DS-510 Linux Runbook

This is the working procedure for scanning with the Epson DS-510 from this machine.

## What worked reliably

1. Load **one page only** in the ADF (multi-page attempts jammed during testing).
2. Wait for the scanner light to be **solid blue**.
3. Reset the scanner USB device.
4. Run `scanimage` against the `epsonscan2` backend with explicit ADF options.

## 1) Detect the scanner

```bash
scanimage -L
```

Expected device entries include:

- `epsonscan2:EPSON DS-510::esci2:usb:ES00E6:332`
- `epsonds:libusb:...` (may appear, but `epsonscan2` was the backend that succeeded)

## 2) Reset USB before scanning (important)

```bash
python - <<'PY'
import os, fcntl, glob
USBDEVFS_RESET = ord('U') << (4 * 2) | 20
for d in glob.glob('/sys/bus/usb/devices/*'):
    try:
        with open(os.path.join(d, 'idVendor')) as f:
            v = f.read().strip().lower()
        with open(os.path.join(d, 'idProduct')) as f:
            p = f.read().strip().lower()
    except Exception:
        continue
    if v == '04b8' and p == '014c':  # Epson DS-510
        bus = open(os.path.join(d, 'busnum')).read().strip().zfill(3)
        dev = open(os.path.join(d, 'devnum')).read().strip().zfill(3)
        path = f'/dev/bus/usb/{bus}/{dev}'
        fd = os.open(path, os.O_WRONLY)
        try:
            fcntl.ioctl(fd, USBDEVFS_RESET, 0)
            print('RESET_OK', path)
        finally:
            os.close(fd)
PY
sleep 2
```

## 3) Scan one page

```bash
outfile="$HOME/scan-ds510-$(date +%Y%m%d-%H%M%S).pnm"
scanimage -d "epsonscan2:EPSON DS-510::esci2:usb:ES00E6:332" \
  --source "ADF" \
  --mode Grayscale \
  --resolution 200 \
  --scan-area Letter \
  --format=pnm \
  --output-file "$outfile"
echo "$outfile"
file "$outfile"
```

The last successful run produced:

- `/home/calvin/scan-ds510-final-20260219-153220.pnm`
- `Netpbm image data, size = 1700 x 2176, rawbits, greymap`

## Optional conversions

```bash
# PNM -> PNG
magick "$outfile" "${outfile%.pnm}.png"

# PNM -> PDF
magick "$outfile" "${outfile%.pnm}.pdf"
```

## Troubleshooting quick map

- `scanimage: ... Error during device I/O`
  - Re-seat one sheet, ensure solid blue light, run USB reset, retry.
- `scanimage: sane_start: Document feeder out of documents`
  - ADF is empty (or page did not feed). Reload page.
- `*** buffer overflow detected ***`
  - Scanner/backend state is bad; USB reset fixed this during testing.
- `which: no avahi-browse`
  - Observed in logs; not the root cause of scan failures here.

## Linux notes from web research

- Other Linux users report DS-series Epson scanners working with `epsonscan2`.
- Common causes of I/O failures: USB autosuspend, permissions, flaky USB path/hubs.
- If failures recur frequently:
  - use a direct USB port (no hub),
  - ensure user is in `scanner`/`lp` groups,
  - consider disabling USB autosuspend for this device.

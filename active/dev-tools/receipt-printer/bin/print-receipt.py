#!/usr/bin/env python3
"""Send a formatted test receipt to the Epson TM-T88V thermal printer."""

import sys

ESC = b"\x1b"
GS = b"\x1d"

out = bytearray()
out += ESC + b"@"  # Initialize printer

# Center + double-size header
out += ESC + b"a" + b"\x01"
out += GS + b"!" + b"\x11"
out += b"MEGAREPO\n"
out += GS + b"!" + b"\x00"
out += b"COFFEE\n"
out += ESC + b"a" + b"\x00"

out += b"-" * 32 + b"\n"
out += b"123 Code St\nTerminal City\n"
out += b"-" * 32 + b"\n"

items = [
    (b"1x Drip Coffee", b"$3.50"),
    (b"1x Cold Brew", b"$4.75"),
    (b"1x Muffin", b"$4.25"),
]
for name, price in items:
    out += name.ljust(24) + b"  " + price + b"\n"

out += b"-" * 32 + b"\n"
out += b"SUBTOTAL".ljust(24) + b"  $12.50\n"
out += b"TAX (8%)".ljust(24) + b"  $1.00\n"
out += b"TOTAL".ljust(24) + b"  $13.50\n"
out += b"=" * 32 + b"\n"

out += ESC + b"a" + b"\x01"
out += GS + b"!" + b"\x11"
out += b"THANK YOU!\n"
out += GS + b"!" + b"\x00"
out += b"Have a great day!\nPrinted by Pi Agent\n"
out += ESC + b"a" + b"\x00"
out += ESC + b"d" + b"\x05"  # Feed 5 lines
out += ESC + b"m"  # Cut

with open("/dev/usb/lp0", "wb") as f:
    f.write(bytes(out))
    f.flush()

print("Receipt sent to printer!")
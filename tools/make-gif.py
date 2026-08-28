#!/usr/bin/env python3
"""Minimal GIF89a writer (no Pillow). Single frame, 256-colour global table.

LZW here only ever emits literals, re-sending the clear code before the decoder's
next free entry would force a 10-bit code. That is valid LZW -- just not compact --
and keeps the encoder short enough to audit.
"""
import struct, sys

def lzw_literals(pixels):
    MIN, CLEAR, END, WIDTH = 8, 256, 257, 9
    out, bitbuf, bitcnt = bytearray(), 0, 0
    def emit(code):
        nonlocal bitbuf, bitcnt
        bitbuf |= code << bitcnt
        bitcnt += WIDTH
        while bitcnt >= 8:
            out.append(bitbuf & 0xFF)
            bitbuf >>= 8
            bitcnt -= 8
    emit(CLEAR)
    since = 0
    for px in pixels:
        emit(px)
        since += 1
        if since >= 250:          # keep the decoder's next code below 512
            emit(CLEAR)
            since = 0
    emit(END)
    if bitcnt:
        out.append(bitbuf & 0xFF)
    blocks = bytearray([MIN])
    for i in range(0, len(out), 255):
        chunk = out[i:i+255]
        blocks.append(len(chunk))
        blocks += chunk
    blocks.append(0)
    return bytes(blocks)

def write_gif(path, w, h, palette, pixels):
    assert len(pixels) == w * h
    g = bytearray(b"GIF89a")
    g += struct.pack("<HHBBB", w, h, 0xF7, 0, 0)      # GCT, 256 entries
    table = bytearray()
    for i in range(256):
        table += bytes(palette[i] if i < len(palette) else (0, 0, 0))
    g += table
    g += b"\x2C" + struct.pack("<HHHHB", 0, 0, w, h, 0)
    g += lzw_literals(pixels)
    g += b"\x3B"
    open(path, "wb").write(g)
    return len(g)

# Orientation probe: distinct corners, a white centre cross, and a 10px border.
W, H = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (310, 100)
PAL = [(0,0,0), (220,40,40), (40,200,80), (60,120,255), (240,200,40), (255,255,255), (25,25,30)]
px = []
for y in range(H):
    for x in range(W):
        c = 6
        if x < 10 or x >= W-10 or y < 10 or y >= H-10: c = 5          # white border
        elif x < W//3 and y < H//3: c = 1                             # top-left red
        elif x >= 2*W//3 and y < H//3: c = 2                          # top-right green
        elif x < W//3 and y >= 2*H//3: c = 3                          # bottom-left blue
        elif x >= 2*W//3 and y >= 2*H//3: c = 4                       # bottom-right yellow
        elif abs(x - W//2) < 3 or abs(y - H//2) < 3: c = 5            # centre cross
        px.append(c)
n = write_gif(sys.argv[1], W, H, PAL, px)
print(f"wrote {sys.argv[1]}: {W}x{H}, {n:,} bytes")

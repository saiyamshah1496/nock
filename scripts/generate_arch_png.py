#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1600, 900
BG = (255, 255, 255, 255)
BOX_FILL = (243, 244, 246, 255)  # #f3f4f6
BOX_STROKE = (17, 24, 39, 255)   # #111827
TEXT = (17, 24, 39, 255)
MUTED = (107, 114, 128, 255)     # #6b7280
LINE = MUTED

def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy, radius=8, fill=BOX_FILL, outline=BOX_STROKE, width=2):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill, outline=outline, width=width)

def main():
    img = Image.new("RGBA", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)
    # Fonts (fallback to default if DejaVu not available)
    try:
        font_title = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
        font_h = ImageFont.truetype("DejaVuSans-Bold.ttf", 20)
        font = ImageFont.truetype("DejaVuSans.ttf", 16)
        font_small = ImageFont.truetype("DejaVuSans.ttf", 12)
        font_note = ImageFont.truetype("DejaVuSans.ttf", 14)
    except Exception:
        font_title = ImageFont.load_default()
        font_h = ImageFont.load_default()
        font = ImageFont.load_default()
        font_small = ImageFont.load_default()
        font_note = ImageFont.load_default()

    # Title
    title = "Nock architecture (v0.1.x)"
    tw, th = draw.textlength(title, font=font_title), font_title.size
    draw.text(((WIDTH - tw) / 2, 60 - th/2), title, fill=TEXT, font=font_title)

    # Surfaces box
    sx, sy, sw, sh = 80, 160, 340, 210
    draw_rounded_rect(draw, (sx, sy, sx+sw, sy+sh))
    draw.text((sx+16, sy+18), "Surfaces (left)", fill=TEXT, font=font_h)
    surfaces = [
        "• CLI (@nockhq/cli)",
        "• GitHub Action",
        "• MCP (@nockhq/mcp)",
        "• GitHub App (DDL Gate)",
    ]
    y = sy + 52
    for line in surfaces:
        draw.text((sx+16, y), line, fill=TEXT, font=font)
        y += 24

    # Core box
    cx, cy, cw, ch = 560, 160, 460, 220
    draw_rounded_rect(draw, (cx, cy, cx+cw, cy+ch))
    draw.text((cx+16, cy+18), "Core: @nockhq/core engine", fill=TEXT, font=font_h)
    draw.text((cx+16, cy+54), "parse/classify DDL -> estate context -> policy/rules (R00x)", fill=TEXT, font=font)
    draw.text((cx+16, cy+78), "-> verdict JSON (never applies migrations)", fill=TEXT, font=font)

    # Estate inputs box
    ex, ey, ew, eh = 80, 440, 340, 280
    draw_rounded_rect(draw, (ex, ey, ex+ew, ey+eh))
    draw.text((ex+16, ey+18), "Estate inputs", fill=TEXT, font=font_h)
    estate_lines = [
        "Path A: committed estate.json / paste",
        "Path B: nock sync-estate (customer DB, read-only role) -> file",
        "Path B+: push encrypted estate to hosted API (Team)",
        "Live refresh: --database-url / MCP databaseUrl",
        "(client-side catalogue refresh, check-only; free path)",
    ]
    y = ey + 50
    for i, line in enumerate(estate_lines):
        draw.text((ex+16, y), line, fill=(MUTED if i == 4 else TEXT), font=(font if i < 4 else font_small))
        y += 24 if i < 4 else 22

    # Hosted Team box
    tx, ty, twi, thi = 1120, 160, 460, 260
    draw_rounded_rect(draw, (tx, ty, tx+twi, ty+thi))
    draw.text((tx+16, ty+18), "Hosted Team (Cloudflare)", fill=TEXT, font=font_h)
    team_lines = [
        "Worker (Hono)",
        "D1 (orgs/tokens, policy knobs, audit)",
        "R2 (encrypted estate blobs)",
        "org API token auth",
    ]
    y = ty + 50
    for line in team_lines:
        draw.text((tx+16, y), line, fill=TEXT, font=font)
        y += 24

    # Outputs box
    ox, oy, ow, oh = 1120, 520, 460, 170
    draw_rounded_rect(draw, (ox, oy, ox+ow, oy+oh))
    draw.text((ox+16, oy+18), "Outputs", fill=TEXT, font=font_h)
    draw.text((ox+16, oy+50), "pass / fail / yellow verdict + remediation hints", fill=TEXT, font=font)
    draw.text((ox+16, oy+74), "-> CI check / PR comment / MCP to agent", fill=TEXT, font=font)

    # Notes
    note = "Postgres-only v1 • check-only (never APPLY) • same engine everywhere"
    nw = draw.textlength(note, font=font_note)
    draw.text(((WIDTH - nw)/2, 500 - font_note.size/2), note, fill=MUTED, font=font_note)

    # Connectors
    # Surfaces -> Core
    draw.line((sx+sw, sy+105, cx, cy+105), fill=LINE, width=2)
    draw.text((sx+sw+40, sy+92), "->", fill=LINE, font=font_small)
    # Estate (A/B) -> Core
    draw.line((ex+ew, ey+100, cx, cy+200), fill=LINE, width=2)
    draw.text((ex+ew+40, ey+80), "Path A / B ->", fill=LINE, font=font_small)
    # Estate (B+) -> Team (dashed)
    # Draw dashed by short segments
    x0, y0, x1 = ex+ew, ey+160, tx
    dash, gap = 10, 6
    x = x0
    while x < x1:
        x2 = min(x + dash, x1)
        draw.line((x, y0, x2, y0), fill=LINE, width=2)
        x += dash + gap
    draw.text(((x0 + x1)//2 - 140, y0 - 16), "Path B+: push encrypted estate to hosted API ->", fill=LINE, font=font_small)
    # Core -> Outputs
    draw.line((cx+cw, cy+160, ox, oy+20), fill=LINE, width=2)
    draw.text((cx+cw+20, cy+140), "->", fill=LINE, font=font_small)

    # Save
    img.save("docs/architecture/nock-architecture.png")

if __name__ == "__main__":
    main()

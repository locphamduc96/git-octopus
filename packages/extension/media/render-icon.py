"""
Renders `icon.svg` into `icon.png` (128x128, RGBA), which is the icon VS Code and the marketplace
show. Run it after editing the SVG:

    python3 packages/extension/media/render-icon.py

Written out rather than done by hand because the checked-in PNG had once drifted from its source:
the artwork sat in the top-left quarter of the canvas on an opaque white background, so VS Code drew
a white card with a small octopus in the corner. Everything here is read off the SVG by hand — the
shapes are a rounded rectangle, five stroked cubic beziers and a handful of circles, which is little
enough to draw directly and saves the project a rendering dependency.

Supersampled 8x and resized down: PIL has no antialiasing of its own, and the curves show it.
"""

from PIL import Image, ImageDraw

SIZE = 128
SUPERSAMPLE = 8
N = SIZE * SUPERSAMPLE

# The SVG wraps the artwork in `translate(64,62) scale(0.84) translate(-64,-64)`.
SCALE = 0.84
OFFSET = (10.24, 8.24)

BADGE = '#232A3B'
BADGE_RADIUS = 28
HEAD = '#FF7A66'
EYE = '#FFFFFF'
PUPIL = '#2B2233'

# Each leg: the four control points of its cubic bezier, then its colour. The end point doubles as
# the centre of the dot at the tip.
LIST_LEGS = [
    ((40, 57), (27, 73), (21, 86), (24, 100), '#4EC9B0'),
    ((52, 67), (43, 83), (39, 96), (44, 110), '#FFB454'),
    ((64, 70), (64, 86), (63, 99), (64, 114), '#7AA2F7'),
    ((76, 67), (85, 83), (89, 96), (84, 110), '#C792EA'),
    ((88, 57), (101, 73), (107, 86), (104, 100), '#F07178'),
]
LEG_WIDTH = 10
TIP_RADIUS = 6.5


def to_canvas(point):
    x, y = point
    return ((SCALE * x + OFFSET[0]) * SUPERSAMPLE, (SCALE * y + OFFSET[1]) * SUPERSAMPLE)


def bezier(p0, p1, p2, p3, steps=600):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )


def main():
    image = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def disc(centre, radius, colour):
        x, y = to_canvas(centre)
        r = radius * SCALE * SUPERSAMPLE
        draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)

    # Transparent outside the rounded corners: the badge is the icon's own background, and VS Code
    # puts its theme behind it.
    draw.rounded_rectangle([0, 0, N - 1, N - 1], radius=BADGE_RADIUS * SUPERSAMPLE, fill=BADGE)

    # A round-capped, round-joined stroke is exactly a disc left at every point along the curve.
    for p0, p1, p2, p3, colour in LIST_LEGS:
        for point in bezier(p0, p1, p2, p3):
            disc(point, LEG_WIDTH / 2, colour)
    for *_, tip, colour in LIST_LEGS:
        disc(tip, TIP_RADIUS, colour)

    head_x, head_y = to_canvas((64, 43))
    rx, ry = 30 * SCALE * SUPERSAMPLE, 27 * SCALE * SUPERSAMPLE
    draw.ellipse([head_x - rx, head_y - ry, head_x + rx, head_y + ry], fill=HEAD)
    disc((53, 42), 8.5, EYE)
    disc((75, 42), 8.5, EYE)
    disc((54.5, 43.5), 4.2, PUPIL)
    disc((76.5, 43.5), 4.2, PUPIL)

    here = __file__.rsplit('/', 1)[0]
    image.resize((SIZE, SIZE), Image.LANCZOS).save(f'{here}/icon.png')


if __name__ == '__main__':
    main()

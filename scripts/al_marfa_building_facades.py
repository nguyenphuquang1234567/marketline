"""Masonry and rainwater fittings for every building in the district."""

from math import cos, pi, sin
from random import Random

from al_marfa_street import Fabrication, material


def build(ctx, buildings):
    if not buildings:
        raise ValueError("Building façade detail requires extracted footprints")

    collection = ctx.collection("Exterior | Building masonry and drainage")
    iron = material("M_District_Rainwater_Iron", (.16, .13, .10), .69, scan="metal")
    stones = [
        material("M_District_" + name, tint, .79, scan="limestone")
        for name, tint in (
            ("Sandstone", (.49, .37, .25)),
            ("Pale_Limestone", (.62, .55, .44)),
            ("Weathered_Limestone", (.43, .40, .34)),
        )
    ]
    for index, building in enumerate(buildings):
        x, z, width, depth, angle, levels = (
            building[key] for key in ("x", "z", "width", "depth", "angle", "levels")
        )
        rng = Random(2324 + index)
        stone = stones[index % len(stones)]
        top = levels * 3.1
        batch = Fabrication(collection, f"SM_District_Facade_{index:02d}")

        # Front, back and both returns share the same corner construction.
        for face, (length, distance, turn) in enumerate((
            (width, depth / 2, 0), (width, depth / 2, pi),
            (depth, width / 2, pi / 2), (depth, width / 2, -pi / 2),
        )):
            c, s = cos(turn), sin(turn)

            def point(u, d, h):
                return (u * c + (distance + d) * s, u * s - (distance + d) * c, h)

            def block(u, d, h, w, thickness, height, finish, bevel):
                start = len(batch.vertices)
                batch.block((u, -distance - d, h), (w, thickness, height), finish, bevel)
                for i in range(start, len(batch.vertices)):
                    a, b, y = batch.vertices[i]
                    batch.vertices[i] = (a * c - b * s, a * s + b * c, y)

            for side in (-1, 1):
                for floor in range(levels):
                    for course in range(6):
                        # Keep the quoins clear of the lowest door and the sill line.
                        h = floor * 3.1 + .53 + course * .402
                        w = (.31 if (course + face) % 2 else .46) + rng.uniform(-.025, .025)
                        block(side * (length / 2 - w / 2 - .045), .041, h,
                              w, .091, .359, stone, .013)
            # Shadow lines below the existing roof band.
            block(0, .074, top - .302, length - .14, .158, .081, stone, .009)
            block(0, .085, top - .371, length - .18, .182, .046, stone, .006)
            count = max(2, round(length / 1.35))
            for bay in range(count):
                u = length * ((bay + .5) / count - .5)
                block(u, .083, top - .459, .145, .175, .136, stone, .012)

            if face < 2:
                openings = building["front" if face == 0 else "rear"]
                if face != 0 or not building["streetFront"]:
                    for opening in openings:
                        u, w, lo, hi = (opening[key] for key in ("u", "w", "bottom", "top"))
                        block(u, .072, hi + .104, w + .22, .16, .093, stone, .008)
                        block(u, .115, hi + .163, w + .29, .21, .038, stone, .006)
                        for side in (-1, 1):
                            block(u + side * (w / 2 + .042), .037, (lo + hi) / 2,
                                  .074, .085, hi - lo - .045, stone, .006)
                        if not opening["open"]:
                            block(u, .126, lo - .093, w + .26, .237, .061, stone, .009)
            else:
                for u in (-.29 * depth, .18 * depth):
                    for floor in range(levels):
                        h = 1.89 + floor * 3.1
                        w, height = (.85, .96) if floor == 0 else (.96, 1.12)
                        block(u, .09, h + height / 2 + .102, w + .28, .177, .078, stone, .009)
                        for side in (-1, 1):
                            block(u + side * (w / 2 + .09), .047, h, .068, .104, height, stone, .006)
                            if floor == 0:
                                for y in (h - .36, h + .36):
                                    block(u + side * (w / 2 - .025), .101, y,
                                          .052, .055, .045, iron, .005)

            if face in (1, 2):
                u = (length / 2 - .56) * (-1 if index % 2 else 1)
                route = [(u, .103, top - .24), (u, .147, top - .42),
                         (u, .147, .52), (u, .213, .31), (u, .32, .24)]
                batch.pipe([point(*p) for p in route], .033, iron, 8)
                for floor in range(levels):
                    for h in (floor * 3.1 + .83, floor * 3.1 + 2.36):
                        block(u, .066, h, .117, .146, .086, iron, .007)
                        batch.pipe([point(u, .147, h - .021), point(u, .147, h + .021)],
                                   .044, iron, 8)

        obj = batch.finish()
        obj.location = (x, -z, 0)
        obj.rotation_euler.z = angle

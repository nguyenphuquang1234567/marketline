"""Street-facing roof profiles and corner masonry for the Al Marfa frontages."""
from random import Random

from al_marfa_street import Fabrication, material


class Frontage:
    def __init__(self, row, collection):
        self.row = row
        self.normal = 1 if row['side'] == 'west' else -1
        self.x = row['faceX']
        self.y = -row['centerZ']
        self.top = row['levels'] * 3.1
        self.width = row['width']
        self.mesh = Fabrication(collection, f"SM_Frontage_{row['id']:02d}_Roof_And_Masonry")

    def p(self, u, z, d):
        return (self.x + self.normal * d, self.y + self.normal * u, z)

    def block(self, u, z, d, width, height, depth, finish, bevel=.006):
        self.mesh.block(self.p(u, z, d), (depth, width, height), finish, bevel)

    def profile(self, u, width, profile, finish):
        # A profile is a counter-clockwise polygon in (depth, height).
        points = [self.p(u + side * width / 2, z, d) for side in (-1, 1) for d, z in profile]
        n = len(profile)
        faces = [tuple(range(n)), tuple(reversed(range(n, n * 2)))]
        faces.extend((i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n))
        self.mesh.append(points, faces, finish)

    def conduit(self, points, radius, finish):
        self.mesh.pipe([self.p(*point) for point in points], radius, finish)


def linear_srgb(hex_color):
    channels = [(hex_color >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels)


def tile(front, u, z, d, length, wide, slope, finish):
    # Molded clay pans overlap downhill. The hollow edge is visible at the eaves.
    vertices = []
    thickness = .014
    section = (-1, -.7, -.3, 0, .3, .7, 1)
    for run, taper in [(0., .90), (length, 1.)]:
        for shell in (0, 1):
            for t in section:
                crown = .048 * (1 - t * t)
                vertices.append(front.p(u + t * wide * .5 * taper, z - slope * run + crown - shell * thickness, d + run))
    n = len(section)
    faces = []
    for i in range(n - 1):
        faces.extend([(i, i + 1, i + 1 + 2 * n, i + 2 * n),
                      (i + n, i + 3 * n, i + 3 * n + 1, i + n + 1),
                      (i, i + n, i + n + 1, i + 1),
                      (i + 2 * n, i + 2 * n + 1, i + 3 * n + 1, i + 3 * n)])
    for i in (0, n - 1):
        face = (i, i + 2 * n, i + 3 * n, i + n)
        faces.append(face if i == 0 else tuple(reversed(face)))
    smooth = {i for i in range(4 * (n - 1)) if i % 4 in (0, 1)}
    front.mesh.append(vertices, [tuple(reversed(face)) for face in faces], finish, smooth)


def clay_roof(front, offset, span, tone, wood, clay, rng):
    # Only taller street blocks get this small rooftop service room.
    z = front.top + 1.56
    low = -0.17
    back = -1.67
    slope = .35
    front.block(offset, front.top + .61, -1.04, span - .32, 1.22, 1.17, tone, .021)
    front.profile(offset, span, [(back, z - .09), (low, z - .62), (low, z - .52), (back, z + .013)], wood)
    for edge in (-1, 1):
        front.profile(offset + edge * (span / 2 - .05), .074,
                      [(back - .03, z - .11), (low + .03, z - .67), (low + .03, z - .55), (back - .03, z + .028)], wood)
    front.block(offset, z - .60, low, span + .10, .119, .085, wood)
    count = round(span / .19)
    for row in range(6):
        for column in range(count):
            u = offset + (column + .5 - count / 2) * span / count
            run = row * .248
            d = back + run
            height = z - run * slope + (5 - row) * .005 + rng.uniform(-.003, .003)
            tile(front, u, height, d, .296, .198, slope, rng.choice(clay))


def parapet(front, tone, metal, wood, clay):
    ident = front.row['id']
    width = front.width
    roof = front.top
    rng = Random(3087 + ident)
    if ident in (0, 5, 9):
        clay_roof(front, width * (-.22 if ident == 5 else .23), min(4.25, width * .46), tone, wood, clay, rng)
    if ident in (1, 6, 10):
        # Raised portions interrupt the otherwise uniform parapet silhouette.
        span = min(4.2, width * .40)
        u = width * (.23 if ident in (1, 10) else -.17)
        front.block(u, roof + 1.05, -.114, span, .45, .24, tone, .025)
        front.block(u, roof + 1.31, -.096, span + .13, .102, .34, tone, .015)
        for side in (-1, 1):
            front.block(u + side * span * .35, roof + 1.10, -.71, .10, .44, .90, tone, .011)
    if ident in (2, 4, 7, 11):
        # Shade screen on the terrace, supported by a low brick return.
        span = width * .29
        u = width * (.21 if ident % 2 else -.24)
        for side in (-1, 1):
            front.block(u + side * span / 2, roof + 1.10, -.50, .14, .84, .17, wood)
        front.block(u, roof + 1.48, -.51, span + .2, .11, .18, wood)
        front.block(u, roof + .82, -.51, span + .2, .067, .13, wood)
        for column in range(round(span / .16)):
            x = u - span / 2 + .09 + column * .16
            front.block(x, roof + 1.15, -.51, .037, .68, .047, wood, .002)
        for side in (-1, 1):
            front.conduit([(u + side * span / 2, roof + .73, -1.03),
                           (u + side * span / 2, roof + 1.34, -.54)], .022, metal)


def masonry_returns(front, tint, mortar):
    ident = front.row['id']
    if ident not in (0, 2, 5, 6, 8, 11):
        return
    side = -1 if ident in (0, 5, 8) else 1
    height = front.top - .32
    # Stone makes the building corner readable against the next bay. It wraps
    # a short distance around the side wall, avoiding its existing openings.
    edge = side * (front.width / 2 - .025)
    course = .35 if ident in (2, 8, 11) else .42
    for row in range(int((height - .47) / course)):
        z = .48 + (row + .5) * course
        if z % 3.1 > 2.86:
            continue
        width = (.39 if row % 2 else .26) if ident in (0, 2, 5) else (.56 if row % 2 else .33)
        front.block(edge - side * width * .48, z, .010, width, course - .014, .057,
                    mortar if row % 7 == 4 else tint, .009)
        front.block(edge + side * .015, z, -.138, .063, course - .014, .285, tint, .007)


def cut_stone_facings(front, tones):
    # On the oldest façades, the window bays are separated by ashlar panels.
    # Clip the courses to the measured jambs and leave the wall as the joint bed.
    if front.row['id'] not in (2, 7, 8):
        return
    random = Random(9143 + front.row['id'])
    for floor in range(1, front.row['levels']):
        windows = [data for data in front.row['openings'] if data['floor'] == floor]
        edge = -front.width / 2 + .39
        panels = []
        for data in windows:
            clearance = .64 if data['balcony'] else .45
            left, right = data['u'] - data['w'] / 2, data['u'] + data['w'] / 2
            if left - clearance - edge > .57:
                panels.append((edge, left - clearance))
            edge = right + clearance
        if front.width / 2 - .39 - edge > .57:
            panels.append((edge, front.width / 2 - .39))
        for left, right in panels:
            for row in range(5):
                z = floor * 3.1 + .42 + row * .51
                x = left
                while right - x > .19:
                    length = min(right - x, random.uniform(.44, .78) if x == left and row % 2 else random.uniform(.81, 1.18))
                    if right - (x + length) < .22:
                        length = right - x
                    front.block(x + length / 2, z, -.013 + random.uniform(-.002, .002),
                                length - .008, .498, .038, random.choice(tones), .006)
                    x += length


def build(ctx):
    collection = ctx.collection('Exterior | Facade masonry returns and roof silhouettes')
    wood = material('Facade weathered cedar structure', (.48, .36, .26), .82, scan='wood')
    metal = material('Facade oxidized fastenings', (.112, .095, .072), .72, .72)
    clay = [material(f'Roof kiln-fired clay {i + 1}', tone, roughness, scan='brick')
            for i, (tone, roughness) in enumerate([
                ((.67, .32, .20), .83), ((.73, .41, .26), .78), ((.61, .28, .18), .85),
            ])]
    mortar = material('Facade weathered joint repair', (.34, .28, .19), .90, scan='limestone')
    for row in ctx.facades:
        front = Frontage(row, collection)
        base = linear_srgb(row['tint'])
        tint = material(f"Facade lime and stone {row['id']:02d}", tuple(v * .95 for v in base), .88, scan='limestone')
        parapet(front, tint, metal, wood, clay)
        masonry_returns(front, tint, mortar)
        if row['id'] in (2, 7, 8):
            tones = [tint, material(f"Facade patched ashlar {row['id']:02d}", tuple(v * .81 for v in base), .88, scan='limestone')]
            cut_stone_facings(front, tones)
        if front.mesh.faces:
            front.mesh.finish()

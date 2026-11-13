"""Street-level storefronts fitted to the Al Marfa façade openings."""

from math import cos, pi, sin

import bpy

from al_marfa_street import Fabrication, material


def finishes():
    def coat(name, tint, scan):
        return material("M_Front_" + name, tint, .61, scan=scan)

    result = {
        "stone": coat("Dressed_Buff_Limestone", (.67, .53, .39), "limestone"),
        "lime": coat("Chalk_Lime_Render", (.71, .68, .60), "plaster"),
        "terracotta": coat("Fired_Clay", (.68, .40, .26), "brick"),
        "sill": coat("Dark_Stone_Threshold", (.52, .49, .43), "limestone"),
        "shadow": material("M_Front_Deep_Cavity", (.022, .021, .017), .92),
        "joint": material("M_Front_Weathered_Mortar", (.186, .157, .113), .94),
        "timber": coat("Oiled_Cedar", (.69, .52, .38), "wood"),
        "cut": coat("Bare_Cedar_Edge", (.86, .73, .54), "wood"),
        "teal": coat("Aged_Teal_Joinery", (.255, .49, .44), "wood"),
        "ink": coat("Faded_Indigo_Joinery", (.30, .44, .59), "wood"),
        "cream": coat("Old_Ivory_Joinery", (.92, .83, .66), "wood"),
        "iron": material("M_Front_Oxidized_Iron", (.105, .102, .086), .68, scan="metal"),
        "steel": material("M_Front_Bare_Galvanized_Steel", (.47, .48, .43), .55, .85, scan="metal"),
        "brass": material("M_Front_Brushed_Brass", (.57, .39, .17), .44, .82),
        "rubber": material("M_Front_Perished_Rubber", (.026, .023, .020), .91),
        "blue": coat("Worn_Blue_Shutter", (.36, .54, .68), "metal"),
        "olive": coat("Worn_Olive_Shutter", (.53, .60, .42), "metal"),
        "oxide": coat("Worn_Red_Shutter", (.53, .27, .20), "metal"),
        "zinc": coat("Worn_Zinc_Shutter", (.69, .69, .60), "metal"),
        "cotton": coat("Unbleached_Shade_Cloth", (.72, .67, .54), "cloth"),
        "ochre": coat("Ochre_Shade_Cloth", (.76, .48, .26), "cloth"),
        "slate": coat("Blue_Shade_Cloth", (.34, .53, .61), "cloth"),
        "glaze_ivory": material("M_Front_Crazed_Ivory_Glaze", (.67, .58, .41), .40),
        "glaze_blue": material("M_Front_Indigo_Glaze", (.062, .136, .181), .31),
        "glaze_teal": material("M_Front_Celadon_Glaze", (.112, .29, .225), .34),
    }
    glass = material("M_Front_Dusty_Display_Glass", (.41, .52, .49), .23)
    glass.surface_render_method = "BLENDED"
    shader = next(node for node in glass.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Alpha"].default_value = .22
    shader.inputs["IOR"].default_value = 1.5
    result["glass"] = glass
    return result


# Row order runs from the southern spawn towards the arch.
WEST = (
    ("Textile_Merchant", "ink", "blue", "stone", "textile"),
    ("Mint_Tea_Room", "timber", "oxide", "stone", "tea"),
    ("Western_Workshop", "cream", "zinc", "sill", "workshop"),
    ("Old_Provisioner", "teal", "olive", "lime", "joinery"),
    ("Arch_Weaver", "ink", "blue", "terracotta", "textile"),
    ("Northern_Goods", "cream", "olive", "stone", "display"),
)
EAST = (
    ("Epicerie", "teal", "olive", "lime", "display"),
    ("Atelier_17", "cream", "oxide", "sill", "workshop"),
    ("Fruits_Secs", "teal", "blue", "terracotta", "display"),
    ("Eastern_Workshop", "ink", "zinc", "stone", "workshop"),
    ("North_Arcade", "timber", "blue", "lime", "joinery"),
    ("Northern_Tea", "timber", "oxide", "stone", "tea"),
)


class Shop:
    """Model in u/height and in measured distance from the existing wall."""

    def __init__(self, ctx, frontage, style, mats):
        self.name, self.wood, self.paint, self.stone, self.kind = style
        self.mats = mats
        self.frontage = frontage
        self.origin = (frontage["faceX"], -frontage["centerZ"], 0)
        self.turn = frontage["angle"]
        collection = ctx.collection("Exterior | Storefronts and recessed displays")
        self.frames = Fabrication(collection, "SM_Front_" + self.name + "_Surrounds")
        self.panels = Fabrication(collection, "SM_Front_" + self.name + "_Inserts")
        self.glass = Fabrication(collection, "SM_Front_" + self.name + "_Glazing")
        self.fittings = Fabrication(collection, "SM_Front_" + self.name + "_Fittings")

    def block(self, batch, u, d, h, width, depth, height, finish, bevel=.004, roll=0):
        batch.block((u, -d, h), (width, depth, height), self.mats[finish], bevel, roll)

    def pipe(self, batch, points, radius, finish, sides=8):
        batch.pipe([(u, -d, h) for u, d, h in points], radius, self.mats[finish], sides)

    def profile(self, batch, outline, start, end, finish):
        """Extrude a counterclockwise outline on the façade plane."""
        verts = [(u, -d, h) for d in (start, end) for u, h in outline]
        count = len(outline)
        faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
        faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
        batch.append(verts, faces, self.mats[finish])

    def finish(self):
        for batch in (self.frames, self.panels, self.glass, self.fittings):
            if not batch.faces:
                continue
            obj = batch.finish(.84)
            obj.location = self.origin
            obj.rotation_euler.z = self.turn
            if batch is self.glass:
                obj["worldCastShadow"] = False

    def fastener(self, u, d, h, radius, finish):
        self.pipe(self.fittings, [(u, d - .003, h), (u, d + .003, h)], radius, finish, 6)

    def masonry_details(self, opening):
        u, width, top, bottom = (opening[k] for k in ("u", "w", "top", "bottom"))
        batch = self.fittings
        if not opening["open"]:
            # Water table has a sloped top, projected nose and a dark drip edge.
            left, right = u - width / 2 - .105, u + width / 2 + .105
            h = bottom - .065
            for x in (left + .175, right - .175):
                self.profile(batch, [(x - .072, h - .157), (x + .072, h - .157),
                                     (x + .082, h + .011), (x - .082, h + .011)],
                             .003, .167, self.stone)
            self.block(batch, u, .178, h + .012, right - left, .075, .036, "sill", .006)
            self.block(batch, u, .184, h - .013, right - left - .048, .029, .013, "joint", .002)

        if self.kind in ("display", "joinery"):
            # Three masonry courses above the lintel, with staggered joints.
            course_width = width + .34
            for row in range(3):
                pieces = 5 if row == 1 else 6
                step = course_width / pieces
                for j in range(pieces):
                    x = u - course_width / 2 + (j + .5) * step
                    projection = .030 + .005 * sin(j * 2.7 + row * 4 + u)
                    self.block(batch, x, projection, top + .211 + row * .050,
                               step - .007, .072, .043, self.stone, .004)

    def shutter_fittings(self, u, width, d, lo, hi, top):
        batch = self.fittings
        for side in (-1, 1):
            x = u + side * (width / 2 - .039)
            for fraction in (.10, .36, .64, .9):
                self.fastener(x, -.109, lo + (hi - lo) * fraction, .008, "steel")
            x = u + side * (width / 2 - .117)
            self.block(batch, x, -.014, top - .069, .066, .022, .11, "iron", .006)
            for y in (top - .104, top - .035):
                self.fastener(x, .000, y, .009, "steel")
        for x in (u - width * .24, u + width * .24):
            self.block(batch, x, d + .054, lo - .014, .085, .027, .041, "steel", .006)
            self.fastener(x, d + .070, lo - .014, .008, "iron")

    def glazed_fittings(self, x, d, lo, hi, width, hinge_side):
        batch = self.fittings
        # Interior shelf and exposed brass glazing clips.
        shelf = lo + (hi - lo) * .27
        self.block(batch, x, d - .078, shelf, width - .047, .112, .026, "cut", .004)
        for side in (-1, 1):
            edge = x + side * (width / 2 - .017)
            for y in (lo + .088, hi - .088):
                self.block(batch, edge, d + .029, y, .025, .016, .048, "brass", .003)
                self.fastener(edge, d + .040, y, .005, "iron")
        hinge = x + hinge_side * (width / 2 + .034)
        for height in (lo - .31, hi + .116):
            self.fastener(hinge, d + .062, height, .007, "steel")

    def surround(self, opening):
        u, width, top = (opening[k] for k in ("u", "w", "top"))
        open_door = opening["open"]
        bottom = .035 if open_door else opening["bottom"]
        height = top - bottom
        frame = self.frames
        trim = self.stone
        width_out = width + .225
        plinth = "sill" if self.kind in ("tea", "workshop") else trim

        for side in (-1, 1):
            edge = u + side * width / 2
            # Behind the visible ashlar, a masonry return closes the wall shell.
            self.block(frame, edge + side * .039, -.154, bottom + height * .5,
                       .079, .359, height, trim, .008)
            if self.kind == "workshop":
                self.block(frame, edge + side * .049, .017, bottom + height * .5,
                           .098, .112, height + .034, "iron", .007)
                self.block(frame, edge + side * .063, .068, bottom + height * .5,
                           .029, .019, height - .09, "steel", .002)
                for offset in (.19, .89, 1.58):
                    self.block(frame, edge + side * .049, .081, bottom + offset,
                               .025, .015, .026, "iron", .004, pi / 4)
            else:
                jamb = .141 if self.kind in ("tea", "textile") else .116
                # Blocks bear individually on the sill. Small mortar joints
                # interrupt the silhouette and give the jamb a plausible bond.
                pieces = 5 if self.kind in ("tea", "textile") else 4
                height_per = height / pieces
                for i in range(pieces):
                    face_depth = .059 + .008 * sin(i * 4.7 + u)
                    self.block(frame, edge + side * (jamb / 2 - .007), face_depth, bottom + (i + .5) * height_per,
                               jamb, .156 + .01 * cos(i * 1.6), height_per - .006, trim, .009)
                self.block(frame, edge + side * .084, .083, bottom + .104,
                           .167, .174, .208, plinth, .011)
                if self.kind in ("tea", "textile"):
                    self.block(frame, edge + side * .08, .107, bottom + height - .096,
                               .164, .149, .106, trim, .007)
                    self.pipe(frame, [(edge + side * .053, .139, bottom + .19),
                                      (edge + side * .053, .139, top - .103)], .016, trim, 8)
        self.block(frame, u, -.139, top + .030, width_out, .379, .061, trim, .007)
        if self.kind in ("tea", "textile"):
            self.carved_header(u, width, top)
        elif self.kind == "workshop":
            self.block(frame, u, .021, top + .088, width_out, .114, .136, "iron", .007)
            self.block(frame, u, .079, top + .084, width_out + .031, .053, .021, "steel", .004)
        else:
            self.block(frame, u, .055, top + .097, width_out, .173, .157, trim, .013)
            self.block(frame, u, .126, top + .164, width_out + .085, .107, .039, plinth, .007)

        if not open_door:
            self.block(frame, u, -.09, bottom - .021, width + .019, .437, .065, trim, .009)
            self.block(frame, u, .145, bottom - .026, width_out, .100, .076, plinth, .012)

    def carved_header(self, u, width, top):
        frame = self.frames
        radius = width / 2 + .045
        spring = top + .009
        # Stone voussoirs describe a shallow relieving arch over the existing
        # rectangle. The open portal keeps the full original head height.
        segments = 11
        for i in range(segments):
            a, b = pi * (i / segments + .002), pi * ((i + 1) / segments - .002)
            center = i == segments // 2
            rise = .218 if center else .191
            outer = [(u + (radius + .11) * cos(t), spring + rise * sin(t)) for t in (a, b)]
            inner = [(u + radius * cos(t), spring + .091 * sin(t)) for t in (b, a)]
            self.profile(frame, outer + inner, -.014, .109 if center else .089, self.stone)
        for sign in (-1, 1):
            self.block(frame, u + sign * (radius - .022), .071, top + .028,
                       .162, .139, .059, "sill", .008)

    def tiled_plinth(self, openings):
        if self.kind not in ("tea", "textile", "display"):
            return
        frame = self.frames
        tile = "glaze_blue" if self.kind != "display" else "glaze_teal"
        for previous, following in zip(openings, openings[1:]):
            left = previous["u"] + previous["w"] * .5 + .12
            right = following["u"] - following["w"] * .5 - .12
            # The outside pier contains meters and older posters. This strip
            # covers only the low masonry between the finished door reveals.
            span = right - left
            if span < .55:
                continue
            center = (left + right) / 2
            self.block(frame, center, .007, .212, span, .036, .299, "joint", .004)
            tiles = int(span / .18)
            tile_w = span / tiles
            for i in range(tiles):
                x = left + (i + .5) * tile_w
                for row in range(2):
                    h = .135 + row * .145
                    self.block(frame, x, .026, h, tile_w - .006, .018, .139,
                               "glaze_ivory", .005)
                    self.block(frame, x, .037, h, .068, .007, .068, tile, .002, pi / 4)
            self.block(frame, center, .042, .365, span, .066, .029, self.stone, .006)

    def closure(self, u, bottom, top, width):
        self.block(self.panels, u, -.341, (top + bottom) / 2, width - .012, .028,
                   top - bottom - .012, "shadow", .0)

    def lock(self, u, d, h, industrial=False):
        batch = self.panels
        finish = "iron" if industrial else "brass"
        self.block(batch, u, d, h, .062, .023, .095, finish, .006)
        self.block(batch, u, d + .014, h - .012, .013, .009, .030, "rubber", .002)
        points = [(u, d + .019, h - .091), (u, d + .047, h - .078),
                  (u, d + .054, h + .066), (u, d + .023, h + .087)]
        self.pipe(batch, points, .009 if industrial else .008, finish, 9)

    def door_panel(self, u, d, h, width, height):
        # Route the moulded lip into one solid panel. Stacking thin plates
        # here leaves overlapping back faces in the real-time shadow atlas.
        rings = ((-.041, .004), (-.035, 0.), (.011, 0.),
                 (.016, .010), (.032, .024), (.037, .031))
        verts = []
        for depth, inset in rings:
            w = width / 2 - inset
            z = height / 2 - inset
            verts.extend((u + x, -(d + depth), h + y)
                         for x, y in ((-w, -z), (w, -z), (w, z), (-w, z)))
        faces = [(3, 2, 1, 0)]
        for i in range(0, len(verts) - 4, 4):
            for j in range(4):
                a, b = i + j, i + (j + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        faces.append(tuple(range(len(verts) - 4, len(verts))))
        self.panels.append(verts, faces, self.mats[self.wood])

    def roll_down(self, opening, wide=False):
        u, width, bottom, top = (opening[k] for k in ("u", "w", "bottom", "top"))
        batch = self.panels
        clear = width - .121
        self.closure(u, bottom, top, width)
        d = -.195
        lo, hi = bottom + .061, top - .165
        slat_count = round((hi - lo) / (.112 if wide else .072))
        pitch = (hi - lo) / slat_count
        left, right = u - clear * .5, u + clear * .5
        # Lath silhouette is profiled through the roll instead of printed.
        lath = ((.00, -.017), (.09, -.016), (.18, -.005), (.30, .008),
                (.68, .008), (.82, .002), (.91, -.009))
        curve = [(lo + pitch * (index + frac), d + lip)
                 for index in range(slat_count) for frac, lip in lath]
        curve.append((hi, d - .016))
        samples = len(curve)
        vertices = [(x, -offset, height) for x in (left, right) for height, offset in curve]
        faces = [(i, i + samples, i + samples + 1, i + 1) for i in range(samples - 1)]
        batch.append(vertices, faces, self.mats[self.paint])
        for index in range(slat_count):
            h = lo + pitch * index
            # A few vent punches have a formed flange. The dark center is
            # backed by the opaque interior screen instead of opening a view.
            if wide and index in (slat_count - 5, slat_count - 3):
                for j in range(8):
                    x = u + (j - 3.5) * clear / 9.3
                    self.block(batch, x, d + .0095, h + pitch * .52, .11, .004, .022, "steel", .003)
                    self.block(batch, x, d + .012, h + pitch * .52, .085, .004, .011, "rubber", .002)
        for sign in (-1, 1):
            x = u + sign * (width / 2 - .038)
            self.block(batch, x, -.167, (lo + hi) / 2, .051, .112, hi - lo + .043, "iron", .005)
            self.block(batch, x - sign * .023, -.105, (lo + hi) / 2, .018, .037, hi - lo, "steel", .003)
        self.block(batch, u, -.142, top - .067, width - .049, .221, .177, self.paint, .013)
        self.block(batch, u, -.024, top - .108, width - .084, .030, .025, "iron", .003)
        self.block(batch, u, d + .003, lo - .019, clear, .091, .058, "iron", .005)
        self.block(batch, u, d + .027, lo - .041, clear + .011, .033, .019, "rubber", .003)
        self.lock(u + (clear * .29 if wide else 0.), d + .013, lo + .143, True)
        self.shutter_fittings(u, width, d, lo, hi, top)

    def workshop_gate(self, opening):
        u, width, bottom, top = (opening[k] for k in ("u", "w", "bottom", "top"))
        batch = self.panels
        self.closure(u, bottom, top, width)
        height, d = top - bottom, -.166
        mid = (bottom + top) * .5
        leaf_width = width * .5 - .053
        vent_high = top - .055
        vent_low = vent_high - .30
        self.block(batch, u, d - .064, mid, width - .040, .024, height - .048, "iron", .004)
        for side in (-1, 1):
            x = u + side * (leaf_width * .5 + .015)
            self.block(batch, x, d - .006, (bottom + vent_low) / 2,
                       leaf_width - .020, .084, vent_low - bottom - .047, self.paint, .011)
            self.block(batch, x, d + .043, bottom + .092,
                       leaf_width - .023, .018, .133, "steel", .004)
            for edge in (-1, 1):
                self.block(batch, x + edge * (leaf_width * .5 - .026), d + .048, mid,
                           .043, .034, height - .068, "iron", .004)
            for level in (bottom + .189, vent_low + .006, vent_high):
                self.block(batch, x, d + .048, level, leaf_width - .023, .042, .041, "iron", .005)
            for index in range(5):
                self.block(batch, x, d + .017 - .004 * (index % 2), vent_low + (index + 1) * .047,
                           leaf_width - .122, .040, .025, "steel", .004)
            brace_height = vent_low - bottom - .346
            brace_width = leaf_width - .126
            self.pipe(batch, [(x - side * brace_width / 2, d + .045, bottom + .242),
                              (x + side * brace_width / 2, d + .045, bottom + .242 + brace_height)],
                      .012, "iron", 6)
            for level in (bottom + .24, bottom + height * .52, top - .19):
                hinge_x = x + side * (leaf_width / 2 - .028)
                self.block(batch, hinge_x - side * .037, d + .062, level,
                           .135, .029, .062, "steel", .004)
                self.pipe(batch, [(hinge_x + side * .018, d + .071, level - .045),
                                  (hinge_x + side * .018, d + .071, level + .045)], .016, "iron", 8)
        self.lock(u - .069, d + .045, bottom + .897, True)

    def panel_door(self, opening, glazed=False):
        u, width, bottom, top = (opening[k] for k in ("u", "w", "bottom", "top"))
        batch = self.panels
        self.closure(u, bottom, top, width)
        h, d = top - bottom, -.167
        pane_top = top - .323
        panel_top = bottom + .581
        leaf_width = width * .5 - .062
        for side in (-1, 1):
            x = u + side * (leaf_width / 2 + .016)
            if not glazed:
                # Narrow vertical planks with irregular milling width and
                # beveled joins, fastened into the surrounding stile.
                plank_w = leaf_width / 5
                for i in range(5):
                    p = x + (i - 2) * plank_w
                    self.block(batch, p, d - .044 - .003 * cos(i * 2.7), bottom + h * .5,
                               plank_w - .006, .056, h - .117, self.wood, .005)
            for sign in (-1, 1):
                self.block(batch, x + sign * (leaf_width / 2 - .037), d + .005, bottom + h * .5,
                           .074, .089, h - .062, self.wood, .007)
            for level in (bottom + .062, panel_top, pane_top, top - .072):
                self.block(batch, x, d + .005, level, leaf_width - .039, .087, .076, self.wood, .007)
            self.door_panel(x, d, bottom + .311, leaf_width - .126, .433)
            for height in (bottom + .26, top - .272):
                hinge = x + side * (leaf_width / 2 - .032)
                self.block(batch, hinge, d + .056, height, .061, .023, .057, "iron", .004)
                self.pipe(batch, [(hinge + side * .026, d + .079, height - .036),
                                  (hinge + side * .026, d + .079, height + .037)], .009, "iron", 8)
            self.lock(u + side * .079, d + .050, bottom + .903)
            if not glazed:
                continue
            pane_bottom = panel_top + .028
            pw = leaf_width - .132
            lo, hi = pane_bottom, pane_top - .034
            self.window_dressing(x, pw, lo, hi, d, side)
            self.glazed_fittings(x, d, lo, hi, pw, side)
            self.window_pane(x, pw, lo, hi, d + .014)
            self.window_pane(x, pw, pane_top + .045, top - .114, d + .011)
            for k in range(3):
                xbar = x + pw * (k - 1) * .26
                self.block(batch, xbar, d + .033, (lo + hi) / 2, .020, .022, hi - lo, self.wood, .003)
            self.block(batch, x, d + .038, lo + (hi - lo) * .52, pw, .024, .027, self.wood, .003)
            self.block(batch, x, d + .041, top - .185, pw, .025, .024, self.wood, .003)
            if self.kind in ("tea", "textile"):
                self.grille(x, pw, lo, hi, d + .066)

    def window_pane(self, u, width, low, high, d):
        self.glass.append(
            [(u - width / 2, -d, low), (u + width / 2, -d, low),
             (u + width / 2, -d, high), (u - width / 2, -d, high)],
            [(0, 1, 2, 3)], self.mats["glass"],
        )

    def window_dressing(self, u, width, lo, hi, d, side):
        batch = self.panels
        if self.kind in ("tea", "textile"):
            cloth = "cotton" if self.kind == "tea" else "slate"
            start = u - width / 2
            columns = 16
            verts = []
            for i in range(columns + 1):
                x = start + i / columns * width
                ripple = .010 * cos(i * pi / 2 + side * .61)
                verts.extend(((x, -(d - .080 + ripple), lo + .009),
                              (x + .012 * side * sin(i * .49), -(d - .073 + ripple), hi - .014)))
            batch.append(verts, [(i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1) for i in range(columns)],
                         self.mats[cloth])
            return

        shelf_y = lo + .18
        self.block(batch, u, d - .091, shelf_y, width - .025, .126, .029, "timber", .004)
        for i in range(4):
            x = u + (i - 1.5) * width / 4.5
            h = .078 + .028 * ((i + (side == 1)) % 3)
            radius = .029 + .004 * (i % 2)
            color = ("glaze_teal", "glaze_ivory", "terracotta", "glaze_blue")[i]
            self.pipe(batch, [(x, d - .059, shelf_y + .016),
                              (x, d - .059, shelf_y + .016 + h)], radius, color, 10)
            self.pipe(batch, [(x, d - .059, shelf_y + .015 + h),
                              (x, d - .059, shelf_y + .022 + h)], radius * 1.07, "brass", 10)
        cloth = "ochre" if side == 1 else "cotton"
        self.block(batch, u, d - .106, hi - .073, width, .024, .115, cloth, .004)

    def grille(self, u, width, low, high, d):
        batch = self.panels
        for i in (-1, 0, 1):
            x = u + i * width * .257
            self.pipe(batch, [(x, d, low + .032), (x, d, high - .034)], .007, "iron", 7)
        for fraction in (.27, .76):
            h = low + (high - low) * fraction
            self.block(batch, u, d, h, width, .018, .015, "iron", .002)
            for i in (-1, 1):
                x = u + i * width * .132
                a = min(width * .11, .062)
                for sign in (-1, 1):
                    points = [(x + a * cos(pi * k / 6), d + .005, h + sign * a * 1.47 * sin(pi * k / 6))
                              for k in range(7)]
                    self.pipe(batch, points, .006, "iron", 7)
        self.block(batch, u, d, low + .032, width, .020, .018, "iron", .003)
        self.block(batch, u, d, high - .032, width, .020, .018, "iron", .003)

    def open_portal(self, opening):
        u, width, top = (opening[k] for k in ("u", "w", "top"))
        batch = self.panels
        # Open doors retain the entire width and height of the original
        # capsule opening. The offset joinery reads as hinged against the jamb.
        for side in (-1, 1):
            x = u + side * (width / 2 + .023)
            self.block(batch, x, -.265, 1.286, .046, .149, 2.472, self.wood, .005)
            for h in (.26, 1.24, 2.30):
                self.block(batch, x, -.188, h, .047, .018, .084, "iron", .004)
        self.block(batch, u, -.237, top + .022, width, .128, .052, self.wood, .005)

    def build(self):
        openings = sorted((o for o in self.frontage["openings"] if o["floor"] == 0),
                          key=lambda o: o["bay"])
        for opening in openings:
            self.surround(opening)
            self.masonry_details(opening)
            if opening["open"]:
                self.open_portal(opening)
                continue
            bay = opening["bay"]
            if self.kind == "workshop" and bay % 3 == 1:
                self.workshop_gate(opening)
            elif self.kind == "workshop":
                self.roll_down(opening, wide=True)
            elif self.kind == "display" and bay % 3 != 2:
                self.panel_door(opening, glazed=True)
            elif self.kind in ("textile", "tea") and bay % 3 == 0:
                self.panel_door(opening, glazed=True)
            elif self.kind == "joinery" and bay % 2 == 0:
                self.panel_door(opening)
            else:
                self.roll_down(opening)
        self.tiled_plinth(openings)
        self.finish()


def build(ctx):
    if not ctx.facades:
        raise ValueError("Storefront rebuild requires extracted façade openings")
    mats = finishes()
    for side, palettes in (("west", WEST), ("east", EAST)):
        rows = sorted((facade for facade in ctx.facades if facade["side"] == side),
                      key=lambda f: -f["centerZ"])
        if len(rows) != len(palettes):
            raise ValueError(f"Expected {len(palettes)} {side} frontages, found {len(rows)}")
        for frontage, style in zip(rows, palettes, strict=True):
            Shop(ctx, frontage, style, mats).build()

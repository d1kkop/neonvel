"""
Neon Velocity car generator v3: one continuous subdivision body (cabin included) from keyframed cross-sections.

Each cross-section is a 12-point half profile (sill, rocker, widest point, shoulder, fender peak, hood valley,
glass base, roof side, roof centre). Every profile value is keyframed along the car (t = 0 nose .. 1 tail) and
interpolated with a monotone cubic, so surfaces flow without kinks. Window regions are marked on the cage, so
their outlines follow the surface flow; after subdivision they get inset into black frames. Arches are round
cuts with rolled edges; lamps, intakes and vents are cut into the body (not glued on).

Conventions as carlib2 (Blender +Y = front, +Z up, origin on the ground at the centre; material names map to
the game's materials; tail_L/R + exhaust_L/R empties).
Run: blender --background --python tools/blender/car_<style>.py -- <out.glb> [preview.png]
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from carlib2 import Car as Car2  # noqa: E402
import rims  # noqa: E402

PARAMS = ['zb', 'hw', 'zw', 'scoop', 'sh', 'zsh', 'fx', 'zf', 'vx', 'zv', 'gb', 'zg', 'rw', 'zr', 'crown']
# Material slots on the body: windows are split per pane while building (merged to glass afterwards).
SLOTS = ['paint', 'glass', 'trim', 'well', 'glass', 'glass', 'glass']
G_FRONT, G_SIDE_R, G_SIDE_L, G_REAR = 1, 4, 5, 6


def mono_cubic(xs, ys):
    """Monotone (Fritsch-Carlson) cubic through the points: smooth, no overshoot."""
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9:
                k = 3 / math.sqrt(s)
                m[i], m[i + 1] = k * a * d[i], k * b * d[i]

    def f(x):
        if x <= xs[0]:
            return ys[0] + m[0] * (x - xs[0])
        if x >= xs[-1]:
            return ys[-1] + m[-1] * (x - xs[-1])
        i = max(j for j in range(n - 1) if xs[j] <= x)
        h = xs[i + 1] - xs[i]
        u = (x - xs[i]) / h
        h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
    return f


class Car3(Car2):
    def __init__(self, style_name, design):
        design.setdefault('glass', [(0.3, 0.8, 1.0, 0.7, 0.5), (0.6, 0.8, 1.0, 0.7, 0.5)])  # carlib2 compat (unused)
        super().__init__(style_name, design)
        keys, cur = [], {}
        for k in design['keys']:
            cur = {**cur, **k}
            keys.append(dict(cur))
        ts = [k['t'] for k in keys]
        self.f = {p: mono_cubic(ts, [k[p] for k in keys]) for p in PARAMS}

    # ---------------------------------------------------------------- the section
    def P(self, t):
        return {p: self.f[p](t) for p in PARAMS}

    def profile(self, t):
        """Half profile P0..P11 as (x, z), bottom centre -> top centre (right side)."""
        p = self.P(t)
        H, HW = self.HW * p['hw'], self.HW
        zb, zw, s = p['zb'], p['zw'], max(0.0, p['scoop'])
        return [
            (0.0, zb),
            (H * 0.80, zb),
            (H * (0.93 - 0.10 * s), zb + 0.035),
            (H * (0.975 - 0.22 * s), zb + 0.45 * (zw - zb)),
            (H * (1.0 - 0.17 * s), zw),
            (H * p['sh'], p['zsh']),
            (H * p['fx'], p['zf']),
            (HW * p['vx'], p['zv']),
            (HW * p['gb'], p['zg']),
            (HW * p['rw'], p['zr']),
            (HW * p['rw'] * 0.5, p['zr'] + p['crown'] * 0.75),
            (0.0, p['zr'] + p['crown']),
        ]

    def sec(self, t):
        """carlib2 compat: (zb, zt, hw, belt, tumble, crown)."""
        p = self.P(t)
        return p['zb'], p['zf'], p['hw'], 0.5, 0.8, 0.0

    # ---------------------------------------------------------------- the body
    def body(self):
        d = self.d
        cab = d['cabin']
        pillars = d.get('pillars', [])
        pw = d.get('pillar_w', 0.012)
        bounds = [cab['ws'][0], cab['ws'][1], cab['side'][0], cab['side'][1], cab['rear'][0], cab['rear'][1]] + [p + k * pw for p in pillars for k in (-1, 1)]
        n_along = d.get('cage_along', 44)
        ts = sorted(set([round(i / n_along, 4) for i in range(n_along + 1)] + [round(b, 4) for b in bounds]
                        + [round(k['t'], 4) for k in d['keys']]))
        ts = [t for k, t in enumerate(ts) if k == 0 or t - ts[k - 1] > 0.006 or t in bounds]
        bm = bmesh.new()
        rings = []

        def ring_from(half, y):
            right = half[1:-1]
            pts = [half[0]] + right + [half[-1]] + [(-x, z) for x, z in reversed(right)]
            return [bm.verts.new((x, y, z)) for x, z in pts]

        # Nose / tail: an extra ring slightly beyond each end, pulled in, so the ends round over.
        def shrunk(t, kx, kz, dt):
            half = self.profile(t)
            zm = (half[0][1] + half[-1][1]) / 2
            return ring_from([(x * kx, zm + (z - zm) * kz) for x, z in half], self.y(t) - dt * self.L)

        rings.append(shrunk(0.0, d.get('nose_kx', 0.8), d.get('nose_kz', 0.82), -d.get('nose_dt', 0.012)))
        for t in ts:
            rings.append(ring_from(self.profile(t), self.y(t)))
        rings.append(shrunk(1.0, d.get('tail_kx', 0.9), d.get('tail_kz', 0.9), d.get('tail_dt', 0.006)))
        ring_t = [0.0] + ts + [1.0]
        n = len(rings[0])
        seg = lambda k: k if k <= 10 else 21 - k   # face band k -> profile segment Pm..Pm+1
        pidx = lambda j: j if j <= 11 else 22 - j  # ring vertex -> profile point
        for i, (a, b) in enumerate(zip(rings, rings[1:])):
            tm = (ring_t[i] + ring_t[i + 1]) / 2
            for k in range(n):
                f = bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
                m = seg(k)
                mi = 0
                if cab['side'][0] < tm < cab['side'][1] and m == 8:
                    mi = G_SIDE_R if k <= 10 else G_SIDE_L
                    if any(abs(tm - p) < pw for p in pillars):
                        mi = 2 if d.get('pillar_mat') == 'trim' else 0
                elif m in (9, 10) and cab['ws'][0] < tm < cab['ws'][1]:
                    mi = G_FRONT
                elif m in (9, 10) and cab['rear'][0] < tm < cab['rear'][1]:
                    mi = G_REAR
                f.material_index = mi
        cap0 = bm.faces.new(list(reversed(rings[0])))
        cap1 = bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        top = max(bm.faces, key=lambda f: f.calc_center_median().z)
        if top.normal.z < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        # Inset the end caps once so they stay flat panels with a tight rounded edge.
        bmesh.ops.inset_individual(bm, faces=[cap0, cap1], thickness=0.035, depth=0.0)
        # Creases: character lines along the car.
        cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        cw = {2: d.get('crease_sill', 0.8), 5: d.get('crease_shoulder', 0.7), 6: d.get('crease_fender', 0.3), 8: d.get('crease_belt', 0.5)}
        cw.update(d.get('creases', {}))  # extra / stronger character lines (profile point -> crease weight)
        for a, b in zip(rings[1:-1], rings[2:-1]):
            for j in range(n):
                w = cw.get(pidx(j))
                if w:
                    e = bm.edges.get((a[j], b[j]))
                    if e:
                        e[cl] = w
        for ring in (rings[1], rings[-2]):
            for j in range(n):
                e = bm.edges.get((ring[j], ring[(j + 1) % n]))
                if e:
                    e[cl] = d.get('end_crease', 0.6)
        o = self.obj('body', bm, SLOTS)
        sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = d.get('subdiv', 2)
        self.apply_all(o)
        self.body_obj = o
        self.windows()
        self.arches()
        self.smooth(o)
        return o

    def smooth(self, o, angle=None):
        for p in o.data.polygons:
            p.use_smooth = True
        bpy.context.view_layer.objects.active = o
        for x in bpy.context.selected_objects:
            x.select_set(False)
        o.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle or self.d.get('smooth_angle', 40)))
        except Exception:
            pass
        o.select_set(False)

    def windows(self):
        """Inset each pane into a black frame (separately, so pillars stay between them)."""
        o = self.body_obj
        bm = bmesh.new()
        bm.from_mesh(o.data)
        frame = self.d.get('frame', 0.028)
        for g in (G_FRONT, G_REAR, G_SIDE_R, G_SIDE_L):
            faces = [f for f in bm.faces if f.material_index == g]
            if not faces:
                continue
            for island in self._islands(faces):
                res = bmesh.ops.inset_region(bm, faces=island, thickness=frame, depth=-0.009, use_even_offset=True)
                for f in res['faces']:
                    f.material_index = 2
        for f in bm.faces:
            if f.material_index in (G_SIDE_R, G_SIDE_L, G_REAR):
                f.material_index = 1
        bm.to_mesh(o.data)
        bm.free()

    @staticmethod
    def _islands(faces):
        left, out = set(faces), []
        while left:
            stack, isl = [left.pop()], []
            while stack:
                f = stack.pop()
                isl.append(f)
                for e in f.edges:
                    for g in e.link_faces:
                        if g in left:
                            left.remove(g)
                            stack.append(g)
            out.append(isl)
        return out

    def arches(self):
        d = self.d
        for wi, t in enumerate(self.wheelT):
            R = self.wheelR[wi]
            aR = R + d.get('arch_gap', 0.05)
            for side in (-1, 1):
                bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=aR, depth=0.6, location=(side * (self.HW + 0.2), self.y(t), R + d.get('arch_lift', 0.0)), rotation=(0, math.pi / 2, 0))
                c = bpy.context.object
                c.data.materials.append(self.M['well'])
                self.boolean(self.body_obj, c)
        # Rolled arch lips: bevel the edges where the paint meets the well.
        o = self.body_obj
        bm = bmesh.new()
        bm.from_mesh(o.data)
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and {f.material_index for f in e.link_faces} == {0, 3}]
        if edges:
            try:
                bmesh.ops.bevel(bm, geom=edges, offset=0.012, segments=2, profile=0.6, affect='EDGES', clamp_overlap=True)
            except Exception as ex:
                print('ARCH BEVEL FAILED', ex)
        bm.to_mesh(o.data)
        bm.free()

    # ---------------------------------------------------------------- helpers for cut-in details
    def surf(self, origin, direction):
        h = self.hit(origin, direction)
        return (Vector(h[0]), Vector(h[1])) if h else (None, None)

    def cut_box(self, size, loc, rot=(0, 0, 0), bevel=0.0):
        c = self.box(size, loc, 'well', rot=rot, bevel=bevel)
        self.apply_all(c)
        self.boolean(self.body_obj, c)

    def front_y(self, x, z):
        p, _ = self.surf((x, self.L, z), (0, -1, 0))
        return p.y if p else self.L / 2

    def rear_y(self, x, z):
        p, _ = self.surf((x, -self.L, z), (0, 1, 0))
        return p.y if p else -self.L / 2

    def top_z(self, x, t):
        p, _ = self.surf((x, self.y(t), 4.0), (0, 0, -1))
        return p.z if p else self.P(t)['zf']

    def side_x(self, s, t, z):
        p, _ = self.surf((s * 4.0, self.y(t), z), (-s, 0, 0))
        return p.x if p else s * self.HW

    # ---------------------------------------------------------------- detail kit (hypercar)
    def led_headlights(self, x=0.6, z=0.5, w=0.36, h=0.07, yaw=0.42, pitch=0.12):
        for s in (-1, 1):
            y = self.front_y(s * x, z)
            rot = (pitch, 0, -s * yaw)
            self.cut_box((w, 0.24, h), (s * x, y - 0.02, z), rot=rot, bevel=0.012)
            # Lamp unit at the back of the slot: black housing, LED blade, projector, amber tip.
            back = Vector((0, -0.075, 0))
            back.rotate(Matrix.Rotation(-s * yaw, 3, 'Z'))
            c = Vector((s * x, y, z)) + back
            self.box((w * 0.92, 0.02, h * 0.82), tuple(c + Vector((0, -0.012, 0))), 'trim', rot=rot)
            self.box((w * 0.82, 0.02, 0.012), tuple(c + Vector((0, 0.006, h * 0.22))), 'head', rot=rot)
            for k in (-0.22, 0.12):
                off = Vector((k * w, 0.004, -0.008))
                off.rotate(Matrix.Rotation(-s * yaw, 3, 'Z'))
                self.cyl(0.022, 0.03, tuple(c + off), 'chrome', rot=(math.pi / 2 + pitch, 0, -s * yaw), verts=20)
                self.cyl(0.016, 0.034, tuple(c + off + Vector((0, 0.004, 0))), 'head', rot=(math.pi / 2 + pitch, 0, -s * yaw), verts=20)
            tip = Vector((s * w * 0.44, 0.006, -h * 0.25))
            tip.rotate(Matrix.Rotation(-s * yaw, 3, 'Z'))
            self.box((w * 0.12, 0.02, 0.014), tuple(c + tip), 'amber', rot=rot)

    def front_intakes(self, z=0.26):
        y = self.front_y(0, z)
        self.cut_box((0.86, 0.3, 0.13), (0, y, z), bevel=0.03)
        self.mesh_insert((0, y - 0.07, z), (1, 0, 0), (0, 0, 1), 0.82, 0.11)
        for s in (-1, 1):
            x = 0.7
            y = self.front_y(s * x, z + 0.02)
            self.cut_box((0.3, 0.36, 0.18), (s * x, y, z + 0.02), rot=(0, 0, -s * 0.35), bevel=0.04)
            self.mesh_insert((s * (x - 0.02), y - 0.09, z + 0.02), (math.cos(0.35), -s * math.sin(0.35), 0), (0, 0, 1), 0.24, 0.15)

    def hood_vents(self, t=0.12, x=0.3, n_fins=4):
        for s in (-1, 1):
            zt = self.top_z(s * x, t)
            self.cut_box((0.32, 0.2, 0.12), (s * x, self.y(t), zt), rot=(-0.15, 0, 0), bevel=0.02)
            for i in range(n_fins):
                yy = self.y(t) - 0.08 + i * 0.16 / (n_fins - 1)
                self.box((0.3, 0.012, 0.05), (s * x, yy, zt - 0.03), 'trim', rot=(-0.5, 0, 0))

    def side_scoops(self, t=0.64, z=0.55, size=(0.5, 0.56, 0.3), fins=3):
        for s in (-1, 1):
            x = self.side_x(s, t, z)
            self.cut_box(size, (x, self.y(t), z), rot=(0, 0, s * 0.22), bevel=0.05)
            self.mesh_insert((x - s * 0.17, self.y(t), z), (0, 1, 0), (0, 0, 1), size[1] * 0.85, size[2] * 0.75)
            for i in range(fins):
                zz = z - size[2] * 0.3 + i * size[2] * 0.6 / max(1, fins - 1)
                self.box((0.2, size[1] * 0.92, 0.014), (x - s * 0.06, self.y(t), zz), 'paint', rot=(0, 0, s * 0.22), bevel=0.004)

    def engine_louvres(self, t0, t1, n=7, w=0.62):
        for i in range(n):
            t = t0 + (t1 - t0) * (i + 0.5) / n
            zt = self.top_z(0, t)
            self.box((w, 0.032, 0.01), (0, self.y(t), zt + 0.016), 'trim', rot=(-0.35, 0, 0))

    def rear_end(self, z_lamp=0.8, z_grille=0.56):
        y = self.rear_y(0, z_lamp)
        # Full-width light bar in a recessed channel, brighter blades at the ends.
        self.cut_box((1.78, 0.12, 0.055), (0, y, z_lamp), bevel=0.012)
        self.box((1.7, 0.02, 0.022), (0, y + 0.04, z_lamp), 'tail')
        for s in (-1, 1):
            self.box((0.3, 0.02, 0.04), (s * 0.72, y + 0.035, z_lamp), 'tail')
            self.box((0.02, 0.02, 0.13), (s * 0.86, y + 0.035, z_lamp - 0.05), 'tail')
        self.empty('tail_L', (-0.72, y - 0.04, z_lamp))
        self.empty('tail_R', (0.72, y - 0.04, z_lamp))
        # Big mesh grille with the exhausts in it.
        yg = self.rear_y(0, z_grille)
        self.cut_box((1.5, 0.24, 0.2), (0, yg, z_grille), bevel=0.03)
        self.mesh_insert((0, yg + 0.09, z_grille), (1, 0, 0), (0, 0, 1), 1.44, 0.17)
        for s in (-1, 1):
            x = s * 0.13
            self.cyl(0.066, 0.24, (x, yg + 0.1, z_grille - 0.01), 'chrome', rot=(math.pi / 2, 0, 0), verts=24)
            self.cyl(0.054, 0.25, (x, yg + 0.105, z_grille - 0.01), 'well', rot=(math.pi / 2, 0, 0), verts=20)
            self.cyl(0.05, 0.02, (x, yg + 0.16, z_grille - 0.01), 'exhaust', rot=(math.pi / 2, 0, 0), verts=20)
        self.empty('exhaust_L', (-0.13, yg - 0.12, z_grille - 0.01))
        self.empty('exhaust_R', (0.13, yg - 0.12, z_grille - 0.01))
        # Diffuser: carbon floor ramp with fins.
        zb = self.P(1.0)['zb']
        self.box((1.6, 0.5, 0.025), (0, y + 0.26, zb - 0.05), 'carbon', rot=(-0.18, 0, 0))
        for i in range(7):
            self.box((0.012, 0.42, 0.09), (-0.66 + i * 0.22, y + 0.24, zb - 0.02), 'carbon', rot=(-0.18, 0, 0))
        self.box((0.16, 0.02, 0.045), (0, y - 0.005, zb + 0.1), 'brake')  # rain light (F1 style)

    def airfoil(self, span, chord, thick, loc, aoa=0.12, mat='carbon'):
        """A real wing section (cambered, round nose, sharp tail) extruded across the car."""
        bm = bmesh.new()
        n = 14
        prof = []
        for i in range(n + 1):  # upper surface nose -> tail
            u = i / n
            xu = (1 - math.cos(u * math.pi)) / 2
            yt = 5 * thick * (0.2969 * math.sqrt(xu) - 0.126 * xu - 0.3516 * xu ** 2 + 0.2843 * xu ** 3 - 0.1036 * xu ** 4)
            camber = 0.05 * chord * 4 * xu * (1 - xu)
            prof.append((xu * chord, camber + yt * chord))
        for i in range(n - 1, 0, -1):
            u = i / n
            xu = (1 - math.cos(u * math.pi)) / 2
            yt = 5 * thick * (0.2969 * math.sqrt(xu) - 0.126 * xu - 0.3516 * xu ** 2 + 0.2843 * xu ** 3 - 0.1036 * xu ** 4)
            camber = 0.05 * chord * 4 * xu * (1 - xu)
            prof.append((xu * chord, camber - yt * chord))
        rings = []
        for sx in (-span / 2, span / 2):
            ring = []
            for px, pz in prof:
                v = Vector((0, -px + chord / 2, pz))
                v.rotate(Matrix.Rotation(-aoa, 3, 'X'))
                ring.append(bm.verts.new((sx + loc[0], v.y + loc[1], v.z + loc[2])))
            rings.append(ring)
        m = len(prof)
        for j in range(m):
            bm.faces.new((rings[0][j], rings[0][(j + 1) % m], rings[1][(j + 1) % m], rings[1][j]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.obj('wing', bm, [mat])
        self.smooth(o, 30)
        return o

    def big_wing(self, t=0.95, height=0.3, span_k=0.9, chord=0.42):
        y0 = self.y(t)
        zt = self.top_z(0, t)
        z = zt + height
        span = self.W * span_k
        self.airfoil(span, chord, 0.12, (0, y0, z), aoa=0.14, mat='carbon')
        self.airfoil(span * 0.98, chord * 0.42, 0.1, (0, y0 - chord * 0.42, z + 0.07), aoa=0.5, mat='paint')  # gurney flap
        for s in (-1, 1):
            # Endplates: tall carbon plates, shaped by a bevelled box with a swept top.
            self.box((0.016, chord * 1.1, 0.15), (s * span / 2, y0 - 0.04, z + 0.02), 'carbon', rot=(0.12, 0, 0), bevel=0.01)
            # Swan-neck mounts: rise behind the wing and hook over onto its top.
            xm = s * 0.36
            zm = self.top_z(xm, t + 0.01)
            self.box((0.03, 0.09, z - zm + 0.06), (xm, y0 - chord * 0.38, (z + zm) / 2 + 0.03), 'trim', rot=(-0.18, 0, 0), bevel=0.008)
            self.box((0.03, chord * 0.5, 0.03), (xm, y0 - chord * 0.2, z + 0.07), 'trim', bevel=0.008)

    def mirrors3(self, t=0.33):
        p = self.P(t)
        for s in (-1, 1):
            x0 = s * self.HW * p['gb']
            z0 = p['zg'] + 0.03
            self.box((0.16, 0.04, 0.025), (x0 + s * 0.08, self.y(t), z0), 'trim', rot=(0, 0, 0), bevel=0.008)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=(x0 + s * 0.2, self.y(t) - 0.02, z0 + 0.03))
            o = bpy.context.object
            o.scale = (0.1, 0.08, 0.05)
            bpy.ops.object.transform_apply(scale=True)
            o.data.materials.append(self.M['paint'])
            self.smooth(o, 60)

    def splitter3(self):
        zb = self.P(0.0)['zb']
        y = self.front_y(0, zb + 0.05)
        self.box((self.W * 0.86, 0.34, 0.025), (0, y - 0.1, zb - 0.025), 'carbon', bevel=0.008)
        for s in (-1, 1):
            self.box((0.02, 0.3, 0.07), (s * self.W * 0.41, y - 0.1, zb + 0.005), 'carbon')

    def sills3(self, t0, t1):
        """Carbon side skirt with the neon strip under it."""
        tm = (t0 + t1) / 2
        for s in (-1, 1):
            zb = self.P(tm)['zb']
            x = self.side_x(s, tm, zb + 0.06)
            self.box((0.07, (t1 - t0) * self.L, 0.06), (x, self.y(tm), zb + 0.02), 'carbon', bevel=0.012)
            self.box((0.025, (t1 - t0) * self.L * 0.96, 0.018), (x, self.y(tm), zb - 0.018), 'neon')

    def panel_gaps(self):
        d = self.d
        if d.get('gaps') is False:
            return
        tf, tr = d['doors']
        for s in (-1, 1):
            for t in (tf, tr):
                p = self.P(t)
                self.groove(self._side_rays(s, t, p['zb'] + 0.08, p['zg'] - 0.02))
            p = self.P((tf + tr) / 2)
            self.groove(self._sill_rays(s, p['zb'] + 0.1, tf, tr))
            for t in d.get('door_cuts', []):  # extra shut lines (rear doors of a sedan)
                p = self.P(t)
                self.groove(self._side_rays(s, t, p['zb'] + 0.08, p['zg'] - 0.02))
        # Front bonnet panel.
        if d.get('bonnet', True) is not False:
            tn, tb = d.get('bonnet', (0.03, 0.26))
            xe = d.get('bonnet_w', 0.5)
            self.groove(self._top_rays(tb, -xe, xe))
            if d.get('bonnet_front'):
                self.groove(self._top_rays(tn, -xe, xe))
            for s in (-1, 1):
                self.groove(self._long_top_rays(s * xe, tn, tb))
        for t in d.get('bays', []):  # luggage-bay shut lines (coach)
            for s in (-1, 1):
                p = self.P(t)
                self.groove(self._side_rays(s, t, p['zb'] + 0.1, p['zw'] + 0.15))
        if d.get('boot'):
            t0, t1 = d['boot']
            xe = d.get('boot_w', 0.5)
            self.groove(self._top_rays(t0, -xe, xe))
            for s in (-1, 1):
                self.groove(self._long_top_rays(s * xe, t0, t1))
        self.smooth(self.body_obj)

    # ---------------------------------------------------------------- preview (studio, real rims)
    def render_preview(self):
        for o in list(bpy.context.scene.objects):
            o.select_set(False)
        sc = bpy.context.scene
        rims.studio_world(sc, 1.0)
        bpy.ops.mesh.primitive_plane_add(size=80)
        fl = bpy.data.materials.new('floor'); fl.use_nodes = True
        bs = fl.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
        bs.inputs['Roughness'].default_value = 0.35
        bpy.context.object.data.materials.append(fl)
        bpy.ops.object.light_add(type='AREA', location=(0, 0, 4.5)); L = bpy.context.object.data; L.energy = 900; L.size = 6
        bpy.ops.object.light_add(type='AREA', location=(5, 3, 2)); L = bpy.context.object; L.data.energy = 500; L.data.size = 4
        L.rotation_euler = (Vector((0, 0, 0.6)) - L.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.light_add(type='AREA', location=(-5, -3, 2)); L = bpy.context.object; L.data.energy = 400; L.data.size = 4
        L.rotation_euler = (Vector((0, 0, 0.6)) - L.location).to_track_quat('-Z', 'Y').to_euler()
        style = self.d.get('rim', 'star5')
        for wi, t in enumerate(self.wheelT):
            for s in (-1, 1):
                rims.build_wheel(style, self.wheelR[wi], (s * (self.HW - 0.13), self.y(t), self.wheelR[wi]), mirror=s < 0)
        bpy.ops.object.camera_add()
        cam = bpy.context.object
        sc.camera = cam
        cam.data.lens = 50
        k = max(1.0, self.L / 4.8)
        target = Vector((0, 0, 0.5 * k))
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        for suffix, loc in (('', (5.2, 6.4, 2.0)), ('_rear', (-5.4, -6.4, 2.3)), ('_side', (8.6, 0.0, 1.0)), ('_top', (3.0, 3.5, 7.5)), ('_front', (0.0, 7.2, 1.3)), ('_close', (2.0, 3.4, 1.0))):
            cam.location = Vector(loc) * k
            cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = self.preview.replace('.png', f'{suffix}.png')
            bpy.ops.render.render(write_still=True)
        print('PREVIEW', self.preview)

    # ---------------------------------------------------------------- retro kit (cut-in, for the 70s/80s cars)
    def end_y(self, end, x, z):
        return self.front_y(x, z) if end == 'front' else self.rear_y(x, z)

    def recess(self, end, size, x, z, bevel=0.008, depth=None):
        """Cut a recess into the front/rear face; returns the face y at its centre and the inward sign."""
        y = self.end_y(end, x, z)
        g = -1 if end == 'front' else 1  # direction into the car
        self.cut_box((size[0], depth or 0.1, size[1]), (x, y, z), bevel=bevel)
        return y, g

    def retro_lamps(self, kind='quad_rect', x=0.62, z=0.62, w=0.2, h=0.13, gap=0.025):
        if kind == 'popup':
            # Closed pop-ups: two lids outlined in the nose top + a slim running lamp in the nose.
            for s in (-1, 1):
                t0, t1 = 0.012, 0.012 + w * 1.6 / self.L
                x0, x1 = sorted((s * (x - w / 2), s * (x + w / 2)))
                self.groove(self._top_rays(t1, x0, x1, 10))
                for xx in (x0, x1):
                    self.groove(self._long_top_rays(xx, t0, t1, 8))
                y, g = self.recess('front', (w * 1.1, 0.045), s * x, z, bevel=0.006)
                self.box((w * 1.05, 0.02, 0.03), (s * x, y + g * 0.04, z), 'head')
                self.box((w * 0.25, 0.02, 0.03), (s * (x + w * 0.42), y + g * 0.038, z), 'amber')
            return
        for s in (-1, 1):
            if kind == 'quad_rect':
                y, g = self.recess('front', (w * 2 + gap + 0.05, h + 0.05), s * x, z)
                for k in (-1, 1):
                    cx = s * x + k * (w + gap) / 2
                    self.box((w + 0.016, 0.02, h + 0.016), (cx, y + g * 0.045, z), 'chrome', bevel=0.004)
                    self.box((w, 0.02, h), (cx, y + g * 0.04, z), 'head')
                    for j in (-1, 1):
                        self.box((w * 0.96, 0.012, 0.006), (cx, y + g * 0.032, z + j * h * 0.22), 'chrome')
                self.box((w * 2 + gap + 0.05, 0.02, 0.012), (s * x, y + g * 0.03, z - h / 2 - 0.035), 'amber')
            elif kind in ('round', 'round2'):
                n = 2 if kind == 'round2' else 1
                r = h / 2
                for k in range(n):
                    cx = s * (x + (k - (n - 1) / 2) * (2 * r + gap))
                    y = self.front_y(cx, z)
                    self.cyl(r + 0.02, 0.2, (cx, y, z), 'well', rot=(math.pi / 2, 0, 0), verts=40)
                    self.boolean(self.body_obj, bpy.context.object)
                    self.cyl(r + 0.012, 0.03, (cx, y - 0.06, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=40)
                    self.cyl(r, 0.03, (cx, y - 0.05, z), 'head', rot=(math.pi / 2, 0, 0), verts=40)
                    self.cyl(r * 0.1, 0.03, (cx, y - 0.044, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=16)
                    for j in (-1, 1):
                        self.box((r * 1.8, 0.012, 0.005), (cx, y - 0.042, z + j * r * 0.4), 'chrome')
            elif kind == 'wide_rect':  # one big rectangular unit per side
                y, g = self.recess('front', (w + 0.04, h + 0.04), s * x, z)
                self.box((w + 0.014, 0.02, h + 0.014), (s * x, y + g * 0.045, z), 'chrome', bevel=0.004)
                self.box((w, 0.02, h), (s * x, y + g * 0.04, z), 'head')
                for j in range(1, 4):
                    self.box((0.006, 0.012, h * 0.96), (s * x - w / 2 + j * w / 4, y + g * 0.032, z), 'chrome')

    def retro_grille(self, kind='waterfall', w=0.7, h=0.2, z=0.6, x=0.0, frame='chrome'):
        y, g = self.recess('front', (w, h), x, z, bevel=0.01, depth=0.16)
        self.box((w, 0.02, h), (x, y + g * 0.07, z), 'well')
        if frame:
            for zz in (z - h / 2, z + h / 2):
                self.box((w + 0.03, 0.04, 0.022), (x, y + g * 0.005, zz), frame, bevel=0.006)
            for xx in (x - w / 2, x + w / 2):
                self.box((0.022, 0.04, h + 0.03), (xx, y + g * 0.005, z), frame, bevel=0.006)
        if kind == 'waterfall':
            n = max(6, int(w / 0.032))
            for i in range(n):
                self.box((0.011, 0.05, h * 0.95), (x - w / 2 + (i + 0.5) * w / n, y + g * 0.035, z), 'chrome', bevel=0.003)
        elif kind == 'eggcrate':
            n = max(4, int(w / 0.07))
            for i in range(1, n):
                self.box((0.012, 0.05, h * 0.95), (x - w / 2 + i * w / n, y + g * 0.035, z), 'chrome')
            for j in (1, 2):
                self.box((w * 0.98, 0.05, 0.012), (x, y + g * 0.035, z - h / 2 + j * h / 3), 'chrome')
        else:  # slats + mesh
            self.mesh_insert((x, y + g * 0.055, z), (1, 0, 0), (0, 0, 1), w * 0.97, h * 0.9)
            for j in range(3):
                self.box((w * 0.98, 0.04, 0.014), (x, y + g * 0.03, z - h * 0.3 + j * h * 0.3), 'trim', bevel=0.003)

    def bumper3(self, end='front', kind='chrome', z=0.36, h=0.13, proud=0.07, wrap=0.4, kx=0.96):
        mat = {'chrome': 'chrome', 'black': 'rubber', 'body': 'paint', 'carbon': 'carbon'}[kind]
        t_end = 0.0 if end == 'front' else 1.0
        g = 1 if end == 'front' else -1  # outward
        y = self.end_y(end, 0, z)
        hw = abs(self.side_x(1, 0.015 if end == 'front' else 0.985, z)) * kx
        self.box((hw * 2, 0.1, h), (0, y + g * (proud - 0.05), z), mat, bevel=0.025)
        if kind == 'chrome':  # black rubber rub strip along the middle
            self.box((hw * 2 - 0.04, 0.1, h * 0.28), (0, y + g * (proud - 0.045), z), 'rubber', bevel=0.008)
        for s in (-1, 1):  # wrap-around ends
            tw = (wrap / 2 + 0.04) / self.L
            t = t_end + (tw if end == 'front' else -tw)
            x = self.side_x(s, t, z)
            self.box((0.1, wrap, h), (x + s * (proud - 0.05), self.y(t), z), mat, bevel=0.025)
            if kind == 'chrome':
                self.box((0.1, wrap - 0.04, h * 0.28), (x + s * (proud - 0.045), self.y(t), z), 'rubber', bevel=0.008)

    def retro_tails(self, kind='bar', z=0.7, h=0.13, w=None, x=0.62):
        y0 = self.rear_y(0, z)
        hw = abs(self.side_x(1, 0.985, z))
        w = w or hw * 1.86
        if kind == 'bar':  # full-width red band with ribs, reverse lamps and a centre panel
            y, g = self.recess('rear', (w, h), 0, z)
            self.box((w - 0.02, 0.02, h - 0.02), (0, y + g * 0.04, z), 'tail')
            n = int(w / 0.07)
            for i in range(1, n):
                self.box((0.008, 0.02, h - 0.02), (-w / 2 + i * w / n, y + g * 0.032, z), 'trim')
            self.box((0.5, 0.02, h - 0.03), (0, y + g * 0.03, z), 'trim')
            for s in (-1, 1):
                self.box((0.12, 0.02, h * 0.5), (s * 0.31, y + g * 0.028, z), 'head')
            ex = w * 0.36
        else:  # quad: two square lamps per side / round4: two round per side
            for s in (-1, 1):
                for k in (0, 1):
                    cx = s * (x - k * (h + 0.04))
                    if kind == 'round4':
                        yy = self.rear_y(cx, z)
                        self.cyl(h / 2 + 0.015, 0.2, (cx, yy, z), 'well', rot=(math.pi / 2, 0, 0), verts=36)
                        self.boolean(self.body_obj, bpy.context.object)
                        self.cyl(h / 2 + 0.01, 0.03, (cx, yy + 0.05, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=36)
                        self.cyl(h / 2, 0.03, (cx, yy + 0.045, z), 'tail', rot=(math.pi / 2, 0, 0), verts=36)
                    else:
                        yy, g = self.recess('rear', (h + 0.03, h + 0.03), cx, z)
                        self.box((h + 0.012, 0.02, h + 0.012), (cx, yy + g * 0.045, z), 'chrome', bevel=0.004)
                        self.box((h, 0.02, h), (cx, yy + g * 0.04, z), 'tail' if k == 0 else 'brake')
                        for j in (-1, 1):
                            self.box((h * 0.96, 0.012, 0.006), (cx, yy + g * 0.032, z + j * h * 0.22), 'trim')
            ex = x - (h + 0.04) / 2
        self.empty('tail_L', (-ex, y0 - 0.04, z))
        self.empty('tail_R', (ex, y0 - 0.04, z))

    def exhausts3(self, n=2, x=0.42, r=0.05, z=None, dual=False):
        zb = self.P(1.0)['zb']
        z = z if z is not None else zb + 0.02
        for s in ((-1, 1) if n >= 2 else (1,)):
            for k in ((0, 1) if dual else (0,)):
                xx = s * (x + k * (2 * r + 0.02))
                y = self.rear_y(xx, z + 0.12)
                self.cyl(r, 0.3, (xx, y + 0.11, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=28)
                self.cyl(r * 0.8, 0.31, (xx, y + 0.11, z), 'well', rot=(math.pi / 2, 0, 0), verts=24)
                self.cyl(r * 0.75, 0.02, (xx, y + 0.02, z), 'exhaust', rot=(math.pi / 2, 0, 0), verts=24)
        self.empty('exhaust_L', (-x, self.rear_y(-x, z + 0.12) - 0.15, z))
        self.empty('exhaust_R', (x, self.rear_y(x, z + 0.12) - 0.15, z))

    def plate3(self, end='rear', z=0.5):
        y, g = self.recess(end, (0.54, 0.13), 0, z, depth=0.04)
        self.box((0.52, 0.012, 0.11), (0, y + g * 0.014, z), 'chrome')

    def side_strip(self, z, t0, t1, mat='chrome', h=0.03, n=8):
        for i in range(n):
            a, b = t0 + (t1 - t0) * i / n, t0 + (t1 - t0) * (i + 1) / n
            for s in (-1, 1):
                x = self.side_x(s, (a + b) / 2, z)
                self.box((0.02, (b - a) * self.L + 0.004, h), (x, self.y((a + b) / 2), z), mat, bevel=0.006)

    def vinyl_roof(self, t0, t1, z_min):
        bm = bmesh.new()
        bm.from_mesh(self.body_obj.data)
        y0, y1 = self.y(t1), self.y(t0)
        for f in bm.faces:
            c = f.calc_center_median()
            if f.material_index == 0 and y0 < c.y < y1 and c.z > z_min and f.normal.z > 0.35:
                f.material_index = 2
        bm.to_mesh(self.body_obj.data)
        bm.free()

    def louvres3(self, t0, t1, n=7, w=0.9):
        for i in range(n):
            t = t0 + (t1 - t0) * (i + 0.5) / n
            zt = self.top_z(0, t)
            self.box((w, 0.05, 0.012), (0, self.y(t), zt + 0.03), 'trim', rot=(-0.55, 0, 0), bevel=0.003)
        tm = (t0 + t1) / 2
        for s in (-1, 1):
            self.box((0.03, (t1 - t0) * self.L, 0.03), (s * w / 2, self.y(tm), self.top_z(s * w / 2, tm) + 0.02), 'trim')

    def bulge(self, t0, t1, w=0.7, h=0.07, mat='paint'):
        tm = (t0 + t1) / 2
        zt = self.top_z(0, tm)
        o = self.box((w, (t1 - t0) * self.L, h * 2), (0, self.y(tm), zt), mat)
        b = o.modifiers.new('b', 'BEVEL'); b.width = h * 0.9; b.segments = 4; b.limit_method = 'NONE'
        self.apply_all(o)
        self.smooth(o, 50)
        return o

    def cowl_scoop(self, t, w=0.6, l=0.7, h=0.13):
        zt = self.top_z(0, t)
        self.bulge(t - l / self.L / 2, t + l / self.L / 2, w, h)
        y = self.y(t) + l / 2 - 0.02
        self.box((w * 0.82, 0.04, h * 0.7), (0, y, zt + h * 0.55), 'well', bevel=0.01)

    def ducktail(self, t=0.97, w=None, h=0.05):
        zt = self.top_z(0, t)
        w = w or abs(self.side_x(1, t, zt - 0.05)) * 1.9
        self.box((w, 0.16, h), (0, self.y(t), zt + h * 0.4), 'paint', rot=(0.25, 0, 0), bevel=0.02)

    def retro_mirrors(self, t=0.4, square=True):
        p = self.P(t)
        for s in (-1, 1):
            x0 = s * self.HW * p['gb']
            z0 = p['zg'] + 0.06
            self.box((0.06, 0.05, 0.05), (x0 + s * 0.04, self.y(t), z0 - 0.03), 'trim', bevel=0.01)
            self.box((0.14, 0.07, 0.1) if square else (0.16, 0.08, 0.08), (x0 + s * 0.13, self.y(t) - 0.01, z0 + 0.02), 'chrome' if square else 'paint', bevel=0.02)

"""
Neon Velocity car generator v2 — complete cars (body, glass, lights, bumpers, wings, details) in Blender.

Bodies are subdivision surfaces: a coarse control cage swept along the car from design sections, with CREASED
edges on the sill, beltline and deck edge (sharp character lines on smooth panels). Every design sets its own
sections, greenhouse and detail kit, so the cars really differ.

Conventions: Blender +Y = car front (glTF → -Z), +Z up, origin on the ground at the car's centre.
Materials (the game swaps in its own by name): paint, glass, trim, chrome, well, carbon, rubber,
tail (red lamps, brighten when braking), brake (third brake light), head (white lamps), amber, neon (accent),
exhaust (glow in the pipe). Empties: tail_L/tail_R, exhaust_L/exhaust_R (game effects anchor on them).
Run: blender --background --python tools/blender/car_<style>.py -- <out.glb> [preview.png]
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = json.load(open(os.path.join(HERE, 'styles.json')))


def smooth_interp(rows, t, n, linear=False):
    """rows = [(t, v1..vn)], smoothstep (or linear: flat panels) between rows."""
    if t <= rows[0][0]:
        return list(rows[0][1:1 + n])
    for a, b in zip(rows, rows[1:]):
        if t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0])
            if not linear:
                k = k * k * (3 - 2 * k)
            return [a[i] + (b[i] - a[i]) * k for i in range(1, 1 + n)]
    return list(rows[-1][1:1 + n])


class Car:
    def __init__(self, style_name, design):
        argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
        self.out = argv[0] if argv else f'{style_name}.glb'
        self.preview = argv[1] if len(argv) > 1 else None
        st = STYLES[style_name]
        self.L, self.W = st['length'], st['width']
        self.HW = self.W / 2
        self.wheelT = st['wheelT']
        R = st['wheelRadius']
        self.wheelR = [R, R * st.get('rearWheelScale', 1)]
        self.d = design
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.M = {}
        pc = design.get('preview_color', (0.8, 0.2, 0.5))
        for name, col, metal, rough in [
            ('paint', pc, 0.5, 0.3), ('glass', (0.02, 0.03, 0.05), 0.9, 0.05), ('trim', (0.03, 0.03, 0.035), 0.3, 0.55),
            ('chrome', (0.85, 0.86, 0.9), 1.0, 0.12), ('well', (0.01, 0.01, 0.012), 0, 0.9), ('carbon', (0.06, 0.06, 0.07), 0.3, 0.35),
            ('rubber', (0.02, 0.02, 0.02), 0, 0.9), ('tail', (1.0, 0.05, 0.08), 0, 0.3), ('brake', (1.0, 0.0, 0.05), 0, 0.3),
            ('head', (1.0, 1.0, 0.95), 0, 0.2), ('amber', (1.0, 0.55, 0.05), 0, 0.3), ('neon', (0.0, 0.9, 1.0), 0, 0.3),
            ('exhaust', (1.0, 0.45, 0.1), 0, 0.3)]:
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            p = m.node_tree.nodes['Principled BSDF']
            p.inputs['Base Color'].default_value = (*col, 1)
            p.inputs['Metallic'].default_value = metal
            p.inputs['Roughness'].default_value = rough
            if name in ('tail', 'brake', 'head', 'amber', 'neon', 'exhaust'):
                p.inputs['Emission Color'].default_value = (*col, 1)
                p.inputs['Emission Strength'].default_value = 3.0
            self.M[name] = m

    # ---------------------------------------------------------------- geometry helpers
    def y(self, t):
        return self.L / 2 - t * self.L

    def sec(self, t):
        """Body section at t: (zb, zt, hw, belt, tumble, crown)."""
        return smooth_interp(self.d['body'], t, 6, self.d.get('linear', True))

    def obj(self, name, bm, mats):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        for m in mats:
            me.materials.append(self.M[m] if isinstance(m, str) else m)
        return o

    def box(self, size, loc, mat, rot=(0, 0, 0), bevel=0.0, name='part'):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.object
        o.name = name
        o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.append(self.M[mat])
        if bevel:
            b = o.modifiers.new('b', 'BEVEL'); b.width = bevel; b.segments = 2; b.limit_method = 'ANGLE'
        return o

    def cyl(self, r, depth, loc, mat, rot=(0, 0, 0), verts=20, name='part'):
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
        o = bpy.context.object
        o.name = name
        o.data.materials.append(self.M[mat])
        return o

    def empty(self, name, loc):
        e = bpy.data.objects.new(name, None)
        e.location = loc
        bpy.context.collection.objects.link(e)
        return e

    def boolean(self, target, cutter, op='DIFFERENCE'):
        b = target.modifiers.new('bool', 'BOOLEAN'); b.object = cutter; b.operation = op; b.material_mode = 'TRANSFER'
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier='bool')
        bpy.data.objects.remove(cutter)

    def apply_all(self, o):
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)

    # ---------------------------------------------------------------- the subdivision body
    def body(self):
        d = self.d
        bm = bmesh.new()
        rings, crease_idx = [], []
        n_along = d.get('cage_along', 34)
        t0, t1 = d['body'][0][0], d['body'][-1][0]
        ts = sorted(set([round(t0 + (t1 - t0) * i / n_along, 4) for i in range(n_along + 1)] + [round(r[0], 4) for r in d['body']]))
        ts = [t for k, t in enumerate(ts) if k == 0 or t - ts[k - 1] > 0.004]
        for t in ts:
            zb, zt, hw, belt, tumble, crown = self.sec(t)
            hw *= self.HW
            h = zt - zb
            half = [  # (x, z, crease weight along the car)
                (0.0, zb, 0), (hw * 0.84, zb, d.get('under_crease', 0.8)), (hw, zb + 0.13 * h, 1), (hw * d.get('shoulder', 1.0), zb + belt * h, 1),
                (hw * tumble, zt, 1), (hw * tumble * 0.55, zt + crown * 0.85, 0), (0.0, zt + crown, 0)]
            pts = [(-x, z, c) for x, z, c in reversed(half[1:-1])] + half
            ring = [bm.verts.new((x, self.y(t), z)) for x, z, _ in pts]
            rings.append(ring)
            crease_idx = [(j, p[2]) for j, p in enumerate(pts) if p[2]]
        n = len(rings[0])
        faces = []
        for a, b in zip(rings, rings[1:]):
            for j in range(n):
                faces.append(bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j])))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        top = max(bm.faces, key=lambda f: f.calc_center_median().z)
        if top.normal.z < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        # Creases: character lines along the body + the front / rear face outlines.
        cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for a, b in zip(rings, rings[1:]):
            for j, w in crease_idx:
                e = bm.edges.get((a[j], b[j]))
                if e:
                    e[cl] = d.get('crease', 1.0) * (1.0 if w == 1 else w)
        # Crisp front and rear faces: the outline loops and the loops right behind them.
        for ring, w in ((rings[0], 1.0), (rings[-1], 1.0), (rings[1], 0.6), (rings[-2], 0.6)):
            for j in range(n):
                e = bm.edges.get((ring[j], ring[(j + 1) % n]))
                if e:
                    e[cl] = d.get('end_crease', 1.0) * w
        o = self.obj('body', bm, ['paint', 'well'])
        sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = d.get('subdiv', 2)
        self.apply_all(o)
        self.body_obj = o
        self.arches()
        for p in o.data.polygons:
            p.use_smooth = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(d.get('smooth_angle', 50)))
        except Exception:
            pass
        o.select_set(False)
        return o

    def arches(self):
        d = self.d
        for wi, t in enumerate(self.wheelT):
            if wi == 1 and d.get('rear_skirt'):
                continue
            R = self.wheelR[wi]
            aR = R + d.get('arch_gap', 0.08)
            zt = self.sec(t)[1]
            for side in (-1, 1):
                if d.get('arches', 'round') == 'round':
                    cz = min(R + 0.02, zt - 0.12 - aR)
                    c = self.cyl(aR, 0.9, (side * self.HW, self.y(t), cz), 'well', rot=(0, math.pi / 2, 0), verts=48)
                else:
                    top = min(R + aR * 0.95, zt - 0.12)
                    c = self.box((0.9, aR * 2.05, top + 0.3), (side * self.HW, self.y(t), (top - 0.3) / 2), 'well', bevel=aR * 0.4)
                    self.apply_all(c)
                self.boolean(self.body_obj, c)

    # ---------------------------------------------------------------- greenhouse with inset windows
    def greenhouse(self):
        d = self.d
        g = d['glass']  # [(t, zb, zt, hw_base, hw_top)]
        bm = bmesh.new()
        rings = []
        n_along = d.get('glass_along', 16)
        t0, t1 = g[0][0], g[-1][0]
        for i in range(n_along + 1):
            t = t0 + (t1 - t0) * i / n_along
            zb, zt, hb, ht = smooth_interp(g, t, 4)
            half = [(0.0, zb), (hb * self.HW, zb), (ht * self.HW, zt), (ht * self.HW * 0.55, zt + d.get('roof_crown', 0.03)), (0.0, zt + d.get('roof_crown', 0.03))]
            pts = [(-x, z) for x, z in reversed(half[1:-1])] + half
            rings.append([bm.verts.new((x, self.y(t), z)) for x, z in pts])
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for j in range(n):
                bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        top = max(bm.faces, key=lambda f: f.calc_center_median().z)
        if top.normal.z < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
        pillars = d.get('pillars', [0.5])
        pw = d.get('pillar_width', 0.05)
        groups = {}
        for f in bm.faces:
            nrm = f.normal
            u = ((self.L / 2 - f.calc_center_median().y) / self.L - t0) / (t1 - t0)
            if nrm.z > 0.8:
                continue
            if abs(nrm.x) > 0.45:
                if u < 0.05 or u > 0.95 or any(abs(u - p) < pw for p in pillars):
                    continue
                if d.get('opera') and u > 0.7 and abs(u - 0.83) > 0.06:
                    continue
                key = ('side', nrm.x > 0, sum(1 for p in pillars if u > p))
            elif nrm.y > 0.25:
                key = ('front',)
            elif nrm.y < -0.25:
                key = ('rear',)
            else:
                continue
            groups.setdefault(key, []).append(f)
        glass = []
        for faces in groups.values():
            bmesh.ops.inset_region(bm, faces=faces, thickness=d.get('frame', 0.05), depth=-0.012)
            glass += faces
        for f in bm.faces:
            f.material_index = 0
        for f in glass:
            if f.is_valid:
                f.material_index = 1
        o = self.obj('greenhouse', bm, ['paint', 'glass'])
        if d.get('vinyl_roof'):
            for p in o.data.polygons:
                if p.material_index == 0 and p.normal.z > 0.6:
                    p.material_index = 2
            o.data.materials.append(self.M['trim'])
        b = o.modifiers.new('bev', 'BEVEL'); b.width = 0.02; b.segments = 2; b.limit_method = 'ANGLE'
        o.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
        return o

    # ---------------------------------------------------------------- detail kit
    def rear_face(self):
        zb, zt, hw, belt, tumble, crown = self.sec(1.0)
        return zb, zt, hw * self.HW, -self.L / 2

    def front_face(self):
        zb, zt, hw, belt, tumble, crown = self.sec(0.0)
        return zb, zt, hw * self.HW, self.L / 2

    def taillights(self, kind='bar', height=0.62):
        zb, zt, hw, y = self.rear_face()
        h = zt - zb
        z = zb + height * h
        if kind == 'bar':
            self.box((hw * 1.7, 0.06, h * 0.2), (0, y - 0.01, z), 'trim', bevel=0.01)
            for s in (-1, 1):
                self.box((hw * 0.62, 0.05, h * 0.15), (s * hw * 0.5, y - 0.04, z), 'tail')
            self.box((hw * 0.36, 0.05, h * 0.06), (0, y - 0.04, z), 'tail')
            tl = [(s * hw * 0.5, y - 0.06, z) for s in (-1, 1)]
        elif kind == 'round4':
            self.box((hw * 1.7, 0.05, h * 0.26), (0, y - 0.01, z), 'trim', bevel=0.02)
            tl = []
            for s in (-1, 1):
                for k, xo in enumerate((0.72, 0.42)):
                    self.cyl(h * 0.1, 0.06, (s * hw * xo, y - 0.04, z), 'tail', rot=(math.pi / 2, 0, 0), verts=24)
                    self.cyl(h * 0.11, 0.03, (s * hw * xo, y - 0.02, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=24)
                tl.append((s * hw * 0.57, y - 0.06, z))
        elif kind == 'quad':  # stacked rectangular units in a black panel
            self.box((hw * 1.8, 0.05, h * 0.32), (0, y - 0.01, z), 'trim')
            tl = []
            for s in (-1, 1):
                for xo in (0.75, 0.48):
                    self.box((hw * 0.24, 0.05, h * 0.22), (s * hw * xo, y - 0.035, z), 'tail', bevel=0.01)
                tl.append((s * hw * 0.62, y - 0.06, z))
        elif kind == 'strip':  # full-width neon strip (prototype)
            self.box((hw * 1.85, 0.05, h * 0.08), (0, y - 0.03, z), 'tail')
            tl = [(s * hw * 0.6, y - 0.06, z) for s in (-1, 1)]
        for i, p in enumerate(tl):
            self.empty('tail_L' if i == 0 else 'tail_R', p)

    def headlights(self, kind='popup', height=0.6):
        zb, zt, hw, y = self.front_face()
        h = zt - zb
        z = zb + height * h
        if kind == 'popup':
            t = 0.07
            zs = self.sec(t)
            for s in (-1, 1):
                self.box((0.42, 0.3, 0.06), (s * hw * 0.55, self.y(t), zs[1] + 0.02), 'paint', rot=(-0.12, 0, 0), bevel=0.01)
                self.box((0.42, 0.012, 0.012), (s * hw * 0.55, self.y(t) + 0.15, zs[1] + 0.05), 'trim')
            # low beams in the bumper
            for s in (-1, 1):
                self.box((0.32, 0.05, 0.07), (s * hw * 0.6, y + 0.01, zb + 0.32 * h), 'head')
                self.box((0.1, 0.05, 0.06), (s * hw * 0.88, y, zb + 0.32 * h), 'amber')
        elif kind == 'quad':
            for s in (-1, 1):
                for xo in (0.72, 0.45):
                    self.box((0.26, 0.05, 0.16), (s * hw * xo, y + 0.01, z), 'head', bevel=0.01)
                    self.box((0.3, 0.03, 0.2), (s * hw * xo, y, z), 'chrome')
        elif kind == 'round':
            for s in (-1, 1):
                for xo in (0.7,):
                    self.cyl(0.13, 0.06, (s * hw * xo, y + 0.02, z), 'head', rot=(math.pi / 2, 0, 0), verts=24)
                    self.cyl(0.15, 0.04, (s * hw * xo, y + 0.0, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=24)
        elif kind == 'strip':
            for s in (-1, 1):
                self.box((hw * 0.55, 0.05, 0.06), (s * hw * 0.55, y + 0.01, z), 'head')
        elif kind == 'covered':  # lamps under a smoked lens (prototype)
            for s in (-1, 1):
                self.box((0.38, 0.06, 0.1), (s * hw * 0.62, y - 0.02, z), 'head')
                self.box((0.5, 0.04, 0.16), (s * hw * 0.62, y + 0.02, z), 'glass')

    def grille(self, kind='slats', width=0.9, height=0.22, z=0.4):
        zb, zt, hw, y = self.front_face()
        h = zt - zb
        zc = zb + z * h
        if kind == 'waterfall':  # tall chrome frame with fine vertical bars
            self.box((hw * 2 * width + 0.06, 0.04, h * height + 0.06), (0, y + 0.005, zc), 'chrome', bevel=0.01)
            self.box((hw * 2 * width, 0.05, h * height), (0, y + 0.02, zc), 'trim')
            for i in range(13):
                self.box((0.016, 0.06, h * height * 0.96), (-hw * width + (i + 0.5) * hw * 2 * width / 13, y + 0.03, zc), 'chrome')
            return
        if kind == 'eggcrate':  # chrome surround + grid
            self.box((hw * 2 * width + 0.06, 0.04, h * height + 0.06), (0, y + 0.005, zc), 'chrome', bevel=0.01)
            self.box((hw * 2 * width, 0.05, h * height), (0, y + 0.02, zc), 'trim')
            for i in range(7):
                self.box((0.02, 0.06, h * height), (-hw * width + (i + 0.5) * hw * 2 * width / 7, y + 0.03, zc), 'chrome')
            self.box((hw * 2 * width, 0.06, 0.02), (0, y + 0.03, zc), 'chrome')
        else:
            self.box((hw * 2 * width, 0.04, h * height), (0, y + 0.01, zc), 'trim')
            self.mesh_insert((0, y + 0.034, zc), (1, 0, 0), (0, 0, 1), hw * 2 * width * 0.97, h * height * 0.9)
            for i in range(3):
                self.box((hw * 2 * width, 0.06, 0.012), (0, y + 0.02, zc - h * height * 0.3 + i * h * height * 0.3), 'trim')

    def bumpers(self, kind='black'):
        mat = {'black': 'rubber', 'chrome': 'chrome', 'body': 'paint', 'carbon': 'carbon'}[kind]
        for zb, zt, hw, y, sgn in [(*self.front_face(), 1), (*self.rear_face(), -1)]:
            self.box((hw * 2.02, 0.16, 0.13), (0, y + sgn * 0.06, zb + 0.11), mat, bevel=0.03)
        if kind == 'chrome':
            pass

    def exhausts(self, n=2, style='twin', r=0.06):
        zb, zt, hw, y = self.rear_face()
        xs = {1: [0.0], 2: [-hw * 0.55, hw * 0.55], 3: [-0.16, 0.0, 0.16], 4: [-hw * 0.6, -hw * 0.42, hw * 0.42, hw * 0.6]}[n]
        z = zb + 0.06
        for i, x in enumerate(xs):
            self.cyl(r, 0.3, (x, y + 0.02, z), 'chrome', rot=(math.pi / 2, 0, 0), verts=20)
            self.cyl(r * 0.8, 0.31, (x, y + 0.025, z), 'well', rot=(math.pi / 2, 0, 0), verts=16)
            self.cyl(r * 0.75, 0.02, (x, y + 0.1, z), 'exhaust', rot=(math.pi / 2, 0, 0), verts=16)
        left = [x for x in xs if x <= 0] or xs
        right = [x for x in xs if x >= 0] or xs
        self.empty('exhaust_L', (min(left), y - 0.12, z))
        self.empty('exhaust_R', (max(right), y - 0.12, z))

    def wing(self, kind='big', t=0.93, height=0.28, span=0.95, chord=0.42):
        zb, zt, hw, belt, tumble, crown = self.sec(t)
        y0 = self.y(t)
        if kind == 'lip':
            self.box((hw * self.HW * 1.8, chord * 0.5, 0.04), (0, y0, zt + crown + 0.02), 'paint', rot=(0.25, 0, 0), bevel=0.01)
            return
        z = zt + crown + height
        tiers = 3 if kind == 'triple' else 1
        for k in range(tiers):
            zz = z + k * 0.09
            self.box((self.W * span, chord * (1 - k * 0.2), 0.05), (0, y0 - k * 0.06, zz), 'paint' if k == 0 else 'carbon', rot=(0.12 + k * 0.08, 0, 0), bevel=0.012)
        for s in (-1, 1):
            self.box((0.03, chord * 1.2, 0.22 + 0.09 * (tiers - 1)), (s * self.W * span / 2, y0, z + 0.05 * tiers), 'carbon')
            self.box((0.05, 0.12, height), (s * self.W * 0.3, y0, zt + crown + height / 2), 'trim')
        self.box((self.W * span * 0.6, 0.04, 0.02), (0, y0 - chord * 0.45, z + 0.03), 'brake')

    def strakes(self, t0=0.55, t1=0.8, n=6, z0=0.35, z1=0.72):
        for s in (-1, 1):
            for i in range(n):
                f = i / max(1, n - 1)
                zb, zt, hw, *_ = self.sec((t0 + t1) / 2)
                z = zb + (z0 + (z1 - z0) * f) * (zt - zb)
                self.box((0.06, (t1 - t0) * self.L, 0.035), (s * (hw * self.HW + 0.02), self.y((t0 + t1) / 2), z), 'paint', bevel=0.008)

    def louvres(self, t0, t1, n=6, on='glass', mat='trim'):
        for i in range(n):
            t = t0 + (t1 - t0) * (i + 0.5) / n
            if on == 'glass':
                zb, zt, hb, ht = smooth_interp(self.d['glass'], t, 4)
                w = ht * self.HW * 1.8
                z = zt
            else:
                zb, zt, hw, belt, tumble, crown = self.sec(t)
                w = hw * self.HW * tumble * 1.3
                z = zt + crown
            self.box((w, 0.035, 0.014), (0, self.y(t), z + 0.015), mat, rot=(-0.4, 0, 0))

    def naca(self, t, z=0.6):
        zb, zt, hw, *_ = self.sec(t)
        for s in (-1, 1):
            c = self.box((0.25, 0.7, 0.12), (s * hw * self.HW, self.y(t), zb + z * (zt - zb)), 'well', rot=(0, 0, s * 0.18))
            self.boolean(self.body_obj, c)

    def side_intake(self, t, z=0.5, size=(0.4, 0.55, 0.26)):
        zb, zt, hw, *_ = self.sec(t)
        for s in (-1, 1):
            zc = zb + z * (zt - zb)
            h0 = self.hit((s * 3.0, self.y(t), zc), (-s, 0, 0))
            c = self.box(size, (s * hw * self.HW, self.y(t), zc), 'well', bevel=0.05)
            self.apply_all(c)
            self.boolean(self.body_obj, c)
            if h0:
                self.mesh_insert((h0[0].x - s * 0.03, self.y(t), zc), (0, 1, 0), (0, 0, 1), size[1] * 0.82, size[2] * 0.78)

    def scoop(self, t, w=0.6, l=0.8, h=0.12):
        zb, zt, hw, belt, tumble, crown = self.sec(t)
        self.box((w, l, h), (0, self.y(t), zt + crown + h * 0.3), 'paint', bevel=0.04)
        self.box((w * 0.8, 0.04, h * 0.6), (0, self.y(t) + l / 2, zt + crown + h * 0.4), 'well')

    def mirrors(self, t):
        zb, zt, hb, ht = smooth_interp(self.d['glass'], t, 4)
        for s in (-1, 1):
            self.box((0.16, 0.12, 0.09), (s * (hb * self.HW + 0.08), self.y(t), zb + 0.08), 'paint', bevel=0.02)

    def rubstrip(self, mat='trim', z=0.32):
        t0 = self.wheelT[0] + (self.wheelR[0] + 0.2) / self.L
        t1 = self.wheelT[1] - (self.wheelR[1] + 0.2) / self.L
        tm = (t0 + t1) / 2
        zb, zt, hw, *_ = self.sec(tm)
        for s in (-1, 1):
            self.box((0.02, (t1 - t0) * self.L, 0.04), (s * (hw * self.HW + 0.01), self.y(tm), zb + z * (zt - zb)), mat)

    def neon_sill(self):
        t0 = self.wheelT[0] + (self.wheelR[0] + 0.15) / self.L
        t1 = self.wheelT[1] - (self.wheelR[1] + 0.15) / self.L
        tm = (t0 + t1) / 2
        zb, zt, hw, *_ = self.sec(tm)
        for s in (-1, 1):
            self.box((0.03, (t1 - t0) * self.L, 0.025), (s * (hw * self.HW * 0.98 + 0.01), self.y(tm), zb + 0.02), 'neon')

    def skirts(self):
        t0 = self.wheelT[0] + (self.wheelR[0] + 0.12) / self.L
        t1 = self.wheelT[1] - (self.wheelR[1] + 0.12) / self.L
        tm = (t0 + t1) / 2
        zb, zt, hw, *_ = self.sec(tm)
        for s in (-1, 1):
            self.box((0.1, (t1 - t0) * self.L, 0.12), (s * (hw * self.HW - 0.02), self.y(tm), zb + 0.02), 'carbon', bevel=0.02)

    def splitter(self):
        zb, zt, hw, y = self.front_face()
        self.box((hw * 2.1, 0.3, 0.03), (0, y - 0.05, zb - 0.02), 'carbon')

    def diffuser(self):
        zb, zt, hw, y = self.rear_face()
        self.box((hw * 1.6, 0.45, 0.04), (0, y + 0.18, zb - 0.02), 'carbon', rot=(-0.15, 0, 0))
        for i in range(5):
            self.box((0.015, 0.4, 0.14), (-hw * 0.6 + i * hw * 0.3, y + 0.18, zb + 0.03), 'carbon')

    def plate(self):
        zb, zt, hw, y = self.rear_face()
        self.box((0.52, 0.03, 0.12), (0, y - 0.02, zb + 0.3 * (zt - zb)), 'chrome')

    def flares(self, k=0.12):
        for wi, t in enumerate(self.wheelT):
            R = self.wheelR[wi]
            for s in (-1, 1):
                self.box((k + 0.05, (R + 0.15) * 2.3, 0.14), (s * (self.HW + k * 0.4), self.y(t), R + R * 0.95), 'paint', bevel=0.05)

    # ---------------------------------------------------------------- panel gaps + mesh inserts
    def hit(self, origin, direction):
        ok, loc, nrm, _ = self.body_obj.ray_cast(Vector(origin), Vector(direction).normalized(), distance=10.0)
        return (loc, nrm) if ok else None

    def groove(self, rays, gap=None, depth=0.014):
        """Cut a shut line into the finished body along the surface points the rays hit (one solid sweep)."""
        gap = (gap or self.d.get('gap', 0.011)) / 2
        hits = [h for h in (self.hit(o, dr) for o, dr in rays) if h]
        if len(hits) < 2:
            return
        bm = bmesh.new()
        rings = []
        n = len(hits)
        for i, (loc, nrm) in enumerate(hits):
            T = (hits[min(i + 1, n - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
            if i == 0: loc = loc - T * gap
            if i == n - 1: loc = loc + T * gap
            B = nrm.cross(T).normalized()
            o, inn = loc + nrm * 0.03, loc - nrm * depth
            rings.append([bm.verts.new(v) for v in (o + B * gap, o - B * gap, inn - B * gap, inn + B * gap)])
        for a, b in zip(rings, rings[1:]):
            for j in range(4):
                bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        c = self.obj('gap', bm, ['well'])
        # A degenerate sweep can make the exact boolean eat the body: keep a copy and roll back if it shrinks.
        body = self.body_obj
        before = body.data.copy()
        n0 = len(body.data.polygons)
        self.boolean(body, c)
        if len(body.data.polygons) < n0 * 0.97:
            bad = body.data
            print('GROOVE ROLLED BACK', n0, '->', len(bad.polygons))
            body.data = before
            bpy.data.meshes.remove(bad)
        else:
            bpy.data.meshes.remove(before)

    def _top_rays(self, t, x0, x1, n=24):
        y = self.y(t)
        return [((x0 + (x1 - x0) * i / (n - 1), y, 4.0), (0, 0, -1)) for i in range(n)]

    def _long_top_rays(self, x, t0, t1, n=24):
        return [((x, self.y(t0 + (t1 - t0) * i / (n - 1)), 4.0), (0, 0, -1)) for i in range(n)]

    def _side_rays(self, s, t, z0, z1, n=14):
        return [((s * 3.0, self.y(t), z0 + (z1 - z0) * i / (n - 1)), (-s, 0, 0)) for i in range(n)]

    def _sill_rays(self, s, z, t0, t1, n=20):
        return [((s * 3.0, self.y(t0 + (t1 - t0) * i / (n - 1)), z), (-s, 0, 0)) for i in range(n)]

    def panel_gaps(self):
        """Door shuts, door bottom, bonnet and boot lid outlines as real grooves (dark shut lines with depth)."""
        d = self.d
        if d.get('gaps') is False:
            return
        g0, g1 = d['glass'][0][0], d['glass'][-1][0]
        R0, R1 = self.wheelR
        tf = max(self.wheelT[0] + (R0 + 0.12) / self.L, g0 + 0.015)
        tr = min(tf + d.get('door_len', 1.12) / self.L, self.wheelT[1] - (R1 + 0.14) / self.L)
        if d.get('doors'):
            tf, tr = d['doors']
        for s in (-1, 1):
            for t in (tf, tr):
                zb, zt, *_ = self.sec(t)
                zg = smooth_interp(d['glass'], min(max(t, g0), g1), 4)[0]
                self.groove(self._side_rays(s, t, zb + 0.07, min(zt, zg) - 0.025))
            zb, zt, *_ = self.sec((tf + tr) / 2)
            self.groove(self._sill_rays(s, zb + 0.09 * (zt - zb) + 0.05, tf, tr))
        # Bonnet: rectangle from the nose to the scuttle.
        tb = g0 - 0.018
        tn = d.get('bonnet_front', 0.045)
        if tb - tn > 0.08:
            zb, zt, hw, belt, tumble, crown = self.sec(tb)
            xe = hw * self.HW * tumble * d.get('bonnet_w', 0.86)
            self.groove(self._top_rays(tb, -xe, xe))
            self.groove(self._top_rays(tn, -xe, xe))
            for s in (-1, 1):
                self.groove(self._long_top_rays(s * xe, tn, tb))
        # Boot lid (only where the glass stops before the tail).
        tk = g1 + 0.018
        if 0.97 - tk > 0.07 and not d.get('no_boot'):
            zb, zt, hw, belt, tumble, crown = self.sec(tk)
            xe = hw * self.HW * tumble * d.get('boot_w', 0.84)
            self.groove(self._top_rays(tk, -xe, xe))
            for s in (-1, 1):
                self.groove(self._long_top_rays(s * xe, tk, 0.985))
        bpy.context.view_layer.objects.active = self.body_obj
        self.body_obj.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(d.get('smooth_angle', 50)))
        except Exception:
            pass
        self.body_obj.select_set(False)

    def mesh_insert(self, center, u, v, size_u, size_v, mat='carbon', pitch=0.032, bar=0.007):
        """A woven grid of thin bars in the plane spanned by unit vectors u, v (for intakes and grilles)."""
        center, u, v = Vector(center), Vector(u), Vector(v)
        nrm = u.cross(v).normalized()
        bm = bmesh.new()
        def bar_box(c, along, length):
            other = v if along is u else u
            ext = (along * length / 2, other * bar / 2, nrm * bar / 2)
            vs = [bm.verts.new(c + sa * ext[0] + sb * ext[1] + sc * ext[2]) for sa in (-1, 1) for sb in (-1, 1) for sc in (-1, 1)]
            for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
                bm.faces.new([vs[i] for i in f])
        nu, nv = max(2, int(size_u / pitch)), max(2, int(size_v / pitch))
        for i in range(nu + 1):
            bar_box(center + u * (-size_u / 2 + i * size_u / nu) + nrm * 0.003, v, size_v)
        for j in range(nv + 1):
            bar_box(center + v * (-size_v / 2 + j * size_v / nv), u, size_u)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self.obj('mesh', bm, [mat])

    # ---------------------------------------------------------------- export + preview
    def finish(self):
        self.panel_gaps()
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o.modifiers:
                self.apply_all(o)
        for o in bpy.context.scene.objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.body_obj
        tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
        print('TRIANGLES', tris)
        bpy.ops.export_scene.gltf(filepath=self.out, export_format='GLB', use_selection=True, export_apply=True,
                                  export_normals=True, export_texcoords=False, export_materials='EXPORT')
        print('EXPORTED', self.out)
        if self.preview:
            self.render_preview()

    def render_preview(self):
        for o in list(bpy.context.scene.objects):
            o.select_set(False)
        k = max(1.0, self.L / 4.6)
        sc = bpy.context.scene
        bpy.ops.object.light_add(type='SUN', location=(4, -3, 6)); bpy.context.object.data.energy = 3.0
        bpy.ops.object.light_add(type='AREA', location=(-4, 3, 5)); bpy.context.object.data.energy = 700; bpy.context.object.data.size = 8
        bpy.ops.mesh.primitive_plane_add(size=60)
        fl = bpy.data.materials.new('floor'); fl.use_nodes = True
        fl.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.04, 0.07, 1)
        bpy.context.object.data.materials.append(fl)
        w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
        w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.06, 0.03, 0.12, 1)
        # Simple wheels for the preview only (the game draws its own).
        for wi, t in enumerate(self.wheelT):
            for s in (-1, 1):
                bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=self.wheelR[wi], depth=0.26, location=(s * (self.HW - 0.16), self.y(t), self.wheelR[wi]), rotation=(0, math.pi / 2, 0))
                bpy.context.object.data.materials.append(self.M['rubber'])
        bpy.ops.object.camera_add()
        cam = bpy.context.object
        sc.camera = cam
        target = Vector((0, 0, 0.55 * k))
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x, sc.render.resolution_y = 960, 540
        for suffix, loc in (('', (4.4 * k, 5.6 * k, 1.9 * k)), ('_rear', (-4.6 * k, -5.6 * k, 2.1 * k))):
            cam.location = loc
            cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = self.preview.replace('.png', f'{suffix}.png')
            bpy.ops.render.render(write_still=True)
        print('PREVIEW', self.preview)

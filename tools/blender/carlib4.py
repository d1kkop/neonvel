"""
Neon Velocity car generator v4: the v3 body (Car3) at a higher resolution plus a close-up detail kit
(projector headlights with DRL light guides, aero mirrors on carbon stalks, canards, roof scoop, door handles,
fuel filler, segmented light bar, deeper carbon intakes and diffuser). Same conventions as carlib3.
"""
import bpy, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from carlib3 import Car3  # noqa: E402


def rotz(v, a):
    v = Vector(v)
    v.rotate(Matrix.Rotation(a, 3, 'Z'))
    return v


def _g(t, c, s):
    return math.exp(-((t - c) / s) ** 2)


def _ss(a, b, x):
    u = min(1.0, max(0.0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)


class Car4(Car3):
    def __init__(self, style_name, design):
        # v7 "crisp": real cars are taut panels meeting at sharp character lines, not one soft blob. Full creases on
        # the sill, shoulder, fender top and belt, a side feature line at the widest point, crisp nose/tail edges and
        # hard normals where the panels meet.
        design.setdefault('arch_gap', 0.04)
        crisp = design.get('crisp', 1.0)
        if crisp:
            for k, v in (('crease_sill', 1.0), ('crease_shoulder', 1.0), ('crease_fender', 1.0), ('crease_belt', 1.0), ('end_crease', 1.0)):
                design[k] = max(design.get(k, 0.0), v * crisp)
            cr = {4: 0.85 * crisp, 7: 0.6 * crisp}
            cr.update(design.get('creases', {}))
            design['creases'] = cr
            design['smooth_angle'] = min(design.get('smooth_angle', 40), 26)
        super().__init__(style_name, design)
        for name, col, alpha in [('lens', (0.55, 0.0, 0.02), 0.5), ('stripe', (0.92, 0.92, 0.94), 1.0), ('gap', (0.01, 0.01, 0.012), 1.0)]:
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            p = m.node_tree.nodes['Principled BSDF']
            p.inputs['Base Color'].default_value = (*col, 1)
            p.inputs['Roughness'].default_value = 0.1
            self.M[name] = m

    # ------------------------------------------------------------ v7 sculpt (applied on top of the keyed sections)
    def P(self, t):
        p = super().P(t)
        sc = self.d.get('sculpt')
        if not sc:
            return p
        tf, tr = self.wheelT
        cab = self.d['cabin']
        c0, c1 = cab['ws'][0], cab['rear'][1]
        s0, s1 = cab['side']
        # Plan view: blistered arches over both axles, a pinched waist between them (coke bottle).
        a_f, a_r = sc.get('arch', 0.0), sc.get('arch_r', sc.get('arch', 0.0))
        bulge = a_f * _g(t, tf, 0.085) + a_r * _g(t, tr, 0.095)
        waist = sc.get('waist', 0.0) * _g(t, (tf + tr) / 2, (tr - tf) * 0.3)
        p['hw'] *= 1 + bulge - waist
        # Body side leans in towards the shoulder (no vertical slab).
        st = sc.get('side', 0.0)
        p['sh'] -= st
        p['fx'] -= st * 0.8
        # Fenders stand above the bonnet / deck: over the wheels and along the bonnet, not along the windows.
        fr = sc.get('fender', 0.0)
        hood = _ss(0.0, 0.07, t) * (1 - _ss(c0 - 0.07, c0 + 0.01, t))
        deck = _ss(c1 - 0.02, c1 + 0.05, t) * (1 - _ss(0.96, 1.0, t))
        w = max(_g(t, tf, 0.1), hood * 0.75) + sc.get('hip', 1.0) * max(_g(t, tr, 0.1), deck * 0.6)
        side = _ss(s0 - 0.03, s0 + 0.02, t) * (1 - _ss(s1 - 0.02, s1 + 0.03, t))
        dz = fr * min(1.0, w) * (1 - side)
        p['zf'] += dz
        p['zsh'] += dz * 0.55
        # Tumblehome: the glasshouse narrows towards the roof.
        tb = sc.get('tumble', 1.0)
        inc = _ss(c0 - 0.02, c0 + 0.05, t) * (1 - _ss(c1 - 0.05, c1 + 0.02, t))
        p['rw'] *= 1 - (1 - tb) * inc
        p['gb'] *= 1 - (1 - tb) * 0.45 * inc
        return p

    # ------------------------------------------------------------ helpers
    def pod(self, scale, loc, mat, rot=(0, 0, 0), seg=32, rings=16, name='part'):
        """A smooth ellipsoid (mirror housings, scoop lips)."""
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=loc, rotation=rot)
        o = bpy.context.object
        o.name = name
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.append(self.M[mat])
        self.smooth(o, 80)
        return o

    def tube(self, pts, r, mat, verts=12):
        """A round bar through a list of points (stalks, frames)."""
        for a, b in zip(pts, pts[1:]):
            a, b = Vector(a), Vector(b)
            d = b - a
            o = self.cyl(r, d.length, tuple((a + b) / 2), mat, verts=verts)
            o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
            self.smooth(o, 60)

    # ------------------------------------------------------------ lights
    def projector_headlights(self, x=0.6, z=0.5, w=0.46, h=0.1, yaw=0.42, pitch=0.12, lenses=3):
        """Deep lamp pocket: black housing, chrome-ringed projector lenses with glowing cores, an L-shaped
        light guide (DRL) along the top and outer edge, amber indicator blade."""
        for s in (-1, 1):
            y = self.front_y(s * x, z)
            rot = (pitch, 0, -s * yaw)
            self.cut_box((w, 0.26, h), (s * x, y - 0.02, z), rot=rot, bevel=0.018)
            c = Vector((s * x, y, z)) + rotz((0, -0.085, 0), -s * yaw)
            self.box((w * 0.94, 0.02, h * 0.86), tuple(c + Vector((0, -0.014, 0))), 'trim', rot=rot, bevel=0.006)
            # Light guide (signature): a thick top blade + outer down-stroke, standing proud in front of the housing.
            self.box((w * 0.9, 0.02, 0.017), tuple(c + rotz((0, 0.012, 0), -s * yaw) + Vector((0, 0, h * 0.34))), 'head', rot=rot, bevel=0.006)
            self.box((0.017, 0.02, h * 0.7), tuple(c + rotz((s * w * 0.44, 0.012, 0), -s * yaw)), 'head', rot=rot, bevel=0.006)
            self.empty(f'head_{"L" if s < 0 else "R"}', tuple(c + rotz((0, 0.05, 0), -s * yaw)))
            for i in range(lenses):
                k = -0.3 + i * 0.6 / max(1, lenses - 1)
                off = rotz((s * k * w * 0.8, 0.004, -h * 0.08), -s * yaw)
                lr = 0.03 if i else 0.037  # inner lens bigger (main beam)
                lrot = (math.pi / 2 + pitch, 0, -s * yaw)
                # Chrome reflector bowl behind each lens (catches the light, the "jewel" look).
                bowl = self.pod((lr * 1.7, lr * 0.9, lr * 1.7), tuple(c + off + rotz((0, -0.01, 0), -s * yaw)), 'chrome', rot=(pitch, 0, -s * yaw), seg=32, rings=16)
                self.cyl(lr + 0.009, 0.026, tuple(c + off), 'chrome', rot=lrot, verts=40)
                self.cyl(lr, 0.03, tuple(c + off + Vector((0, 0.002, 0))), 'head', rot=lrot, verts=32)
                fwd = rotz((0, 0.018, 0), -s * yaw)
                self.pod((lr * 0.95, lr * 0.5, lr * 0.95), tuple(c + off + fwd), 'glass', rot=(pitch, 0, -s * yaw), seg=24, rings=12)
            tip = rotz((s * w * 0.36, 0.008, -h * 0.34), -s * yaw)
            self.box((w * 0.22, 0.016, 0.012), tuple(c + tip), 'amber', rot=rot, bevel=0.004)

    def segmented_lightbar(self, z_lamp=0.8, segs=28, width=1.7):
        y = self.rear_y(0, z_lamp)
        self.cut_box((width + 0.08, 0.12, 0.06), (0, y, z_lamp), bevel=0.014)
        self.box((width + 0.02, 0.02, 0.04), (0, y + 0.048, z_lamp), 'trim')
        # Light blade standing just proud of the tail, following its curve: dark backing, 28 lit segments.
        seg_w = width / segs
        for i in range(segs):
            xx = -width / 2 + seg_w * (i + 0.5)
            yy = self.rear_y(xx, z_lamp)
            self.box((seg_w * 1.02, 0.03, 0.062), (xx, yy - 0.004, z_lamp), 'trim')
            self.box((seg_w * 0.96, 0.006, 0.05), (xx, yy - 0.016, z_lamp), 'chrome')  # reflector behind the segments
            self.box((seg_w * 0.74, 0.014, 0.036), (xx, yy - 0.024, z_lamp), 'tail', bevel=0.004)
        for s in (-1, 1):  # vertical end blades wrap down the corners
            xx = s * (width / 2 - 0.02)
            self.box((0.032, 0.016, 0.19), (xx, self.rear_y(xx, z_lamp - 0.09) - 0.012, z_lamp - 0.09), 'tail', bevel=0.005)
        self.empty('tail_L', (-0.72, y - 0.04, z_lamp))
        self.empty('tail_R', (0.72, y - 0.04, z_lamp))

    def rear_lower(self, z_grille=0.55):
        yg = self.rear_y(0, z_grille)
        self.cut_box((1.5, 0.26, 0.22), (0, yg, z_grille), bevel=0.035)
        self.mesh_insert((0, yg + 0.1, z_grille), (1, 0, 0), (0, 0, 1), 1.44, 0.19, pitch=0.024, bar=0.005)
        for s in (-1, 1):
            x = s * 0.15
            # Big oval-ish tips: carbon surround, polished pipe, dark bore, hot glow.
            self.cyl(0.085, 0.2, (x, yg + 0.1, z_grille - 0.01), 'carbon', rot=(math.pi / 2, 0, 0), verts=40)
            self.cyl(0.072, 0.24, (x, yg + 0.11, z_grille - 0.01), 'chrome', rot=(math.pi / 2, 0, 0), verts=40)
            self.cyl(0.06, 0.25, (x, yg + 0.115, z_grille - 0.01), 'well', rot=(math.pi / 2, 0, 0), verts=32)
            self.cyl(0.056, 0.02, (x, yg + 0.17, z_grille - 0.01), 'exhaust', rot=(math.pi / 2, 0, 0), verts=32)
        self.empty('exhaust_L', (-0.15, yg - 0.12, z_grille - 0.01))
        self.empty('exhaust_R', (0.15, yg - 0.12, z_grille - 0.01))
        y = self.rear_y(0, 0.8)
        zb = self.P(1.0)['zb']
        self.box((1.64, 0.56, 0.022), (0, y + 0.28, zb - 0.05), 'carbon', rot=(-0.2, 0, 0), bevel=0.006)
        for i in range(9):
            xx = -0.72 + i * 0.18
            self.box((0.01, 0.5, 0.11 if i % 4 else 0.15), (xx, y + 0.26, zb - 0.015), 'carbon', rot=(-0.2, 0, 0), bevel=0.003)
        self.box((0.18, 0.02, 0.05), (0, y - 0.005, zb + 0.1), 'brake', bevel=0.005)  # rain light

    # ------------------------------------------------------------ body kit
    def aero_mirrors(self, t=0.335):
        p = self.P(t)
        for s in (-1, 1):
            x0 = s * self.HW * p['gb']
            z0 = p['zg'] + 0.02
            y0 = self.y(t)
            # Two carbon stalks sweeping out and up from the door to the pod.
            pod = Vector((x0 + s * 0.23, y0 - 0.04, z0 + 0.07))
            for dy in (0.03, -0.05):
                self.tube([(x0 - s * 0.01, y0 + dy, z0), (x0 + s * 0.1, y0 + dy * 0.6, z0 + 0.05), tuple(pod + Vector((-s * 0.04, dy * 0.4, -0.01)))], 0.009, 'carbon', verts=10)
            self.pod((0.11, 0.075, 0.048), tuple(pod), 'paint', rot=(0, 0, s * 0.12))
            self.pod((0.095, 0.01, 0.036), tuple(pod + Vector((0, -0.07, 0))), 'glass', rot=(0, 0, s * 0.12), seg=24, rings=10)
            self.box((0.07, 0.01, 0.006), tuple(pod + Vector((s * 0.03, 0.0, 0.04))), 'amber', rot=(0, 0, s * 0.12))

    def canards(self, z=0.36):
        # Dive planes on the bumper corners: rooted in the body side just behind the nose.
        for s in (-1, 1):
            for k, dz in enumerate((0.0, 0.085)):
                t = 0.045 + 0.02 * k
                xs = self.side_x(s, t, z + dz)
                self.box((0.08, 0.13, 0.009), (xs + s * 0.022, self.y(t), z + dz), 'carbon', rot=(0.1, s * 0.25, -s * 0.35), bevel=0.003)

    def roof_scoop(self, t=0.5, w=0.36, l=0.7, h=0.1):
        zt = self.top_z(0, t)
        y = self.y(t)
        self.pod((w / 2, l / 2, h), (0, y - l * 0.1, zt - h * 0.2), 'paint', seg=48, rings=24)
        # Intake mouth: dark opening with a mesh in front.
        self.pod((w * 0.4, 0.03, h * 0.55), (0, y + l * 0.33, zt + h * 0.42), 'well', seg=24, rings=12)
        self.mesh_insert((0, y + l * 0.355, zt + h * 0.42), (1, 0, 0), (0, 0, 1), w * 0.72, h * 0.8, pitch=0.018, bar=0.004)

    def door_handles(self, t=0.5):
        p = self.P(t)
        for s in (-1, 1):
            z = p['zsh'] - 0.04
            x = self.side_x(s, t, z)
            self.box((0.012, 0.16, 0.03), (x - s * 0.002, self.y(t), z), 'trim', bevel=0.008)

    def fuel_cap(self, t=0.74, s=1):
        z = self.P(t)['zsh'] - 0.02
        x = self.side_x(s, t, z)
        self.cyl(0.05, 0.012, (x - s * 0.002, self.y(t), z), 'chrome', rot=(0, math.pi / 2, 0), verts=40)
        self.cyl(0.04, 0.014, (x, self.y(t), z), 'carbon', rot=(0, math.pi / 2, 0), verts=40)

    def carbon_scoops(self, t=0.64, z=0.55, size=(0.5, 0.56, 0.3), fins=5):
        for s in (-1, 1):
            x = self.side_x(s, t, z)
            self.cut_box(size, (x, self.y(t), z), rot=(0, 0, s * 0.22), bevel=0.06)
            self.mesh_insert((x - s * 0.18, self.y(t), z), (0, 1, 0), (0, 0, 1), size[1] * 0.85, size[2] * 0.75, pitch=0.022, bar=0.005)
            for i in range(fins):
                zz = z - size[2] * 0.34 + i * size[2] * 0.68 / max(1, fins - 1)
                self.box((0.2, size[1] * 0.9, 0.01), (x - s * 0.07, self.y(t), zz), 'carbon', rot=(0.0, 0, s * 0.22), bevel=0.003)

    def louvres_fine(self, t0, t1, n=13, w=0.62):
        for i in range(n):
            t = t0 + (t1 - t0) * (i + 0.5) / n
            zt = self.top_z(0, t)
            self.box((w, 0.02, 0.008), (0, self.y(t), zt + 0.014), 'carbon', rot=(-0.4, 0, 0), bevel=0.003)
        for s in (-1, 1):  # frame rails
            tm = (t0 + t1) / 2
            self.box((0.014, (t1 - t0) * self.L, 0.016), (s * (w / 2 + 0.01), self.y(tm), self.top_z(s * w / 2, tm) + 0.008), 'trim', bevel=0.004)

    # ------------------------------------------------------------ v5: see-through glass, cabin, baked AO
    def glass_and_cabin(self, inner=0.022):
        """Windows become their own see-through object; the body gets a dark inner skin (so you can't look straight
        through the car) and a simple cabin: floor tub, two seats, dashboard, steering wheel."""
        import bmesh
        o = self.body_obj
        bm = bmesh.new()
        bm.from_mesh(o.data)
        glass_idx = {i for i, m in enumerate(o.data.materials) if m and m.name.startswith('glass')}
        gfaces = [f for f in bm.faces if f.material_index in glass_idx]
        # Glass panes: copy them into a new object, then remove them from the body.
        gb = bmesh.new()
        vmap = {}
        for f in gfaces:
            vs = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = gb.verts.new(v.co)
                vs.append(vmap[v])
            try:
                gb.faces.new(vs)
            except ValueError:
                pass
        bmesh.ops.delete(bm, geom=gfaces, context='FACES_ONLY')
        bm.to_mesh(o.data)
        bm.free()
        g = self.obj('glass_panes', gb, ['glass'])
        self.smooth(g, 60)
        # Inner skin: the body (without glass) copied, pushed inwards and turned inside out, dark trim.
        ib = bmesh.new()
        ib.from_mesh(o.data)
        ib.normal_update()
        for v in ib.verts:
            v.co -= v.normal * inner
        bmesh.ops.reverse_faces(ib, faces=ib.faces)
        for f in ib.faces:
            f.material_index = 0
        inner_o = self.obj('cabin_skin', ib, ['trim'])
        dec = inner_o.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.08  # dark and only glimpsed: a fraction of the triangles
        self.apply_all(inner_o)
        self.smooth(inner_o, 50)
        # Simple cabin: you only glimpse it through the glass.
        c0, c1 = self.d['cabin']['side']
        tm = c0 + (c1 - c0) * 0.55
        p = self.P(tm)
        zf = p['zb'] + 0.12
        self.box((self.HW * 1.5, (c1 - c0) * self.L, 0.04), (0, self.y((c0 + c1) / 2), zf), 'well', name='cabin_floor')
        for s in (-1, 1):
            x = s * self.HW * 0.36
            self.box((0.46, 0.5, 0.12), (x, self.y(tm), zf + 0.1), 'trim', bevel=0.03, name='seat')       # cushion
            self.box((0.46, 0.12, 0.62), (x, self.y(tm) - 0.3, zf + 0.42), 'trim', rot=(-0.28, 0, 0), bevel=0.04, name='seat')  # back
        td = c0 + (c1 - c0) * 0.08
        zd = self.P(td)['zg'] - 0.06
        self.box((self.HW * 1.55, 0.36, 0.16), (0, self.y(td) - 0.05, zd), 'trim', bevel=0.03, name='dash')
        sx = -self.HW * 0.36
        bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.022, major_segments=32, minor_segments=8,
                                         location=(sx, self.y(td) - 0.3, zd - 0.02), rotation=(math.pi / 2 - 0.35, 0, 0))
        w = bpy.context.object
        w.name = 'steering_wheel'
        w.data.materials.append(self.M['trim'])

    def bake_ao(self, samples=48, distance=0.6):
        """Ambient occlusion (dark creases, panel gaps, under the wing, inside the arches) baked into vertex colours."""
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = samples
        sc.cycles.device = 'CPU'
        sc.render.bake.target = 'VERTEX_COLORS'
        sc.world = sc.world or bpy.data.worlds.new('w')
        sc.world.light_settings.distance = distance
        meshes = [o for o in sc.objects if o.type == 'MESH']
        lit = ('tail', 'brake', 'head', 'amber', 'neon', 'exhaust', 'glass', 'lens')
        for o in meshes:
            if not o.data.color_attributes.get('ao'):
                o.data.color_attributes.new('ao', 'BYTE_COLOR', 'CORNER')
            o.data.color_attributes.active_color = o.data.color_attributes['ao']
        for o in meshes:
            names = {m.name.split('.')[0] for m in o.data.materials if m}
            if names and names <= set(lit):
                # Lamps / glass: no darkening (white).
                for c in o.data.color_attributes['ao'].data:
                    c.color = (1, 1, 1, 1)
                continue
            for x in sc.objects:
                x.select_set(False)
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            try:
                bpy.ops.object.bake(type='AO')
            except Exception as ex:
                print('AO BAKE FAILED', o.name, ex)
        print('AO baked on', len(meshes), 'objects')

    def _report(self, tag):
        o = self.body_obj
        mats = [m.name if m else None for m in o.data.materials]
        used = sorted({p.material_index for p in o.data.polygons})
        print(f'STAGE {tag}: body faces {len(o.data.polygons)} mats {mats} used {used}')

    def finish(self):
        self._report('start')
        self.details8()
        self.panel_gaps()
        self._report('after gaps')
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o.modifiers:
                self.apply_all(o)
        self.auto_head_empties()
        self._report('before glass')
        self.glass_and_cabin()
        self._report('after glass')
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o.modifiers:
                self.apply_all(o)
        self.bake_ao()
        for o in bpy.context.scene.objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.body_obj
        tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
        print('TRIANGLES', tris)
        bpy.ops.export_scene.gltf(filepath=self.out, export_format='GLB', use_selection=True, export_apply=True,
                                  export_normals=True, export_texcoords=False, export_materials='EXPORT',
                                  export_vertex_color='ACTIVE')
        print('EXPORTED', self.out)
        if self.preview:
            sc = bpy.context.scene
            sc.render.engine = 'BLENDER_EEVEE'
            self.render_preview()

    # ------------------------------------------------------------ v6: real tail lamps (swept along the body)
    def sweep(self, path, profile, mat, name='part', cap=True):
        """A profile (list of (out, up) offsets) swept along a path of points; 'out' points away from the body
        (backwards at the tail), 'up' is world up. Returns the mesh object."""
        import bmesh
        bm = bmesh.new()
        rings = []
        n = len(path)
        for i, p in enumerate(path):
            a, b = path[max(0, i - 1)], path[min(n - 1, i + 1)]
            T = (Vector(b) - Vector(a)).normalized()
            back = Vector((0, -1, 0))
            O = (back - T * T.dot(back)).normalized()  # outwards (backwards), perpendicular to the path
            U = O.cross(T).normalized()                 # turns smoothly with the path (round corners stay round)
            rings.append([bm.verts.new(Vector(p) + O * po + U * pu) for po, pu in profile])
        m = len(profile)
        for r0, r1 in zip(rings, rings[1:]):
            for j in range(m):
                try:
                    bm.faces.new((r0[j], r0[(j + 1) % m], r1[(j + 1) % m], r1[j]))
                except ValueError:
                    pass
        if cap:
            for r in (rings[0], rings[-1]):
                try:
                    bm.faces.new(r)
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.obj(name, bm, [mat])
        self.smooth(o, 50)
        return o

    def tail_lamp_strip(self, z=0.8, width=None, drop=0.15, n=64, corner_r=0.1):
        """A modern full-width tail lamp: one continuous shape that comes up the left corner, runs across the tail
        along its curve and goes down the right corner (round bends), recessed into the body: a light pipe (plus a
        thin second line) in front of a chrome reflector, under a red see-through lens flush with the body."""
        width = width or self.W * 0.84
        hw = width / 2
        pts = []
        def P(x, zz):
            return (x, self.rear_y(x, zz) - 0.001, zz)
        for k in range(8):  # left corner, going up
            pts.append(P(-hw, z - drop + (drop - corner_r) * k / 8))
        for k in range(9):  # round bend
            a = math.pi - (math.pi / 2) * k / 8
            pts.append(P(-hw + corner_r + corner_r * math.cos(a), z - corner_r + corner_r * math.sin(a)))
        for i in range(1, n):
            x = -hw + corner_r + (width - 2 * corner_r) * i / n
            pts.append(P(x, z))
        for k in range(9):
            a = math.pi / 2 - (math.pi / 2) * k / 8
            pts.append(P(hw - corner_r + corner_r * math.cos(a), z - corner_r + corner_r * math.sin(a)))
        for k in range(1, 9):
            pts.append(P(hw, z - corner_r - (drop - corner_r) * k / 8))
        paths = [pts]
        circle = lambda r, cu=0.0, co=0.0, k=14: [(co + r * math.cos(2 * math.pi * i / k), cu + r * math.sin(2 * math.pi * i / k)) for i in range(k)]
        for pi, pth in enumerate(paths):
            # Recess: a rounded channel cut into the tail.
            # Flush lamp (no boolean cut: it damaged the body mesh): a dark housing band lies on the surface, the
            # reflector, light pipes and lens sit in front of it.
            self.sweep(pth, [(-0.004, -0.046), (0.004, -0.046), (0.006, 0.046), (-0.004, 0.046)], 'trim', name='tail_housing')
            self.sweep(pth, [(0.004, -0.032), (0.009, -0.032), (0.014, 0.0), (0.009, 0.032), (0.004, 0.032)], 'chrome', name='tail_reflector')
            self.sweep(pth, circle(0.0105, cu=-0.005, co=0.02), 'tail', name='tail_pipe')
            self.sweep(pth, circle(0.0045, cu=0.024, co=0.018, k=10), 'tail', name='tail_pipe_thin')
            # Lens cover: a gently curved band flush with the body surface.
            lens = [(0.034 + 0.008 * math.cos(t), 0.042 * math.sin(t)) for t in [(-math.pi / 2) + math.pi * i / 10 for i in range(11)]]
            lens += [(p[0] - 0.004, p[1]) for p in reversed(lens)]
            self.sweep(pth, lens, 'lens', name='tail_lens')
        self.empty('tail_L', (-width * 0.4, self.rear_y(-width * 0.4, z) - 0.03, z))
        self.empty('tail_R', (width * 0.4, self.rear_y(width * 0.4, z) - 0.03, z))

    # ------------------------------------------------------------ v6 helpers for every car
    def stripes(self, segments, offset=0.11, width=0.13, mat='stripe'):
        """Twin racing stripes over the top of the car (bonnet, roof, boot: `segments` = [(t0, t1), …] so the glass
        is skipped): thin ribbons a hair above the paint, following its shape."""
        import bmesh
        for t0, t1 in segments:
            for s in (-1, 1):
                bm = bmesh.new()
                prev = None
                steps = max(4, int((t1 - t0) * 80))
                for i in range(steps + 1):
                    t = t0 + (t1 - t0) * i / steps
                    x0, x1 = s * (offset - width / 2), s * (offset + width / 2)
                    a = bm.verts.new((x0, self.y(t), self.top_z(x0, t) + 0.004))
                    b = bm.verts.new((x1, self.y(t), self.top_z(x1, t) + 0.004))
                    if prev:
                        try:
                            bm.faces.new((prev[0], prev[1], b, a))
                        except ValueError:
                            pass
                    prev = (a, b)
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                for f in bm.faces:
                    if f.normal.z < 0:
                        f.normal_flip()
                o = self.obj('stripe', bm, [mat])
                self.smooth(o, 40)

    def auto_head_empties(self):
        """head_L / head_R markers for the game's headlight glow, found from the lamp parts (when a script did not
        place them itself)."""
        names = {o.name for o in bpy.context.scene.objects}
        if 'head_L' in names and 'head_R' in names:
            return
        pts = {-1: [], 1: []}
        for o in bpy.context.scene.objects:
            if o.type != 'MESH' or not o.data.materials:
                continue
            if all(m and m.name.split('.')[0] == 'head' for m in o.data.materials):
                o.data.update()
                c = sum((o.matrix_world @ v.co for v in o.data.vertices), Vector()) / max(1, len(o.data.vertices))
                if c.y > 0:  # front half only
                    pts[1 if c.x > 0 else -1].append(c)
        for s, tag in ((-1, 'L'), (1, 'R')):
            if pts[s]:
                c = sum(pts[s], Vector()) / len(pts[s])
                self.empty(f'head_{tag}', (c.x, c.y + 0.04, c.z))

    # ================================================================ v8: panels, not one lump of clay
    # Bumpers are separate swept parts that hug the body and stop at the wheel arch, panel shut lines get rolled
    # edges (like folded sheet metal), a diagonal sculpted cove runs along the flank, and the small things real
    # cars have: proper mirrors, wipers, badges, door handles.

    def hug_path(self, end, z, h=0.0, n=72, arch_clear=0.05):
        """Points around the front/rear end at height z, on the outermost body surface between z-h/2 and z+h/2,
        from the arch on one side round the end to the arch on the other: [(point, horizontal outward normal)]."""
        g = 1 if end == 'front' else -1
        wi = 0 if end == 'front' else 1
        R = self.wheelR[wi]
        aR = R + self.d.get('arch_gap', 0.05)
        dz = z - R
        half = math.sqrt(aR * aR - dz * dz) if abs(dz) < aR else 0.0
        y_lim = self.y(self.wheelT[wi]) + g * (half + arch_clear)
        c = Vector((0.0, y_lim, z))
        pts = []
        for i in range(n + 1):
            th = -math.pi / 2 + math.pi * i / n
            dr = Vector((math.sin(th), g * math.cos(th), 0.0))
            best = None
            for zz in ((z - h / 2, z, z + h / 2) if h else (z,)):
                hh = self.hit(Vector((c.x, c.y, zz)) + dr * 6.0, -dr)
                if not hh:
                    continue
                d = (Vector((hh[0].x, hh[0].y, 0)) - Vector((c.x, c.y, 0))).dot(dr)
                if best is None or d > best[0]:
                    best = (d, hh[1])
            if best is None:
                continue
            p = Vector((c.x, c.y, z)) + dr * best[0]
            if g * (p.y - y_lim) < -1e-4:
                continue
            nh = Vector((best[1].x, best[1].y, 0.0))
            nh = nh.normalized() if nh.length > 0.2 else dr.copy()
            pts.append([p, nh])
        for _ in range(4):  # even out small dents (lamp / grille cuts) so the part flows
            sm = [list(x) for x in pts]
            for k in range(1, len(pts) - 1):
                sm[k][0] = pts[k - 1][0] * 0.25 + pts[k][0] * 0.5 + pts[k + 1][0] * 0.25
                sm[k][1] = (pts[k - 1][1] * 0.25 + pts[k][1] * 0.5 + pts[k + 1][1] * 0.25).normalized()
            pts = sm
        return pts

    def hug_sweep(self, path, profile, mat, name='part', cap=True, smooth=40):
        """Profile (out, up) swept along a hug_path: 'out' along the surface normal, 'up' world up."""
        import bmesh
        bm = bmesh.new()
        rings = [[bm.verts.new(p + nrm * o + Vector((0, 0, u))) for o, u in profile] for p, nrm in path]
        m = len(profile)
        for r0, r1 in zip(rings, rings[1:]):
            for j in range(m):
                try:
                    bm.faces.new((r0[j], r0[(j + 1) % m], r1[(j + 1) % m], r1[j]))
                except ValueError:
                    pass
        if cap:
            for r in (rings[0], rings[-1]):
                try:
                    bm.faces.new(r)
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.obj(name, bm, [mat])
        self.smooth(o, smooth)
        return o

    @staticmethod
    def band(h, out, r=None, inner=-0.012, seg=5, bulge=0.0):
        """Closed rounded band profile: buried at `inner`, standing out to `out`, height h, corner radius r."""
        r = min(r if r is not None else h * 0.3, h / 2 - 1e-4, max(0.004, out - inner - 0.002))
        pts = [(inner, -h / 2)]
        for k in range(seg + 1):  # bottom-front corner
            a = -math.pi / 2 + (math.pi / 2) * k / seg
            pts.append((out - r + r * math.cos(a), -h / 2 + r + r * math.sin(a)))
        if bulge:
            pts.append((out + bulge, 0.0))
        for k in range(seg + 1):  # top-front corner
            a = (math.pi / 2) * k / seg
            pts.append((out - r + r * math.cos(a), h / 2 - r + r * math.sin(a)))
        pts.append((inner, h / 2))
        return pts

    def bumper3(self, end='front', kind='chrome', z=0.36, h=0.13, proud=0.07, wrap=0.4, kx=0.96):
        path = self.hug_path(end, z, h)
        if len(path) < 8:
            return super().bumper3(end, kind, z, h, proud, wrap, kx)
        if kind == 'body':
            # Body-colour bumper cover: its own panel, a hair proud with rolled edges, a black lip below.
            self.hug_sweep(path, self.band(h, 0.016, r=0.012, bulge=0.004), 'paint', 'bumper')
            lip = self.hug_path(end, z - h / 2 - 0.025, 0.03)
            if len(lip) > 8:
                self.hug_sweep(lip, self.band(0.03, 0.03, r=0.008), 'trim', 'bumper_lip')
        elif kind == 'chrome':
            self.hug_sweep(path, self.band(h, proud * 0.85, r=h * 0.38, bulge=0.008, seg=7), 'chrome', 'bumper')
            self.hug_sweep(path, self.band(h * 0.26, proud * 0.85 + 0.012, r=0.008), 'rubber', 'bumper_strip')
        else:
            mat = 'carbon' if kind == 'carbon' else 'trim'
            self.hug_sweep(path, self.band(h, proud * 0.7, r=h * 0.3, bulge=0.004), mat, 'bumper')
            self.hug_sweep(path, self.band(h * 0.18, proud * 0.7 + 0.006, r=0.005), 'rubber', 'bumper_strip')

    # ---------------------------------------------------------------- mirrors
    def car_mirror(self, t, mat='paint'):
        p = self.P(t)
        y = self.y(t)
        for s in (-1, 1):
            z0 = p['zg'] - 0.02
            x0 = self.side_x(s, t, z0)
            self.pod((0.022, 0.075, 0.04), (x0 + s * 0.008, y, z0 + 0.01), 'trim', name='mirror_base')
            a, b = Vector((x0 + s * 0.01, y - 0.01, z0 + 0.02)), Vector((x0 + s * 0.13, y - 0.035, z0 + 0.065))
            self.tube([tuple(a), tuple(a.lerp(b, 0.5) + Vector((0, 0, 0.012))), tuple(b)], 0.012, 'trim', verts=12)
            hc = Vector((x0 + s * 0.175, y - 0.04, z0 + 0.075))
            self.pod((0.085, 0.055, 0.052), tuple(hc), mat, rot=(0, 0, s * 0.12), name='mirror')
            self.pod((0.074, 0.006, 0.042), tuple(hc + Vector((0, -0.05, 0))), 'chrome', rot=(0, 0, s * 0.12), seg=24, rings=10, name='mirror_glass')

    def retro_mirrors(self, t=0.4, square=True):
        self.car_mirror(t, 'chrome' if square else 'paint')

    def mirrors3(self, t=0.33):
        self.car_mirror(t, 'paint')

    # ---------------------------------------------------------------- shut lines with rolled edges
    def groove(self, rays, gap=None, depth=0.014):
        gap = (gap or self.d.get('gap', 0.009)) / 2
        hits = [h for h in (self.hit(o, dr) for o, dr in rays) if h]
        if len(hits) < 2:
            return
        import bmesh
        bm = bmesh.new()
        rings = []
        n = len(hits)
        for i, (loc, nrm) in enumerate(hits):
            T = (hits[min(i + 1, n - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
            if i == 0:
                loc = loc - T * gap
            if i == n - 1:
                loc = loc + T * gap
            B = nrm.cross(T).normalized()
            o, inn = loc + nrm * 0.03, loc - nrm * depth
            rings.append([bm.verts.new(v) for v in (o + B * gap, o - B * gap, inn - B * gap, inn + B * gap)])
        for a, b in zip(rings, rings[1:]):
            for j in range(4):
                bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        c = self.obj('gap', bm, ['gap'])
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

    def panel_gaps(self):
        super().panel_gaps()
        import bmesh
        o = self.body_obj
        names = [m.name if m else '' for m in o.data.materials]
        if 'gap' not in names or 'paint' not in names:
            return
        gi, pi = names.index('gap'), names.index('paint')
        bm = bmesh.new()
        bm.from_mesh(o.data)
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and {f.material_index for f in e.link_faces} == {gi, pi}]
        if edges:
            try:
                bmesh.ops.bevel(bm, geom=edges, offset=0.0045, segments=2, profile=0.6, affect='EDGES', clamp_overlap=True)
            except Exception as ex:
                print('GAP BEVEL FAILED', ex)
        bm.to_mesh(o.data)
        bm.free()

    # ---------------------------------------------------------------- diagonal cove along the flank
    def side_cove(self, depth=0.012, rise=0.09, band=0.13, z_off=0.15):
        """A sculpted recess under a line that rises from behind the front wheel towards the rear wheel: a crisp
        diagonal light/shadow line on the flank (no more lines that only run parallel to the car)."""
        o = self.body_obj
        tf, tr = self.wheelT
        t0 = tf + (self.wheelR[0] + 0.12) / self.L
        t1 = tr - (self.wheelR[1] + 0.1) / self.L
        if t1 - t0 < 0.15:
            return
        z0 = self.P(t0)['zsh'] - z_off
        z1 = z0 + rise
        soft = 0.012
        for v in o.data.vertices:
            n = v.normal
            if abs(n.x) < 0.5:
                continue
            co = v.co
            t = (self.L / 2 - co.y) / self.L
            if t <= t0 or t >= t1:
                continue
            u = (t - t0) / (t1 - t0)
            fade = _ss(0.0, 0.16, u) * (1 - _ss(0.8, 1.0, u))
            below = (z0 + (z1 - z0) * u ** 1.3) - co.z
            if below < -soft:
                continue
            k = _ss(-soft, soft * 0.3, below) * (1 - _ss(band * 0.55, band, below))
            co.x -= math.copysign(depth * k * fade, co.x)
        o.data.update()

    def body(self):
        o = super().body()
        cove = self.d.get('cove', {})
        if cove is not False:
            self.side_cove(**cove)
        return o

    # ---------------------------------------------------------------- small things
    def door_handles(self, t=0.5):
        self._handles = True
        p = self.P(t)
        for s in (-1, 1):
            z = p['zsh'] - 0.05
            x = self.side_x(s, t, z)
            self.box((0.014, 0.15, 0.026), (x + s * 0.004, self.y(t), z), 'chrome', bevel=0.011, name='handle')
            self.box((0.006, 0.17, 0.04), (x, self.y(t), z - 0.004), 'trim', bevel=0.006, name='handle_well')

    def wipers(self):
        cab = self.d['cabin']
        t = cab['ws'][0] + 0.12 * (cab['ws'][1] - cab['ws'][0])
        gw = self.HW * self.P(t)['gb']
        for xa, xb in ((-gw * 0.82, -gw * 0.04), (gw * 0.02, gw * 0.7)):
            pts = []
            for i in range(7):
                x = xa + (xb - xa) * i / 6
                pts.append((x, self.y(t) + 0.004, self.top_z(x, t) + 0.011))
            self.tube(pts, 0.0055, 'trim', verts=10)
            self.tube([(q[0], q[1] - 0.006, q[2] - 0.004) for q in pts[1:]], 0.008, 'rubber', verts=10)
            self.cyl(0.016, 0.02, (xb, self.y(t) + 0.01, self.top_z(xb, t) + 0.006), 'trim', verts=20)

    def badges(self):
        for t in (0.04, 0.965):
            self.pod((0.045, 0.028, 0.007), (0, self.y(t), self.top_z(0, t) + 0.004), 'chrome', seg=32, rings=8, name='badge')

    def details8(self):
        if self.d.get('wipers', True):
            self.wipers()
        if self.d.get('badges', True):
            self.badges()
        if not getattr(self, '_handles', False) and self.d.get('handles', True):
            d0, d1 = self.d['doors']
            self.door_handles(d1 - 0.035)

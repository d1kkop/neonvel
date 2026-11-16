"""
Shared Blender car generator for Neon Velocity.

Each tools/blender/car_<name>.py calls build(style, design) with the game's own (raised) style dimensions from
styles.json, so the game's lights / plate / exhausts / wheels line up. The design dict makes every car different:
body cross-section, arches, greenhouse shape and car-specific shapes (hip kick, side intakes, fender pods, …).
Windows are inset into the greenhouse, which leaves real window frames and pillars.

Blender +Y = car front (glTF converts it to -Z). Materials: paint, glass, trim, chrome, well.
Run:  blender --background --python tools/blender/car_<name>.py -- <out.glb> [preview.png]
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = json.load(open(os.path.join(HERE, 'styles.json')))


def interp(rows, t):
    if t <= rows[0][0]:
        return tuple(rows[0][1:])
    for a, b in zip(rows, rows[1:]):
        if t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0])
            k = k * k * (3 - 2 * k)
            return tuple(a[i] + (b[i] - a[i]) * k for i in (1, 2, 3))
    return tuple(rows[-1][1:])


# ---------------------------------------------------------------- cross-section profiles (half, bottom→top)
def profile_boxy(top, bot, hw, belt=0.66):
    h = top - bot
    return [(0.0, bot), (hw * 0.84, bot), (hw, bot + 0.09 * h), (hw, bot + belt * h), (hw * 0.985, bot + (belt + 0.035) * h), (hw * 0.9, top), (0.0, top)]


def profile_round(top, bot, hw, n=4.0, steps=10):
    """Superellipse half section (soft but not a blob)."""
    mid, hh = (top + bot) / 2, (top - bot) / 2
    pts = []
    for i in range(steps + 1):
        a = -math.pi / 2 + math.pi * i / steps
        c, s = math.cos(a), math.sin(a)
        x = abs(c) ** (2 / n) * hw
        y = math.copysign(abs(s) ** (2 / n), s) * hh
        pts.append((x if i not in (0, steps) else 0.0, mid + y))
    return pts


def profile_facet(top, bot, hw):
    h = top - bot
    return [(0.0, bot), (hw * 0.7, bot), (hw, bot + 0.3 * h), (hw * 0.96, bot + 0.62 * h), (hw * 0.62, top), (0.0, top)]


def profile_bus(top, bot, hw):
    h = top - bot
    return [(0.0, bot), (hw * 0.95, bot), (hw, bot + 0.04 * h), (hw, top - 0.06 * h), (hw * 0.96, top), (0.0, top)]


PROFILES = {'boxy': profile_boxy, 'round': profile_round, 'facet': profile_facet, 'bus': profile_bus}


# ---------------------------------------------------------------- helpers
def material(name, color, metal=0.0, rough=0.5):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    return ob


def loft(rows, half_profile, n_along, L, HW, width_fn=None):
    """Sweep a mirrored half profile along t; closed, outward-facing bmesh."""
    bm = bmesh.new()
    t0, t1 = rows[0][0], rows[-1][0]
    rings = []
    for i in range(n_along + 1):
        t = t0 + (t1 - t0) * i / n_along
        top, bot, hw = interp(rows, t)
        w = hw * HW * (width_fn(t) if width_fn else 1.0)
        half = half_profile(top, bot, w)
        pts = [(-x, z) for x, z in reversed(half[1:-1])] + half
        rings.append([bm.verts.new((x, L / 2 - t * L, z)) for x, z in pts])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    top_face = max(bm.faces, key=lambda f: f.calc_center_median().z)
    if top_face.normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update()
    return bm


def box(name, size, loc, mat, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(mat)
    if bevel:
        bpy.ops.object.transform_apply(scale=True)
        b = o.modifiers.new('b', 'BEVEL'); b.width = bevel; b.segments = 2
    return o


def boolean(target, cutter, op='DIFFERENCE'):
    b = target.modifiers.new('bool', 'BOOLEAN'); b.object = cutter; b.operation = op; b.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier='bool')
    bpy.data.objects.remove(cutter)


# ---------------------------------------------------------------- the build
def build(style_name, design):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else f'{style_name}.glb'
    preview = argv[1] if len(argv) > 1 else None

    st = STYLES[style_name]
    L, W = st['length'], st['width']
    HW = W / 2
    BODY, CABIN = st['body'], st['cabin']
    wheelT = st['wheelT']
    R = st['wheelRadius']
    wheelR = [R, R * st.get('rearWheelScale', 1)]
    archR = [r + 0.09 for r in wheelR]
    y_of = lambda t: L / 2 - t * L

    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = {
        'paint': material('paint', design.get('preview_color', (0.85, 0.2, 0.5)), 0.5, 0.35),
        'glass': material('glass', (0.02, 0.03, 0.05), 0.9, 0.05),
        'trim': material('trim', (0.03, 0.03, 0.035), 0.3, 0.5),
        'chrome': material('chrome', (0.8, 0.82, 0.86), 1.0, 0.15),
        'well': material('well', (0.01, 0.01, 0.012), 0.0, 0.9),
    }

    # --- body
    prof_name = design.get('profile', 'boxy')
    pkw = design.get('profile_args', {})
    prof = lambda top, bot, hw: PROFILES[prof_name](top, bot, hw, **pkw)
    width_fn = None
    if 'hip' in design:  # coke-bottle: bulge over the rear wheel, pinched waist ahead of it
        hip = design['hip']
        def width_fn(t, hip=hip):
            bulge = hip * math.exp(-((t - wheelT[1]) / 0.11) ** 2)
            waist = -hip * 0.6 * math.exp(-((t - (wheelT[0] + wheelT[1]) / 2) / 0.12) ** 2)
            return 1 + bulge + waist
    body = new_obj('body', loft(BODY, prof, design.get('along', 90), L, HW, width_fn), [M['paint'], M['well']])

    # Wheel arches: per side cutters, kept below the body line; square (80s) or round.
    for wi, t in enumerate(wheelT):
        if wi == 1 and design.get('rear_skirt'):
            continue
        top_here = interp(BODY, t)[0]
        z_top = min(wheelR[wi] + archR[wi] * 0.95, top_here - 0.14)
        for side in (-1, 1):
            if design.get('arches', 'square') == 'round':
                cz = min(wheelR[wi] + 0.02, z_top - archR[wi])  # round arches stay below the bonnet too
                bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=archR[wi], depth=0.8, location=(side * HW, y_of(t), cz), rotation=(0, math.pi / 2, 0))
                cut = bpy.context.object
            else:
                zb = -0.3
                cut = box('cut', (0.8, archR[wi] * 2.05, z_top - zb), (side * HW, y_of(t), (z_top + zb) / 2), M['well'], bevel=archR[wi] * 0.38)
                bpy.context.view_layer.objects.active = cut
                bpy.ops.object.modifier_apply(modifier='b')
            if not cut.data.materials:
                cut.data.materials.append(M['well'])
            boolean(body, cut)

    # Side air intakes (mid-engine cars): dark scoops cut into the flanks ahead of the rear wheels.
    if design.get('side_intakes'):
        t = wheelT[1] - (archR[1] + 0.32) / L
        top, bot, hw = interp(BODY, t)
        for side in (-1, 1):
            cut = box('intake', (0.5, 0.75, (top - bot) * 0.36), (side * hw * HW, y_of(t), bot + (top - bot) * 0.55), M['well'], rot=(0, 0, side * 0.12))
            boolean(body, cut)

    bev = body.modifiers.new('crease', 'BEVEL'); bev.limit_method = 'ANGLE'; bev.angle_limit = math.radians(design.get('crease_angle', 28))
    bev.width = design.get('crease_width', 0.014); bev.segments = design.get('crease_segments', 3)
    body.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True

    # Separate fender pods (endurance racer): rounded blocks standing proud over each wheel.
    if design.get('fender_pods'):
        for wi, t in enumerate(wheelT):
            for side in (-1, 1):
                pod = box('pod', (0.42, archR[wi] * 2.4, wheelR[wi] * 1.3), (side * (HW - 0.2), y_of(t), wheelR[wi] + 0.1), M['paint'], bevel=0.12)

    # --- greenhouse: painted shell, windows inset into it (frames + pillars appear by themselves)
    gh_prof = design.get('greenhouse', 'trapezoid')
    tumble = design.get('tumble', 0.84)
    def cabin_profile(top, bot, hw):
        if gh_prof == 'bubble':
            return [(0.0, bot), (hw, bot), (hw * 0.96, bot + (top - bot) * 0.55), (hw * 0.7, top - (top - bot) * 0.05), (0.0, top)]
        if gh_prof == 'box':
            return [(0.0, bot), (hw, bot), (hw * 0.985, top - 0.03), (hw * 0.95, top), (0.0, top)]
        return [(0.0, bot), (hw, bot), (hw * tumble, top), (0.0, top)]
    gbm = loft(CABIN, cabin_profile, design.get('cabin_along', 40), L, HW)
    bmesh.ops.subdivide_edges(gbm, edges=[e for e in gbm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6 and abs(e.verts[0].co.x) > 0.01], cuts=1)
    c0, c1 = CABIN[0][0], CABIN[-1][0]
    b_t = design.get('b_pillar', 0.5)  # B-pillar position within the greenhouse (0..1), None = no pillar
    pillars = design.get('extra_pillars', [])  # bus: many window posts
    def classify(f):
        n = f.normal
        cy = f.calc_center_median().y
        t = (L / 2 - cy) / L
        u = (t - c0) / max(1e-6, c1 - c0)
        if n.z > 0.82:
            return None  # roof stays paint
        if abs(n.x) > 0.55:  # side windows, minus the pillars
            for pt in ([b_t] if b_t is not None else []) + pillars:
                if abs(u - pt) < design.get('pillar_width', 0.035):
                    return None
            if u < 0.04 or u > 0.96:
                return None
            if design.get('opera') and u > 0.72:
                return 'opera' if abs(u - 0.84) < 0.07 else None
            return 'side'
        if n.y > 0.3:
            return 'front'
        if n.y < -0.3:
            return 'rear'
        return None
    groups = {}
    for f in gbm.faces:
        g = classify(f)
        if g:
            groups.setdefault((g, f.normal.x > 0 if g in ('side', 'opera') else 0), []).append(f)
    glass_faces = []
    for key, faces in groups.items():
        res = bmesh.ops.inset_region(gbm, faces=faces, thickness=design.get('frame', 0.045), depth=-0.008)
        glass_faces += faces
    for f in gbm.faces:
        f.material_index = 0
    for f in glass_faces:
        if f.is_valid:
            f.material_index = 1
    green = new_obj('greenhouse', gbm, [M['paint'], M['glass']])
    sm = green.modifiers.new('wn', 'WEIGHTED_NORMAL'); sm.keep_sharp = True

    # --- small retro details
    for d in design.get('details', []):
        kind = d[0]
        if kind == 'louvres':
            t0, t1 = d[1], d[2]
            for i in range(6):
                t = t0 + (t1 - t0) * (i + 0.5) / 6
                top, bot, hw = interp(CABIN, t)
                box('louvre', (hw * HW * 1.55, 0.03, 0.012), (0, y_of(t), top + 0.012), M['trim'], rot=(math.radians(-25), 0, 0))
        elif kind == 'rubstrip':
            mat = M[d[1]] if len(d) > 1 else M['trim']
            t0 = wheelT[0] + (archR[0] + 0.06) / L
            t1 = wheelT[1] - (archR[1] + 0.06) / L
            tm = (t0 + t1) / 2
            top, bot, hw = interp(BODY, tm)
            w = hw * HW * (width_fn(tm) if width_fn else 1)
            for side in (-1, 1):
                box('rub', (0.024, (t1 - t0) * L, 0.045), (side * (w + 0.008), y_of(tm), bot + 0.32 * (top - bot)), mat)
        elif kind == 'grille':
            top, bot, hw = interp(BODY, 0.0)
            box('grille', (hw * HW * d[1], 0.03, (top - bot) * d[2]), (0, L / 2 + 0.005, bot + 0.45 * (top - bot)), M['trim'])
        elif kind == 'busdoors':
            top, bot, hw = interp(BODY, 0.5)
            for t in d[1]:
                box('door', (0.03, 1.1, top - bot - 0.6), (HW + 0.004, y_of(t), bot + (top - bot - 0.6) / 2 + 0.25), M['trim'])
        elif kind == 'sign':  # bus destination board above the windscreen
            top, bot, hw = interp(BODY, 0.0)
            box('sign', (W * 0.7, 0.04, 0.24), (0, L / 2 + 0.02, top - 0.22), M['trim'])

    # --- export (selected meshes, modifiers applied)
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.convert(target='MESH')
    tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
    print('TRIANGLES', tris)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                              export_normals=True, export_texcoords=False, export_materials='EXPORT')
    print('EXPORTED', out)

    if preview:
        for o in list(bpy.context.scene.objects):
            o.select_set(False)
        k = max(1.0, L / 4.6)
        bpy.ops.object.camera_add(location=(4.8 * k, 6.4 * k, 2.4 * k))
        cam = bpy.context.object
        target = Vector((0, 0, 0.55 * k))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.camera = cam
        bpy.ops.object.light_add(type='SUN', location=(4, -3, 6)); bpy.context.object.data.energy = 3.5
        bpy.ops.object.light_add(type='AREA', location=(-4, 3, 4)); bpy.context.object.data.energy = 600; bpy.context.object.data.size = 8
        bpy.ops.mesh.primitive_plane_add(size=60); bpy.context.object.data.materials.append(material('floor', (0.06, 0.04, 0.08), 0, 0.6))
        w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True
        w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.02, 0.1, 1)
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x, sc.render.resolution_y = 960, 540
        sc.render.filepath = preview
        bpy.ops.render.render(write_still=True)
        cam.location = (-5.0 * k, -6.4 * k, 2.4 * k)
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', '_rear.png')
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', preview)

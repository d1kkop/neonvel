"""
Neon Velocity rims: five rim designs modelled for real (lathed barrel with a polished stepped lip, concave tapered
spokes, hub with centre cap and lug nuts). One object per design, named rim_<style>, exported as one .glb.

Conventions: wheel axis = Blender X, outer face +X (glTF keeps X, so the game's +X outer face matches).
Built at real size for a rim radius RR (lip outer radius) and the game's 0.24 m barrel; the game scales Y/Z by
(its rim radius / RR). Materials (the game swaps its own by name): rim, lip, barrel, cap, nut, accent.
Run: blender --background --python tools/blender/rims.py -- <out.glb> [preview.png]
Also importable: build_rim(style) returns the joined object (used by the car previews).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

RR = 0.27
STYLES = ['star5', 'spokes', 'turbofan', 'mesh', 'dish', 'wire']

MAT_DEFS = {
    'rim': ((0.78, 0.8, 0.84), 1.0, 0.18), 'lip': ((0.95, 0.95, 0.97), 1.0, 0.05), 'barrel': ((0.08, 0.08, 0.09), 0.8, 0.45),
    'cap': ((0.03, 0.03, 0.035), 0.4, 0.3), 'nut': ((0.9, 0.9, 0.92), 1.0, 0.1), 'accent': ((0.0, 0.9, 1.0), 0.0, 0.3),
    'rubber': ((0.02, 0.02, 0.022), 0.0, 0.85), 'sidewall': ((0.06, 0.06, 0.065), 0.0, 0.8), 'disc': ((0.35, 0.36, 0.4), 0.9, 0.35),
    'caliper': ((0.85, 0.08, 0.1), 0.3, 0.35),
}


def mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough = MAT_DEFS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if name == 'accent':
        p.inputs['Emission Color'].default_value = (*col, 1)
        p.inputs['Emission Strength'].default_value = 4.0
    return m


def to_obj(name, bm, mats, smooth_angle=40):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in mats:
        me.materials.append(mat(m))
    for p in me.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    except Exception:
        pass
    o.select_set(False)
    return o


def lathe(name, prof, mats, mat_fn, steps=56, smooth_angle=40):
    """prof = [(r, x)] revolved about the X axis; mat_fn(x, r) -> material index."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, r)) for r, x in prof]
    es = [bm.edges.new((a, b)) for a, b in zip(vs, vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.tau, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = mat_fn(c.x, math.hypot(c.y, c.z))
    return to_obj(name, bm, mats, smooth_angle)


def spoke(bm, ang, r0, r1, x0, x1, w0, w1, th, twist=lambda u: 0.0, segs=10, curve=1.6, waist=0.0, chamfer=0.25):
    """A tapered concave spoke from the hub (r0, face at x0) to the lip (r1, face at x1)."""
    rings = []
    for i in range(segs + 1):
        u = i / segs
        r = r0 + (r1 - r0) * u
        x = x0 + (x1 - x0) * (u ** curve)
        w = (w0 + (w1 - w0) * u) * (1.0 - waist * math.sin(math.pi * u))
        a = ang + twist(u)
        er = Vector((0, math.cos(a), math.sin(a)))
        et = Vector((0, -math.sin(a), math.cos(a)))
        ex = Vector((1, 0, 0))
        c = w * chamfer * 0.5
        sec = [(-w / 2, -c), (-w / 2 + c, 0.0), (w / 2 - c, 0.0), (w / 2, -c), (w * 0.36, -th), (-w * 0.36, -th)]
        rings.append([bm.verts.new(er * r + et * t + ex * (x + d)) for t, d in sec])
    n = 6
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def hex_nut(bm, center, r, depth):
    """Lug nut: hexagonal prism along +X with a chamfered top."""
    cx, cy, cz = center
    rings = []
    for x, k in ((cx - depth, 1.0), (cx, 1.0), (cx + depth * 0.25, 0.7)):
        rings.append([bm.verts.new((x, cy + math.cos(i * math.pi / 3) * r * k, cz + math.sin(i * math.pi / 3) * r * k)) for i in range(6)])
    for a, b in zip(rings, rings[1:]):
        for j in range(6):
            bm.faces.new((a[j], a[(j + 1) % 6], b[(j + 1) % 6], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def barrel(name):
    prof = [(RR * 0.86, 0.100), (RR * 0.93, 0.112), (RR * 0.985, 0.121), (RR * 1.015, 0.118), (RR * 1.02, 0.108),
            (RR * 0.985, 0.101), (RR * 0.955, 0.096), (RR * 0.945, 0.05), (RR * 0.86, 0.015), (RR * 0.86, -0.07),
            (RR * 0.95, -0.105), (RR * 1.0, -0.12)]
    return lathe(name, prof, ['lip', 'barrel'], lambda x, r: 0 if (x > 0.097 and r > RR * 0.9) else 1, steps=64, smooth_angle=35)


def hub(name, xh, r_hub=0.34, nuts=5, cap_style='plain'):
    prof = [(0.0, xh + 0.034), (RR * 0.1, xh + 0.034), (RR * 0.125, xh + 0.03), (RR * 0.14, xh + 0.022),
            (RR * 0.2, xh + 0.016), (RR * (r_hub - 0.04), xh + 0.01), (RR * r_hub, xh - 0.004), (RR * r_hub, xh - 0.07), (0.0, xh - 0.07)]
    o = lathe(name, prof, ['cap', 'rim'], lambda x, r: 0 if r < RR * 0.128 else 1, steps=40, smooth_angle=30)
    bm = bmesh.new()
    for i in range(nuts):
        a = i * math.tau / nuts + math.pi / 2
        hex_nut(bm, (xh + 0.03, math.cos(a) * RR * 0.215, math.sin(a) * RR * 0.215), 0.0115, 0.02)
    nuts_o = to_obj(name + '_nuts', bm, ['nut'], 30)
    # Accent ring around the centre cap (the game's neon).
    bpy.ops.mesh.primitive_torus_add(major_radius=RR * 0.128, minor_radius=0.0035, major_segments=40, minor_segments=6,
                                     location=(xh + 0.03, 0, 0), rotation=(0, math.pi / 2, 0))
    ring = bpy.context.object
    ring.data.materials.append(mat('accent'))
    return [o, nuts_o, ring]


def disc_face(name, r0, r1, x0, x1, holes=0, hole_r=0.0, hole_at=0.0, steps=64):
    """A concave solid face (dish / turbofan backing), optionally with round holes."""
    prof = [(RR * r0, x0 - 0.012), (RR * r0, x0), (RR * (r0 + (r1 - r0) * 0.5), x0 + (x1 - x0) * 0.35), (RR * r1, x1), (RR * r1, x1 - 0.015),
            (RR * (r0 + (r1 - r0) * 0.5), x0 + (x1 - x0) * 0.35 - 0.015), (RR * r0, x0 - 0.012)]
    o = lathe(name, prof, ['rim'], lambda x, r: 0, steps=steps, smooth_angle=35)
    for i in range(holes):
        a = i * math.tau / holes
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=RR * hole_r, depth=0.2,
                                            location=(x0, math.cos(a) * RR * hole_at, math.sin(a) * RR * hole_at), rotation=(0, math.pi / 2, 0))
        c = bpy.context.object
        b = o.modifiers.new('h', 'BOOLEAN'); b.object = c; b.operation = 'DIFFERENCE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='h')
        bpy.data.objects.remove(c)
    return o



def wire_hub(name, xh):
    """Wire-wheel centre: spoke flange, polished dome and a two-eared knock-off spinner."""
    prof = [(0.0, xh + 0.105), (RR * 0.06, xh + 0.103), (RR * 0.12, xh + 0.095), (RR * 0.16, xh + 0.08), (RR * 0.17, xh + 0.06),
            (RR * 0.2, xh + 0.05), (RR * 0.235, xh + 0.04), (RR * 0.235, xh + 0.025), (RR * 0.2, xh + 0.02), (RR * 0.2, xh - 0.03),
            (RR * 0.24, xh - 0.035), (RR * 0.24, xh - 0.06), (0.0, xh - 0.06)]
    o = lathe(name, prof, ['lip', 'rim'], lambda x, r: 0 if x > xh + 0.045 else 1, steps=48, smooth_angle=35)
    bm = bmesh.new()
    # Spinner: an octagonal nut with two tapered ears.
    zc = xh + 0.085
    for k in (0, 1):
        a = k * math.pi
        rings = []
        for u, w, t in ((0.0, 0.024, 0.02), (0.6, 0.018, 0.016), (1.0, 0.012, 0.012)):
            r = RR * (0.05 + 0.19 * u)
            c = Vector((zc - 0.006 * u, math.cos(a) * r, math.sin(a) * r))
            et = Vector((0, -math.sin(a), math.cos(a)))
            rings.append([bm.verts.new(c + et * (sx * w / 2) + Vector((sz * t / 2, 0, 0))) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        for ra, rb in zip(rings, rings[1:]):
            for j in range(4):
                bm.faces.new((ra[j], ra[(j + 1) % 4], rb[(j + 1) % 4], rb[j]))
        bm.faces.new(rings[-1])
    rings = []
    for x, k in ((zc - 0.015, 1.0), (zc + 0.012, 1.0), (zc + 0.02, 0.75)):
        rings.append([bm.verts.new((x, math.cos(i * math.tau / 8 + math.pi / 8) * RR * 0.075 * k, math.sin(i * math.tau / 8 + math.pi / 8) * RR * 0.075 * k)) for i in range(8)])
    for ra, rb in zip(rings, rings[1:]):
        for j in range(8):
            bm.faces.new((ra[j], ra[(j + 1) % 8], rb[(j + 1) % 8], rb[j]))
    bm.faces.new(rings[-1])
    spin = to_obj(name + '_spinner', bm, ['nut'], 30)
    return [o, spin]

def build_rim(style):
    parts = [barrel(f'rim_{style}')]
    bm = bmesh.new()
    xh = 0.045  # hub face: ~6 cm behind the lip = deep concave
    if style == 'star5':
        for k in range(5):
            A = k * math.tau / 5
            for s in (-1, 1):
                spoke(bm, A, RR * 0.26, RR * 0.97, xh + 0.006, 0.104, 0.032, 0.04, 0.04,
                      twist=lambda u, s=s: s * (0.035 + 0.115 * u), curve=1.7, waist=0.12)
    elif style == 'spokes':
        for k in range(10):
            spoke(bm, k * math.tau / 10, RR * 0.26, RR * 0.97, xh + 0.006, 0.104, 0.034, 0.028, 0.036,
                  twist=lambda u: 0.06 * u * u, curve=1.5, waist=0.18)
    elif style == 'turbofan':
        xh = 0.075
        parts.append(disc_face(f'rim_{style}_disc', 0.3, 0.97, xh - 0.004, 0.1))
        for k in range(14):
            spoke(bm, k * math.tau / 14, RR * 0.36, RR * 0.9, xh + 0.006, 0.108, 0.018, 0.038, 0.02,
                  twist=lambda u: 0.55 * u, curve=1.2, chamfer=0.35)
    elif style == 'mesh':
        xh = 0.06
        for k in range(16):
            A = k * math.tau / 16
            for s, dx in ((-1, 0.0), (1, -0.006)):
                spoke(bm, A, RR * 0.3, RR * 0.95, xh + 0.006 + dx, 0.1 + dx, 0.011, 0.011, 0.012,
                      twist=lambda u, s=s: s * 0.42 * u, segs=12, curve=1.2, chamfer=0.4)
        bpy.ops.mesh.primitive_torus_add(major_radius=RR * 0.9, minor_radius=0.008, major_segments=64, minor_segments=8,
                                         location=(0.098, 0, 0), rotation=(0, math.pi / 2, 0))
        ring = bpy.context.object
        ring.data.materials.append(mat('rim'))
        parts.append(ring)
    elif style == 'wire':
        # Laced wire wheel: 3 x 24 thin spokes from a small hub flange to the rim, tangential, crossing in three
        # planes (outer pair crosses, inner set laced the other way), chrome dome with a two-eared spinner.
        xh = 0.035
        for k in range(24):
            A = k * math.tau / 24
            for s, x0, x1, ph in ((1, xh + 0.035, 0.1, 0.0), (-1, xh + 0.03, 0.094, 0.5), (1, xh - 0.02, 0.06, 0.25)):
                spoke(bm, A + ph * math.tau / 24, RR * 0.2, RR * 0.95, x0, x1, 0.0062, 0.0052, 0.0058,
                      twist=lambda u, s=s: s * 0.36 * u, segs=4, curve=1.0, chamfer=0.5)
        parts += wire_hub(f'rim_{style}_hub', xh)
    elif style == 'dish':
        xh = 0.09
        parts.append(disc_face(f'rim_{style}_disc', 0.3, 0.97, xh - 0.002, 0.104, holes=8, hole_r=0.12, hole_at=0.6))
    if bm.verts:
        parts.append(to_obj(f'rim_{style}_spokes', bm, ['rim'], 32))
    else:
        bm.free()
    if style != 'wire':
        parts += hub(f'rim_{style}_hub', xh, r_hub=0.36 if style != 'mesh' else 0.33)
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = f'rim_{style}'
    return o


def build_tyre(name, R, rr, width=0.28):
    """Preview tyre: rounded low-profile tyre with a sidewall band (the game builds its own)."""
    h = width / 2
    prof = [(rr * 0.99, -h * 0.9), (rr * 1.05, -h), (R * 0.93, -h * 1.02), (R * 0.985, -h * 0.85), (R, -h * 0.5), (R, h * 0.5),
            (R * 0.985, h * 0.85), (R * 0.93, h * 1.02), (rr * 1.05, h), (rr * 0.99, h * 0.9)]
    return lathe(name, prof, ['rubber', 'sidewall'], lambda x, r: 1 if (abs(x) > h * 0.95 and rr * 1.1 < r < rr * 1.25) else 0, steps=64, smooth_angle=50)


def build_wheel(style, R, location, mirror=False):
    """Complete preview wheel (tyre + rim scaled to the tyre) at a location; mirror for the left side."""
    rr = R * 0.7
    rim = build_rim(style)
    rim.scale = (1, rr / RR, rr / RR)
    tyre = build_tyre(f'tyre_{style}', R, rr)
    for o in (rim, tyre):
        o.location = location
        if mirror:
            o.rotation_euler = (0, 0, math.pi)
    return [rim, tyre]


def studio_world(sc, strength=1.0):
    """Studio environment for previews: dark floor, bright horizon band, soft sky (metals need something to reflect)."""
    w = bpy.data.worlds.new('studio'); sc.world = w; w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.40, (0.015, 0.015, 0.02, 1)
    cr.elements[1].position, cr.elements[1].color = 0.62, (0.25, 0.28, 0.36, 1)
    for pos, col in ((0.495, (0.05, 0.05, 0.06, 1)), (0.505, (1.2, 1.15, 1.1, 1)), (0.53, (0.7, 0.72, 0.8, 1))):
        e = cr.elements.new(pos); e.color = col
    # Z of the view direction (-1..1) -> 0..1
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'; mul.inputs[1].default_value = 0.5; mul.inputs[2].default_value = 0.5
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mul.inputs[0])
    nt.links.new(mul.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else 'rims.glb'
    preview = argv[1] if len(argv) > 1 else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = []
    for i, st in enumerate(STYLES):
        o = build_rim(st)
        o.location = (0, (i - 2.5) * 0.7, 0) if preview else (0, 0, 0)
        objs.append(o)
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    print('TRIANGLES (all rims)', tris, 'avg', tris // len(objs))
    if not preview:
        for o in objs:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                                  export_normals=True, export_texcoords=False, export_materials='EXPORT')
        print('EXPORTED', out)
    else:
        sc = bpy.context.scene
        studio_world(sc)
        bpy.ops.object.light_add(type='AREA', location=(3, 1, 2)); bpy.context.object.data.energy = 300; bpy.context.object.data.size = 3
        bpy.context.object.rotation_euler = (0, math.radians(60), math.radians(20))
        bpy.ops.object.light_add(type='SUN', location=(2, -2, 3)); bpy.context.object.data.energy = 2
        bpy.ops.object.camera_add(location=(5.4, -0.9, 0.5))
        cam = bpy.context.object
        sc.camera = cam
        cam.data.lens = 50
        cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x, sc.render.resolution_y = 1600, 420
        sc.render.filepath = preview
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', preview)

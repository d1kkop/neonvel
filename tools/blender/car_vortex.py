"""
Vortex GT-R — retro 80s notchback sports coupé, modelled procedurally in Blender.

Run headless:  blender --background --python tools/blender/car_vortex.py -- <out.glb> [preview.png]

Matches the game's 'wedge' style dimensions (src/game/car/CarBuilder.ts, after raiseStyle), so the game's own
lights / plate / exhausts / pop-ups line up with this body. Blender +Y = car front (glTF converts it to -Z).
Materials are named so the game can swap in its own: paint, glass, trim, chrome, well.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'vortex.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

# --- dimensions (identical to the game's 'wedge' style, height scale 1.14) --------------------------
L, W = 4.4, 1.86
HW = W / 2
K = 1.14
def lift(rows):
    return [(t, top * K, bot * (1 + (K - 1) * 1.3), hw) for t, top, bot, hw in rows]
BODY = lift([(0.0, 0.5, 0.26, 0.86), (0.03, 0.6, 0.22, 0.97), (0.3, 0.7, 0.21, 1.0), (0.62, 0.78, 0.21, 1.0), (0.95, 0.8, 0.22, 1.0), (1.0, 0.76, 0.3, 0.97)])
CABIN = lift([(0.36, 0.76, 0.7, 0.8), (0.45, 1.06, 0.72, 0.78), (0.68, 1.08, 0.74, 0.77), (0.76, 0.94, 0.75, 0.76), (0.8, 0.8, 0.75, 0.74)])
WHEEL_T = (0.17, 0.81)
WHEEL_R = 0.33 * (1 + (K - 1) * 0.45)
ARCH_R = WHEEL_R + 0.09

def interp(rows, t):
    if t <= rows[0][0]:
        return rows[0][1:]
    for a, b in zip(rows, rows[1:]):
        if t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0])
            k = k * k * (3 - 2 * k)
            return tuple(a[i] + (b[i] - a[i]) * k for i in (1, 2, 3))
    return rows[-1][1:]

def y_of(t):  # loft t (0 nose .. 1 tail) -> Blender Y (front = +Y)
    return L / 2 - t * L

# --- scene + materials ------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
def material(name, color, metal=0.0, rough=0.5, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
    return m
M_PAINT = material('paint', (0.85, 0.82, 0.05), 0.5, 0.35)
M_GLASS = material('glass', (0.02, 0.03, 0.05), 0.9, 0.05)
M_TRIM = material('trim', (0.03, 0.03, 0.035), 0.3, 0.5)
M_CHROME = material('chrome', (0.8, 0.82, 0.86), 1.0, 0.15)
M_WELL = material('well', (0.01, 0.01, 0.012), 0.0, 0.9)

def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    return ob

def loft(rows, profile, n_along, mat_for_face=None):
    """Sweep a creased half-profile (mirrored) along t; returns a closed bmesh."""
    bm = bmesh.new()
    t0, t1 = rows[0][0], rows[-1][0]
    rings = []
    for i in range(n_along + 1):
        t = t0 + (t1 - t0) * i / n_along
        top, bot, hw = interp(rows, t)
        half = profile(top, bot, hw * HW)
        pts = [(-x, z) for x, z in reversed(half[1:-1])] + half  # mirrored, closed ring (left .. right)
        ring = [bm.verts.new((x, y_of(t), z)) for x, z in pts]
        rings.append(ring)
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

# --- body: slab sides with crisp sill / beltline / deck creases ---------------------------------------
def body_profile(top, bot, hw):
    h = top - bot
    sill = bot + 0.09 * h
    belt = bot + 0.66 * h
    return [(0.0, bot), (hw * 0.84, bot), (hw, sill), (hw, belt), (hw * 0.985, belt + 0.035 * h), (hw * 0.9, top), (0.0, top)]

body = new_obj('body', loft(BODY, body_profile, 48), [M_PAINT, M_WELL])

# Squared-off 80s wheel arches: subtract rounded boxes (their faces become the dark wheel wells).
for t, side in [(t, s) for t in WHEEL_T for s in (-1, 1)]:
    # Arch top stays well below the bonnet / deck line, bottom goes under the car.
    top_here = interp(BODY, t)[0]
    z_top = min(WHEEL_R + ARCH_R * 0.95, top_here - 0.14)
    z_bot = -0.3
    bpy.ops.mesh.primitive_cube_add(size=1, location=(side * HW, y_of(t), (z_top + z_bot) / 2))
    cut = bpy.context.object
    cut.scale = (0.75, ARCH_R * 2.05, z_top - z_bot)
    bev = cut.modifiers.new('round', 'BEVEL'); bev.width = ARCH_R * 0.4; bev.segments = 4
    bpy.context.view_layer.objects.active = cut
    bpy.ops.object.modifier_apply(modifier='round')
    cut.data.materials.append(M_WELL)
    b = body.modifiers.new('arch', 'BOOLEAN'); b.object = cut; b.operation = 'DIFFERENCE'; b.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier='arch')
    bpy.data.objects.remove(cut)

# Crisp edges: small angle-limited bevel + weighted normals (flat panels, sharp highlight lines).
bev = body.modifiers.new('crease', 'BEVEL'); bev.limit_method = 'ANGLE'; bev.angle_limit = math.radians(28); bev.width = 0.012; bev.segments = 2
body.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True

# --- greenhouse: glass with a painted roof, B-pillar, chrome window line, rear louvres -----------------
def cabin_profile(top, bot, hw):
    return [(0.0, bot), (hw, bot), (hw * 0.84, top), (0.0, top)]
gbm = loft(CABIN, cabin_profile, 24)
for f in gbm.faces:  # roof faces (pointing up) get paint, the rest is glass
    f.material_index = 1 if f.normal.z > 0.82 else 0
green = new_obj('greenhouse', gbm, [M_GLASS, M_PAINT])

def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(mat)
    return o

mid_t = 0.57
top, bot, hw = interp(CABIN, mid_t)
for s in (-1, 1):
    box('bpillar', (0.02, 0.14, (top - bot) * 0.98), (s * hw * HW * 0.915, y_of(mid_t), (top + bot) / 2), M_PAINT, rot=(0, s * math.atan2(hw * HW * 0.16, top - bot), 0))
# Chrome strip along the bottom of the side windows.
for s in (-1, 1):
    t0, t1 = CABIN[0][0] + 0.02, CABIN[-1][0] - 0.02
    _, bot0, hw0 = interp(CABIN, (t0 + t1) / 2)
    box('windowline', (0.03, (t1 - t0) * L, 0.025), (s * hw0 * HW, y_of((t0 + t1) / 2), bot0 + 0.01), M_CHROME)
# Rear window louvres (very 80s).
t_rw0, t_rw1 = 0.68, 0.79
for i in range(6):
    t = t_rw0 + (t_rw1 - t_rw0) * (i + 0.5) / 6
    top, bot, hw = interp(CABIN, t)
    box('louvre', (hw * HW * 1.55, 0.03, 0.012), (0, y_of(t), top + 0.012), M_TRIM, rot=(math.radians(-25), 0, 0))
# Black rubbing strip along the flanks and a recessed grille panel at the nose.
for s in (-1, 1):
    pts = []
    t0 = WHEEL_T[0] + (ARCH_R + 0.06) / L
    t1 = WHEEL_T[1] - (ARCH_R + 0.06) / L
    tm = (t0 + t1) / 2
    top, bot, hw = interp(BODY, tm)
    box('rubstrip', (0.024, (t1 - t0) * L, 0.05), (s * (hw * HW + 0.008), y_of(tm), bot + 0.32 * (top - bot)), M_TRIM)
top, bot, hw = interp(BODY, 0.0)
box('grille', (hw * HW * 1.3, 0.03, (top - bot) * 0.32), (0, L / 2 + 0.005, bot + 0.45 * (top - bot)), M_TRIM)

# --- export ------------------------------------------------------------------------------------------
for o in bpy.context.scene.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = body
bpy.ops.object.convert(target='MESH')  # apply remaining modifiers
tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
print('TRIANGLES', tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_normals=True, export_texcoords=False, export_materials='EXPORT')
print('EXPORTED', OUT)

if PREVIEW:
    for o in list(bpy.context.scene.objects):
        o.select_set(False)
    bpy.ops.object.camera_add(location=(4.8, 6.4, 2.4))
    cam = bpy.context.object
    cam.data.lens = 50
    d = Vector((0, 0, 0.55)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type='SUN', location=(4, -3, 6)); bpy.context.object.data.energy = 3.5
    bpy.ops.object.light_add(type='AREA', location=(-4, 3, 4)); bpy.context.object.data.energy = 500; bpy.context.object.data.size = 6
    bpy.ops.mesh.primitive_plane_add(size=30); bpy.context.object.data.materials.append(material('floor', (0.06, 0.04, 0.08), 0, 0.6))
    w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.02, 0.1, 1)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    cam.location = (-5.0, -6.4, 2.4)
    cam.rotation_euler = (Vector((0, 0, 0.55)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = PREVIEW.replace('.png', '_rear.png')
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', PREVIEW)

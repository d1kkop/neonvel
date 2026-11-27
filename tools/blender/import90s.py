"""
Turn one car of the bought "90s Sports Cars Pack" (assets-src/cars90s, licensed: never publish the sources)
into a game model.

  blender -b assets-src/cars90s/Car_Pack_Blender/91s_Car_Pack.blend --python tools/blender/import90s.py -- <Object> <out.glb> [lo]

What it does:
  * keeps only that car, turns it nose-forward for the game (glTF -Z) and puts the tyres on the ground (y = 0);
  * splits the wheels off: the front-right and rear-right wheel become the nodes wheel_F / wheel_R (origin at
    the hub, axle along X) that the game spins and steers; the other wheels are deleted;
  * renames the materials to the game's contract: paint (keeps its panel normal map), glass, head / tail
    (the lamp atlas, front half / rear half, so they glow and the tail flares when braking or drifting);
    every other material is prefixed k_ (the game keeps it as authored: interior, underbody, plates...);
  * adds the empties head_L/R, tail_L/R, exhaust_L/R and cabin_skin (see-through glass);
  * keeps the textures at full size (2048 px; 1024 for the light version) and exports a .glb with WebP images
    and MikkTSpace tangents (the baked paint normal maps only shade right with the tangents they were baked with).
"""
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
NAME, OUT = argv[0], argv[1]
LO = len(argv) > 2 and argv[2] == 'lo'
TEX = 1024 if LO else 2048

src = bpy.data.objects[NAME]
for o in list(bpy.data.objects):
    if o is not src:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = src
src.select_set(True)

# Nose forward: the pack's cars point at -X; the game wants the nose at glTF -Z, i.e. Blender +Y.
if src.data.users > 1:
    src.data = src.data.copy()
src.data.transform(src.matrix_world)
src.matrix_world = Matrix.Identity(4)
src.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))

def mat_name(o, idx):
    m = o.material_slots[idx].material if idx < len(o.material_slots) else None
    return m.name if m else ''

is_tyre = lambda n: n.startswith('RB1c_Tire')

# Ground: the lowest tyre vertex. Centre: bounding box in X / Y.
me = src.data
tyre_z = [src.matrix_world @ me.vertices[v].co for p in me.polygons if is_tyre(mat_name(src, p.material_index)) for v in p.vertices]
zmin = min(v.z for v in tyre_z)
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
off = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, zmin))
me.transform(Matrix.Translation(-off))
me.update()

# --- Wheels: tyre centres per quadrant (from the tyre faces), then every loose part inside a wheel's cylinder.
quads = {}
for p in me.polygons:
    if not is_tyre(mat_name(src, p.material_index)):
        continue
    c = p.center
    q = (c.x > 0, c.y > 0)  # (right side, front axle)
    a = quads.setdefault(q, [Vector((1e9,) * 3), Vector((-1e9,) * 3)])
    for vi in p.vertices:
        v = me.vertices[vi].co
        a[0] = Vector(map(min, a[0], v)); a[1] = Vector(map(max, a[1], v))
assert len(quads) == 4, f'expected 4 tyres, found quadrants {list(quads)}'
wheels = {}
for q, (lo, hi) in quads.items():
    c = (lo + hi) / 2
    wheels[q] = dict(c=c, r=(hi.z - lo.z) / 2, xlo=lo.x, xhi=hi.x)

def in_wheel(v, w):
    return (min(w['xlo'], w['xhi']) - 0.03 <= v.x <= max(w['xlo'], w['xhi']) + 0.03
            and math.hypot(v.y - w['c'].y, v.z - w['c'].z) <= w['r'] * 1.02)

def split_faces(obj, pick, name):
    """Move the faces pick(face) is true for into their own object (returns it, or None)."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
    n = 0
    for p in obj.data.polygons:
        p.select = pick(obj, p)
        n += p.select
    if not n:
        return None
    before = set(bpy.data.objects)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    new = (set(bpy.data.objects) - before).pop()
    new.name = name
    return new

for q, axle in (((True, True), 'F'), ((True, False), 'R'), ((False, True), 'xF'), ((False, False), 'xR')):
    w = wheels[q]
    o = split_faces(src, lambda ob, p: all(in_wheel(ob.data.vertices[i].co, w) for i in p.vertices), f'wheel_{axle}')
    assert o, f'no wheel faces for {axle}'
    if axle.startswith('x'):
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    o.data.transform(Matrix.Translation(-w['c']))
    o.location = w['c'].copy()
    for p in o.data.polygons:
        p.use_smooth = True
body = src
body.name = 'body'

# --- Materials.
def clone_named(m, name):
    c = m.copy(); c.name = name
    return c

slots = body.material_slots
lamp_slot = {}
for i, s in enumerate(slots):
    m = s.material
    if not m:
        continue
    n = m.name.split('.')[0]
    if n.startswith('MI_CarPaint'):
        s.material = clone_named(m, 'paint')
    elif n.startswith('M_Glass_Master') or n.startswith('MI_Glass_Clear'):
        s.material = clone_named(m, 'glass')
    elif n == 'UCB_Lights_and_Glass':
        lamp_slot[i] = m
    else:
        s.material = clone_named(m, 'k_' + n)
for w in (bpy.data.objects['wheel_F'], bpy.data.objects['wheel_R']):
    for s in w.material_slots:
        if s.material and not s.material.name.startswith('k_'):
            s.material = clone_named(s.material, 'k_' + s.material.name.split('.')[0])

# Lamp atlas: front half -> head, rear half -> tail (both keep the texture; the game makes them glow).
heads, tails = [], []
if lamp_slot:
    (li, lm), = list(lamp_slot.items())[:1]
    slots[li].material = clone_named(lm, 'head')
    body.data.materials.append(clone_named(lm, 'tail'))
    ti = len(body.material_slots) - 1
    for p in body.data.polygons:
        if p.material_index == li:
            c = p.center
            if c.y < 0:
                p.material_index = ti
                tails.append(c.copy())
            else:
                heads.append(c.copy())

def lamp_point(pts, side, front):
    sel = [p for p in pts if (p.x > 0) == (side > 0)]
    if not sel:
        return None
    # The main lamps sit highest: drop fog / bumper lamps (the lower part of the lamp faces).
    zs = sorted(p.z for p in sel)
    zcut = zs[len(zs) // 2] if front else zs[len(zs) // 4]
    sel = [p for p in sel if p.z >= zcut] or sel
    c = sum(sel, Vector()) / len(sel)
    edge = max(p.y for p in sel) if front else min(p.y for p in sel)
    return Vector((c.x, edge, c.z))

ys = [v.co.y for v in body.data.vertices]
xs = [v.co.x for v in body.data.vertices]
hw = max(abs(min(xs)), max(xs))
def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
for side, tag in ((-1, 'L'), (1, 'R')):
    h = lamp_point(heads, side, True) or Vector((side * hw * 0.7, max(ys), 0.65))
    t = lamp_point(tails, side, False) or Vector((side * hw * 0.7, min(ys), 0.8))
    empty(f'head_{tag}', h)
    empty(f'tail_{tag}', t)
    empty(f'exhaust_{tag}', Vector((side * hw * 0.42, min(ys) + 0.08, 0.28)))
empty('cabin_skin', Vector((0, 0, 1.0)))

# --- Light version: fewer triangles (keeps UV seams).
if LO:
    for o in [bpy.data.objects['body'], bpy.data.objects['wheel_F'], bpy.data.objects['wheel_R']]:
        d = o.modifiers.new('dec', 'DECIMATE')
        d.ratio = 0.45 if o.name == 'body' else 0.35
        d.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
        bpy.ops.object.modifier_apply(modifier='dec')

# --- Textures: smaller, and only what is used.
used = set()
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for s in o.material_slots:
        if s.material and s.material.use_nodes:
            for n in s.material.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image:
                    used.add(n.image)
for img in used:
    w, h = img.size
    if max(w, h) > TEX:
        k = TEX / max(w, h)
        img.scale(max(1, int(w * k)), max(1, int(h * k)))

tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
print(f'IMPORT90 {NAME} tris={tris} wheels F r={wheels[(True, True)]["r"]:.3f} at {tuple(round(v, 3) for v in wheels[(True, True)]["c"])} '
      f'R r={wheels[(True, False)]["r"]:.3f} at {tuple(round(v, 3) for v in wheels[(True, False)]["c"])} '
      f'len={max(ys) - min(ys):.2f} width={2 * hw:.2f} heads={len(heads)} tails={len(tails)}')

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
    export_image_format='WEBP', export_image_quality=88, export_materials='EXPORT', export_extras=False,
    export_tangents=True,
)

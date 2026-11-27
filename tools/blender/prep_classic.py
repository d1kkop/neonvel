"""
Prepare the Classic Vehicle Set car (exported from Unreal by tools/unreal/export_classic.py) for the normal car build:
puts it into one .blend in the same shape as the 90s pack (one object, nose at -X, metres, materials named the way
tools/blender/import90s.py expects), so `node tools/build-cars.mjs classic` builds it like the other cars.

  blender -b --python tools/blender/prep_classic.py
Output: assets-src/classicvehicle/classic.blend (object "Classic")
"""
import bpy, math, os
from mathutils import Matrix, Vector

SRC = 'E:/Projects/RetroGame/assets-src/classicvehicle/'
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=SRC + 'meshes/' + name + '.fbx')
    return [o for o in set(bpy.data.objects) - before if o.type == 'MESH']


body = load('SM_Car_02a_Merged')
glass = load('SM_Car02_Body_Glass') + load('SM_Car02_LeftDoor_Glass') + load('SM_Car02_RightDoor_Glass')
for o in body + glass:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# The glass panes are very dense (curved, double-sided): thin them out.
for o in glass:
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = 0.2
    bpy.context.view_layer.objects.active = o; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')

# Wheels: the merged model's tyres are very low-poly (~215 faces, visibly not round). Find them, cut out everything
# inside each wheel (tyre, rim, brake) and put the detailed tyre mesh of the set (SM_Car02_Tyre) there instead.
import bmesh
merged = body[0]
bm = bmesh.new(); bm.from_mesh(merged.data); bm.faces.ensure_lookup_table()
seen, wheels = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, part = [f], []
    seen.add(f.index)
    while stack:
        g = stack.pop(); part.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index); stack.append(h)
    vs = {v for g in part for v in g.verts}
    lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
    hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
    d = hi - lo
    if 0.45 < d.z < 0.9 and abs(d.x - d.z) < 0.08 and d.y < 0.4 and lo.z < 0.1 and len(part) > 150:
        wheels.append(dict(c=(lo + hi) / 2, r=d.z / 2, w=d.y))
assert len(wheels) == 4, f'found {len(wheels)} tyres'
kill = []
for f in bm.faces:
    for w in wheels:
        if all(abs(v.co.y - w['c'].y) <= w['w'] / 2 + 0.06 and (Vector((v.co.x, v.co.z)) - Vector((w['c'].x, w['c'].z))).length <= w['r'] * 1.03 for v in f.verts):
            kill.append(f); break
bmesh.ops.delete(bm, geom=kill, context='FACES')
# The merged model's wheels do not sit in the middle of the wheel arches (Unreal places them with its rig).
# Corrections set by eye in the game (user, 2026-11-27), from the merged wheel positions (Unreal +X = front):
# rear 6 cm back (first 10, then 4 cm forward again) and 5 cm higher in its arch, front 4 cm forward and 1.5 cm higher. "Higher in the arch" = the
# body sits that much lower over that axle (the tyres stay on the road).
FRONT_DX, REAR_DX = 0.04, -0.06
FRONT_DROP, REAR_DROP = 0.015, 0.05
fx = rx = 0.0
for w in wheels:
    if w['c'].x > 0: w['c'].x += FRONT_DX; fx = w['c'].x
    else: w['c'].x += REAR_DX; rx = w['c'].x
for v in bm.verts:
    k = min(1.0, max(0.0, (v.co.x - rx) / (fx - rx)))  # 0 at the rear axle, 1 at the front axle
    v.co.z -= REAR_DROP + (FRONT_DROP - REAR_DROP) * k
bm.to_mesh(merged.data); bm.free()

tyre_src = load('SM_Car02_Tyre')
for o in tyre_src:
    bpy.context.view_layer.objects.active = o; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')
for o in tyre_src: o.select_set(True)
bpy.context.view_layer.objects.active = tyre_src[0]
if len(tyre_src) > 1: bpy.ops.object.join()
tyre_obj = bpy.context.view_layer.objects.active
tm = tyre_obj.data
vs = [v.co for v in tm.vertices]
tlo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))); thi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
tm.transform(Matrix.Translation(-(tlo + thi) / 2))
dims = thi - tlo
axle = min(range(3), key=lambda i: dims[i])
if axle == 0: tm.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
elif axle == 2: tm.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
tyre_mat = tyre_obj.material_slots[0].material.copy() if tyre_obj.material_slots and tyre_obj.material_slots[0].material else bpy.data.materials.new('TyreSrc')
tyre_mat.name = 'TyreSrc'
for s in tyre_obj.material_slots: s.material = tyre_mat
radius = max(dims) / 2
# Outer face: the side of the axle where the rim face sits has more of the mesh's area; mirror for the other side.
ys = [v.co.y for v in tm.vertices]
outer_sign = 1 if sum(ys) / len(ys) > 0 else -1
for w in wheels:
    o = tyre_obj.copy(); o.data = tm.copy(); bpy.context.scene.collection.objects.link(o)
    k = w['r'] / radius
    side = 1 if w['c'].y > 0 else -1
    o.data.transform(Matrix.Diagonal((k, k * (1 if side == outer_sign else -1), k, 1)))
    if side != outer_sign:
        o.data.flip_normals()
    o.data.transform(Matrix.Translation(w['c']))
    body.append(o)
bpy.data.objects.remove(tyre_obj, do_unlink=True)
print('PREP_CLASSIC wheels', [(tuple(round(v, 3) for v in w['c']), round(w['r'], 3)) for w in wheels], 'tyre axle', 'xyz'[axle], 'outer', outer_sign)

# One object.
bpy.ops.object.select_all(action='DESELECT')
for o in body + glass:
    o.select_set(True)
bpy.context.view_layer.objects.active = body[0]
bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
car.name = 'Classic'

# Nose: Unreal +X -> the pack's -X.
car.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
car.data.update()

# Materials: the names import90s.py maps (paint / glass / lamps / tyres), textures wired from the exported PNGs.
TEX = {'MI_Car_02a': 'T_Car_02a', 'MI_Car_02b': 'T_Car_02b', 'MI_Car_02c': 'T_Car_02c', 'MI_Car_02d': 'T_Car_02d',
       'MI_Car_Engine_01a': 'T_Car_Engine_01a', 'MI_All_Lights_01a': 'T_All_Lights'}
RENAME = {'MI_Car_02a': 'MI_CarPaint_Classic', 'MI_All_Lights_01a': 'UCB_Lights_and_Glass'}


def wire(m, base):
    m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) or nt.nodes.new('ShaderNodeBsdfPrincipled')
    def img(suffix, non_color):
        p = f'{SRC}textures/{base}_{suffix}.png'
        if not os.path.exists(p):
            return None
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(p)
        if non_color:
            t.image.colorspace_settings.name = 'Non-Color'
        return t
    d = img('D', False)
    if d: nt.links.new(d.outputs['Color'], b.inputs['Base Color'])
    n = img('N', True)
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    orm = img('ORM', True)
    if orm:
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])


for s in car.material_slots:
    m = s.material
    if not m:
        continue
    key = m.name.split('.')[0]
    if key in TEX:
        wire(m, TEX[key])
    if key.startswith('MI_Glass') or 'Glass' in key:
        m.name = 'M_Glass_Master_Classic'
    elif key in RENAME:
        m.name = RENAME[key]

# Tyres: the detailed tyre mesh's material (import90s finds the wheels by the RB1c_Tire name).
for s in car.material_slots:
    if s.material and s.material.name.startswith('TyreSrc'):
        wire(s.material, 'T_Car_02c')
        s.material.name = 'RB1c_Tire_Classic'

out = SRC + 'classic.blend'
for o in list(bpy.data.objects):
    if o is not car:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
print('PREP_CLASSIC saved', out, 'tris', sum(len(p.vertices) - 2 for p in car.data.polygons), 'materials', [s.material.name for s in car.material_slots if s.material])

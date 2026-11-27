"""
Prepare the Super Car "Phoenix" (LVLXP, Fab, Unreal-only; exported by tools/unreal/export_phoenix.py) for the normal
car build: one object, nose at -X, metres, materials named the way tools/blender/import90s.py expects
(paint / glass / one lamp material split front-back into head + tail / RB1c_Tire* for the wheels).

  blender -b --python tools/blender/prep_phoenix.py
Output: assets-src/phoenix/phoenix.blend (object "SuperPhoenix")
"""
import bpy, math, os, re
from mathutils import Matrix

SRC = 'E:/Projects/RetroGame/assets-src/phoenix/'
bpy.ops.wm.read_factory_settings(use_empty=True)
# The skeletal mesh, not SM_Super_Phoenix: the static one is the showroom pose (doors, bonnet and engine lid open).
# The rig's rest pose has everything shut: bake that pose in and drop the rig.
bpy.ops.import_scene.fbx(filepath=SRC + 'meshes/SKM_Super_Phoenix.fbx')
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE']
parts = [o for o in bpy.data.objects if o.type == 'MESH']
for a in arm: a.data.pose_position = 'REST'
bpy.context.view_layer.update()
for o in parts:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for a in arm: bpy.data.objects.remove(a, do_unlink=True)
# The model is ~10% larger than the other bought cars (5.44 m): bring it to their size (~5.06 m).
SCALE = 0.93
for o in parts: o.data.transform(Matrix.Scale(SCALE, 4))
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
if len(parts) > 1: bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
car.name = 'SuperPhoenix'
for o in list(bpy.data.objects):
    if o is not car: bpy.data.objects.remove(o, do_unlink=True)

# Nose: Unreal +X -> the pack's -X.
car.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
for p in car.data.polygons: p.use_smooth = True
car.data.update()


def wire(m, color=None, normal=None, rough=None, rgb=None):
    """Plain PBR wiring from the exported PNGs (or a flat colour)."""
    m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) or nt.nodes.new('ShaderNodeBsdfPrincipled')
    def img(name, non_color):
        p = f'{SRC}textures/{name}.png'
        if not name or not os.path.exists(p) or os.path.getsize(p) < 100: return None
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(p)
        if non_color: t.image.colorspace_settings.name = 'Non-Color'
        return t
    if rgb: b.inputs['Base Color'].default_value = (*rgb, 1)
    c = img(color, False)
    if c: nt.links.new(c.outputs['Color'], b.inputs['Base Color'])
    n = img(normal, True)
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    r = img(rough, True)
    if r:  # through a channel split: the glTF exporter only packs roughness from a separated channel
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(r.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])


# The skeletal mesh's FBX carries the slot names, not the material names.
ALIAS = {'CarPaint': 'MI_CarMaterial_Red', 'CarPaint2': 'MI_CarMaterial_BlackTotal', 'Glass': 'M_Windshield', 'Windows': 'M_Windshield',
         'WhiteLight': 'M_FrontLight', 'RedLight': 'M_RedLight', 'Tire': 'M_Tire', 'TireSide': 'M_TireSide', 'Seat': 'M_Seat',
         'SetBelt_Texture': 'M_SetBelt', 'Pedals': 'M_Pedals', 'Speedometer': 'M_Speedometer', 'LicensePlate': 'M_Licence_Plate',
         'Left_SignLight': 'M_Left_SingLight', 'Right_SignLight': 'M_Right_SingLight', 'GreyColor': 'M_Gray_Color', 'Rim': 'M_Gray_Color',
         'Disk': 'M_Gray_Color', 'Egine': 'M_Gray_Color', 'Egine2': 'M_Black_Color', 'BlackColor': 'M_Black_Color', 'BottonColor': 'M_Black_Color',
         'InteriorColor': 'M_Black_Color', 'Breake': 'M_Brake', 'Mirror': 'M_Mirror'}
# Image nodes the FBX brought along whose file is not there (they exported as textures without an image).
for m in bpy.data.materials:
    if m.node_tree:
        for n in list(m.node_tree.nodes):
            if n.type == 'TEX_IMAGE' and (not n.image or n.image.size[0] == 0):
                m.node_tree.nodes.remove(n)
lamp = None
for s in car.material_slots:
    m = s.material
    if not m: continue
    key = re.sub(r'(_\d+)?(\.\d+)?$', '', m.name)
    key = ALIAS.get(key, key)
    if key == 'MI_CarMaterial_Red':
        m.name = 'MI_CarPaint_Phoenix'
    elif key == 'MI_CarMaterial_BlackTotal':
        wire(m, rgb=(0.02, 0.02, 0.022)); m.name = 'Phoenix_Black'
    elif key == 'M_Windshield':
        m.name = 'M_Glass_Master_Phoenix'
    elif key in ('M_FrontLight', 'M_RedLight'):
        # import90s takes one lamp material and splits it: front half -> head (glows), rear half -> tail (brakes).
        if lamp is None:
            lamp = m; m.name = 'UCB_Lights_and_Glass'
        s.material = lamp
    elif key == 'M_Tire':
        wire(m, None, 'T_Tire_Normal', 'T_Tire_Roughness', rgb=(0.035, 0.035, 0.038)); m.name = 'RB1c_Tire_Phoenix'
    elif key == 'M_TireSide':
        wire(m, None, None, 'T_TireSide_Roughness', rgb=(0.03, 0.03, 0.033)); m.name = 'RB1c_Tire_PhoenixSide'
    elif key == 'M_Seat':
        wire(m, 'T_Seat_Color', 'T_Seat_Normal', 'T_Seat_Roughness')
    elif key == 'M_SetBelt':
        wire(m, 'T_SeatBelt_Color', 'T_SeatBelt_Normal', 'T_SeatBelt_Roughness')
    elif key == 'M_Pedals':
        wire(m, 'T_Pedals_Color', 'T_Pedals_Normal', 'T_Pedals_Roughness')
    elif key == 'M_Speedometer':
        wire(m, 'T_Speedometer')
    elif key == 'M_Licence_Plate':
        wire(m, 'T_License_Plate_Logo', rgb=(0.9, 0.9, 0.9))
    elif key in ('M_Left_SingLight', 'M_Right_SingLight'):
        wire(m, rgb=(1.0, 0.45, 0.05))
    elif key == 'M_Gray_Color':
        wire(m, rgb=(0.35, 0.35, 0.37))
    elif key == 'M_Black_Color':
        wire(m, rgb=(0.025, 0.025, 0.028))
    elif key == 'M_Brake':
        wire(m, rgb=(0.5, 0.05, 0.03))
    elif key == 'M_Mirror':
        wire(m, rgb=(0.8, 0.8, 0.82))

out = SRC + 'phoenix.blend'
bpy.ops.wm.save_as_mainfile(filepath=out)
vs = [v.co for v in car.data.vertices]
size = [round(max(v[i] for v in vs) - min(v[i] for v in vs), 3) for i in range(3)]
print('PREP_PHOENIX saved', out, 'tris', sum(len(p.vertices) - 2 for p in car.data.polygons), 'size', size,
      'materials', sorted({s.material.name for s in car.material_slots if s.material}))

"""
Export the Classic Vehicle Set (Fab, Unreal-only) out of an Unreal project into FBX + PNG, so Blender can build a game model.
Run headless:
  UnrealEditor-Cmd.exe <project.uproject> -run=pythonscript -script="<this file>" -unattended -nop4 -nosplash -nullrhi
Output: E:/Projects/RetroGame/assets-src/classicvehicle/ (meshes/*.fbx, textures/*.png, materials.txt)
"""
import os
import unreal

SRC = '/Game/ClassicVehicleSet_V2/CarsSet'
OUT = 'E:/Projects/RetroGame/assets-src/classicvehicle'
os.makedirs(OUT + '/meshes', exist_ok=True)
os.makedirs(OUT + '/textures', exist_ok=True)

reg = unreal.AssetRegistryHelpers.get_asset_registry()
assets = reg.get_assets_by_path(SRC, recursive=True)
lines = []


def export(obj, filename, options=None):
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = filename
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    if options:
        task.options = options
    ok = unreal.Exporter.run_asset_export_task(task)
    unreal.log(f'EXPORT {"ok" if ok else "FAILED"} {filename}')
    return ok


fbx = unreal.FbxExportOption()
fbx.collision = False
fbx.level_of_detail = False
fbx.vertex_color = True

for a in assets:
    cls = str(a.asset_class_path.asset_name)
    name = str(a.asset_name)
    path = str(a.package_name) + '.' + name
    if cls == 'StaticMesh':
        mesh = unreal.load_asset(path)
        if not os.path.exists(f'{OUT}/meshes/{name}.fbx'):
            export(mesh, f'{OUT}/meshes/{name}.fbx', fbx)
        mats = [str(m.material_interface.get_path_name()) if m.material_interface else '-' for m in mesh.static_materials]
        slots = [str(m.material_slot_name) for m in mesh.static_materials]
        lines.append(f'MESH {name} tris={mesh.get_num_triangles(0)} slots={list(zip(slots, mats))}')
    elif cls == 'SkeletalMesh':
        lines.append(f'SKEL {name} (skipped: the driving rig crashes the headless exporter and is not needed)')
    elif cls == 'Texture2D':
        tex = unreal.load_asset(path)
        export(tex, f'{OUT}/textures/{name}.png')
    elif cls in ('MaterialInstanceConstant',):
        mi = unreal.load_asset(path)
        texs = [(str(p.parameter_info.name), str(p.parameter_value.get_name()) if p.parameter_value else '-') for p in mi.texture_parameter_values]
        vecs = [(str(p.parameter_info.name), (round(p.parameter_value.r, 3), round(p.parameter_value.g, 3), round(p.parameter_value.b, 3))) for p in mi.vector_parameter_values]
        scal = [(str(p.parameter_info.name), round(p.parameter_value, 3)) for p in mi.scalar_parameter_values]
        parent = mi.parent.get_name() if mi.parent else '-'
        lines.append(f'MATI {name} parent={parent} tex={texs} vec={vecs} scalar={scal}')
    elif cls == 'Material':
        lines.append(f'MAT {name}')

with open(OUT + '/materials.txt', 'w', encoding='utf8') as f:
    f.write('\n'.join(lines))
unreal.log(f'EXPORT DONE {len(lines)} entries')

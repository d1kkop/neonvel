import unreal
skm = unreal.load_asset('/Game/Super_Phoenix/Meshes/SKM_Super_Phoenix.SKM_Super_Phoenix')
skel = skm.skeleton
unreal.log('SKMINFO mats ' + str([str(m.material_slot_name) for m in skm.materials]))
task = unreal.AssetExportTask()
task.object = skm
task.filename = 'E:/Projects/RetroGame/assets-src/phoenix/meshes/SKM_Super_Phoenix.fbx'
task.automated = True; task.prompt = False; task.replace_identical = True
o = unreal.FbxExportOption(); o.collision = False; o.level_of_detail = False; o.export_morph_targets = False
task.options = o
ok = unreal.Exporter.run_asset_export_task(task)
unreal.log('SKMEXPORT ' + str(ok))

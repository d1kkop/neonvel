import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib4 import Car4

# Midnight Cruiser — v5: long, low 80s luxury GT (period spirit, no real design copied). Long flat bonnet, slim
# rectangular lamps over a low egg-crate grille, a fastback roof that falls in one line to a short deck, body-colour
# bumpers, a full-width tail-lamp band. Clearly a different shape from the upright Thunder 454 muscle car.
c = Car4('gt', dict(
    subdiv=3, sculpt=dict(arch=0.04, waist=0.025, side=0.03, fender=0.025, tumble=0.86),
    preview_color=(0.05, 0.04, 0.16), rim='mesh',
    keys=[
        dict(t=0.00, zb=0.28, hw=0.95, zw=0.52, scoop=0.0, sh=0.985, zsh=0.74, fx=0.96, zf=0.78, vx=0.86, zv=0.785, gb=0.60, zg=0.785, rw=0.30, zr=0.79, crown=0.004),
        dict(t=0.03, zb=0.24, hw=0.99, zsh=0.80, fx=0.965, zf=0.83, vx=0.88, zv=0.835, zg=0.835, zr=0.84, crown=0.006),
        dict(t=0.33, zb=0.23, zf=0.86, zv=0.865, zg=0.865, zr=0.87, crown=0.01),
        dict(t=0.385, gb=0.80, zg=0.885, rw=0.74, zr=0.895),
        dict(t=0.47, gb=0.82, zg=0.89, rw=0.70, zr=1.23, crown=0.03),
        dict(t=0.60, zr=1.21),
        dict(t=0.72, gb=0.80, zg=0.895, rw=0.62, zr=1.11, crown=0.025),
        dict(t=0.82, gb=0.72, zg=0.90, rw=0.48, zr=0.99, crown=0.015),
        dict(t=0.88, gb=0.60, zg=0.905, rw=0.30, zr=0.93, crown=0.01),
        dict(t=0.98, zb=0.27, zf=0.88, zv=0.885, zg=0.89, zr=0.895),
        dict(t=1.00, zb=0.32, hw=0.965, zsh=0.78, zf=0.85, zv=0.85, zg=0.85, zr=0.855, crown=0.004),
    ],
    cabin=dict(ws=(0.39, 0.47), side=(0.472, 0.70), rear=(0.705, 0.86)),
    pillars=[0.61], pillar_w=0.014,
    doors=(0.39, 0.62), bonnet=(0.03, 0.365), bonnet_w=0.82, bonnet_front=True, boot=(0.885, 0.985), boot_w=0.8,
    cage_along=64, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.9, crease_belt=0.8, end_crease=0.95,
    nose_kx=0.94, nose_kz=0.92, nose_dt=0.006, tail_kx=0.94, tail_kz=0.92, tail_dt=0.006, smooth_angle=35,
))
c.body()
c.retro_grille('eggcrate', w=0.62, h=0.12, z=0.5)
c.retro_lamps('wide_rect', x=0.64, z=0.6, w=0.27, h=0.075)
c.bumper3('front', 'body', z=0.36, h=0.12)
c.bumper3('rear', 'body', z=0.38, h=0.12)
c.tail_lamp_strip(z=0.7, drop=0.1)
c.plate3('rear', z=0.53)
c.exhausts3(2, x=0.52, r=0.05, z=0.26)
c.side_strip(0.5, 0.08, 0.94)
c.retro_mirrors(0.41)
c.finish()

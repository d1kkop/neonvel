import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Pocket Rocket — v3 80s hot hatch: upright box with a tall glasshouse, big rectangular lamps either side of a
# slatted grille, chunky black bumpers, side air intakes ahead of the rear wheels, roof spoiler over a
# near-vertical hatch, square tail lamps.
c = Car3('hatch', dict(
    preview_color=(1.0, 0.25, 0.1), rim='dish',
    keys=[
        dict(t=0.00, zb=0.28, hw=0.93, zw=0.50, scoop=0.0, sh=0.98, zsh=0.75, fx=0.95, zf=0.79, vx=0.85, zv=0.795, gb=0.60, zg=0.795, rw=0.30, zr=0.80, crown=0.004),
        dict(t=0.03, zb=0.24, hw=0.98, zsh=0.80, fx=0.96, zf=0.85, vx=0.86, zv=0.855, zg=0.855, zr=0.86, crown=0.008),
        dict(t=0.17, hw=1.0, zsh=0.83, zf=0.88, zv=0.885, zg=0.885, zr=0.89),
        dict(t=0.28, zf=0.90, zv=0.90, zg=0.90, zr=0.905, crown=0.012),
        dict(t=0.30, gb=0.80, zg=0.915, rw=0.74, zr=0.925),
        dict(t=0.42, gb=0.82, zg=0.93, rw=0.70, zr=1.36, crown=0.03),
        dict(t=0.86, zr=1.36),
        dict(t=0.90, zr=1.35),
        dict(t=0.97, zsh=0.86, zf=0.93, zv=0.95, gb=0.80, zg=0.96, rw=0.74, zr=0.98, crown=0.012),
        dict(t=1.00, zb=0.32, hw=0.97, zsh=0.86, zf=0.93, vx=0.86, zv=0.95, gb=0.70, zg=0.955, rw=0.50, zr=0.96, crown=0.004),
    ],
    cabin=dict(ws=(0.305, 0.42), side=(0.422, 0.88), rear=(0.892, 0.962)),
    pillars=[0.6], pillar_w=0.016, pillar_mat='trim',
    doors=(0.31, 0.6), bonnet=(0.03, 0.29), bonnet_w=0.78, bonnet_front=True,
    cage_along=36, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.9, crease_belt=0.8, end_crease=0.9,
    nose_kx=0.94, nose_kz=0.92, nose_dt=0.006, tail_kx=0.95, tail_kz=0.93, tail_dt=0.005, smooth_angle=35,
))
c.body()
c.retro_lamps('wide_rect', x=0.6, z=0.66, w=0.3, h=0.13)
c.retro_grille('slats', w=0.5, h=0.12, z=0.66, frame=None)
c.bumper3('front', 'black', z=0.37, h=0.16, proud=0.05)
c.bumper3('rear', 'black', z=0.4, h=0.16, proud=0.05)
c.retro_tails('quad', z=0.74, h=0.11, x=0.72)
c.plate3('rear', z=0.57)
c.exhausts3(2, x=0.5, r=0.045, z=0.26)
c.side_scoops(t=0.7, z=0.6, size=(0.3, 0.28, 0.16), fins=0)
c.side_strip(0.46, 0.06, 0.94, mat='rubber', h=0.04)
c.ducktail(0.89, h=0.04)
c.retro_mirrors(0.33, square=False)
c.finish()

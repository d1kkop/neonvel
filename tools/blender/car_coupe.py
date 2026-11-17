import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Velvet Coupe — v3 curvy 70s Italian GT: fenders standing proud of a low bonnet, single round lamps, small
# egg-crate grille, slim chrome blade bumpers, long sweeping fastback, quad round tail lamps.
c = Car3('coupe', dict(
    preview_color=(1.0, 0.17, 0.84), rim='spokes',
    keys=[
        dict(t=0.00, zb=0.30, hw=0.86, zw=0.45, scoop=0.0, sh=0.95, zsh=0.60, fx=0.88, zf=0.66, vx=0.72, zv=0.68, gb=0.50, zg=0.69, rw=0.25, zr=0.695, crown=0.01),
        dict(t=0.05, zb=0.26, hw=0.96, zw=0.48, zsh=0.70, fx=0.92, zf=0.79, vx=0.76, zv=0.76, zg=0.755, zr=0.76, crown=0.012),
        dict(t=0.19, hw=1.0, zw=0.50, zsh=0.78, fx=0.93, zf=0.88, vx=0.74, zv=0.82, zg=0.80, zr=0.805, crown=0.015),
        dict(t=0.36, zf=0.86, vx=0.76, zv=0.85, gb=0.52, zg=0.84, rw=0.30, zr=0.85),
        dict(t=0.385, gb=0.78, zg=0.87, rw=0.68, zr=0.88),
        dict(t=0.48, gb=0.80, zg=0.88, rw=0.58, zr=1.22, crown=0.04),
        dict(t=0.58, zr=1.23),
        dict(t=0.64, rw=0.56, zr=1.20),
        dict(t=0.79, hw=1.02, zsh=0.82, zf=0.92, vx=0.78, zv=0.91, gb=0.66, zg=0.92, rw=0.50, zr=0.99, crown=0.03),
        dict(t=0.90, gb=0.55, zg=0.90, rw=0.35, zr=0.93, crown=0.02),
        dict(t=0.98, zb=0.28, hw=0.98, zf=0.88, zv=0.88, zg=0.885, zr=0.89),
        dict(t=1.00, zb=0.34, hw=0.90, zsh=0.78, zf=0.82, zv=0.83, zg=0.83, zr=0.835, crown=0.01),
    ],
    cabin=dict(ws=(0.39, 0.48), side=(0.482, 0.64), rear=(0.645, 0.87)),
    doors=(0.39, 0.62), bonnet=(0.05, 0.37), bonnet_w=0.6,
    cage_along=38, crease_sill=0.6, crease_shoulder=0.35, crease_fender=0.3, crease_belt=0.4, end_crease=0.5,
    nose_kx=0.8, nose_kz=0.8, nose_dt=0.015, tail_kx=0.85, tail_kz=0.85, tail_dt=0.01, smooth_angle=45,
))
c.body()
c.retro_lamps('round', x=0.6, z=0.58, h=0.18)
c.retro_grille('eggcrate', w=0.42, h=0.14, z=0.47)
c.bumper3('front', 'chrome', z=0.37, h=0.06, proud=0.04, kx=0.9, wrap=0.3)
c.bumper3('rear', 'chrome', z=0.42, h=0.06, proud=0.04, kx=0.9, wrap=0.3)
c.retro_tails('round4', z=0.66, h=0.12, x=0.62)
c.plate3('rear', z=0.53)
c.exhausts3(2, x=0.36, r=0.04, z=0.28, dual=True)
c.side_strip(0.52, 0.08, 0.92, h=0.014)
c.retro_mirrors(0.4, square=False)
c.finish()

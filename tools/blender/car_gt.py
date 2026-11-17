import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Midnight Cruiser — v3: square-rigged 80s turbo coupe (period spirit, no real design copied). Flat bonnet with a
# turbo bulge, chrome waterfall grille between quad rectangular lamps, formal near-upright rear window under a
# vinyl roof, B-pillar, chrome wrap-around bumpers and a full-width ribbed tail-lamp band.
c = Car3('gt', dict(
    preview_color=(0.025, 0.025, 0.03), rim='mesh',
    keys=[
        dict(t=0.00, zb=0.30, hw=0.95, zw=0.55, scoop=0.0, sh=0.985, zsh=0.80, fx=0.96, zf=0.84, vx=0.86, zv=0.845, gb=0.60, zg=0.845, rw=0.30, zr=0.85, crown=0.004),
        dict(t=0.03, zb=0.25, hw=0.99, zsh=0.86, fx=0.965, zf=0.89, vx=0.88, zv=0.895, zg=0.895, zr=0.90, crown=0.006),
        dict(t=0.30, zb=0.24, zf=0.90, zv=0.905, zg=0.905, zr=0.91, crown=0.01),
        dict(t=0.355, gb=0.80, zg=0.925, rw=0.74, zr=0.935),
        dict(t=0.45, gb=0.82, zg=0.93, rw=0.70, zr=1.36, crown=0.03),
        dict(t=0.72, zr=1.36),
        dict(t=0.79, gb=0.80, zg=0.94, rw=0.72, zr=0.955, crown=0.012),
        dict(t=0.83, gb=0.60, zg=0.945, rw=0.30, zr=0.955, crown=0.01),
        dict(t=0.98, zb=0.28, zf=0.92, zv=0.925, zg=0.93, zr=0.935),
        dict(t=1.00, zb=0.34, hw=0.965, zsh=0.84, zf=0.89, zv=0.89, zg=0.89, zr=0.895, crown=0.004),
    ],
    cabin=dict(ws=(0.36, 0.45), side=(0.452, 0.718), rear=(0.722, 0.79)),
    pillars=[0.6], pillar_w=0.014,
    doors=(0.36, 0.6), bonnet=(0.03, 0.335), bonnet_w=0.82, bonnet_front=True, boot=(0.835, 0.985), boot_w=0.8,
    cage_along=38, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.9, crease_belt=0.8, end_crease=0.95,
    nose_kx=0.94, nose_kz=0.92, nose_dt=0.006, tail_kx=0.94, tail_kz=0.92, tail_dt=0.006, smooth_angle=35,
))
c.body()
c.vinyl_roof(0.44, 0.8, 1.2)
c.retro_grille('waterfall', w=0.5, h=0.25, z=0.63)
c.retro_lamps('quad_rect', x=0.64, z=0.64, w=0.17, h=0.12)
c.bulge(0.07, 0.3, w=0.9, h=0.04)
c.bumper3('front', 'chrome', z=0.39, h=0.14)
c.bumper3('rear', 'chrome', z=0.41, h=0.14)
c.retro_tails('bar', z=0.72, h=0.15)
c.plate3('rear', z=0.56)
c.exhausts3(2, x=0.52, r=0.05, z=0.27)
c.side_strip(0.52, 0.06, 0.95)
c.retro_mirrors(0.385)
c.finish()

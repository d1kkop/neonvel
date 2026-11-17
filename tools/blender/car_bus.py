import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Night Liner — v3 80s touring coach: raked one-piece windscreen, a long band of tinted side windows split by
# slim pillars, a rounded roof cap with a lit destination sign, luggage-bay doors between the axles, big
# rectangular lamps, chrome grille, black bumpers, square tail lamps.
pillars = [0.16 + i * 0.09 for i in range(9)]
c = Car3('bus', dict(
    preview_color=(0.1, 0.1, 0.3), rim='dish',
    keys=[
        dict(t=0.00, zb=0.45, hw=0.97, zw=0.90, scoop=0.0, sh=0.99, zsh=1.10, fx=0.98, zf=1.16, vx=0.95, zv=1.18, gb=0.92, zg=1.20, rw=0.88, zr=1.22, crown=0.01),
        dict(t=0.006, zb=0.42, hw=1.0, zsh=1.14, zf=1.2, zv=1.24, gb=0.96, zg=1.27, rw=0.90, zr=1.30),
        dict(t=0.045, gb=0.97, zg=1.30, rw=0.93, zr=2.90, crown=0.05),
        dict(t=0.07, zr=2.96, crown=0.06),
        dict(t=0.965, zr=2.96),
        dict(t=0.995, zb=0.45, zr=2.82, crown=0.04),
        dict(t=1.00, zb=0.50, hw=0.97, zsh=1.12, zf=1.18, zv=1.22, gb=0.94, zg=1.26, rw=0.90, zr=2.78, crown=0.03),
    ],
    cabin=dict(ws=(0.007, 0.044), side=(0.05, 0.96), rear=(0.968, 0.994)),
    pillars=pillars, pillar_w=0.007, pillar_mat='trim', frame=0.035,
    doors=(0.06, 0.135), bonnet=False, bays=[0.27, 0.39, 0.51, 0.63],
    cage_along=36, crease_sill=0.9, crease_shoulder=1.0, crease_fender=1.0, crease_belt=0.9, end_crease=0.9,
    nose_kx=0.97, nose_kz=0.96, nose_dt=0.003, tail_kx=0.97, tail_kz=0.96, tail_dt=0.003, smooth_angle=35,
))
c.body()
# Roof cap over the top of the window band (rounded), with a destination sign at the front.
c.box((c.W * 0.975, c.L * 0.885, 0.36), (0, c.y(0.52), 2.8), 'paint', bevel=0.1)
yf = c.y(0.52) + c.L * 0.885 / 2
c.box((c.W * 0.66, 0.05, 0.2), (0, yf + 0.005, 2.78), 'trim', bevel=0.015)
c.box((c.W * 0.6, 0.02, 0.13), (0, yf + 0.03, 2.78), 'amber')
c.retro_lamps('wide_rect', x=0.86, z=0.78, w=0.4, h=0.17)
c.retro_grille('slats', w=1.0, h=0.3, z=0.78)
c.bumper3('front', 'black', z=0.5, h=0.22, proud=0.06, wrap=0.5)
c.bumper3('rear', 'black', z=0.55, h=0.22, proud=0.06, wrap=0.5)
c.retro_tails('quad', z=0.98, h=0.22, x=1.0)
c.plate3('rear', z=0.8)
c.exhausts3(2, x=0.9, r=0.06, z=0.42)
c.side_strip(1.05, 0.03, 0.97, h=0.03, n=12)
c.retro_mirrors(0.03)
c.finish()

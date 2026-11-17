import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Nocturne (Velvet line) - mid-80s two-seat kammback, period spirit (no real design copied): low wedge nose with
# flush wide lamps and amber corners, a slim slot grille, steep raked windshield, short roof falling into a long
# glass hatch, chopped vertical tail with a full-width lamp band, black bumpers with a deep air dam, flat-face rims.
c = Car3('coupe', dict(
    preview_color=(0.02, 0.02, 0.025), rim='dish',
    keys=[
        dict(t=0.00, zb=0.25, hw=0.88, zw=0.40, scoop=0.0, sh=0.98, zsh=0.52, fx=0.95, zf=0.55, vx=0.84, zv=0.555, gb=0.60, zg=0.555, rw=0.30, zr=0.56, crown=0.004),
        dict(t=0.03, zb=0.21, hw=0.95, zw=0.42, zsh=0.58, fx=0.96, zf=0.61, vx=0.85, zv=0.615, zg=0.615, zr=0.62, crown=0.008),
        dict(t=0.17, hw=1.0, zsh=0.64, zf=0.67, zv=0.675, zg=0.675, zr=0.68, crown=0.012),
        dict(t=0.29, zsh=0.68, zf=0.72, vx=0.86, zv=0.725, zg=0.725, zr=0.73, crown=0.014),
        dict(t=0.31, gb=0.80, zg=0.74, rw=0.74, zr=0.75),
        dict(t=0.47, gb=0.80, zg=0.775, rw=0.66, zr=1.2, crown=0.03),
        dict(t=0.53, zr=1.195),
        dict(t=0.91, zsh=0.8, zf=0.87, zv=0.88, gb=0.74, zg=0.9, rw=0.6, zr=0.95, crown=0.02),
        dict(t=0.925, gb=0.6, zg=0.91, rw=0.36, zr=0.915, crown=0.01),
        dict(t=0.985, zb=0.24, zsh=0.8, zf=0.89, zv=0.9, zg=0.905, zr=0.905),
        dict(t=1.00, zb=0.3, hw=0.96, zsh=0.79, zf=0.87, zv=0.875, zg=0.875, zr=0.88, crown=0.004),
    ],
    cabin=dict(ws=(0.31, 0.47), side=(0.475, 0.83), rear=(0.6, 0.915)),
    pillars=[0.64], pillar_w=0.014, pillar_mat='trim',
    doors=(0.31, 0.64), bonnet=(0.03, 0.29), bonnet_w=0.78, bonnet_front=True,
    cage_along=46, crease_sill=0.9, crease_shoulder=0.95, crease_fender=0.85, crease_belt=0.8, end_crease=0.9,
    nose_kx=0.94, nose_kz=0.9, nose_dt=0.006, tail_kx=0.95, tail_kz=0.93, tail_dt=0.005, smooth_angle=34,
))
c.body()
# Flush wide lamps with amber corner lamps, slim slot grille between them.
c.retro_lamps('wide_rect', x=0.5, z=0.5, w=0.36, h=0.085)
for s in (-1, 1):
    yb = c.front_y(s * 0.76, 0.5)
    c.box((0.09, 0.02, 0.07), (s * 0.76, yb + 0.004, 0.5), 'amber', bevel=0.004)
c.retro_grille('slats', w=0.52, h=0.05, z=0.47, frame=None)
# Black wrap-around bumpers, deep air dam with a mesh intake and amber parking lamps.
c.bumper3('front', 'black', z=0.35, h=0.15, proud=0.05)
y = c.front_y(0, 0.25)
c.box((c.W * 0.86, 0.1, 0.1), (0, y + 0.02, 0.24), 'rubber', bevel=0.02)
c.mesh_insert((0, y + 0.07, 0.24), (1, 0, 0), (0, 0, 1), 0.6, 0.05)
for s in (-1, 1):
    c.box((0.14, 0.02, 0.05), (s * 0.55, c.front_y(s * 0.55, 0.35) + 0.075, 0.35), 'amber', bevel=0.004)
c.bumper3('rear', 'black', z=0.38, h=0.16, proud=0.05)
# Chopped tail: full-width lamp band, plate, single exhaust.
c.retro_tails('bar', z=0.72, h=0.11)
c.plate3('rear', z=0.53)
c.exhausts3(1, x=0.5, r=0.04, z=0.25)
# Black rub strip along the body side and lower sills, small black mirrors.
c.side_strip(0.42, 0.06, 0.95, mat='rubber', h=0.05, n=10)
c.retro_mirrors(0.335, square=False)
c.finish()

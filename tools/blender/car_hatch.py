import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib4 import Car4

# Nordring 2.5 (Pocket line) - late-80s touring-car-style sport sedan, period spirit (no real design copied):
# compact two-door three-box, squared box flares over all four wheels, a band of quad round lamps either side of
# a slim slatted grille, deep black air dam and bumpers, short high boot with a body-colour wing, cross-spoke rims.
F1, F2 = 0.18, 0.80  # axle stations (from styles.json wheelT)
c = Car4('hatch', dict(
    subdiv=3, sculpt=dict(arch=0.06, waist=0.015, side=0.02, fender=0.02, tumble=0.88),
    preview_color=(0.9, 0.9, 0.92), rim='mesh',
    keys=[
        dict(t=0.00, zb=0.27, hw=0.91, zw=0.48, scoop=0.0, sh=0.985, zsh=0.70, fx=0.96, zf=0.74, vx=0.86, zv=0.745, gb=0.60, zg=0.745, rw=0.30, zr=0.75, crown=0.004),
        dict(t=0.025, zb=0.23, hw=0.92, zsh=0.76, fx=0.965, zf=0.80, vx=0.87, zv=0.805, zg=0.805, zr=0.81, crown=0.008),
        # front box flare
        dict(t=F1 - 0.12, hw=0.92, sh=0.985),
        dict(t=F1 - 0.1, hw=0.975, sh=0.95),
        dict(t=F1 - 0.07, hw=1.0, sh=0.935),
        dict(t=F1 + 0.07, hw=1.0, sh=0.935, zf=0.82, zv=0.83, zg=0.83, zr=0.835),
        dict(t=0.28, hw=0.975, sh=0.95, zf=0.84, zv=0.845, gb=0.80, zg=0.86, rw=0.74, zr=0.87, crown=0.012),
        dict(t=F1 + 0.12, hw=0.92, sh=0.985),
        dict(t=0.395, gb=0.81, zg=0.875, rw=0.70, zr=1.32, crown=0.03),
        dict(t=0.665, zr=1.31),
        dict(t=F2 - 0.12, hw=0.92, sh=0.985),
        dict(t=F2 - 0.1, hw=0.975, sh=0.95),
        dict(t=F2 - 0.07, hw=1.0, sh=0.935),
        dict(t=0.78, gb=0.79, zg=0.9, rw=0.72, zr=0.95, crown=0.014),
        dict(t=0.805, gb=0.62, zg=0.905, rw=0.30, zr=0.915, crown=0.01),
        dict(t=F2 + 0.07, hw=1.0, sh=0.935),
        dict(t=F2 + 0.1, hw=0.975, sh=0.95),
        dict(t=F2 + 0.12, hw=0.92, sh=0.985),
        dict(t=0.975, zb=0.26, zsh=0.82, zf=0.88, zv=0.89, zg=0.895, zr=0.9),
        dict(t=1.00, zb=0.31, hw=0.92, zsh=0.8, zf=0.86, zv=0.865, zg=0.865, zr=0.87, crown=0.004),
    ],
    cabin=dict(ws=(0.28, 0.395), side=(0.4, 0.665), rear=(0.67, 0.8)),
    pillars=[0.575], pillar_w=0.014, pillar_mat='trim',
    doors=(0.28, 0.575), bonnet=(0.025, 0.265), bonnet_w=0.8, bonnet_front=True, boot=(0.82, 0.975), boot_w=0.78,
    cage_along=64, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.95, crease_belt=0.85, end_crease=0.95,
    nose_kx=0.95, nose_kz=0.93, nose_dt=0.005, tail_kx=0.95, tail_kz=0.93, tail_dt=0.005, smooth_angle=33,
))
c.body()
# Lamp band: quad round lamps in black bezels, slim chrome-framed slatted grille between them.
c.retro_grille('slats', w=0.34, h=0.13, z=0.62, frame='chrome')
# Lamp band: a black panel proud of the nose either side of the grille, quad round lamps in chrome bezels on it.
import math
for s in (-1, 1):
    yb = max(c.front_y(s * x, 0.62) for x in (0.24, 0.52, 0.8))
    c.box((0.6, 0.03, 0.2), (s * 0.52, yb + 0.005, 0.62), 'trim', bevel=0.012)
    for cx in (0.43, 0.65):
        y0 = yb + 0.02
        c.cyl(0.088, 0.03, (s * cx, y0 + 0.01, 0.62), 'chrome', rot=(math.pi / 2, 0, 0), verts=40)
        c.cyl(0.074, 0.03, (s * cx, y0 + 0.016, 0.62), 'head', rot=(math.pi / 2, 0, 0), verts=40)
        c.cyl(0.012, 0.02, (s * cx, y0 + 0.03, 0.62), 'chrome', rot=(math.pi / 2, 0, 0), verts=16)
        for j in (-1, 1):
            c.box((0.13, 0.008, 0.005), (s * cx, y0 + 0.033, 0.62 + j * 0.03), 'chrome')
# Bonnet power bulge, deep air dam with a mesh intake and brake-cooling slots.
c.bulge(0.06, 0.24, w=0.46, h=0.014)

c.bumper3('front', 'black', z=0.38, h=0.12, proud=0.05)
y = c.front_y(0, 0.27)
c.box((c.W * 0.9, 0.12, 0.14), (0, y + 0.02, 0.27), 'rubber', bevel=0.02)
c.mesh_insert((0, y - 0.045, 0.27), (1, 0, 0), (0, 0, 1), 0.7, 0.07)
for s in (-1, 1):
    c.mesh_insert((s * 0.62, y - 0.045, 0.27), (1, 0, 0), (0, 0, 1), 0.16, 0.06)
c.bumper3('rear', 'black', z=0.4, h=0.14, proud=0.05)
c.retro_tails('quad', z=0.74, h=0.12, x=0.74)
c.plate3('rear', z=0.56)
c.exhausts3(2, x=0.48, r=0.04, z=0.26, dual=True)
# Black rub strip along the doors, side skirts between the flares, sport mirrors.
c.side_strip(0.5, 0.3, 0.69, mat='rubber', h=0.035, n=6)
for s in (-1, 1):
    tm = (F1 + 0.1 + F2 - 0.1) / 2
    x = c.side_x(s, tm, 0.33)
    c.box((0.05, (F2 - F1 - 0.2) * c.L, 0.08), (x + s * 0.01, c.y(tm), 0.31), 'rubber', bevel=0.012)
# Boot wing: body-colour aerofoil on two stands, plus a lip across the boot edge.
tw = 0.93
zt = c.top_z(0, tw)
c.airfoil(c.W * 0.78, 0.26, 0.11, (0, c.y(tw), zt + 0.1), aoa=0.1, mat='paint')
for s in (-1, 1):
    c.box((0.03, 0.12, 0.1), (s * 0.5, c.y(tw), zt + 0.05), 'paint', bevel=0.008)
c.retro_mirrors(0.31, square=False)
c.finish()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Phantom LM — v3 Le Mans prototype: tall front fenders over a deep centre valley, narrow bubble canopy, rising
# rear fenders around a spine with a shark fin, LED slot lamps, big carbon wing, diffuser and mesh rear grille.
c = Car3('proto', dict(
    preview_color=(0.35, 0.05, 0.4), rim='turbofan',
    keys=[
        dict(t=0.00, zb=0.14, hw=0.85, zw=0.22, scoop=0.0, sh=0.90, zsh=0.30, fx=0.82, zf=0.34, vx=0.50, zv=0.32, gb=0.30, zg=0.32, rw=0.15, zr=0.325, crown=0.003),
        dict(t=0.06, zb=0.10, hw=0.97, zw=0.26, zsh=0.48, fx=0.84, zf=0.62, vx=0.55, zv=0.50, gb=0.32, zg=0.48, zr=0.485, crown=0.006),
        dict(t=0.17, hw=1.0, zw=0.30, zsh=0.66, fx=0.85, zf=0.84, vx=0.60, zv=0.62, gb=0.34, zg=0.60, rw=0.16, zr=0.605, crown=0.008),
        dict(t=0.27, zf=0.78, vx=0.58, zv=0.66, gb=0.36, zg=0.65, rw=0.20, zr=0.66),
        dict(t=0.29, gb=0.42, zg=0.67, rw=0.30, zr=0.68),
        dict(t=0.40, hw=0.97, zf=0.74, zv=0.70, gb=0.44, zg=0.70, rw=0.30, zr=1.0, crown=0.03),
        dict(t=0.55, zr=1.0),
        dict(t=0.62, gb=0.40, zg=0.74, rw=0.28, zr=0.97),
        dict(t=0.70, hw=1.0, zsh=0.74, fx=0.86, zf=0.88, vx=0.62, zv=0.80, gb=0.38, zg=0.82, rw=0.22, zr=0.90, crown=0.02),
        dict(t=0.82, zf=0.92, zv=0.82, zg=0.84, zr=0.90),
        dict(t=0.97, zb=0.16, zf=0.88, zv=0.82, zg=0.83, zr=0.86),
        dict(t=1.00, zb=0.24, hw=0.95, zw=0.40, zsh=0.76, zf=0.84, vx=0.62, zv=0.80, gb=0.38, zg=0.80, rw=0.20, zr=0.82, crown=0.01),
    ],
    cabin=dict(ws=(0.295, 0.40), side=(0.402, 0.6), rear=(0.625, 0.66)),
    doors=(0.3, 0.55), bonnet=(0.03, 0.24), bonnet_w=0.4,
    cage_along=38, crease_sill=0.9, crease_shoulder=0.8, crease_fender=0.6, crease_belt=0.6, end_crease=0.8,
    nose_kx=0.85, nose_kz=0.8, nose_dt=0.012, tail_kx=0.88, tail_kz=0.88, tail_dt=0.01,
))
c.body()
c.led_headlights(x=0.68, z=0.42, w=0.34, h=0.07)
c.front_intakes(z=0.2)
c.engine_louvres(0.72, 0.86, n=7, w=0.5)
c.rear_end(z_lamp=0.74, z_grille=0.45)
c.big_wing(t=0.96, height=0.3)
c.box((0.025, 1.0, 0.24), (0, c.y(0.8), c.top_z(0, 0.8) + 0.1), 'paint', bevel=0.008)  # shark fin
c.splitter3()
c.sills3(0.3, 0.65)
c.mirrors3(0.33)
c.finish()

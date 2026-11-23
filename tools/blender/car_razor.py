import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib4 import Car4

# Razor X — v3 razor-edged 80s supercar: knife wedge nose with closed pop-ups, crisp creases everywhere, a low
# cab-forward glasshouse, deep finned scoops behind the doors, louvred engine deck and a high wing.
c = Car4('razor', dict(
    subdiv=3, sculpt=dict(arch=0.05, waist=0.035, side=0.03, fender=0.035, tumble=0.85),
    preview_color=(0.9, 0.9, 0.95), rim='mesh',
    keys=[
        dict(t=0.00, zb=0.20, hw=0.86, zw=0.32, scoop=0.0, sh=0.92, zsh=0.42, fx=0.86, zf=0.46, vx=0.60, zv=0.45, gb=0.40, zg=0.45, rw=0.20, zr=0.455, crown=0.003),
        dict(t=0.06, zb=0.14, hw=0.97, zw=0.36, zsh=0.55, fx=0.90, zf=0.60, vx=0.66, zv=0.58, gb=0.42, zg=0.575, zr=0.58, crown=0.006),
        dict(t=0.19, hw=1.0, zw=0.40, zsh=0.70, fx=0.92, zf=0.82, vx=0.70, zv=0.74, gb=0.44, zg=0.72, zr=0.725, crown=0.008),
        dict(t=0.28, zsh=0.74, zf=0.84, vx=0.74, zv=0.79, gb=0.50, zg=0.78, rw=0.30, zr=0.79, crown=0.01),
        dict(t=0.30, gb=0.70, zg=0.81, rw=0.52, zr=0.82),
        dict(t=0.45, hw=0.97, zf=0.85, gb=0.72, zg=0.84, rw=0.52, zr=1.08, crown=0.02),
        dict(t=0.58, scoop=0.6, zr=1.07),
        dict(t=0.66, scoop=1.0, gb=0.64, zg=0.88, rw=0.46, zr=1.02),
        dict(t=0.80, scoop=0.3, hw=1.04, zw=0.44, zsh=0.82, zf=0.94, vx=0.70, zv=0.90, gb=0.50, zg=0.90, rw=0.30, zr=0.91, crown=0.01),
        dict(t=0.96, scoop=0.0, zb=0.18, hw=1.02, zf=0.93, zv=0.90, zg=0.90, zr=0.905),
        dict(t=1.00, zb=0.26, hw=0.97, zw=0.48, zsh=0.84, zf=0.90, vx=0.74, zv=0.88, gb=0.50, zg=0.88, rw=0.30, zr=0.885, crown=0.006),
    ],
    cabin=dict(ws=(0.305, 0.45), side=(0.452, 0.64), rear=(0.665, 0.71)),
    doors=(0.31, 0.58), bonnet=(0.17, 0.28), bonnet_w=0.55,
    cage_along=64, crease_sill=1.0, crease_shoulder=1.0, crease_fender=1.0, crease_belt=1.0, end_crease=0.95,
    nose_kx=0.88, nose_kz=0.8, nose_dt=0.008, tail_kx=0.94, tail_kz=0.92, tail_dt=0.006, smooth_angle=30,
))
c.body()
c.retro_lamps('popup', x=0.45, z=0.32, w=0.3)
c.front_intakes(z=0.24)
c.side_scoops(t=0.64, z=0.6, size=(0.42, 0.5, 0.26), fins=4)
c.engine_louvres(0.72, 0.92, n=9, w=0.8)
c.tail_lamp_strip(z=0.74, drop=0.12)
c.exhausts3(2, x=0.34, r=0.045, z=0.3, dual=True)
c.big_wing(t=0.95, height=0.22)
c.splitter3()
c.sills3(0.32, 0.58)
c.mirrors3(0.33)
c.finish()

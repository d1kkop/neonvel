import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib3 import Car3

# Aurum Hyper (locked) — v3 hypercar: one-piece body with a teardrop canopy, raised front fenders over a low
# hood, deep side scoops ahead of wide rear hips, LED slot headlights, light-bar tail, big carbon wing.
# keys: t (0 nose .. 1 tail); zb floor, hw width (x HW), zw widest-point height, scoop (side scallop 0..1),
# sh/zsh shoulder (x of width, z), fx/zf fender peak, vx/zv hood valley / belt, gb/zg glass base, rw/zr roof side,
# crown roof camber. Later keys inherit earlier values.
c = Car3('hyper', dict(
    preview_color=(0.83, 0.6, 0.08), rim='star5',
    keys=[
        dict(t=0.00, zb=0.17, hw=0.80, zw=0.30, scoop=0.0, sh=0.93, zsh=0.40, fx=0.80, zf=0.46, vx=0.56, zv=0.445, gb=0.40, zg=0.445, rw=0.22, zr=0.45, crown=0.004),
        dict(t=0.05, zb=0.135, hw=0.93, zw=0.36, sh=0.95, zsh=0.53, fx=0.82, zf=0.64, vx=0.60, zv=0.585, gb=0.42, zg=0.575, rw=0.22, zr=0.58, crown=0.008),
        dict(t=0.12, zb=0.12, hw=1.01, zw=0.42, sh=0.96, zsh=0.68, fx=0.84, zf=0.82, vx=0.62, zv=0.72, gb=0.44, zg=0.69, rw=0.22, zr=0.695, crown=0.01),
        dict(t=0.20, hw=1.045, zw=0.44, zsh=0.74, fx=0.85, zf=0.92, vx=0.63, zv=0.79, gb=0.46, zg=0.75, rw=0.24, zr=0.76, crown=0.012),
        dict(t=0.28, hw=1.0, zw=0.45, zsh=0.76, fx=0.84, zf=0.9, vx=0.68, zv=0.83, gb=0.63, zg=0.82, rw=0.40, zr=0.85, crown=0.015),
        dict(t=0.36, hw=0.955, zw=0.46, scoop=0.25, zsh=0.77, fx=0.86, zf=0.86, vx=0.75, zv=0.85, gb=0.70, zg=0.86, rw=0.50, zr=1.0, crown=0.025),
        dict(t=0.44, hw=0.935, scoop=0.5, zsh=0.78, zf=0.85, vx=0.77, zv=0.865, gb=0.72, zg=0.88, rw=0.52, zr=1.12, crown=0.03),
        dict(t=0.52, hw=0.93, scoop=0.85, zsh=0.8, zf=0.88, vx=0.77, zv=0.895, gb=0.70, zg=0.91, rw=0.50, zr=1.14, crown=0.03),
        dict(t=0.60, hw=0.96, scoop=1.0, zsh=0.84, zf=0.94, vx=0.74, zv=0.945, gb=0.62, zg=0.96, rw=0.42, zr=1.1, crown=0.03),
        dict(t=0.68, hw=1.01, scoop=0.75, zw=0.47, zsh=0.88, zf=0.99, vx=0.68, zv=0.955, gb=0.52, zg=0.965, rw=0.32, zr=1.01, crown=0.02),
        dict(t=0.76, hw=1.065, scoop=0.15, zw=0.49, zsh=0.9, zf=1.02, vx=0.62, zv=0.94, gb=0.48, zg=0.93, rw=0.28, zr=0.94, crown=0.015),
        dict(t=0.84, hw=1.065, scoop=0.0, zsh=0.9, zf=1.01, zv=0.93, gb=0.48, zg=0.92, rw=0.28, zr=0.925, crown=0.01),
        dict(t=0.94, zb=0.16, hw=1.01, zw=0.52, zsh=0.88, fx=0.88, zf=0.965, vx=0.66, zv=0.92, gb=0.50, zg=0.915, rw=0.30, zr=0.92, crown=0.008),
        dict(t=1.00, zb=0.24, hw=0.96, zw=0.55, zsh=0.86, fx=0.88, zf=0.93, vx=0.70, zv=0.9, gb=0.52, zg=0.9, rw=0.32, zr=0.905, crown=0.005),
    ],
    cabin=dict(ws=(0.285, 0.445), side=(0.33, 0.6), rear=(0.6, 0.7)),
    doors=(0.31, 0.56), bonnet=(0.035, 0.265), bonnet_w=0.48,
    cage_along=38, crease_sill=0.9, crease_shoulder=0.9, crease_fender=0.55, crease_belt=0.6, end_crease=0.75,
    tail_kx=0.86, tail_kz=0.86, tail_dt=0.012,
))
c.body()
c.led_headlights(x=0.62, z=0.5, w=0.42, h=0.08)
c.front_intakes(z=0.27)
c.hood_vents(t=0.13, x=0.3)
c.side_scoops(t=0.645, z=0.52)
c.engine_louvres(0.71, 0.86, w=0.5)
c.rear_end(z_lamp=0.8, z_grille=0.55)
c.big_wing(t=0.94, height=0.3)
c.mirrors3(0.335)
c.splitter3()
c.sills3(0.3, 0.6)
c.finish()

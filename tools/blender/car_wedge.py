import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib4 import Car4

# Vortex GT-R — v3 80s Japanese liftback: knife-low wedge nose with closed pop-up lamps, belt line rising to the
# tail, blacked-out B-pillar, long louvred liftback glass, black bumpers with a rub strip, ribbed tail-lamp band.
c = Car4('wedge', dict(
    subdiv=3, sculpt=dict(arch=0.05, waist=0.03, side=0.035, fender=0.03, tumble=0.86),
    preview_color=(0.9, 0.8, 0.05), rim='turbofan',
    keys=[
        dict(t=0.00, zb=0.26, hw=0.92, zw=0.40, scoop=0.0, sh=0.97, zsh=0.55, fx=0.93, zf=0.60, vx=0.80, zv=0.605, gb=0.60, zg=0.605, rw=0.30, zr=0.61, crown=0.003),
        dict(t=0.04, zb=0.22, hw=0.97, zw=0.42, zsh=0.62, fx=0.95, zf=0.68, vx=0.82, zv=0.685, zg=0.685, zr=0.69, crown=0.006),
        dict(t=0.17, hw=1.0, zw=0.45, zsh=0.76, zf=0.82, zv=0.825, zg=0.825, zr=0.83),
        dict(t=0.34, zsh=0.82, zf=0.88, zv=0.885, zg=0.885, zr=0.89, crown=0.01),
        dict(t=0.355, gb=0.78, zg=0.895, rw=0.70, zr=0.90),
        dict(t=0.46, gb=0.80, zg=0.90, rw=0.62, zr=1.22, crown=0.025),
        dict(t=0.60, zr=1.23),
        dict(t=0.66, rw=0.62, zr=1.20),
        dict(t=0.90, zsh=0.9, zf=0.955, zv=0.96, gb=0.74, zg=0.96, rw=0.60, zr=0.98, crown=0.015),
        dict(t=0.93, gb=0.60, zg=0.965, rw=0.30, zr=0.97, crown=0.008),
        dict(t=0.99, zb=0.26, zsh=0.9, zf=0.96, zv=0.965, zg=0.965, zr=0.97),
        dict(t=1.00, zb=0.30, hw=0.96, zsh=0.88, zf=0.93, zv=0.935, zg=0.935, zr=0.94, crown=0.004),
    ],
    cabin=dict(ws=(0.36, 0.46), side=(0.462, 0.66), rear=(0.665, 0.895)),
    pillars=[0.565], pillar_w=0.016, pillar_mat='trim',
    doors=(0.36, 0.6), bonnet=(0.16, 0.34), bonnet_w=0.7, bonnet_front=True,
    cage_along=64, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.85, crease_belt=0.8, end_crease=0.85,
    nose_kx=0.9, nose_kz=0.85, nose_dt=0.01, tail_kx=0.94, tail_kz=0.92, tail_dt=0.006, smooth_angle=35,
))
c.body()
c.retro_lamps('popup', x=0.55, z=0.48, w=0.36)
c.retro_grille('slats', w=0.56, h=0.08, z=0.42, frame=None)
c.bumper3('front', 'black', z=0.32, h=0.12, proud=0.05)
c.bumper3('rear', 'black', z=0.38, h=0.12, proud=0.05)
c.tail_lamp_strip(z=0.73, drop=0.12)
c.plate3('rear', z=0.54)
c.exhausts3(2, x=0.45, r=0.045, z=0.25)
c.louvres3(0.72, 0.88, 8, w=0.95)
c.side_strip(0.46, 0.06, 0.95, mat='rubber', h=0.035)
c.ducktail(0.985, h=0.035)
c.retro_mirrors(0.375, square=False)
c.finish()

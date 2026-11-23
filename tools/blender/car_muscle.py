import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib4 import Car4

# Thunder 454 — v5 muscle coupe (red, white twin stripes, fatter coke-bottle hips): very long bonnet with a cowl scoop, twin round lamps each side of a slatted grille,
# pillarless hardtop with a long semi-fastback over louvres, coke-bottle hips over the bigger rear wheels,
# ducktail, quad square tail lamps, chrome bumpers and dual exhausts.
c = Car4('muscle', dict(
    subdiv=3, sculpt=dict(arch=0.035, arch_r=0.02, waist=0.035, side=0.025, fender=0.03, tumble=0.86),
    preview_color=(0.7, 0.04, 0.05), rim='star5',
    keys=[
        dict(t=0.00, zb=0.30, hw=0.95, zw=0.55, scoop=0.0, sh=0.98, zsh=0.78, fx=0.95, zf=0.84, vx=0.84, zv=0.85, gb=0.60, zg=0.85, rw=0.30, zr=0.855, crown=0.004),
        dict(t=0.03, zb=0.26, hw=0.98, zsh=0.84, fx=0.96, zf=0.90, vx=0.86, zv=0.905, zg=0.905, zr=0.91, crown=0.008),
        dict(t=0.16, zf=0.92, zv=0.915, zg=0.915, zr=0.92),
        dict(t=0.40, hw=0.965, zsh=0.85, zf=0.93, zv=0.92, zg=0.92, zr=0.93, crown=0.012),
        dict(t=0.42, gb=0.80, zg=0.935, rw=0.72, zr=0.945),
        dict(t=0.50, gb=0.82, zg=0.94, rw=0.66, zr=1.31, crown=0.03),
        dict(t=0.58, hw=0.975, zr=1.32),
        dict(t=0.66, rw=0.64, zr=1.29),
        dict(t=0.72, hw=1.0),
        dict(t=0.80, hw=1.085, zw=0.58, zsh=0.92, zf=1.0, vx=0.88, zv=1.0, gb=0.74, zg=1.0, rw=0.66, zr=1.07, crown=0.02),
        dict(t=0.845, gb=0.62, zg=1.0, rw=0.40, zr=1.01, crown=0.012),
        dict(t=0.90, hw=1.08),
        dict(t=0.98, zb=0.30, hw=1.05, zsh=0.92, zf=0.99, zv=0.995, zg=0.995, rw=0.30, zr=1.0),
        dict(t=1.00, zb=0.36, hw=0.98, zsh=0.90, zf=0.95, zv=0.955, zg=0.955, zr=0.96, crown=0.004),
    ],
    cabin=dict(ws=(0.425, 0.5), side=(0.502, 0.68), rear=(0.685, 0.82)),
    doors=(0.43, 0.66), bonnet=(0.03, 0.40), bonnet_w=0.84, bonnet_front=True, boot=(0.86, 0.985), boot_w=0.82,
    cage_along=64, crease_sill=0.9, crease_shoulder=1.0, crease_fender=0.8, crease_belt=0.7, end_crease=0.9,
    nose_kx=0.93, nose_kz=0.9, nose_dt=0.008, tail_kx=0.94, tail_kz=0.92, tail_dt=0.006, smooth_angle=35,
))
c.body()
c.retro_grille('slats', w=0.72, h=0.24, z=0.62)
c.retro_lamps('round2', x=0.66, z=0.63, h=0.15, gap=0.02)
c.cowl_scoop(0.24, w=0.62, l=0.8, h=0.11)
c.bumper3('front', 'chrome', z=0.38, h=0.13)
c.bumper3('rear', 'chrome', z=0.42, h=0.13)
c.retro_tails('quad', z=0.74, h=0.13, x=0.74)
c.plate3('rear', z=0.57)
c.exhausts3(2, x=0.42, r=0.045, z=0.27, dual=True)
c.louvres3(0.7, 0.81, 7, w=1.0)
c.ducktail(0.975)
c.retro_mirrors(0.445)
# White twin racing stripes over bonnet, roof and boot (the glass is skipped).
c.stripes([(0.01, 0.42), (0.505, 0.675), (0.86, 0.99)], offset=0.12, width=0.14)
c.finish()

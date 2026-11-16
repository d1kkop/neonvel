import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Razor X (locked) — extreme 80s wedge: knife nose, NACA ducts, louvred engine cover, giant wing, quad exhaust, neon sills.
c = Car('razor', dict(
    preview_color=(0.96, 0.96, 0.96), arches='square', crease=1.0, end_crease=1.0, subdiv=1, smooth_angle=28,
    body=[(0.00, 0.20, 0.36, 0.82, 0.50, 0.86, 0.0), (0.06, 0.17, 0.46, 0.96, 0.55, 0.86, 0.01), (0.35, 0.16, 0.62, 1.0, 0.60, 0.84, 0.02),
          (0.62, 0.16, 0.76, 1.04, 0.64, 0.82, 0.02), (0.90, 0.17, 0.82, 1.05, 0.66, 0.82, 0.01), (1.00, 0.26, 0.80, 1.0, 0.66, 0.84, 0.0)],
    glass=[(0.30, 0.62, 0.64, 0.74, 0.70), (0.40, 0.64, 0.98, 0.70, 0.56), (0.58, 0.70, 1.02, 0.64, 0.52), (0.70, 0.76, 0.86, 0.58, 0.50), (0.76, 0.78, 0.80, 0.50, 0.46)],
    pillars=[]))
c.body()
c.naca(0.5, 0.58)
c.greenhouse()
c.headlights('popup'); c.taillights('quad', 0.58); c.bumpers('carbon'); c.splitter(); c.diffuser(); c.skirts()
c.louvres(0.78, 0.94, 8, on='body'); c.wing('big', 0.94, 0.34, 0.98, 0.46); c.exhausts(4, r=0.05); c.neon_sill(); c.mirrors(0.36); c.plate()
c.finish()

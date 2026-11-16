import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Pocket Rocket — Group B rally hatch: tall box with huge rear hips, side air intakes, rally lamps, roof spoiler.
c = Car('hatch', dict(
    preview_color=(1.0, 0.69, 0.0), arches='square', crease=1.0,
    body=[(0.00, 0.30, 0.62, 0.88, 0.60, 0.92, 0.0), (0.04, 0.27, 0.76, 0.98, 0.60, 0.92, 0.02), (0.30, 0.26, 0.84, 1.0, 0.60, 0.90, 0.02),
          (0.55, 0.26, 0.88, 1.06, 0.62, 0.86, 0.02), (0.82, 0.26, 0.90, 1.15, 0.64, 0.82, 0.02), (1.00, 0.30, 0.90, 1.10, 0.64, 0.84, 0.0)],
    glass=[(0.30, 0.86, 0.88, 0.86, 0.82), (0.40, 0.88, 1.40, 0.84, 0.76), (0.92, 0.90, 1.44, 0.84, 0.76), (1.00, 0.90, 1.40, 0.84, 0.78)],
    pillars=[0.36, 0.74]))
c.body(); c.greenhouse()
c.side_intake(0.66, 0.55, (0.5, 0.5, 0.28)); c.headlights('quad', 0.56); c.taillights('quad'); c.bumpers('black'); c.grille('slats', 0.6, 0.25, 0.5)
for s in (-1, 1):
    for xo in (0.25, 0.55):
        c.cyl(0.09, 0.08, (s * c.HW * xo, c.L / 2 + 0.06, 0.62), 'amber', rot=(1.5708, 0, 0), verts=20)
zb, zt, hb, ht = 0.9, 1.44, 0.84, 0.76
c.box((c.W * 0.78, 0.4, 0.05), (0, c.y(0.99), 1.47), 'paint', rot=(0.15, 0, 0), bevel=0.01)
c.box((c.W * 0.5, 0.04, 0.02), (0, c.y(0.99) - 0.18, 1.49), 'brake')
c.exhausts(1, r=0.08); c.mirrors(0.40); c.plate()
c.finish()

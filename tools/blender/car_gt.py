import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Midnight Cruiser — 80s personal-luxury coupe: chrome egg-crate grille, quad lamps, formal landau roof with opera window.
c = Car('gt', dict(
    preview_color=(0.16, 0.16, 0.23), arches='square', crease=1.0,
    body=[(0.00, 0.33, 0.68, 0.96, 0.62, 0.94, 0.0), (0.02, 0.30, 0.78, 1.0, 0.64, 0.94, 0.02), (0.42, 0.28, 0.84, 1.0, 0.68, 0.93, 0.03),
          (0.80, 0.28, 0.85, 1.0, 0.68, 0.93, 0.02), (0.98, 0.30, 0.84, 1.0, 0.68, 0.93, 0.0), (1.00, 0.36, 0.80, 0.98, 0.66, 0.93, 0.0)],
    glass=[(0.44, 0.84, 0.86, 0.84, 0.80), (0.52, 0.84, 1.22, 0.82, 0.78), (0.74, 0.84, 1.24, 0.82, 0.78), (0.80, 0.84, 1.06, 0.82, 0.80), (0.83, 0.84, 0.86, 0.82, 0.80)],
    pillars=[0.5], opera=True, vinyl_roof=True))
c.body(); c.greenhouse()
c.grille('eggcrate', 0.42, 0.42, 0.52); c.headlights('quad', 0.55); c.taillights('bar', 0.6); c.bumpers('chrome')
c.rubstrip('chrome', 0.45); c.exhausts(2, r=0.06); c.mirrors(0.5); c.plate()
c.box((0.06, 0.12, 0.1), (0, c.L / 2 - 0.25, 0.86), 'chrome')  # bonnet ornament
c.finish()

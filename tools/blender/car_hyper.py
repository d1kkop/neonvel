import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Aurum Hyper (locked) — hypercar: huge cheese-grater side strakes, louvred engine cover, triple-tier wing, wide hips, round quad lamps.
c = Car('hyper', dict(
    preview_color=(0.83, 0.63, 0.09), arches='square', crease=0.95,
    body=[(0.00, 0.20, 0.40, 0.86, 0.50, 0.90, 0.0), (0.06, 0.17, 0.50, 0.96, 0.55, 0.90, 0.02), (0.22, 0.16, 0.60, 1.0, 0.60, 0.88, 0.03),
          (0.45, 0.16, 0.66, 0.92, 0.62, 0.86, 0.03), (0.74, 0.17, 0.86, 1.07, 0.64, 0.84, 0.02), (0.94, 0.18, 0.86, 1.07, 0.66, 0.84, 0.01),
          (1.00, 0.26, 0.84, 1.03, 0.66, 0.86, 0.0)],
    glass=[(0.24, 0.60, 0.62, 0.66, 0.62), (0.34, 0.62, 0.98, 0.62, 0.52), (0.50, 0.66, 1.02, 0.56, 0.48), (0.62, 0.72, 0.88, 0.50, 0.44), (0.68, 0.74, 0.76, 0.44, 0.40)],
    pillars=[]))
c.body(); c.greenhouse()
c.strakes(0.5, 0.74, 6, 0.32, 0.74); c.louvres(0.7, 0.92, 9, on='body'); c.wing('triple', 0.95, 0.3, 0.96, 0.44)
c.headlights('popup'); c.taillights('round4', 0.58); c.bumpers('carbon'); c.splitter(); c.diffuser(); c.exhausts(3, r=0.055); c.neon_sill(); c.mirrors(0.30); c.plate()
c.finish()

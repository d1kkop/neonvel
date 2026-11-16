import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Phantom LM (locked) — Group C endurance racer: long-tail, enclosed rear wheels, bubble canopy, full-width wing, shark fin.
c = Car('proto', dict(
    preview_color=(0.05, 0.05, 0.08), arches='round', rear_skirt=True, crease=0.7, end_crease=0.6,
    body=[(0.00, 0.16, 0.34, 0.94, 0.50, 0.90, 0.0), (0.05, 0.14, 0.46, 1.0, 0.60, 0.90, 0.03), (0.20, 0.14, 0.58, 1.0, 0.66, 0.88, 0.04),
          (0.42, 0.14, 0.56, 0.94, 0.66, 0.86, 0.04), (0.70, 0.14, 0.70, 1.0, 0.70, 0.90, 0.03), (0.92, 0.15, 0.76, 1.0, 0.72, 0.92, 0.02),
          (1.00, 0.20, 0.74, 0.98, 0.72, 0.92, 0.0)],
    glass=[(0.30, 0.56, 0.58, 0.46, 0.42), (0.38, 0.58, 0.96, 0.42, 0.34), (0.52, 0.62, 1.00, 0.38, 0.30), (0.64, 0.66, 0.86, 0.34, 0.28), (0.70, 0.68, 0.72, 0.30, 0.26)],
    pillars=[], frame=0.04))
c.body(); c.greenhouse()
c.headlights('covered', 0.55); c.taillights('strip', 0.6); c.splitter(); c.diffuser(); c.skirts()
c.wing('big', 0.97, 0.26, 1.0, 0.5); c.exhausts(2, r=0.055); c.neon_sill()
c.box((0.03, 1.1, 0.26), (0, c.y(0.8), 0.86), 'paint', bevel=0.01)  # shark fin
c.finish()

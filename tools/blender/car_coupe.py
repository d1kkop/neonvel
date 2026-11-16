import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Velvet Coupe — curvy Italian 70s GT: soft round body, high crown, fastback, round lamps, covered rear wheels.
c = Car('coupe', dict(
    preview_color=(1.0, 0.17, 0.84), arches='round', rear_skirt=True, crease=0.45, end_crease=0.5, shoulder=1.02,
    body=[(0.00, 0.32, 0.58, 0.80, 0.50, 0.80, 0.0), (0.06, 0.28, 0.66, 0.94, 0.52, 0.80, 0.05), (0.30, 0.26, 0.74, 1.0, 0.50, 0.78, 0.08),
          (0.62, 0.26, 0.84, 1.02, 0.50, 0.76, 0.07), (0.90, 0.27, 0.82, 0.98, 0.50, 0.76, 0.04), (1.00, 0.33, 0.72, 0.86, 0.50, 0.80, 0.0)],
    glass=[(0.32, 0.76, 0.78, 0.80, 0.74), (0.42, 0.78, 1.16, 0.76, 0.62), (0.56, 0.82, 1.20, 0.72, 0.60), (0.80, 0.86, 1.00, 0.66, 0.58), (0.96, 0.80, 0.83, 0.50, 0.46)],
    pillars=[0.48], roof_crown=0.05))
c.body(); c.greenhouse()
c.headlights('round', 0.55); c.taillights('round4', 0.6); c.bumpers('chrome'); c.exhausts(2, r=0.05)
c.mirrors(0.40); c.rubstrip('chrome', 0.4); c.plate()
c.finish()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Thunder 454 — muscle coupe: long bonnet with cowl scoop, quad lamps, louvred rear window, chrome bumpers, wide rear hips.
c = Car('muscle', dict(
    preview_color=(0.1, 0.3, 0.9), arches='square', crease=1.0,
    body=[(0.00, 0.33, 0.70, 0.95, 0.60, 0.94, 0.0), (0.03, 0.30, 0.80, 1.0, 0.62, 0.93, 0.03), (0.40, 0.28, 0.88, 1.0, 0.66, 0.92, 0.05),
          (0.80, 0.28, 0.90, 1.04, 0.66, 0.90, 0.03), (0.98, 0.30, 0.90, 1.0, 0.66, 0.90, 0.0), (1.00, 0.36, 0.86, 0.98, 0.64, 0.90, 0.0)],
    glass=[(0.47, 0.90, 0.92, 0.86, 0.82), (0.54, 0.90, 1.34, 0.84, 0.76), (0.76, 0.90, 1.36, 0.84, 0.76), (0.86, 0.90, 0.95, 0.83, 0.80)],
    pillars=[0.45]))
c.body(); c.greenhouse()
c.headlights('quad'); c.grille('slats', 0.62, 0.32, 0.55); c.taillights('quad'); c.bumpers('chrome')
c.scoop(0.22, 0.7, 1.0, 0.14); c.exhausts(2, r=0.075); c.wing('lip', 0.985); c.louvres(0.77, 0.85, 6); c.rubstrip('chrome'); c.mirrors(0.52); c.plate()
c.finish()

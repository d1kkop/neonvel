import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib2 import Car

# Vortex GT-R — 80s Japanese liftback coupe: pop-up lamps, slab sides, louvred liftback, black bumpers.
c = Car('wedge', dict(
    preview_color=(0.85, 0.82, 0.05), arches='round',
    body=[(0.00, 0.30, 0.56, 0.86, 0.55, 0.92, 0.0), (0.05, 0.27, 0.66, 0.96, 0.58, 0.90, 0.02), (0.30, 0.25, 0.80, 1.0, 0.62, 0.88, 0.04),
          (0.62, 0.25, 0.86, 1.0, 0.64, 0.86, 0.03), (0.95, 0.26, 0.88, 0.99, 0.64, 0.86, 0.02), (1.00, 0.32, 0.86, 0.96, 0.62, 0.86, 0.0)],
    glass=[(0.34, 0.80, 0.82, 0.84, 0.80), (0.44, 0.80, 1.24, 0.83, 0.70), (0.62, 0.84, 1.25, 0.82, 0.69), (0.86, 0.88, 0.95, 0.80, 0.74), (0.92, 0.88, 0.89, 0.78, 0.76)],
    pillars=[0.42]))
c.body(); c.greenhouse()
c.headlights('popup'); c.taillights('bar'); c.bumpers('black'); c.grille('slats', 0.55, 0.16, 0.5)
c.exhausts(2); c.wing('lip', 0.98); c.mirrors(0.40); c.rubstrip(); c.louvres(0.72, 0.86, 7); c.plate()
c.finish()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carlib

# Night Liner: 80s city bus - long box, window band with posts, doors, destination board.
carlib.build('bus', dict(profile='bus', arches='square', greenhouse='box', b_pillar=None, extra_pillars=[0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84], pillar_width=0.012, frame=0.06, along=40, cabin_along=60, details=[('busdoors', [0.08, 0.55]), ('sign',)], preview_color=(0.91, 0.69, 0.13)))

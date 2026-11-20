"""
Neon Velocity car generator v4: the v3 body (Car3) at a higher resolution plus a close-up detail kit
(projector headlights with DRL light guides, aero mirrors on carbon stalks, canards, roof scoop, door handles,
fuel filler, segmented light bar, deeper carbon intakes and diffuser). Same conventions as carlib3.
"""
import bpy, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from carlib3 import Car3  # noqa: E402


def rotz(v, a):
    v = Vector(v)
    v.rotate(Matrix.Rotation(a, 3, 'Z'))
    return v


class Car4(Car3):
    # ------------------------------------------------------------ helpers
    def pod(self, scale, loc, mat, rot=(0, 0, 0), seg=32, rings=16, name='part'):
        """A smooth ellipsoid (mirror housings, scoop lips)."""
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=loc, rotation=rot)
        o = bpy.context.object
        o.name = name
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.append(self.M[mat])
        self.smooth(o, 80)
        return o

    def tube(self, pts, r, mat, verts=12):
        """A round bar through a list of points (stalks, frames)."""
        for a, b in zip(pts, pts[1:]):
            a, b = Vector(a), Vector(b)
            d = b - a
            o = self.cyl(r, d.length, tuple((a + b) / 2), mat, verts=verts)
            o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
            self.smooth(o, 60)

    # ------------------------------------------------------------ lights
    def projector_headlights(self, x=0.6, z=0.5, w=0.46, h=0.1, yaw=0.42, pitch=0.12, lenses=3):
        """Deep lamp pocket: black housing, chrome-ringed projector lenses with glowing cores, an L-shaped
        light guide (DRL) along the top and outer edge, amber indicator blade."""
        for s in (-1, 1):
            y = self.front_y(s * x, z)
            rot = (pitch, 0, -s * yaw)
            self.cut_box((w, 0.26, h), (s * x, y - 0.02, z), rot=rot, bevel=0.018)
            c = Vector((s * x, y, z)) + rotz((0, -0.085, 0), -s * yaw)
            self.box((w * 0.94, 0.02, h * 0.86), tuple(c + Vector((0, -0.014, 0))), 'trim', rot=rot, bevel=0.006)
            # Light guide: top blade + outer down-stroke.
            self.box((w * 0.86, 0.016, 0.011), tuple(c + rotz((0, 0.008, 0), -s * yaw) + Vector((0, 0, h * 0.33))), 'head', rot=rot, bevel=0.004)
            self.box((0.011, 0.016, h * 0.62), tuple(c + rotz((s * w * 0.43, 0.008, 0), -s * yaw)), 'head', rot=rot, bevel=0.004)
            for i in range(lenses):
                k = -0.3 + i * 0.6 / max(1, lenses - 1)
                off = rotz((s * k * w * 0.8, 0.004, -h * 0.08), -s * yaw)
                lr = 0.024 if i else 0.03  # inner lens a little bigger (main beam)
                lrot = (math.pi / 2 + pitch, 0, -s * yaw)
                self.cyl(lr + 0.008, 0.026, tuple(c + off), 'chrome', rot=lrot, verts=32)
                self.cyl(lr, 0.03, tuple(c + off + Vector((0, 0.002, 0))), 'head', rot=lrot, verts=32)
                fwd = rotz((0, 0.018, 0), -s * yaw)
                self.pod((lr * 0.95, lr * 0.5, lr * 0.95), tuple(c + off + fwd), 'glass', rot=(pitch, 0, -s * yaw), seg=24, rings=12)
            tip = rotz((s * w * 0.36, 0.008, -h * 0.34), -s * yaw)
            self.box((w * 0.22, 0.016, 0.012), tuple(c + tip), 'amber', rot=rot, bevel=0.004)

    def segmented_lightbar(self, z_lamp=0.8, segs=28, width=1.7):
        y = self.rear_y(0, z_lamp)
        self.cut_box((width + 0.08, 0.12, 0.06), (0, y, z_lamp), bevel=0.014)
        self.box((width + 0.02, 0.02, 0.04), (0, y + 0.048, z_lamp), 'trim')
        # Light blade standing just proud of the tail, following its curve: dark backing, 28 lit segments.
        seg_w = width / segs
        for i in range(segs):
            xx = -width / 2 + seg_w * (i + 0.5)
            yy = self.rear_y(xx, z_lamp)
            self.box((seg_w * 1.02, 0.03, 0.05), (xx, yy - 0.004, z_lamp), 'trim')
            self.box((seg_w * 0.7, 0.012, 0.026), (xx, yy - 0.02, z_lamp), 'tail', bevel=0.003)
        for s in (-1, 1):  # vertical end blades wrap down the corners
            xx = s * (width / 2 - 0.02)
            self.box((0.024, 0.014, 0.15), (xx, self.rear_y(xx, z_lamp - 0.07) - 0.012, z_lamp - 0.07), 'tail', bevel=0.004)
        self.empty('tail_L', (-0.72, y - 0.04, z_lamp))
        self.empty('tail_R', (0.72, y - 0.04, z_lamp))

    def rear_lower(self, z_grille=0.55):
        yg = self.rear_y(0, z_grille)
        self.cut_box((1.5, 0.26, 0.22), (0, yg, z_grille), bevel=0.035)
        self.mesh_insert((0, yg + 0.1, z_grille), (1, 0, 0), (0, 0, 1), 1.44, 0.19, pitch=0.024, bar=0.005)
        for s in (-1, 1):
            x = s * 0.15
            # Big oval-ish tips: carbon surround, polished pipe, dark bore, hot glow.
            self.cyl(0.085, 0.2, (x, yg + 0.1, z_grille - 0.01), 'carbon', rot=(math.pi / 2, 0, 0), verts=40)
            self.cyl(0.072, 0.24, (x, yg + 0.11, z_grille - 0.01), 'chrome', rot=(math.pi / 2, 0, 0), verts=40)
            self.cyl(0.06, 0.25, (x, yg + 0.115, z_grille - 0.01), 'well', rot=(math.pi / 2, 0, 0), verts=32)
            self.cyl(0.056, 0.02, (x, yg + 0.17, z_grille - 0.01), 'exhaust', rot=(math.pi / 2, 0, 0), verts=32)
        self.empty('exhaust_L', (-0.15, yg - 0.12, z_grille - 0.01))
        self.empty('exhaust_R', (0.15, yg - 0.12, z_grille - 0.01))
        y = self.rear_y(0, 0.8)
        zb = self.P(1.0)['zb']
        self.box((1.64, 0.56, 0.022), (0, y + 0.28, zb - 0.05), 'carbon', rot=(-0.2, 0, 0), bevel=0.006)
        for i in range(9):
            xx = -0.72 + i * 0.18
            self.box((0.01, 0.5, 0.11 if i % 4 else 0.15), (xx, y + 0.26, zb - 0.015), 'carbon', rot=(-0.2, 0, 0), bevel=0.003)
        self.box((0.18, 0.02, 0.05), (0, y - 0.005, zb + 0.1), 'brake', bevel=0.005)  # rain light

    # ------------------------------------------------------------ body kit
    def aero_mirrors(self, t=0.335):
        p = self.P(t)
        for s in (-1, 1):
            x0 = s * self.HW * p['gb']
            z0 = p['zg'] + 0.02
            y0 = self.y(t)
            # Two carbon stalks sweeping out and up from the door to the pod.
            pod = Vector((x0 + s * 0.23, y0 - 0.04, z0 + 0.07))
            for dy in (0.03, -0.05):
                self.tube([(x0 - s * 0.01, y0 + dy, z0), (x0 + s * 0.1, y0 + dy * 0.6, z0 + 0.05), tuple(pod + Vector((-s * 0.04, dy * 0.4, -0.01)))], 0.009, 'carbon', verts=10)
            self.pod((0.11, 0.075, 0.048), tuple(pod), 'paint', rot=(0, 0, s * 0.12))
            self.pod((0.095, 0.01, 0.036), tuple(pod + Vector((0, -0.07, 0))), 'glass', rot=(0, 0, s * 0.12), seg=24, rings=10)
            self.box((0.07, 0.01, 0.006), tuple(pod + Vector((s * 0.03, 0.0, 0.04))), 'amber', rot=(0, 0, s * 0.12))

    def canards(self, z=0.36):
        # Dive planes on the bumper corners: rooted in the body side just behind the nose.
        for s in (-1, 1):
            for k, dz in enumerate((0.0, 0.085)):
                t = 0.045 + 0.02 * k
                xs = self.side_x(s, t, z + dz)
                self.box((0.08, 0.13, 0.009), (xs + s * 0.022, self.y(t), z + dz), 'carbon', rot=(0.1, s * 0.25, -s * 0.35), bevel=0.003)

    def roof_scoop(self, t=0.5, w=0.36, l=0.7, h=0.1):
        zt = self.top_z(0, t)
        y = self.y(t)
        self.pod((w / 2, l / 2, h), (0, y - l * 0.1, zt - h * 0.2), 'paint', seg=48, rings=24)
        # Intake mouth: dark opening with a mesh in front.
        self.pod((w * 0.4, 0.03, h * 0.55), (0, y + l * 0.33, zt + h * 0.42), 'well', seg=24, rings=12)
        self.mesh_insert((0, y + l * 0.355, zt + h * 0.42), (1, 0, 0), (0, 0, 1), w * 0.72, h * 0.8, pitch=0.018, bar=0.004)

    def door_handles(self, t=0.5):
        p = self.P(t)
        for s in (-1, 1):
            z = p['zsh'] - 0.04
            x = self.side_x(s, t, z)
            self.box((0.012, 0.16, 0.03), (x - s * 0.002, self.y(t), z), 'trim', bevel=0.008)

    def fuel_cap(self, t=0.74, s=1):
        z = self.P(t)['zsh'] - 0.02
        x = self.side_x(s, t, z)
        self.cyl(0.05, 0.012, (x - s * 0.002, self.y(t), z), 'chrome', rot=(0, math.pi / 2, 0), verts=40)
        self.cyl(0.04, 0.014, (x, self.y(t), z), 'carbon', rot=(0, math.pi / 2, 0), verts=40)

    def carbon_scoops(self, t=0.64, z=0.55, size=(0.5, 0.56, 0.3), fins=5):
        for s in (-1, 1):
            x = self.side_x(s, t, z)
            self.cut_box(size, (x, self.y(t), z), rot=(0, 0, s * 0.22), bevel=0.06)
            self.mesh_insert((x - s * 0.18, self.y(t), z), (0, 1, 0), (0, 0, 1), size[1] * 0.85, size[2] * 0.75, pitch=0.022, bar=0.005)
            for i in range(fins):
                zz = z - size[2] * 0.34 + i * size[2] * 0.68 / max(1, fins - 1)
                self.box((0.2, size[1] * 0.9, 0.01), (x - s * 0.07, self.y(t), zz), 'carbon', rot=(0.0, 0, s * 0.22), bevel=0.003)

    def louvres_fine(self, t0, t1, n=13, w=0.62):
        for i in range(n):
            t = t0 + (t1 - t0) * (i + 0.5) / n
            zt = self.top_z(0, t)
            self.box((w, 0.02, 0.008), (0, self.y(t), zt + 0.014), 'carbon', rot=(-0.4, 0, 0), bevel=0.003)
        for s in (-1, 1):  # frame rails
            tm = (t0 + t1) / 2
            self.box((0.014, (t1 - t0) * self.L, 0.016), (s * (w / 2 + 0.01), self.y(tm), self.top_z(s * w / 2, tm) + 0.008), 'trim', bevel=0.004)

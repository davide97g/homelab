"""
GMKtec NucBox M6 / M6 Ultra height-extension stand.
Parametric rebuild of the M5 Plus / K6 stand by 'mintonette' (MakerWorld 1710632, CC BY-NC-SA),
re-dimensioned for the M6 Ultra chassis (128.8 x 127 x 47.8 mm).

Printed in the file's own orientation: z=0 is on the build plate and is the face
that the mini-PC sits on in use (the stand is flipped after printing).
"""
import cadquery as cq
import math

# ---- device / fit parameters -------------------------------------------------
DX          = 128.8   # chassis width  (M6 Ultra / K6 spec)
DY          = 127.0   # chassis depth
R_OUT       = 10.0    # outer corner radius
# Socket centres are kept EXACTLY where the proven K6 design puts them, because the
# M6 Ultra uses the same chassis - shifting them with the 0.2 mm footprint change would
# only eat into the 0.15 mm radial friction clearance.
SOCK_CX     = 54.5    # socket centre, X (109.0 mm centre-to-centre)
SOCK_CY     = 53.5    # socket centre, Y (107.0 mm centre-to-centre)
SOCK_INSET  = 10.0    # outer corner radius is centred on the foot
SOCK_D      = 12.30   # socket bore (device feet are 12.0 -> 0.30 friction clearance)
LEAD_IN     = 0.80    # NEW: 45 deg lead-in chamfer at the socket mouth

# ---- frame ------------------------------------------------------------------
RIM         = 6.0     # rim width at the middle of each edge
R_IN        = 36.0    # inner opening corner radius
PLATE_T     = 3.0     # top plate thickness
TOTAL_H     = 16.0    # total stand height  (= ground clearance in use)
LEG         = 22.75   # corner-leg footprint (square, anchored at the outer corner)
LEG_FIL     = 1.5     # fillet where the leg meets the rim

# ---- socket internals (self-supporting, no supports needed) ------------------
CYL_TOP     = 8.50    # straight bore from z=0 up to here
CONE_TOP    = 13.00   # cone closes down to the vent bore here
VENT_D      = 3.00    # vent / push-out bore through the bottom of the leg

# ---- orientation notch (marks the 127 mm axis) -------------------------------
NOTCH_W     = 10.0
NOTCH_D     = 1.5

hx, hy = DX / 2.0, DY / 2.0
sx, sy = SOCK_CX, SOCK_CY                          # socket centres
ix, iy = DX - 2 * RIM, DY - 2 * RIM                # inner opening size

def rrect(w, h, r):
    return cq.Workplane("XY").rect(w, h).vertices().fillet(r).wires().toPending()

# ---- top plate ---------------------------------------------------------------
outer = cq.Workplane("XY").rect(DX, DY).extrude(TOTAL_H).edges("|Z").fillet(R_OUT)
plate = cq.Workplane("XY").rect(DX, DY).extrude(PLATE_T).edges("|Z").fillet(R_OUT)
inner = cq.Workplane("XY").rect(ix, iy).extrude(PLATE_T).edges("|Z").fillet(R_IN)
plate = plate.cut(inner)

# orientation notch: a shallow bulge of the rim into the opening on the -Y side
nr = (( NOTCH_W / 2.0) ** 2 + NOTCH_D ** 2) / (2.0 * NOTCH_D)
nyc = -(iy / 2.0) - nr + NOTCH_D
bump = (cq.Workplane("XY").center(0, nyc).circle(nr).extrude(PLATE_T)
          .intersect(cq.Workplane("XY").rect(DX, DY).extrude(PLATE_T).edges("|Z").fillet(R_OUT)))
plate = plate.union(bump)

# ---- corner legs -------------------------------------------------------------
legs = None
for gx in (-1, 1):
    for gy in (-1, 1):
        x0, x1 = (hx - LEG, hx) if gx > 0 else (-hx, -hx + LEG)
        y0, y1 = (hy - LEG, hy) if gy > 0 else (-hy, -hy + LEG)
        box = (cq.Workplane("XY")
                 .moveTo(x0, y0).rect(LEG, LEG, centered=False)
                 .extrude(TOTAL_H))
        leg = box.intersect(outer).cut(
            cq.Workplane("XY").rect(ix, iy).extrude(TOTAL_H).edges("|Z").fillet(R_IN))
        legs = leg if legs is None else legs.union(leg)

body = plate.union(legs)

# soften the two vertical edges where each leg meets the rim
try:
    body = body.edges("|Z").edges(
        cq.selectors.BoxSelector((-hx + 0.1, -hy + 0.1, PLATE_T + 0.5),
                                 ( hx - 0.1,  hy - 0.1, TOTAL_H - 0.1))).fillet(LEG_FIL)
except Exception as e:
    print("leg fillet skipped:", e)

# ---- foot sockets ------------------------------------------------------------
for gx in (-1, 1):
    for gy in (-1, 1):
        cx, cy = gx * sx, gy * sy
        cut = (cq.Workplane("XY").center(cx, cy).circle(SOCK_D / 2).extrude(CYL_TOP)
               .union(cq.Workplane("XY", origin=(cx, cy, CYL_TOP))
                        .circle(SOCK_D / 2).workplane(offset=CONE_TOP - CYL_TOP)
                        .circle(VENT_D / 2).loft(ruled=True))
               .union(cq.Workplane("XY", origin=(cx, cy, CONE_TOP))
                        .circle(VENT_D / 2).extrude(TOTAL_H - CONE_TOP + 0.1)))
        body = body.cut(cut)

# lead-in chamfer at each socket mouth (z=0 face) -- socket circles only
cands = body.faces("<Z").edges("%CIRCLE").vals()
socket_edges = []
for e in cands:
    try:
        r = e.radius()
    except Exception:
        continue
    if abs(r - SOCK_D / 2.0) < 0.05:
        socket_edges.append(e)
print("socket mouth edges found:", len(socket_edges))
assert len(socket_edges) == 4, "expected 4 socket mouths"
body = body.newObject(socket_edges).chamfer(LEAD_IN)

cq.exporters.export(body, "m6_stand.stl", tolerance=0.01, angularTolerance=0.1)
cq.exporters.export(body, "m6_stand.step")
print("socket centres: (+-%.2f, +-%.2f)  spacing %.1f x %.1f" % (sx, sy, 2*sx, 2*sy))
print("volume mm3:", body.val().Volume())
print("bbox:", body.val().BoundingBox().xlen, body.val().BoundingBox().ylen, body.val().BoundingBox().zlen)

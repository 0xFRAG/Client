// Must match server constants
export const MOVE_SPEED = 5.0;
export const GRAVITY = 20.0;
export const JUMP_VELOCITY = 8.0;
export const PLAYER_HALF = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const GROUND_SLIP = 0.85;   // velocity multiplier per tick (60Hz)
export const AIR_SLIP = 0.99;      // slow friction in air
export const TICK_DT = 1 / 60;     // fixed physics timestep (must match server)
export const EYE_HEIGHT = 1.6;
export const JUMP_BUFFER_MS = 100;
export const MOUSE_SENSITIVITY = 0.002;

// --- Collision (mirrors server logic) ---

export function collides(map, px, py, pz) {
    const pMinX = px - PLAYER_HALF;
    const pMaxX = px + PLAYER_HALF;
    const pMinY = py;
    const pMaxY = py + PLAYER_HEIGHT;
    const pMinZ = pz - PLAYER_HALF;
    const pMaxZ = pz + PLAYER_HALF;

    for (const block of map.blocks) {
        const bMinY = block.pos.y;
        const bMaxY = block.pos.y + block.size.y;

        // Y overlap (shared by all shapes)
        if (!(pMinY < bMaxY && pMaxY > bMinY)) continue;

        if (block.shape === "cylinder") {
            // Circle vs AABB in XZ
            const cx = block.pos.x + block.size.x / 2;
            const cz = block.pos.z + block.size.z / 2;
            const r = Math.min(block.size.x, block.size.z) / 2;

            const nearestX = Math.max(pMinX, Math.min(cx, pMaxX));
            const nearestZ = Math.max(pMinZ, Math.min(cz, pMaxZ));
            const dx = nearestX - cx;
            const dz = nearestZ - cz;

            if (dx * dx + dz * dz < r * r) return true;
        } else {
            // Standard AABB
            const bMinX = block.pos.x;
            const bMaxX = block.pos.x + block.size.x;
            const bMinZ = block.pos.z;
            const bMaxZ = block.pos.z + block.size.z;

            if (
                pMinX < bMaxX && pMaxX > bMinX &&
                pMinZ < bMaxZ && pMaxZ > bMinZ
            ) {
                return true;
            }
        }
    }

    // Out of bounds
    return (
        pMinX < 0 || pMaxX > map.size.x ||
        pMinZ < 0 || pMaxZ > map.size.z
    );
}

// --- Raycast against map blocks (client-side, for laser sight) ---

export function raycastBlocks(map, ox, oy, oz, dx, dy, dz, maxT) {
    let closest = maxT;
    for (const block of map.blocks) {
        const bt = block.type;
        if (bt === "floor" || bt === "ground") continue;

        const bMinX = block.pos.x;
        const bMinY = block.pos.y;
        const bMinZ = block.pos.z;
        const bMaxX = block.pos.x + block.size.x;
        const bMaxY = block.pos.y + block.size.y;
        const bMaxZ = block.pos.z + block.size.z;

        let tMin = 0, tMax = closest;

        if (Math.abs(dx) < 1e-9) {
            if (ox < bMinX || ox > bMaxX) continue;
        } else {
            const inv = 1.0 / dx;
            let t1 = (bMinX - ox) * inv;
            let t2 = (bMaxX - ox) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) continue;
        }

        if (Math.abs(dy) < 1e-9) {
            if (oy < bMinY || oy > bMaxY) continue;
        } else {
            const inv = 1.0 / dy;
            let t1 = (bMinY - oy) * inv;
            let t2 = (bMaxY - oy) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) continue;
        }

        if (Math.abs(dz) < 1e-9) {
            if (oz < bMinZ || oz > bMaxZ) continue;
        } else {
            const inv = 1.0 / dz;
            let t1 = (bMinZ - oz) * inv;
            let t2 = (bMaxZ - oz) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) continue;
        }

        if (tMin > 0 && tMin < closest) {
            closest = tMin;
        }
    }
    return closest;
}

// --- Ray-AABB against a player hitbox (client-side, for laser sight) ---

export function rayHitPlayerAABB(ox, oy, oz, dx, dy, dz, px, py, pz) {
    const MAX_RANGE = 200.0;
    const bMinX = px - PLAYER_HALF;
    const bMaxX = px + PLAYER_HALF;
    const bMinY = py;
    const bMaxY = py + PLAYER_HEIGHT;
    const bMinZ = pz - PLAYER_HALF;
    const bMaxZ = pz + PLAYER_HALF;

    let tMin = 0, tMax = MAX_RANGE;

    if (Math.abs(dx) < 1e-9) {
        if (ox < bMinX || ox > bMaxX) return null;
    } else {
        const inv = 1.0 / dx;
        let t1 = (bMinX - ox) * inv;
        let t2 = (bMaxX - ox) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    if (Math.abs(dy) < 1e-9) {
        if (oy < bMinY || oy > bMaxY) return null;
    } else {
        const inv = 1.0 / dy;
        let t1 = (bMinY - oy) * inv;
        let t2 = (bMaxY - oy) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    if (Math.abs(dz) < 1e-9) {
        if (oz < bMinZ || oz > bMaxZ) return null;
    } else {
        const inv = 1.0 / dz;
        let t1 = (bMinZ - oz) * inv;
        let t2 = (bMaxZ - oz) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    if (tMin > 0) return tMin;
    if (tMax > 0) return tMax;
    return null;
}

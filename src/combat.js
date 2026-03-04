import * as THREE from "three";
import { createCharacterModel, disposeCharacter } from "./character.js";

export const MAGAZINE_SIZE = 30;
export const MAX_RANGE = 200.0;

// --- Username sprite ---

export function createNameSprite(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 32px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 4;
    ctx.strokeText(name, 128, 32);
    ctx.fillText(name, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2, 0.5, 1);
    sprite.name = "nameSprite";
    return sprite;
}

export function updateNameSprite(mesh, name) {
    const existing = mesh.getObjectByName("nameSprite");
    if (existing) {
        existing.material.map.dispose();
        existing.material.dispose();
        mesh.remove(existing);
    }
    const sprite = createNameSprite(name);
    sprite.position.set(0, 2.1, 0); // above head (origin at feet)
    mesh.add(sprite);
}

export function updatePlayers(scene, players, snapshots, localPlayerId, pred, playerNames, sharedGeo, skinTexture, combatState) {
    const seen = new Set();

    for (const p of snapshots) {
        seen.add(p.id);

        // Store server state for local player correction + combat state
        if (p.id === localPlayerId) {
            pred.sx = p.x;
            pred.sy = p.y;
            pred.sz = p.z;
            pred.svy = p.vy;
            combatState.health = p.health;
            combatState.ammo = p.ammo;
            combatState.dead = p.dead;
            combatState.reloading = p.reloading;
            combatState.shooting = p.shooting;
            continue;
        }

        // Other players
        let group = players.get(p.id);
        if (!group) {
            group = createCharacterModel(sharedGeo, skinTexture);
            group.position.set(p.x, p.y, p.z);
            group.rotation.y = p.rot;
            scene.add(group);
            players.set(p.id, group);
        }

        // Always ensure name sprite is present if we know the name
        const info = playerNames.get(p.id);
        if (info && !group.getObjectByName("nameSprite")) {
            updateNameSprite(group, info.username);
        }

        // Calculate target speed from position deltas
        const d = group.userData;
        if (d.prevX !== undefined) {
            const dx = p.x - d.prevX;
            const dz = p.z - d.prevZ;
            d.targetSpeed = Math.sqrt(dx * dx + dz * dz) * 60;
        }
        d.prevX = p.x;
        d.prevZ = p.z;
        d.animVy = p.vy;
        d.animPitch = p.pitch;
        d.animSneaking = p.sneaking;

        // Store target for per-frame smoothing (origin at feet, no +0.9)
        d.tx = p.x;
        d.ty = p.y;
        d.tz = p.z;
        d.tr = p.rot;

        // Third-person weapon
        updateThirdPersonWeapon(group, p.weaponSlot, p.shooting);
    }

    for (const [id, group] of players) {
        if (!seen.has(id)) {
            disposeCharacter(group);
            scene.remove(group);
            players.delete(id);
        }
    }
}

export function updateThirdPersonWeapon(group, slot, shooting) {
    const d = group.userData;
    const pivots = d.pivots;
    if (!pivots) return;

    if (slot === 1) {
        if (!d.weaponMesh) {
            const gunGeo = new THREE.BoxGeometry(0.04, 0.03, 0.15);
            const gunMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
            d.weaponMesh = new THREE.Mesh(gunGeo, gunMat);
            d.weaponMesh.position.set(0, -0.28, -0.12);
            pivots.rightArmPivot.children[0].add(d.weaponMesh); // attach to right arm mesh
        }
        d.weaponMesh.visible = true;

        // Muzzle flash
        if (shooting) {
            if (!d.tpFlash) {
                const fmat = new THREE.SpriteMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9, depthTest: false });
                d.tpFlash = new THREE.Sprite(fmat);
                d.tpFlash.scale.set(0.06, 0.06, 0.06);
                d.tpFlash.position.set(0, 0, -0.08);
                d.weaponMesh.add(d.tpFlash);
            }
            d.tpFlash.visible = true;
        } else if (d.tpFlash) {
            d.tpFlash.visible = false;
        }
    } else if (d.weaponMesh) {
        d.weaponMesh.visible = false;
        if (d.tpFlash) d.tpFlash.visible = false;
    }
}

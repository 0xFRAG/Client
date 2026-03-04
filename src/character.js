import * as THREE from "three";

const PX = 1.8 / 32; // 0.05625 units per pixel
const TEX_SIZE = 64;
const MOVE_SPEED = 5.0;

// --- Skin UV mapping (64x64 layout) ---

function setUVs(geometry, texX, texY, partW, partH, partD) {
    const uv = geometry.attributes.uv;

    // Three.js BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
    // Skin strip layout for part at (texX, texY):
    //   Row 0 (D px high):  [D empty] [W top]    [D+W bottom]
    //   Row 1 (H px high):  [D right] [W front]  [D left]     [W back]
    //
    // Model faces -Z (Three.js camera convention), so remap:
    //   +X → character left,  -X → character right
    //   +Z → character back,  -Z → character front
    // X faces need U-flip because depth axis is reversed.
    const regions = [
        // +X → character left
        [texX + partD + partW, texY + partD, texX + 2 * partD + partW, texY + partD + partH],
        // -X → character right
        [texX, texY + partD, texX + partD, texY + partD + partH],
        // +Y → top
        [texX + partD, texY, texX + partD + partW, texY + partD],
        // -Y → bottom
        [texX + partD + partW, texY, texX + 2 * partD + partW, texY + partD],
        // +Z → back
        [texX + 2 * partD + partW, texY + partD, texX + 2 * (partD + partW), texY + partD + partH],
        // -Z → front
        [texX + partD, texY + partD, texX + partD + partW, texY + partD + partH],
    ];

    const flipU = [true, true, false, false, false, false];

    for (let f = 0; f < 6; f++) {
        const [x0, y0, x1, y1] = regions[f];
        let u0 = x0 / TEX_SIZE, u1 = x1 / TEX_SIZE;
        const v0 = 1 - y1 / TEX_SIZE, v1 = 1 - y0 / TEX_SIZE;
        if (flipU[f]) { const tmp = u0; u0 = u1; u1 = tmp; }
        const i = f * 4;
        uv.setXY(i, u0, v1);
        uv.setXY(i + 1, u1, v1);
        uv.setXY(i + 2, u0, v0);
        uv.setXY(i + 3, u1, v0);
    }

    uv.needsUpdate = true;
}

// --- Shared geometries (call once, reuse across all players) ---

export function createSharedGeometries() {
    const head = new THREE.BoxGeometry(8 * PX, 8 * PX, 8 * PX);
    const torso = new THREE.BoxGeometry(8 * PX, 12 * PX, 4 * PX);
    const arm = new THREE.BoxGeometry(4 * PX, 12 * PX, 4 * PX);
    const upperLeg = new THREE.BoxGeometry(4 * PX, 6 * PX, 4 * PX);
    const lowerLeg = new THREE.BoxGeometry(4 * PX, 6 * PX, 4 * PX);

    setUVs(head, 0, 0, 8, 8, 8);
    setUVs(torso, 16, 16, 8, 12, 4);
    setUVs(arm, 40, 16, 4, 12, 4);
    setUVs(upperLeg, 0, 16, 4, 6, 4);
    setUVs(lowerLeg, 0, 22, 4, 6, 4);

    return { head, torso, arm, upperLeg, lowerLeg };
}

// --- Character model factory ---

export function createCharacterModel(sharedGeo, skinTexture) {
    const mat = new THREE.MeshLambertMaterial({ map: skinTexture });

    const group = new THREE.Group(); // origin at feet, rotation.y = yaw
    const body = new THREE.Group();
    group.add(body);

    // Upper body pivots at hip level (y=0.675) — sneak tilts this as one unit
    const upperBody = new THREE.Group();
    upperBody.position.y = 0.675;
    body.add(upperBody);

    // Torso (offset relative to upperBody pivot)
    const torso = new THREE.Mesh(sharedGeo.torso, mat);
    torso.position.y = 1.0125 - 0.675; // 0.3375
    upperBody.add(torso);

    // Head (pivot at neck = bottom of head, so pitch rotates naturally)
    const headPivot = new THREE.Group();
    headPivot.position.y = 1.35 - 0.675; // 0.675 = torso top = neck
    const head = new THREE.Mesh(sharedGeo.head, mat);
    head.position.y = 0.225; // half head height up from pivot
    headPivot.add(head);
    upperBody.add(headPivot);

    // Right arm (pivot at shoulder)
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.3375, 1.35 - 0.675, 0); // 0.675
    const rightArm = new THREE.Mesh(sharedGeo.arm, mat);
    rightArm.position.y = -0.3375;
    rightArmPivot.add(rightArm);
    upperBody.add(rightArmPivot);

    // Left arm (pivot at shoulder)
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.3375, 1.35 - 0.675, 0); // 0.675
    const leftArm = new THREE.Mesh(sharedGeo.arm, mat);
    leftArm.position.y = -0.3375;
    leftArmPivot.add(leftArm);
    upperBody.add(leftArmPivot);

    // Right leg (pivot at hip — stays in body, not upperBody)
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.1125, 0.675, 0);
    const rightUpperLeg = new THREE.Mesh(sharedGeo.upperLeg, mat);
    rightUpperLeg.position.y = -0.16875; // center of upper half
    rightLegPivot.add(rightUpperLeg);
    const rightKneePivot = new THREE.Group();
    rightKneePivot.position.y = -0.3375; // bottom of upper leg
    const rightLowerLeg = new THREE.Mesh(sharedGeo.lowerLeg, mat);
    rightLowerLeg.position.y = -0.16875; // center of lower half
    rightKneePivot.add(rightLowerLeg);
    rightLegPivot.add(rightKneePivot);
    body.add(rightLegPivot);

    // Left leg (pivot at hip — stays in body, not upperBody)
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.1125, 0.675, 0);
    const leftUpperLeg = new THREE.Mesh(sharedGeo.upperLeg, mat);
    leftUpperLeg.position.y = -0.16875;
    leftLegPivot.add(leftUpperLeg);
    const leftKneePivot = new THREE.Group();
    leftKneePivot.position.y = -0.3375;
    const leftLowerLeg = new THREE.Mesh(sharedGeo.lowerLeg, mat);
    leftLowerLeg.position.y = -0.16875;
    leftKneePivot.add(leftLowerLeg);
    leftLegPivot.add(leftKneePivot);
    body.add(leftLegPivot);

    // Direct refs for animation (no tree traversal per frame)
    group.userData.pivots = {
        body,
        upperBody,
        torso,
        headPivot,
        head,
        rightArmPivot,
        leftArmPivot,
        rightLegPivot,
        leftLegPivot,
        rightKneePivot,
        leftKneePivot,
    };

    // Animation state
    group.userData.animPhase = 0;
    group.userData.animSpeed = 0;
    group.userData.animVy = 0;
    group.userData.animPitch = 0; // server-sent look pitch
    group.userData.animSneaking = false;
    group.userData.prevX = undefined;
    group.userData.prevZ = undefined;
    group.userData.targetSpeed = 0;
    group.userData.bodyYaw = undefined; // lazy-init to group yaw on first frame

    return group;
}

// --- Animation state machine ---

const JUMP_VELOCITY = 8.0;

export function updateCharacterAnimation(group, frameDt) {
    const d = group.userData;
    const p = d.pivots;
    if (!p) return;

    const speed = d.animSpeed;
    const onGround = Math.abs(d.animVy) < 0.5;

    // Smooth limb transitions (50ms half-life — visible blend, no pop)
    const limbSmooth = 1 - Math.pow(0.5, frameDt / 0.05);

    let targetRA = 0, targetLA = 0, targetRL = 0, targetLL = 0;
    let targetRK = 0, targetLK = 0; // knee bend
    let bodyBob = 0;
    let headBobY = 0, headTilt = 0;
    let torsoTwist = 0;

    // Head pitch = actual look direction from server (negative = looking up in Three.js)
    const headPitch = d.animPitch;

    if (speed >= 0.3 && onGround) {
        // Walk — 2 full leg cycles per second at max speed
        d.animPhase += (speed / MOVE_SPEED) * frameDt * Math.PI * 4;
        const phase = d.animPhase;

        const legSwing = Math.sin(phase) * 0.6;
        const armSwing = Math.sin(phase) * 0.5;

        targetRL = legSwing;
        targetLL = -legSwing;
        targetRA = -armSwing;  // counter-swing
        targetLA = armSwing;

        // Head bob at 2x leg frequency (once per step)
        headBobY = Math.abs(Math.sin(phase)) * 0.025;
        // Subtle head sway (tilts left-right with steps)
        headTilt = Math.sin(phase) * 0.03;
        // Torso twist counter to arm swing
        torsoTwist = Math.sin(phase) * 0.04;
    } else if (!onGround) {
        // Airborne — smooth blend based on normalized vy
        const vyNorm = Math.max(-1, Math.min(1, d.animVy / JUMP_VELOCITY));
        targetRA = -0.3 - vyNorm * 0.2; // arms raise more going up
        targetLA = -0.3 - vyNorm * 0.2;
        targetRL = -vyNorm * 0.3;
        targetLL = vyNorm * 0.3;
    }

    // --- Sneaking / crouch (Minecraft-style: upper body leans, knees bend) ---

    const sneaking = d.animSneaking;
    const crouchUpperX = sneaking ? -0.4 : 0;

    if (sneaking) {
        targetRL += 0.4;  // upper legs tilt forward (thighs angle down)
        targetLL += 0.4;
        targetRK = -0.8;  // knees bend backward (natural bend)
        targetLK = -0.8;
    }

    // --- Body yaw lag (body rotates slower than look direction, head compensates) ---

    const currentYaw = group.rotation.y;
    if (d.bodyYaw === undefined) d.bodyYaw = currentYaw;

    let yawDiff = currentYaw - d.bodyYaw;
    if (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    if (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
    const bodyYawSmooth = 1 - Math.pow(0.5, frameDt / 0.08); // 80ms half-life
    d.bodyYaw += yawDiff * bodyYawSmooth;

    // Body offset from look direction (clamped to ±30°)
    let bodyOffset = d.bodyYaw - currentYaw;
    if (bodyOffset > Math.PI) bodyOffset -= 2 * Math.PI;
    if (bodyOffset < -Math.PI) bodyOffset += 2 * Math.PI;
    bodyOffset = Math.max(-0.52, Math.min(0.52, bodyOffset));

    p.body.rotation.y = bodyOffset;
    // Head counter-rotates to face the actual look direction
    p.headPivot.rotation.y = -bodyOffset;

    // --- Apply limb rotations with smoothing ---

    p.rightArmPivot.rotation.x += (targetRA - p.rightArmPivot.rotation.x) * limbSmooth;
    p.leftArmPivot.rotation.x += (targetLA - p.leftArmPivot.rotation.x) * limbSmooth;
    p.rightLegPivot.rotation.x += (targetRL - p.rightLegPivot.rotation.x) * limbSmooth;
    p.leftLegPivot.rotation.x += (targetLL - p.leftLegPivot.rotation.x) * limbSmooth;
    p.rightKneePivot.rotation.x += (targetRK - p.rightKneePivot.rotation.x) * limbSmooth;
    p.leftKneePivot.rotation.x += (targetLK - p.leftKneePivot.rotation.x) * limbSmooth;

    // --- Head movement (headPivot at neck, rotations pivot from bottom of head) ---

    const targetHeadPivotY = (1.35 - 0.675) + headBobY; // 0.675 + bob
    p.headPivot.position.y += (targetHeadPivotY - p.headPivot.position.y) * limbSmooth;
    p.headPivot.rotation.x += (headPitch - crouchUpperX - p.headPivot.rotation.x) * limbSmooth;
    p.headPivot.rotation.z += (headTilt - p.headPivot.rotation.z) * limbSmooth;

    // --- Upper body crouch lean (pivots at hip, tilts torso+head+arms together) ---

    p.upperBody.rotation.x += (crouchUpperX - p.upperBody.rotation.x) * limbSmooth;

    // --- Torso twist + body bob + crouch ---

    p.torso.rotation.y += (torsoTwist - p.torso.rotation.y) * limbSmooth;
    p.body.position.y += (bodyBob - p.body.position.y) * limbSmooth;
}

// --- Disposal (geometries are shared, only dispose materials) ---

export function disposeCharacter(group) {
    // All body meshes share one material — dispose once via head ref
    const pivots = group.userData.pivots;
    if (pivots) pivots.head.material.dispose();

    // Dispose name sprite if present
    const nameSprite = group.getObjectByName("nameSprite");
    if (nameSprite) {
        nameSprite.material.map.dispose();
        nameSprite.material.dispose();
    }
}

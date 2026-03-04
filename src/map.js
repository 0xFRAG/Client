import * as THREE from "three";

export const BLOCK_COLORS = {
    floor: 0x888888,
    wall: 0x444444,
    pillar: 0xffffff,
};

export function makeConcreteTexture() {
    const size = 16;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    // Smooth concrete: base gray with subtle per-pixel variation
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const base = 128;
            const noise = Math.floor(Math.random() * 14) - 7; // -7..+6
            const v = Math.max(0, Math.min(255, base + noise));
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

export function buildMap(scene, map) {
    const meshes = [];
    const floorTex = makeConcreteTexture();
    for (const block of map.blocks) {
        const { x: sx, y: sy, z: sz } = block.size;
        let geo, mat;
        if (block.type === "pillar") {
            const r = Math.min(sx, sz) / 2;
            geo = new THREE.CylinderGeometry(r, r, sy, 32);
            mat = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.pillar });
        } else if (block.type === "floor") {
            geo = new THREE.BoxGeometry(sx, sy, sz);
            const tex = floorTex.clone();
            tex.repeat.set(sx, sz);
            mat = new THREE.MeshLambertMaterial({ map: tex });
        } else {
            geo = new THREE.BoxGeometry(sx, sy, sz);
            mat = new THREE.MeshLambertMaterial({
                color: BLOCK_COLORS[block.type] || 0xaaaaaa,
            });
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(block.pos.x + sx / 2, block.pos.y + sy / 2, block.pos.z + sz / 2);
        scene.add(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

export function buildLobbyHud(scene, center) {
    const HUD_COLOR = 0x4dc9f6;
    const HUD_CSS = "#4dc9f6";
    const radius = 4;
    const hudHeight = 4;
    const y = 8;
    const gapAngle = Math.PI / 10;  // 18° gap between panels
    const hudAngle = (2 * Math.PI - 4 * gapAngle) / 4; // arc per panel
    const curveSegs = 32;

    const hudGroup = new THREE.Group();
    hudGroup.position.set(center.x, y, center.z);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 340;
    const ctx = canvas.getContext("2d");

    function drawStar(cx, cy, outerR) {
        const innerR = outerR * 0.382;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = i * Math.PI / 5 - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            const x = cx + r * Math.cos(a);
            const y = cy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
    }

    function drawText() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = HUD_CSS;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 72px MicroExtend";
        ctx.fillText("0xFRAG", canvas.width / 2, 80);
        ctx.font = "bold 28px MicroExtend";
        ctx.fillText("European District Lobby", canvas.width / 2, 150);
        // EU stars — 12 stars in a circle, corrected for texture stretch
        const ringX = canvas.width / 2;
        const ringY = 250;
        const arcLength = radius * hudAngle;
        const aspect = (canvas.height * arcLength) / (canvas.width * hudHeight);
        const ringRx = 50;
        const ringRy = ringRx * aspect;
        for (let i = 0; i < 12; i++) {
            const a = i * (2 * Math.PI / 12) - Math.PI / 2;
            drawStar(ringX + ringRx * Math.cos(a), ringY + ringRy * Math.sin(a), 9);
        }
    }

    function buildScreens(texture) {
        for (let i = 0; i < 4; i++) {
            const thetaStart = i * (hudAngle + gapAngle) + gapAngle / 2;

            // Background arc
            const bgGeo = new THREE.CylinderGeometry(
                radius, radius, hudHeight, curveSegs, 1, true, thetaStart, hudAngle
            );
            const bgMat = new THREE.MeshBasicMaterial({
                color: HUD_COLOR,
                opacity: 0.15,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const bgMesh = new THREE.Mesh(bgGeo, bgMat);
            bgMesh.frustumCulled = false;
            hudGroup.add(bgMesh);

            // Border (threshold filters out internal curve edges)
            const edgesGeo = new THREE.EdgesGeometry(bgGeo, 30);
            const edgesMat = new THREE.LineBasicMaterial({ color: HUD_COLOR });
            const border = new THREE.LineSegments(edgesGeo, edgesMat);
            border.frustumCulled = false;
            hudGroup.add(border);

            // Text arc (slightly outside background)
            const textGeo = new THREE.CylinderGeometry(
                radius + 0.02, radius + 0.02, hudHeight, curveSegs, 1, true, thetaStart, hudAngle
            );
            const textMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const textMesh = new THREE.Mesh(textGeo, textMat);
            textMesh.frustumCulled = false;
            hudGroup.add(textMesh);
        }
    }

    document.fonts.ready.then(() => {
        drawText();
        const texture = new THREE.CanvasTexture(canvas);
        buildScreens(texture);
    });

    scene.add(hudGroup);
    return hudGroup;
}

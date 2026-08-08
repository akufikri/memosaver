import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

const canvas = document.getElementById('canvas');
const statsEl = document.getElementById('stats');
const tooltipEl = document.getElementById('tooltip');
const projectFilter = document.getElementById('project-filter');

const COLORS = {
  project: 0x6c8cff,
  session: 0x3ddc97,
  memory: 0xffb648,
  checkpoint: 0xc77dff
};

const SIMILAR_COLOR = 0x5b8dff;

// ---------- renderer / scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch {
  renderer = null;
}
if (!renderer) {
  showFatal('Your browser could not create a WebGL context.<br>Please enable hardware acceleration / WebGL, or use a desktop browser.');
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070910, 250, 650);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 1200);
camera.position.set(0, 90, 200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(120, 200, 160);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x6c8cff, 0.8, 500);
rimLight.position.set(-180, 60, -120);
scene.add(rimLight);

// tiny starfield
{
  const count = 500;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 900;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 600;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 600;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb0d8, size: 0.8, transparent: true, opacity: 0.5 });
  scene.add(new THREE.Points(geo, mat));
}

// ---------- graph state ----------
let nodes = [];
let edges = [];
const meshByNode = new Map(); // id -> mesh
const posStore = new Map();   // id -> THREE.Vector3 (desired)
const velStore = new Map();   // id -> THREE.Vector3

let lineStore = null;

// ---------- layout & entrance animation ----------
// Deterministic hierarchical layout, then a short choreographed "expand from
// center" animation. No permanent force sim -> graph stays still after entry.

const targetStore = new Map(); // id -> final layout position
const originStore = new Map();  // id -> entry (scaled-out) position
let entranceT = 0;              // 0..1 animation progress

function initPhysics() {
  posStore.clear();
  velStore.clear();
  targetStore.clear();
  originStore.clear();

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const parentMap = new Map(); // child id -> parent id (first contains edge)
  const childMap = new Map();  // parent id -> [child ids]
  for (const edge of edges) {
    if (edge.kind !== 'contains') continue;
    parentMap.set(edge.target, edge.source);
    if (!childMap.has(edge.source)) childMap.set(edge.source, []);
    childMap.get(edge.source).push(edge.target);
  }

  const projectNodes = nodes.filter((n) => n.kind === 'project');
  const projectPos = new Map();

  // 1) projects
  projectNodes.forEach((n, i) => {
    const center = new THREE.Vector3(0, 0, 0);
    if (projectNodes.length > 1) {
      const a = (i / projectNodes.length) * Math.PI * 2;
      center.set(Math.cos(a) * 80, Math.sin(a) * 80 * 0.6, Math.sin(a * 2) * 20);
    }
    projectPos.set(n.id, center);
    targetStore.set(n.id, center);
  });

  const rootId = projectNodes[0]?.id ?? 'root';
  if (!projectNodes.length) targetStore.set(rootId, new THREE.Vector3(0, 0, 0));

  function placeRing(center, radius, count, index, kind) {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2;
    const spread = kind === 'session' ? 0.06 : 0.35;
    const j = ((index * 37) % 100) / 100 - 0.5; // deterministic pseudo-jitter
    return new THREE.Vector3(
      center.x + Math.cos(angle) * radius + j * radius * spread,
      center.y + Math.sin(angle) * radius * 0.78 + j * radius * spread,
      center.z + Math.sin(angle * 1.5) * radius * 0.4 + j * radius * spread * 1.6
    );
  }

  // 2) sessions ring around their project
  for (const node of nodes.filter((n) => n.kind === 'session')) {
    const parentId = parentMap.get(node.id);
    const center = projectPos.get(parentId) ?? new THREE.Vector3(0, 0, 0);
    const sessionSibs = (childMap.get(parentId) ?? []).filter((c) => nodeById.get(c)?.kind === 'session');
    const count = Math.max(sessionSibs.length, 1);
    const idx = Math.max(sessionSibs.indexOf(node.id), 0);
    targetStore.set(node.id, placeRing(center, 46, count, idx, 'session'));
  }

  // 3) memories / checkpoints ring around their session
  const leaves = nodes.filter((n) => n.kind === 'memory' || n.kind === 'checkpoint');
  for (const node of leaves) {
    const parentId = parentMap.get(node.id);
    const center = posStore.has(parentId) ? posStore.get(parentId) : projectPos.get(parentId);
    const siblings = (childMap.get(parentId) ?? []).filter((c) => nodeById.get(c)?.kind !== 'session');
    const idx = Math.max(siblings.indexOf(node.id), 0);
    targetStore.set(node.id, placeRing(center ?? new THREE.Vector3(0, 0, 0), 34, Math.max(siblings.length, 1), idx, node.kind));
  }

  // 4) anything left unplaced gets a spot near its default project
  for (const node of nodes) {
    if (targetStore.has(node.id)) continue;
    const center = projectPos.get(parentMap.get(node.id)) ?? new THREE.Vector3(0, 0, 0);
    targetStore.set(node.id, center.clone().add(new THREE.Vector3(Math.random() * 40 - 20, Math.random() * 20 - 10, Math.random() * 40 - 20)));
  }

  // entry positions: target shrunk toward the center -> expansion looks organized
  for (const node of nodes) {
    const t = targetStore.get(node.id);
    originStore.set(node.id, t.clone().multiplyScalar(0.04));
    posStore.set(node.id, originStore.get(node.id).clone());
    velStore.set(node.id, new THREE.Vector3());
  }

  entranceT = 0;
}

function updateEntrance() {
  const speed = 0.018;
  entranceT = Math.min(1, entranceT + speed);
  const e = 1 - Math.pow(1 - entranceT, 3);
  for (const node of nodes) {
    const o = originStore.get(node.id);
    const t = targetStore.get(node.id);
    const p = posStore.get(node.id);
    if (!o || !t || !p) continue;
    p.lerpVectors(o, t, e);
  }
  syncMeshPositions();
  syncLinePositions();
}

// ---------- build meshes & lines ----------
function buildGraphObjects() {
  // clear previous
  for (const mesh of meshByNode.values()) scene.remove(mesh);
  meshByNode.clear();
  if (lineStore) scene.remove(lineStore);

  // node meshes
  for (const node of nodes) {
    const radius = radiusFor(node);
    const geo = new THREE.SphereGeometry(radius, 20, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS[node.kind],
      emissive: COLORS[node.kind],
      emissiveIntensity: kindEmissive(node.kind),
      roughness: 0.35,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nodeId = node.id;
    mesh.userData.kind = node.kind;
    scene.add(mesh);
    meshByNode.set(node.id, mesh);
  }
  syncMeshPositions();

  // edge lines: single LineSegments buffer (contains dim, similar hinted)
  const points = [];
  for (const edge of edges) {
    const a = posStore.get(edge.source);
    const b = posStore.get(edge.target);
    if (!a || !b || !isFinite(a.x) || !isFinite(b.x)) continue;
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  // segment colors
  const colors = [];
  for (const edge of edges) {
    if (!posStore.get(edge.source) || !posStore.get(edge.target)) continue;
    const c = edge.kind === 'similar' ? new THREE.Color(SIMILAR_COLOR) : new THREE.Color(0x3a4152);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  lineStore = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
  );
  scene.add(lineStore);
}

function radiusFor(node) {
  if (node.kind === 'project') return 16;
  if (node.kind === 'session') return 8;
  if (node.kind === 'checkpoint') return 7;
  return 5 + (node.importance ?? 0.5) * 7;
}

function kindEmissive(kind) {
  return kind === 'project' ? 0.85 : 0.45;
}

function syncMeshPositions() {
  for (const node of nodes) {
    const mesh = meshByNode.get(node.id);
    const p = posStore.get(node.id);
    if (mesh && p) mesh.position.copy(p);
  }
}

function syncLinePositions() {
  if (!lineStore) return;
  const attr = lineStore.geometry.getAttribute('position');
  let idx = 0;
  for (const edge of edges) {
    const a = posStore.get(edge.source);
    const b = posStore.get(edge.target);
    if (!a || !b) continue;
    attr.setXYZ(idx, a.x, a.y, a.z);
    attr.setXYZ(idx + 1, b.x, b.y, b.z);
    idx += 2;
  }
  attr.needsUpdate = true;
}

// ---------- dragging via raycast ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let draggingId = null;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragOffset = new THREE.Vector3();

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function pickNode(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const meshes = nodes.map((n) => meshByNode.get(n.id)).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes);
  return hits.length ? hits[0] : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // left only for drag
  const hit = pickNode(e);
  if (hit) {
    // freeze any running entrance animation so drag position sticks
    if (entranceT < 1) {
      entranceT = 1;
      updateEntrance();
    }
    draggingId = hit.object.userData.nodeId;
    const node = nodes.find((n) => n.id === draggingId);
    const center = posStore.get(draggingId);
    if (node && node.kind === 'project') {
      // disallow moving the anchor project
      draggingId = null;
      return;
    }
    controls.enabled = false;
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      center
    );
    const hitPt = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, hitPt);
    dragOffset.copy(center).sub(hitPt);
    renderer.domElement.style.cursor = 'grabbing';
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (draggingId) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hitPt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, hitPt)) {
      const target = hitPt.add(dragOffset).clone();
      posStore.get(draggingId).copy(target);
      velStore.get(draggingId).multiplyScalar(0);
      const mesh = meshByNode.get(draggingId);
      if (mesh) mesh.position.copy(target);
    }
    return;
  }
  // hover highlight
  const hit = pickNode(e);
  setHover(hit ? hit.object.userData.nodeId : null);
  if (hit) {
    showTooltip(hit.object.userData.nodeId, e);
  } else {
    hideTooltip();
  }
});

renderer.domElement.addEventListener('pointerup', () => {
  if (draggingId) {
    draggingId = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = 'grab';
  }
});

// ---------- auto-orbit toggle ----------
let autoOrbit = true;
document.getElementById('orbit').addEventListener('click', () => {
  autoOrbit = !autoOrbit;
  controls.autoRotate = autoOrbit;
  document.getElementById('orbit').textContent = autoOrbit ? '◉ Auto-orbit: ON' : '◯ Auto-orbit: OFF';
});
document.getElementById('reset').addEventListener('click', () => {
  initPhysics();
});
document.getElementById('focus').addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  camera.position.set(0, 60, 220);
});

// ---------- tooltip ----------
function showTooltip(nodeId, e) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  let html = `<div class="kind">${node.kind}</div><div class="body"><strong>${escapeHtml(node.label)}</strong></div>`;
  if (node.type) html += `<div class="body">type: ${escapeHtml(node.type)}</div>`;
  if (node.importance != null) html += `<div class="meta">importance ${node.importance.toFixed(2)}</div>`;
  if (node.status) html += `<div class="meta">status: ${escapeHtml(node.status)}</div>`;
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = (Math.min(e.clientX, window.innerWidth - 360)) + 'px';
  tooltipEl.style.top = (e.clientY + 18) + 'px';
  tooltipEl.classList.add('visible');
}

function hideTooltip() {
  tooltipEl.classList.remove('visible');
}

function setHover(nodeId) {
  for (const mesh of meshByNode.values()) {
    if (mesh.userData.nodeId === nodeId) mesh.scale.setScalar(1.15);
    else mesh.scale.setScalar(1);
  }
  renderer.domElement.style.cursor = nodeId ? 'pointer' : 'grab';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showFatal(message) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;text-align:center;z-index:50;background:rgba(10,12,18,0.85);color:#eef1f8;font-family:system-ui;padding:24px;font-size:14px;line-height:1.7';
  banner.innerHTML = message;
  document.body.appendChild(banner);
}

// ---------- window sizing ----------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ---------- load ----------
const loadingEl = document.getElementById('loading');
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      projectFilter.appendChild(opt);
    }
  } catch (err) {
    console.error('projects load failed:', err);
  }
}

function showLoading() {
  loadingEl.classList.remove('hidden');
  statsEl.textContent = 'loading…';
}

function hideLoading() {
  loadingEl.classList.add('hidden');
}

async function loadGraph() {
  const project = projectFilter.value;
  const url = '/api/graph' + (project ? '?project=' + encodeURIComponent(project) : '');
  showLoading();
  try {
    const res = await fetch(url);
    const data = await res.json();
    nodes = data.nodes;
    edges = data.edges;
    initPhysics();
    buildGraphObjects();
    statsEl.innerHTML = `<b>${nodes.length}</b> nodes · <b>${edges.length}</b> edges`;
  } catch (err) {
    statsEl.textContent = 'failed to load graph';
    console.error(err);
  } finally {
    hideLoading();
  }
}

projectFilter.addEventListener('change', loadGraph);
loadProjects();
loadGraph();

// ---------- animation loop ----------
function animate() {
  requestAnimationFrame(animate);
  if (!draggingId && entranceT < 1) {
    updateEntrance();
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
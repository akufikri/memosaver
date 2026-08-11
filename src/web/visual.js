import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

const canvas = document.getElementById('canvas');
const statsEl = document.getElementById('stats');
const tooltipEl = document.getElementById('tooltip');
const projectFilter = document.getElementById('project-filter');

// one color per project cluster
const PALETTE = [
  0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x4dabf7,
  0x748ffc, 0xda77f2, 0xf783ac, 0x63e6be, 0xa9e34b,
  0xff8787, 0xffec99, 0x74c0fc, 0xb2f2bb, 0xe599f7,
  0xfcc2d7, 0xd0bfff, 0x99e9f2,
];

const KIND_R = { project: 12, session: 7, memory: 4, checkpoint: 5 };

// ---------- renderer ----------
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { renderer = null; }
if (!renderer) {
  showFatal('WebGL unavailable — enable hardware acceleration or use a desktop browser.');
  throw new Error('no WebGL');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0d1117, 1);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

// ---------- orthographic camera (2D) ----------
const VIEW_H = 350;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -VIEW_H * aspect, VIEW_H * aspect, VIEW_H, -VIEW_H, -10, 10
);
camera.position.z = 5;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enableRotate = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
controls.zoomSpeed = 1.2;

// ---------- graph state ----------
let nodes = [], edges = [];
const meshByNode = new Map();
const pos = new Map();       // id -> {x, y}
const vel = new Map();       // id -> {x, y}
const clusterOf = new Map(); // nodeId -> projectId
const colorOf = new Map();   // projectId -> palette hex

let lineSegs = null;
let lineGeo = null;

// ---------- color helpers ----------
function buildColorMaps() {
  clusterOf.clear();
  const parentMap = getParentMap();
  for (const n of nodes) {
    let cur = n.id;
    for (let i = 0; i < 8; i++) {
      const par = parentMap.get(cur);
      if (!par) break;
      cur = par;
    }
    clusterOf.set(n.id, cur);
  }
  colorOf.clear();
  const projects = nodes.filter(n => n.kind === 'project');
  projects.forEach((p, i) => colorOf.set(p.id, PALETTE[i % PALETTE.length]));
  for (const n of nodes) {
    const proj = clusterOf.get(n.id) ?? n.id;
    if (!colorOf.has(proj)) colorOf.set(proj, PALETTE[nodes.indexOf(n) % PALETTE.length]);
  }
}

function hexFor(nodeId) {
  return colorOf.get(clusterOf.get(nodeId)) ?? 0x778ca3;
}

function getParentMap() {
  const pm = new Map();
  for (const e of edges) if (e.kind === 'contains') pm.set(e.target, e.source);
  return pm;
}

// ---------- build scene objects ----------
function buildGraphObjects() {
  for (const m of meshByNode.values()) scene.remove(m);
  meshByNode.clear();
  if (lineSegs) scene.remove(lineSegs);
  lineSegs = null; lineGeo = null;

  buildColorMaps();

  for (const node of nodes) {
    const r = KIND_R[node.kind] ?? 4;
    const segs = node.kind === 'project' ? 32 : 16;
    const geo = new THREE.CircleGeometry(r, segs);
    const mat = new THREE.MeshBasicMaterial({
      color: hexFor(node.id),
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nodeId = node.id;
    mesh.userData.kind = node.kind;
    const p = pos.get(node.id);
    if (p) mesh.position.set(p.x, p.y, 0);
    scene.add(mesh);
    meshByNode.set(node.id, mesh);
  }

  buildEdges();
}

function buildEdges() {
  if (lineSegs) scene.remove(lineSegs);
  if (!edges.length) return;

  const positions = new Float32Array(edges.length * 6);
  const colors = new Float32Array(edges.length * 6);
  const c = new THREE.Color();
  let pi = 0, ci = 0;

  for (const edge of edges) {
    const a = pos.get(edge.source), b = pos.get(edge.target);
    positions[pi++] = a?.x ?? 0; positions[pi++] = a?.y ?? 0; positions[pi++] = 0;
    positions[pi++] = b?.x ?? 0; positions[pi++] = b?.y ?? 0; positions[pi++] = 0;
    c.setHex(hexFor(edge.source));
    const dim = edge.kind === 'similar' ? 0.6 : 0.4;
    colors[ci++] = c.r * dim; colors[ci++] = c.g * dim; colors[ci++] = c.b * dim;
    colors[ci++] = c.r * dim; colors[ci++] = c.g * dim; colors[ci++] = c.b * dim;
  }

  lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  lineSegs = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  lineSegs.frustumCulled = false;
  scene.add(lineSegs);
}

function syncPositions() {
  for (const node of nodes) {
    const mesh = meshByNode.get(node.id);
    const p = pos.get(node.id);
    if (mesh && p) mesh.position.set(p.x, p.y, 0);
  }
  if (!lineGeo) return;
  const arr = lineGeo.attributes.position.array;
  let i = 0;
  for (const edge of edges) {
    const a = pos.get(edge.source), b = pos.get(edge.target);
    arr[i++] = a?.x ?? 0; arr[i++] = a?.y ?? 0; arr[i++] = 0;
    arr[i++] = b?.x ?? 0; arr[i++] = b?.y ?? 0; arr[i++] = 0;
  }
  lineGeo.attributes.position.needsUpdate = true;
}

// ---------- force simulation ----------
// ponytail: O(n²) repulsion; upgrade to Barnes-Hut when n > 500
let simAlpha = 0;
let simPaused = false;

function initSim(keepExisting = false) {
  for (const node of nodes) {
    if (keepExisting && pos.has(node.id)) {
      if (!vel.has(node.id)) vel.set(node.id, { x: 0, y: 0 });
      continue;
    }
    // small random start → center gravity pulls everything together
    pos.set(node.id, { x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40 });
    vel.set(node.id, { x: 0, y: 0 });
  }
  simAlpha = 1.0;
}

function tickSim() {
  if (simPaused || simAlpha < 0.002) return;
  simAlpha *= 0.975;

  // tuned for compact, well-spread single-blob layout
  const REP = 500;        // repulsion strength
  const SPRING_K = 0.06;  // edge spring
  const SPRING_L = 20;    // rest length (px) — short = compact graph
  const CENTER_K = 0.06;  // centering — keep clusters from flying off
  const DAMP = 0.75;
  const ids = nodes.map(n => n.id);

  // repulsion (all pairs)
  for (let i = 0; i < ids.length; i++) {
    const pa = pos.get(ids[i]), va = vel.get(ids[i]);
    for (let j = i + 1; j < ids.length; j++) {
      const pb = pos.get(ids[j]), vb = vel.get(ids[j]);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const f = REP / d2 * simAlpha;
      va.x -= dx * f; va.y -= dy * f;
      vb.x += dx * f; vb.y += dy * f;
    }
  }

  // spring (edges)
  for (const edge of edges) {
    const pa = pos.get(edge.source), pb = pos.get(edge.target);
    const va = vel.get(edge.source), vb = vel.get(edge.target);
    if (!pa || !pb || !va || !vb) continue;
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const disp = (d - SPRING_L) * SPRING_K * simAlpha;
    va.x += dx / d * disp; va.y += dy / d * disp;
    vb.x -= dx / d * disp; vb.y -= dy / d * disp;
  }

  // centering + integrate
  for (const id of ids) {
    const p = pos.get(id), v = vel.get(id);
    // centering force proportional to distance from origin
    v.x -= p.x * CENTER_K * simAlpha;
    v.y -= p.y * CENTER_K * simAlpha;
    v.x *= DAMP; v.y *= DAMP;
    p.x += v.x; p.y += v.y;
  }
}

// ---------- dragging ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const dragPt = new THREE.Vector3();
let draggingId = null;

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function pickNode(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...meshByNode.values()]);
  return hits.length ? hits[0] : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const hit = pickNode(e);
  if (!hit) return;
  draggingId = hit.object.userData.nodeId;
  controls.enabled = false;
  renderer.domElement.style.cursor = 'grabbing';
});

renderer.domElement.addEventListener('pointermove', (e) => {
  setPointer(e);
  if (draggingId) {
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(dragPlane, dragPt);
    const p = pos.get(draggingId);
    if (p) { p.x = dragPt.x; p.y = dragPt.y; }
    const v = vel.get(draggingId);
    if (v) { v.x = 0; v.y = 0; }
    return;
  }
  const hit = pickNode(e);
  setHover(hit?.object.userData.nodeId ?? null, e);
});

renderer.domElement.addEventListener('pointerup', () => {
  if (!draggingId) return;
  draggingId = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = 'grab';
});

// ---------- hover / tooltip ----------
function setHover(nodeId, e) {
  for (const [id, mesh] of meshByNode) mesh.scale.setScalar(id === nodeId ? 1.5 : 1);
  renderer.domElement.style.cursor = nodeId ? 'pointer' : 'grab';
  if (nodeId && e) showTooltip(nodeId, e);
  else hideTooltip();
}

function showTooltip(nodeId, e) {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  let html = `<div class="kind">${node.kind}</div><div class="body"><strong>${esc(node.label)}</strong></div>`;
  if (node.type) html += `<div class="body">type: ${esc(node.type)}</div>`;
  if (node.importance != null) html += `<div class="meta">importance ${node.importance.toFixed(2)}</div>`;
  if (node.status) html += `<div class="meta">status: ${esc(node.status)}</div>`;
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = Math.min(e.clientX, window.innerWidth - 360) + 'px';
  tooltipEl.style.top = (e.clientY + 18) + 'px';
  tooltipEl.classList.add('visible');
}
function hideTooltip() { tooltipEl.classList.remove('visible'); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showFatal(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0d1117;color:#eef1f8;font-family:system-ui;font-size:14px;text-align:center;padding:24px';
  d.textContent = msg;
  document.body.appendChild(d);
}

// ---------- controls ----------
document.getElementById('reset')?.addEventListener('click', () => {
  pos.clear(); vel.clear();
  initSim(false);
  buildGraphObjects();
});
document.getElementById('orbit')?.addEventListener('click', () => {
  simPaused = !simPaused;
  const btn = document.getElementById('orbit');
  btn.textContent = simPaused ? '▶ Resume sim' : '⏸ Pause sim';
  if (!simPaused) simAlpha = Math.max(simAlpha, 0.3);
});
document.getElementById('focus')?.addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  aspect = w / h;
  camera.left = -VIEW_H * aspect; camera.right = VIEW_H * aspect;
  camera.top = VIEW_H; camera.bottom = -VIEW_H;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ---------- load ----------
const loadingEl = document.getElementById('loading');
function showLoading() { loadingEl?.classList.remove('hidden'); statsEl.textContent = 'loading…'; }
function hideLoading() { loadingEl?.classList.add('hidden'); }

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      projectFilter.appendChild(opt);
    }
  } catch (err) { console.error('projects load failed:', err); }
}

async function loadGraph() {
  const project = projectFilter.value;
  const url = '/api/graph' + (project ? '?project=' + encodeURIComponent(project) : '');
  showLoading();
  try {
    const res = await fetch(url);
    const data = await res.json();
    nodes = data.nodes; edges = data.edges;
    pos.clear(); vel.clear();
    initSim(false);
    buildGraphObjects();
    statsEl.innerHTML = `<b>${nodes.length}</b> nodes · <b>${edges.length}</b> edges`;
  } catch (err) {
    statsEl.textContent = 'failed to load graph';
    console.error(err);
  } finally { hideLoading(); }
}

function applyGraphUpdate(nextNodes, nextEdges) {
  const nextIds = new Set(nextNodes.map(n => n.id));
  for (const id of pos.keys()) if (!nextIds.has(id)) { pos.delete(id); vel.delete(id); }
  nodes = nextNodes; edges = nextEdges;
  initSim(true);
  buildGraphObjects();
  statsEl.innerHTML = `<b>${nodes.length}</b> nodes · <b>${edges.length}</b> edges`;
}

projectFilter.addEventListener('change', loadGraph);
loadProjects();
loadGraph();

// ---------- live polling ----------
async function pollGraph() {
  if (draggingId) return;
  const project = projectFilter.value;
  const url = '/api/graph' + (project ? '?project=' + encodeURIComponent(project) : '');
  try {
    const res = await fetch(url);
    const data = await res.json();
    const sig = arr => arr.map(x => x.id).sort().join(',');
    if (sig(data.nodes) !== sig(nodes) || data.edges.length !== edges.length) {
      applyGraphUpdate(data.nodes, data.edges);
    }
  } catch { /* retry next tick */ }
}
setInterval(() => { if (nodes.length) pollGraph(); }, 4000);

// ---------- animation loop ----------
function animate() {
  requestAnimationFrame(animate);
  if (!draggingId) tickSim();
  syncPositions();
  controls.update();
  renderer.render(scene, camera);
}
animate();

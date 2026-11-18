// Bagel Pollo Plancha en three.js. Se arma con el progreso del desplazamiento (0 a 1).
// Interfaz común con la secuencia de vídeo: crearEscena(canvas) -> { progreso(p), tamano(), listo }
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ───────── Ruido ─────────
const fract = x => x - Math.floor(x);
const hash = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const suave = t => t * t * (3 - 2 * t);
function ruido(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = suave(x - ix), fy = suave(y - iy), fz = suave(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0,0,0), c(1,0,0), fx), l(c(0,1,0), c(1,1,0), fx), fy),
           l(l(c(0,0,1), c(1,0,1), fx), l(c(0,1,1), c(1,1,1), fx), fy), fz);
}
function fbm(x, y, z, o = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * ruido(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return v; }
let semilla = 7; const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
const col = h => new THREE.Color(h);
const mezcla = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));
const pasoSuave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function lienzo(tam, dibujar) {
  const c = document.createElement('canvas'); c.width = c.height = tam;
  dibujar(c.getContext('2d'), tam);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ───────── Pan ─────────
const R = 1, A = 0.5;
function perfil(t, arriba) {
  const c = Math.cos(t), s = Math.sin(t), h = arriba ? 0.5 : 0.42;
  return new THREE.Vector2(R + A * Math.sign(c) * Math.pow(Math.abs(c), 0.82), (arriba ? 1 : -1) * h * Math.pow(s, arriba ? 0.62 : 0.5));
}
// La primera y la última columna del torno son el mismo borde: se promedian sus normales para que no se vea la costura.
function coserCostura(g, seg, filas) {
  const n = g.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let j = 0; j < filas; j++) {
    const i0 = j, i1 = seg * filas + j;
    a.fromBufferAttribute(n, i0); b.fromBufferAttribute(n, i1); a.add(b).normalize();
    n.setXYZ(i0, a.x, a.y, a.z); n.setXYZ(i1, a.x, a.y, a.z);
  }
}

// ───────── Fotos reales ─────────
// Si existe web-3d/texturas/<nombre>.(webp|jpg|png), sustituye la textura generada por código.
const cargador = new THREE.TextureLoader();
export const texturasCargadas = [];
function vestir(material, nombre, { repetir = false, relieve = 0, mezclarColor = false, campo = 'map', escala = 0, rugosidad = false } = {}) {
  const exts = ['webp', 'jpg', 'png'];
  const probar = k => {
    if (k >= exts.length) return;
    cargador.load(`texturas/${nombre}.${exts[k]}`, t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      if (repetir || escala) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (escala) { t.repeat.set(escala, escala); t.offset.set(0.5, 0.5); }
      material[campo] = t; material.color.set('#FFFFFF');
      if (relieve) { material.bumpMap = t; material.bumpScale = relieve; }
      if (rugosidad) material.roughnessMap = t;
      if (mezclarColor && material.vertexColors) {
        // La foto pone el detalle; los colores de vértice solo oscurecen lo más horneado.
        material.vertexColors = false; material.color.set('#FFFFFF');
      }
      material.userData.alCargar?.();
      material.needsUpdate = true; texturasCargadas.push(nombre);
    }, undefined, () => probar(k + 1));
  };
  probar(0);
}

// Un bagel hecho a mano no es un círculo: se ensancha y se achata un poco según el ángulo.
const formaPan = ang => 1 + (fbm(Math.cos(ang) * 1.2 + 5, Math.sin(ang) * 1.2, 2) - 0.5) * 0.1 + Math.cos(2 * ang + 0.7) * 0.025;
const relieve = (p) => (fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6) - 0.5) * 0.09 + (fbm(p.x * 11, p.y * 11, p.z * 11) - 0.5) * 0.018;

function corteza(arriba) {
  const pts = [];
  for (let i = 0; i <= 72; i++) pts.push(perfil((i / 72) * Math.PI, arriba));
  if (!arriba) pts.reverse();
  const SEG = 200, g = new THREE.LatheGeometry(pts, SEG);
  // Se conservan las coordenadas UV para poder vestir la corteza con una foto (texturas/corteza).
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 0.6);
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  const colores = new Float32Array(n * 3);
  const claro = col('#C98A45'), dorado = col('#9A531F'), oscuro = col('#56260A'), borde = col('#E6C690');
  const p = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i); nv.fromBufferAttribute(nor, i);
    const w = pasoSuave(0, 0.1, Math.abs(p.y));
    p.addScaledVector(nv, relieve(p) * w);
    const kPan = formaPan(Math.atan2(p.z, p.x)); p.x *= kPan; p.z *= kPan;
    pos.setXYZ(i, p.x, p.y, p.z);
    const arribaT = arriba ? Math.max(0, nv.y) : 0.35 + Math.max(0, -nv.y) * 0.3;
    const manchas = fbm(p.x * 3.5 + 9, p.y * 3.5, p.z * 3.5);
    let c = mezcla(claro, dorado, arribaT * 1.1 + (manchas - 0.5) * 0.9);
    c = mezcla(c, oscuro, Math.pow(Math.max(0, arribaT * manchas - 0.32), 1.4) * 2.2);
    c = mezcla(c, borde, 1 - w);
    colores.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  g.computeVertexNormals(); coserCostura(g, SEG, pts.length);
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.32, sheen: 0.15, sheenColor: col('#E8A860'), sheenRoughness: 0.5 });
  vestir(m, 'corteza', { repetir: true, relieve: 0.7, mezclarColor: true, rugosidad: true });
  m.userData.alCargar = () => { m.roughness = 0.8; m.clearcoat = 0.42; m.clearcoatRoughness = 0.32; m.color.set('#F4ECE0'); };   // tinte que baja un punto la saturación de la foto   // con mapa: zonas claras mate, tostadas más brillantes
  return new THREE.Mesh(g, m);
}

const texMiga = lienzo(1024, (x, t) => {
  x.fillStyle = '#E9D3A6'; x.fillRect(0, 0, t, t);
  for (let i = 0; i < 9000; i++) {
    const px = Math.random() * t, py = Math.random() * t, r = Math.random() ** 3 * 9 + 0.6;
    x.fillStyle = Math.random() < 0.6 ? `rgba(176,136,82,${0.15 + Math.random() * 0.35})` : `rgba(255,246,222,${0.2 + Math.random() * 0.4})`;
    x.beginPath(); x.ellipse(px, py, r, r * (0.5 + Math.random() * 0.6), Math.random() * 3, 0, 7); x.fill();
  }
});
function cara(arriba) {
  const g = new THREE.RingGeometry(R - A + 0.002, R + A - 0.002, 200, 6);
  // Misma deformación que la corteza. El anillo está en el plano XY y luego se gira: la z del mundo es ±y.
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), k = formaPan(Math.atan2(arriba ? y : -y, x)); pa.setXY(i, x * k, y * k); }
  const mat = new THREE.MeshStandardMaterial({ map: texMiga, bumpMap: texMiga, bumpScale: 2.5, roughness: 0.92 });
  vestir(mat, 'miga', { relieve: 2.5 });
  const m = new THREE.Mesh(g, mat);
  m.rotation.x = arriba ? Math.PI / 2 : -Math.PI / 2;
  return m;
}

function sesamo(cantidad) {
  const g = new THREE.SphereGeometry(1, 12, 8);
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const inst = new THREE.InstancedMesh(g, m, cantidad);
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), arriba = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < cantidad; i++) {
    const t = Math.PI * (0.16 + azar() * 0.68), phi = azar() * Math.PI * 2;
    const a = perfil(t, true), b = perfil(t + 0.01, true), c0 = perfil(t - 0.01, true);
    const tg = new THREE.Vector2().subVectors(b, c0).normalize();
    const n2 = new THREE.Vector2(-tg.y, tg.x); if (n2.y < 0) n2.negate();
    const pos = new THREE.Vector3(a.x * Math.sin(phi), a.y, a.x * Math.cos(phi));
    const n = new THREE.Vector3(n2.x * Math.sin(phi), n2.y, n2.x * Math.cos(phi)).normalize();
    pos.addScaledVector(n, relieve(pos) + 0.006);
    const kPan = formaPan(Math.atan2(pos.z, pos.x)); pos.x *= kPan; pos.z *= kPan;
    q.setFromUnitVectors(arriba, n); q2.setFromAxisAngle(arriba, azar() * Math.PI * 2); q.multiply(q2);
    mat.compose(pos, q, new THREE.Vector3(0.021, 0.0075, 0.012).multiplyScalar(0.85 + azar() * 0.3));
    inst.setMatrixAt(i, mat);
    inst.setColorAt(i, azar() < 0.06 ? col('#231A14') : mezcla(col('#F2E3BE'), col('#D8B57A'), azar()));
  }
  return inst;
}

// ───────── Ingredientes ─────────
function losa(rIn, rOut, grosor, ondas, sem, caida = 0) {
  const pts = [], r = grosor / 2, seg = 10;
  for (let i = 0; i <= seg; i++) { const a = Math.PI * 1.5 - (i / seg) * Math.PI; pts.push(new THREE.Vector2(rIn + r + Math.cos(a) * r * 0.9, r + Math.sin(a) * r)); }
  for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 - (i / seg) * Math.PI; pts.push(new THREE.Vector2(rOut - r + Math.cos(a) * r, r + Math.sin(a) * r)); }
  pts.reverse();
  let g = new THREE.LatheGeometry(pts, 220);
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-5);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x), rr = Math.hypot(v.x, v.z);
    const k = (rr - rIn) / (rOut - rIn);
    const borde = (fbm(Math.cos(ang) * 2 + sem, Math.sin(ang) * 2, sem) - 0.5) * ondas;
    const nr = rr + borde * k * 1.6 - borde * (1 - k) * 0.5;
    v.x *= nr / rr; v.z *= nr / rr;
    v.y += (fbm(v.x * 5 + sem, v.z * 5, 1) - 0.5) * grosor * 0.5;
    if (caida && nr > rOut - 0.12) v.y -= (nr - (rOut - 0.12)) * caida;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}

function quesoCrema() {
  return new THREE.Mesh(losa(0.6, 1.34, 0.04, 0.1, 3), new THREE.MeshPhysicalMaterial({ color: '#F4EFE5', roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: col('#FFFFFF') }));
}

const texPollo = lienzo(512, (x, t) => {
  x.fillStyle = '#D9A466'; x.fillRect(0, 0, t, t);
  for (let i = 0; i < 300; i++) { x.strokeStyle = `rgba(${Math.random() < 0.5 ? '130,78,36' : '246,214,160'},${0.1 + Math.random() * 0.18})`; x.lineWidth = 1 + Math.random() * 2.5; const y = Math.random() * t; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(t * 0.3, y + 8, t * 0.6, y - 8, t, y + Math.random() * 10); x.stroke(); }
  x.filter = 'blur(14px)';
  for (let i = 0; i < 14; i++) { x.fillStyle = `rgba(${120 + Math.random() * 30},${60 + Math.random() * 20},20,${0.35 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(Math.random() * t, Math.random() * t, 30 + Math.random() * 60, 20 + Math.random() * 40, Math.random() * 3, 0, 7); x.fill(); }
  x.filter = 'blur(5px)';
  for (let i = 0; i < 3; i++) { x.fillStyle = 'rgba(60,30,10,0.55)'; x.save(); x.translate(t * (0.2 + i * 0.3) + Math.random() * 20, t / 2); x.rotate(0.55); x.fillRect(-7, -t, 14, t * 2); x.restore(); }
  x.filter = 'none';
});
// Una sola pechuga, grande, gruesa y asimétrica. Se construye como un campo de alturas
// polar y se expone su altura para que mozzarella, aguacate y salsa se apoyen encima.
const PECHUGA = { cx: 0, cz: 0.02, giro: 0.5, largo: 1.72, ancho: 1.28, alto: 0.36 };
function bordePechuga(th) {
  const c = Math.cos(th), s = Math.sin(th), b = PECHUGA.ancho + 0.2 * c; // ancha hacia +x, se afina hacia -x
  return (1 / Math.sqrt((c / PECHUGA.largo) ** 2 + (s / b) ** 2)) * (1 + (fbm(c * 1.6 + 3, s * 1.6, 7) - 0.5) * 0.16);
}
function altoLocal(x, z) {
  const R = bordePechuga(Math.atan2(z, x)), r = Math.hypot(x, z) / R;
  if (r >= 1) return 0;
  const cumbre = PECHUGA.alto * (0.7 + 0.3 * (x / PECHUGA.largo + 1) / 2);
  return cumbre * Math.pow(1 - r * r, 0.42) + (fbm(x * 2.6 + 1, z * 2.6, 2) - 0.5) * 0.06 * (1 - r * r);
}
const aLocal = (xb, zb) => { const dx = xb - PECHUGA.cx, dz = zb - PECHUGA.cz, c = Math.cos(PECHUGA.giro), s = Math.sin(PECHUGA.giro); return [dx * c - dz * s, dx * s + dz * c]; };
const aBagel = (x, z) => { const c = Math.cos(PECHUGA.giro), s = Math.sin(PECHUGA.giro); return [x * c + z * s + PECHUGA.cx, -x * s + z * c + PECHUGA.cz]; };
export const altoPechuga = (xb, zb) => altoLocal(...aLocal(xb, zb));
// Apoya una geometría ya colocada sobre la pechuga.
function apoyar(g, extra) {
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, pos.getY(k) + altoPechuga(pos.getX(k), pos.getZ(k)) + extra);
  g.computeVertexNormals(); return g;
}

function pollo() {
  const NR = 44, NA = 180, pos = [], uv = [], idx = [];
  for (const cara of [1, -1]) {
    for (let i = 0; i <= NR; i++) for (let j = 0; j < NA; j++) {
      const th = (j / NA) * Math.PI * 2, r = i / NR, R = bordePechuga(th);
      const x = Math.cos(th) * r * R, z = Math.sin(th) * r * R;
      const y = cara > 0 ? altoLocal(x, z) : -0.02 * Math.sqrt(Math.max(0, 1 - r * r));
      const [xb, zb] = aBagel(x, z);
      pos.push(xb, y, zb); uv.push(x / (2 * PECHUGA.largo) + 0.5, z / (2 * (PECHUGA.ancho + 0.2)) + 0.5);
    }
  }
  const base = (NR + 1) * NA;
  for (const [cara, off] of [[1, 0], [-1, base]]) for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = off + i * NA + j, b = off + i * NA + (j + 1) % NA, c = off + (i + 1) * NA + j, d = off + (i + 1) * NA + (j + 1) % NA;
    if (cara > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // Si la cara de arriba quedó mirando hacia abajo, se invierte el sentido de los triángulos.
  const n = g.attributes.normal; if (n.getY(NA * 10) < 0) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) [ix[t + 1], ix[t + 2]] = [ix[t + 2], ix[t + 1]]; g.index.needsUpdate = true; g.computeVertexNormals(); }
  // Pechuga jugosa: barniz fino que da el brillo de los jugos sobre la superficie mate de la carne
  const m = new THREE.MeshPhysicalMaterial({ map: texPollo, bumpMap: texPollo, bumpScale: 2, roughness: 0.62, clearcoat: 0.55, clearcoatRoughness: 0.22, sheen: 0.12, sheenColor: col('#F5D3A0') });
  m.userData.alCargar = () => m.color.set('#EEE4D6');   // la foto del pollo, con este tono de color, se iba a naranja
  vestir(m, 'pollo', { relieve: 2.5, rugosidad: true });
  return new THREE.Mesh(g, m);
}

const texPeperoni = lienzo(512, (x, t) => {
  x.fillStyle = '#7A1B10'; x.fillRect(0, 0, t, t);
  const g = x.createRadialGradient(t / 2, t / 2, t * 0.3, t / 2, t / 2, t / 2); g.addColorStop(0, 'rgba(150,40,22,0.5)'); g.addColorStop(0.8, 'rgba(110,26,14,0.3)'); g.addColorStop(1, 'rgba(50,10,5,0.95)');
  x.fillStyle = g; x.fillRect(0, 0, t, t);
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(200,${100 + Math.random() * 30},${80 + Math.random() * 20},${0.35 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(Math.random() * t, Math.random() * t, 2 + Math.random() * 6, 2 + Math.random() * 4, Math.random() * 3, 0, 7); x.fill(); }
  for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(40,8,4,0.5)'; x.fillRect(Math.random() * t, Math.random() * t, 2, 2); }
});
function peperoni() {
  const gr = new THREE.Group(), n = 5, rad = 0.5;
  const m = new THREE.MeshPhysicalMaterial({ map: texPeperoni, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  vestir(m, 'pepperoni', { relieve: 1 });
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(rad, rad * 0.97, 0.026, 64, 1);
    const pos = g.attributes.position, v = new THREE.Vector3();
    // Al calentarse, el borde se levanta un poco (se «encopa»)
    for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k); const rr = Math.hypot(v.x, v.z) / rad; v.y += rr * rr * 0.05 + (fbm(v.x * 4 + i, v.z * 4, i) - 0.5) * 0.02; pos.setXYZ(k, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const s = new THREE.Mesh(g, m), a = (i / n) * Math.PI * 2 + 0.3;
    s.position.set(Math.sin(a) * 0.82, i * 0.007, Math.cos(a) * 0.82);
    s.rotation.set((azar() - 0.5) * 0.12, azar() * 6, (azar() - 0.5) * 0.12);
    gr.add(s);
  }
  return gr;
}

function mozzarella() {
  const gr = new THREE.Group();
  const m = new THREE.MeshPhysicalMaterial({ color: '#F3E9D2', emissive: col('#403D37'), roughness: 0.4, sheen: 0.6, sheenColor: col('#FFF6E0'), clearcoat: 0.3, clearcoatRoughness: 0.35, side: THREE.DoubleSide });   // sin translucidez: en láminas tan finas toma el color de lo que hay detrás y se ve metálica
  vestir(m, 'mozzarella', { escala: 1.0, relieve: 1 });
  const sitios = [[-0.95, -0.25, 0.3], [-0.25, 0.4, -0.4], [0.5, -0.3, 0.5], [1.05, 0.3, -0.2], [0.15, -0.85, 1.1], [-0.65, 0.85, 0.9]];
  sitios.forEach(([lx, lz, rot], i) => {
    const w = 0.6, h = 0.42, g = new THREE.PlaneGeometry(2, 2, 30, 22);
    const pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const u = pa.getX(k), v = pa.getY(k);
      // Cuadrado → óvalo conservando la malla interior; el borde se rompe un poco con ruido
      const x = u * Math.sqrt(1 - v * v / 2), y = v * Math.sqrt(1 - u * u / 2);
      const borde = 1 + (fbm(Math.atan2(y, x) * 1.5 + i * 7, i, 1) - 0.5) * 0.25 * Math.min(1, Math.hypot(x, y));
      pa.setXYZ(k, x * w * borde, y * h * borde, 0);
    }
    g.rotateX(-Math.PI / 2); g.rotateY(rot);
    const [xb, zb] = aBagel(lx, lz); g.translate(xb, 0, zb);
    gr.add(new THREE.Mesh(apoyar(g, 0.012 + i * 0.004), m));
  });
  return gr;
}

const texTomate = lienzo(512, (x, t) => {
  const c = t / 2;
  x.fillStyle = '#A8190C'; x.fillRect(0, 0, t, t);
  const g = x.createRadialGradient(c, c, t * 0.1, c, c, t * 0.46); g.addColorStop(0, '#E0583C'); g.addColorStop(0.85, '#C9301C'); g.addColorStop(1, '#A01A0C');
  x.fillStyle = g; x.beginPath(); x.arc(c, c, t * 0.46, 0, 7); x.fill();
  x.filter = 'blur(3px)';
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4 + (Math.random() - 0.5) * 0.3;
    x.save(); x.translate(c + Math.cos(a) * t * 0.23, c + Math.sin(a) * t * 0.23); x.rotate(a);
    x.fillStyle = 'rgba(238,128,92,0.85)'; x.beginPath(); x.ellipse(0, 0, t * 0.13, t * 0.095, 0, 0, 7); x.fill();
    x.filter = 'blur(0.6px)';
    for (let s = 0; s < 12; s++) { x.fillStyle = `rgba(236,210,140,${0.6 + Math.random() * 0.3})`; x.beginPath(); x.ellipse((Math.random() - 0.5) * t * 0.16, (Math.random() - 0.5) * t * 0.11, 4, 2.5, Math.random() * 3, 0, 7); x.fill(); }
    x.filter = 'blur(3px)';
    x.restore();
  }
  x.fillStyle = 'rgba(230,110,80,0.7)'; x.beginPath(); x.arc(c, c, t * 0.08, 0, 7); x.fill();
  x.filter = 'none';
});
function tomate() {
  const gr = new THREE.Group(), n = 5;
  const lado = new THREE.MeshPhysicalMaterial({ color: '#A3170E', roughness: 0.2, clearcoat: 0.9, transmission: 0.25, thickness: 0.05, attenuationColor: col('#C0251A'), attenuationDistance: 0.08 });
  // Pulpa húmeda: capa de barniz muy lisa y algo de luz que atraviesa el gel
  const cara = new THREE.MeshPhysicalMaterial({ map: texTomate, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06, transmission: 0.3, thickness: 0.05, attenuationColor: col('#E0482E'), attenuationDistance: 0.1, ior: 1.36 });
  vestir(cara, 'tomate', { relieve: 0.8 });
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.585, 0.6, 0.05, 96, 2);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), z = pos.getZ(k); pos.setY(k, pos.getY(k) + (fbm(x * 3 + i, z * 3, 5) - 0.5) * 0.02); }
    g.computeVertexNormals();
    const s = new THREE.Mesh(g, [lado, cara, cara]), a = (i / n) * Math.PI * 2 + 0.3 + Math.PI / n;
    s.position.set(Math.sin(a) * 0.74, i * 0.008, Math.cos(a) * 0.74);
    s.rotation.set((azar() - 0.5) * 0.08, azar() * 6, (azar() - 0.5) * 0.08);
    gr.add(s);
  }
  return gr;
}

// Rodaja de aguacate como malla: a lo largo (u) y de dentro hacia fuera (v), con cara superior, inferior y bordes.
// Así el color de la piel queda en el borde exterior y no se arrastra por triángulos largos.
function rodajaAguacate(L = 0.58, interior = 0.016, exterior = 0.34, grosor = 0.06) {
  const NU = 40, NV = 10, pos = [], col_ = [], idx = [];
  const palido = col('#E6E59E'), verde = col('#B7CB5C'), piel = col('#2F4A17');
  const punto = (u, v, lado) => {
    const k = 1 - u * u, yi = interior * k, yo = exterior * k * (1 + (fbm(u * 3, 1, 2) - 0.5) * 0.12);
    // el borde exterior se redondea: la rodaja es más fina hacia la piel
    const z = lado * (grosor / 2) * (1 - 0.55 * Math.pow(v, 3)) * (0.4 + 0.6 * Math.sqrt(k));
    return [u * L, yi + v * (yo - yi), z];
  };
  const color = v => { let c = mezcla(palido, verde, Math.pow(v, 1.8)); if (v > 0.9) c = mezcla(c, piel, (v - 0.9) / 0.1); return c; };
  const caras = [];
  for (const lado of [1, -1]) {
    const base = pos.length / 3; caras.push(base);
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
      const u = -1 + 2 * i / NU, v = j / NV; pos.push(...punto(u, v, lado)); const c = color(v); col_.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = base + i * (NV + 1) + j, b = a + NV + 1;
      lado > 0 ? idx.push(a, b, a + 1, b, b + 1, a + 1) : idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Bordes: une la cara de arriba y la de abajo por el canto interior (v=0) y exterior (v=1)
  for (const j of [0, NV]) for (let i = 0; i < NU; i++) {
    const a = caras[0] + i * (NV + 1) + j, b = caras[0] + (i + 1) * (NV + 1) + j, c = caras[1] + i * (NV + 1) + j, d = caras[1] + (i + 1) * (NV + 1) + j;
    j === 0 ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col_, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g.translate(0, -exterior * 0.4, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

function aguacate() {
  // Medialunas en abanico, a lo largo de la pechuga.
  const gr = new THREE.Group(), n = 6;
  const base = rodajaAguacate();
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, side: THREE.DoubleSide, transmission: 0.15, thickness: 0.05, attenuationColor: col('#C9D36A'), attenuationDistance: 0.2, ior: 1.36 });
  for (let i = 0; i < n; i++) {
    const g = base.clone(), t = i / (n - 1);
    const lx = -1.15 + t * 2.25, lz = Math.sin(t * Math.PI * 2) * 0.16 + (i % 2 ? 0.14 : -0.14);
    g.rotateY(PECHUGA.giro + Math.PI / 2 + (i % 2 ? 0.25 : -0.25));
    // Cada rodaja se apoya entera, inclinada según la pendiente de la pechuga bajo su centro.
    // (Deformarla vértice a vértice dobla los triángulos largos de la tapa y la luz se ve rota.)
    const [xb, zb] = aBagel(lx, lz), e = 0.08;
    const h0 = altoPechuga(xb, zb), dx = (altoPechuga(xb + e, zb) - altoPechuga(xb - e, zb)) / (2 * e), dz = (altoPechuga(xb, zb + e) - altoPechuga(xb, zb - e)) / (2 * e);
    const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
    g.translate(xb, h0 + 0.075 + i * 0.006, zb);
    gr.add(new THREE.Mesh(g, m));
  }
  return gr;
}

function salsa() {
  // Un hilo en zigzag que sigue el lomo de la pechuga.
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    // Dentro del contorno de la pechuga, con un margen, para que el hilo nunca quede en el aire
    const t = i / 120, lx = -1.2 + t * 2.4, lz = Math.sin(t * Math.PI * 9) * (0.45 + 0.2 * t) * Math.sqrt(Math.max(0, 1 - (lx / 1.45) ** 2));
    const [xb, zb] = aBagel(lx, lz);
    pts.push(new THREE.Vector3(xb, altoPechuga(xb, zb) + 0.12, zb));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 900, 0.022, 10, false);
  return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#EC9A63', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 }));
}

// ───────── Estudio de luz ─────────
// Un estudio de foto de comida hecho de paneles que emiten luz: softbox grande a la izquierda (la luz principal,
// la misma dirección que usa la página), relleno pequeño a la derecha, tira cenital y rebote cálido de la mesa.
// Los reflejos de la corteza, el tomate y el queso salen de estos paneles.
function estudio() {
  const sala = new THREE.Scene();
  // Paredes claras: así lo brillante (corteza, tomate) no refleja negro.
  const caja = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 14), new THREE.MeshBasicMaterial({ color: col('#B9AA92'), side: THREE.BackSide }));
  sala.add(caja);
  const panel = (w, h, color, fuerza, pos, mira) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col(color).multiplyScalar(fuerza), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...mira); sala.add(m);
  };
  panel(5, 4.5, '#FFF7EE', 9, [-5.5, 3.2, 3], [0, 0, 0]);     // softbox principal
  panel(2.2, 3, '#FFF6EC', 2.2, [5.5, 1.8, 2.5], [0, 0, 0]);   // relleno
  panel(7, 1.2, '#FFFFFF', 4, [0, 4.4, -1], [0, 0, 0]);         // tira cenital
  panel(3, 2, '#FFD7A8', 2.5, [2.5, 2, -5.5], [0, 0, 0]);      // contraluz cálido
  panel(14, 14, '#EBDDC4', 0.6, [0, -4.4, 0], [0, 0, 0]);      // rebote de la mesa
  return sala;
}

// ───────── Escena ─────────
export function crearEscena(canvas, { desplazado = true, centroMovil = 0.12, bajadaInicio = 0, oclusion = true } = {}) {
  const render = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  render.setPixelRatio(Math.min(devicePixelRatio, 2));
  render.outputColorSpace = THREE.SRGBColorSpace;
  render.toneMapping = THREE.NeutralToneMapping; render.toneMappingExposure = 1.0;   // Khronos PBR Neutral: respeta el color del producto
  render.shadowMap.enabled = true; render.shadowMap.type = THREE.PCFSoftShadowMap;

  const escena = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(render);
  escena.environment = pm.fromScene(estudio(), 0.03).texture;
  escena.environmentIntensity = 0.62;

  const camara = new THREE.PerspectiveCamera(28, 1, 0.1, 60);

  const clave = new THREE.DirectionalLight('#FFF5EA', 2.5);   // casi neutra: la comida pone su propio color clave.position.set(-3, 5, 3.5); clave.castShadow = true;
  clave.shadow.mapSize.set(2048, 2048); clave.shadow.radius = 6; clave.shadow.bias = -0.0004;
  Object.assign(clave.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 15 });
  const contra = new THREE.DirectionalLight('#FFE2C4', 1.5); contra.position.set(2.5, 2.2, -4);
  const relleno = new THREE.DirectionalLight('#F4F1EC', 0.55); relleno.position.set(4, 1, 3);
  escena.add(clave, contra, relleno);

  const mundo = new THREE.Group(); escena.add(mundo);
  const bagel = new THREE.Group(); mundo.add(bagel);

  const base = new THREE.Group(); base.add(corteza(false), cara(false)); bagel.add(base);
  const tapa = new THREE.Group(); tapa.add(corteza(true), cara(true), sesamo(1500)); bagel.add(tapa);

  // Capas de abajo arriba, con la altura a la que se asientan.
  const capas = [
    [quesoCrema(), 0.0],
    [peperoni(), 0.045],
    [tomate(), 0.12],
    [pollo(), 0.2],
    [mozzarella(), 0.2],
    [aguacate(), 0.2],
    [salsa(), 0.2],
  ].map(([obj, y]) => { const g = new THREE.Group(); g.add(obj); g.userData.y = y; bagel.add(g); return g; });
  const ALTO = 0.6;   // la tapa aprieta el relleno: la cumbre de la pechuga queda dentro del pan

  bagel.traverse(o => { if (o.isMesh || o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.38, color: '#4A2A10' }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = -0.43; suelo.receiveShadow = true; mundo.add(suelo);


  const contacto = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    map: lienzo(512, (x, t) => { const c = t / 2, g = x.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(60,32,10,0.62)'); g.addColorStop(0.3, 'rgba(60,32,10,0.5)'); g.addColorStop(0.36, 'rgba(60,32,10,0.34)'); g.addColorStop(0.5, 'rgba(60,32,10,0.12)'); g.addColorStop(0.75, 'rgba(60,32,10,0.03)'); g.addColorStop(1, 'rgba(60,32,10,0)');
      x.fillStyle = g; x.fillRect(0, 0, t, t); }),
  }));
  contacto.rotation.x = -Math.PI / 2; contacto.position.set(0.12, -0.428, 0.08); escena.add(contacto);

  // ── Línea de tiempo ──
  const TAPA_SUBE = [0.06, 0.16], TAPA_BAJA = [0.86, 0.95];
  const VENTANAS = capas.map((_, i) => [0.17 + i * 0.095, 0.17 + i * 0.095 + 0.1]);
  const tramo = (p, [a, b]) => Math.min(1, Math.max(0, (p - a) / (b - a)));
  const ease = t => 1 - Math.pow(1 - t, 3);
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // ── Oclusión ambiental (GTAO): la sombra fina donde una capa toca a otra ──
  let compositor = null, ao = null;
  if (oclusion) {
    compositor = new EffectComposer(render);
    const pasada = new RenderPass(escena, camara); pasada.clearAlpha = 0;
    ao = new GTAOPass(escena, camara, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
    ao.blendIntensity = 1;
    compositor.addPass(pasada); compositor.addPass(ao); compositor.addPass(new OutputPass());
  }

  let ancho = 1, alto = 1, p = 0, reloj = 0, puntero = { x: 0, y: 0 }, inclina = { x: 0, y: 0 };

  function pose(t) {
    // Tapa
    const sube = easeIO(tramo(t, TAPA_SUBE)), baja = easeIO(tramo(t, TAPA_BAJA));
    const altura = sube * 4.2 * (1 - baja) + baja * ALTO;
    tapa.position.y = altura; tapa.rotation.x = (sube - baja) * 0.0 + Math.sin(sube * Math.PI) * 0.25 * (1 - baja);
    tapa.visible = altura < 3.9 || baja > 0;
    // Capas
    capas.forEach((g, i) => {
      const u = tramo(t, VENTANAS[i]);
      g.visible = u > 0;
      const caida = 1 - ease(Math.min(1, u / 0.78));
      g.position.y = g.userData.y + caida * 2.6;
      g.rotation.y = caida * caida * 1.4;
      const golpe = u > 0.72 ? Math.sin(((u - 0.72) / 0.28) * Math.PI) * 0.12 : 0;
      g.scale.set(1 + golpe * 0.25, 1 - golpe, 1 + golpe * 0.25);
    });
    // Cámara: elevación según la fase
    const fase = pasoSuave(0.04, 0.2, t) * (1 - pasoSuave(0.84, 0.97, t));
    const elev = THREE.MathUtils.degToRad(14 + fase * 22 + inclina.y * 5);
    // Base estable: casi no gira con el scroll; solo un vaivén lento y la reacción al cursor.
    const giro = 0.6 + t * 0.12 + Math.sin(reloj * 0.35) * 0.03 + inclina.x * 0.08;
    mundo.rotation.y = giro;
    const objetivo = new THREE.Vector3(0, 0.2 + fase * 0.08, 0);
    const vert = THREE.MathUtils.degToRad(camara.fov / 2), horiz = Math.atan(Math.tan(vert) * camara.aspect);
    const escritorio = ancho > 900;
    const radio = escritorio ? 2.6 : 1.75;
    const cerca = pasoSuave(0.4, 0.56, t) * (1 - pasoSuave(0.84, 0.96, t));
    const d = Math.max(radio / Math.tan(vert) * 0.82, radio / Math.tan(horiz)) * (1 - cerca * 0.17);
    camara.position.set(0, objetivo.y + Math.sin(elev) * d, Math.cos(elev) * d);
    camara.lookAt(objetivo);
    // Al inicio el bagel se sienta bajo el titular; al armarse sube al centro.
    const bajo = 1 - pasoSuave(0.02, 0.16, t);
    camara.setViewOffset(ancho, alto, 0, escritorio ? -alto * bajadaInicio * bajo : alto * centroMovil, ancho, alto);
    camara.updateProjectionMatrix();
  }

  function tamano() {
    const r = canvas.getBoundingClientRect(); ancho = r.width; alto = r.height;
    render.setSize(ancho, alto, false);
    if (compositor) { compositor.setPixelRatio(Math.min(devicePixelRatio, ancho > 900 ? 1.5 : 1.25)); compositor.setSize(ancho, alto); }
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
  }

  addEventListener('pointermove', e => { puntero.x = e.clientX / innerWidth * 2 - 1; puntero.y = e.clientY / innerHeight * 2 - 1; });
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let objetivo = 0, ultimo = performance.now(), activo = true, salto = false;
  function cuadro(ahora) {
    const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora; reloj += quieto ? 0 : dt;
    p = salto ? objetivo : p + (objetivo - p) * (1 - Math.exp(-dt * 7));
    inclina.x += (puntero.x - inclina.x) * (1 - Math.exp(-dt * 4));
    inclina.y += (puntero.y - inclina.y) * (1 - Math.exp(-dt * 4));
    pose(quieto ? 1 : p);
    compositor ? compositor.render(dt) : render.render(escena, camara);
    oyente?.(quieto ? 1 : p);
    if (activo) requestAnimationFrame(cuadro);
  }
  let oyente = null;
  tamano(); requestAnimationFrame(cuadro);
  window.__depurar = { escena, camara, render, bagel, pose, ao, alternarAO: v => { compositor = v ? compositorGuardado : null; } };
  const compositorGuardado = compositor;

  return {
    progreso(v, inmediato = false) { objetivo = v; salto = inmediato; },
    alCuadro(fn) { oyente = fn; },
    tamano,
    pausar(v) { const antes = activo; activo = !v; if (activo && !antes) { ultimo = performance.now(); requestAnimationFrame(cuadro); } },
  };
}

// ───────── Secuencia de vídeo (para cuando exista el render hiperrealista) ─────────
// Fotogramas en web-3d/fotogramas/0001.webp ... NNNN.webp, encuadre 16:9.
export function crearSecuencia(canvas, { total, ruta = 'fotogramas/escritorio/', encaje = 'cubrir', fondo = '#FCF3DB' }) {
  // Fotogramas del stop motion. 'cubrir' llena el lienzo (escritorio); 'arriba' coloca la foto a todo el ancho
  // en la parte de arriba (móvil: producto arriba, estado debajo) y funde sus bordes con el fondo de la página.
  const ctx = canvas.getContext('2d'), imgs = [];
  for (let i = 1; i <= total; i++) { const im = new Image(); im.decoding = 'async'; im.src = `${ruta}${String(i).padStart(4, '0')}.webp`; imgs.push(im); }
  let objetivo = 0, p = 0, salto = false, activo = true, ultimo = -1, dpr = 1;
  function tamano() { const r = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio, 2); canvas.width = r.width * dpr; canvas.height = r.height * dpr; ultimo = -1; }
  function dibujar(im) {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = fondo; ctx.fillRect(0, 0, W, H);
    if (encaje === 'arriba') {
      const w = W, h = im.naturalHeight * (W / im.naturalWidth), y = Math.round(H * 0.13);
      ctx.drawImage(im, 0, y, w, h);
      // Fundido de los bordes superior e inferior con la crema de la página
      const borde = h * 0.12;
      for (const [y0, y1] of [[y, y + borde], [y + h, y + h - borde]]) {
        const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, fondo); g.addColorStop(1, fondo + '00');
        ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), W, borde);
      }
    } else {
      const e = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * e, h = im.naturalHeight * e;
      ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    }
  }
  function cuadro() {
    p = salto ? objetivo : p + (objetivo - p) * 0.14;
    // Muestra el fotograma más cercano ya cargado, para no dejar huecos mientras llegan los demás
    let n = Math.round(p * (total - 1));
    for (let d = 0; d < total && !(imgs[n]?.complete && imgs[n].naturalWidth); d++) n = Math.max(0, n - 1);
    if (n !== ultimo && imgs[n]?.complete && imgs[n].naturalWidth) { dibujar(imgs[n]); ultimo = n; window.__fotograma = n; }
    oyente?.(p);
    if (activo) requestAnimationFrame(cuadro);
  }
  let oyente = null;
  tamano(); requestAnimationFrame(cuadro);
  return {
    progreso(v, i = false) { objetivo = v; salto = i; }, alCuadro(fn) { oyente = fn; }, tamano,
    pausar(v) { const antes = activo; activo = !v; if (activo && !antes) requestAnimationFrame(cuadro); },
  };
}

/*
 * The "Who is watching" panel, in three dimensions.
 *
 * This is the `afterRender` code of a Business Text panel
 * (marcusolsson-dynamictext-panel). build.py inlines it into
 * homelab-overview.json, so it can be read and edited as JavaScript instead of
 * as one escaped line inside a dashboard.
 *
 * The contract, from the plugin's source: the code is a function body called
 * with one argument, `context`, holding `element` (the panel's div),
 * `panelData`, `data` and `grafana`. Whatever it returns is called on unmount,
 * which is where the renderer, the geometries and the animation frame go --
 * without that, every dashboard refresh leaks a WebGL context and Chrome kills
 * the oldest one after sixteen.
 *
 * Data comes from two queries on the same labels, instant, no legend format so
 * that `__name__` survives in the field labels:
 *   A  jellyfin_session_progress_ratio{instance="nas"}
 *   B  jellyfin_session_position_seconds{instance="nas"}
 */

const element = context.element;
const theme = context.grafana.theme;

/** One row per person watching, merged across the two metrics. */
const byViewer = new Map();
for (const frame of context.panelData?.series ?? []) {
  const field = frame.fields?.find((candidate) => candidate.type === 'number');
  const labels = field?.labels ?? {};
  if (!field || !labels.user) {
    continue;
  }

  const values = typeof field.values?.toArray === 'function' ? field.values.toArray() : field.values;
  let value = null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null && Number.isFinite(values[index])) {
      value = values[index];
      break;
    }
  }
  if (value == null) {
    continue;
  }

  const key = `${labels.user}|${labels.item}|${labels.device}`;
  const viewer = byViewer.get(key) ?? {
    user: labels.user,
    item: labels.item || 'Something',
    kind: labels.kind || '',
    client: labels.client || '',
    method: labels.method || '',
    paused: labels.paused === 'true',
    progress: 0,
    position: 0,
  };
  if ((labels.__name__ || '').endsWith('progress_ratio')) {
    viewer.progress = Math.max(0, Math.min(1, value));
  }
  if ((labels.__name__ || '').endsWith('position_seconds')) {
    viewer.position = value;
  }
  byViewer.set(key, viewer);
}

const viewers = [...byViewer.values()].sort((a, b) => a.user.localeCompare(b.user));

const host = document.createElement('div');
host.style.cssText = 'position:relative;width:100%;height:100%;min-height:220px;';
element.replaceChildren(host);

const caption = document.createElement('div');
caption.style.cssText = [
  'position:absolute',
  'left:12px',
  'top:10px',
  'font:600 12px/1.2 Inter,system-ui,sans-serif',
  'letter-spacing:0.14em',
  'text-transform:uppercase',
  `color:${theme.colors.text.secondary}`,
  'pointer-events:none',
].join(';');
caption.textContent = viewers.length
  ? `${viewers.length} watching`
  : 'nobody watching';
host.appendChild(caption);

if (!viewers.length) {
  // An empty house is the normal state of a home server. A WebGL context for
  // nothing is not worth the memory, so the empty state is plain DOM.
  const empty = document.createElement('div');
  empty.style.cssText = [
    'display:grid',
    'place-items:center',
    'width:100%',
    'height:100%',
    'font:400 13px/1.4 Inter,system-ui,sans-serif',
    `color:${theme.colors.text.disabled}`,
  ].join(';');
  empty.textContent = 'The screens are dark.';
  host.appendChild(empty);
  return () => element.replaceChildren();
}

let disposed = false;
let dispose = () => {};

/** A viewer's card, drawn on a 2D canvas and used as the screen's texture. */
const drawCard = (viewer) => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // The red hairline is the only accent, same as the Cinema cards.
  ctx.fillStyle = viewer.paused ? '#6b7280' : '#e11d2e';
  ctx.fillRect(0, 0, 8, canvas.height);

  ctx.fillStyle = '#f5f5f5';
  ctx.font = '600 44px Inter, system-ui, sans-serif';
  ctx.fillText(viewer.user, 44, 96);

  ctx.fillStyle = '#c7c9cd';
  ctx.font = '400 34px Inter, system-ui, sans-serif';
  const title = viewer.item.length > 26 ? `${viewer.item.slice(0, 25)}…` : viewer.item;
  ctx.fillText(title, 44, 154);

  const hours = Math.floor(viewer.position / 3600);
  const minutes = Math.floor((viewer.position % 3600) / 60);
  const seconds = Math.floor(viewer.position % 60);
  const timecode = hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;

  ctx.fillStyle = '#8b8e95';
  ctx.font = '400 26px Inter, system-ui, sans-serif';
  ctx.fillText(
    [timecode, viewer.client, viewer.method, viewer.paused ? 'paused' : null]
      .filter(Boolean)
      .join('  ·  '),
    44,
    214,
  );

  ctx.fillStyle = '#26282e';
  ctx.fillRect(44, 268, canvas.width - 88, 10);
  ctx.fillStyle = viewer.paused ? '#6b7280' : '#e11d2e';
  ctx.fillRect(44, 268, (canvas.width - 88) * viewer.progress, 10);

  return canvas;
};

(async () => {
  // Three is not bundled with Grafana and the plugin's external-scripts option
  // was removed in Grafana 11, so the module comes from a CDN at render time.
  // The box needs outbound HTTPS for this panel and only this panel.
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
  if (disposed) {
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.8));
  const key = new THREE.PointLight(0xe11d2e, 60, 40);
  key.position.set(0, 2.5, 4);
  scene.add(key);

  // One screen per viewer on a carousel. The radius grows with the count so
  // three people are not drawn on top of each other and one is not lost in the
  // middle of an empty ring.
  const radius = Math.max(2.2, viewers.length * 0.75);
  const group = new THREE.Group();
  const disposables = [];

  viewers.forEach((viewer, index) => {
    const texture = new THREE.CanvasTexture(drawCard(viewer));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const geometry = new THREE.PlaneGeometry(3.2, 1.8);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const screen = new THREE.Mesh(geometry, material);

    const angle = (index / viewers.length) * Math.PI * 2;
    screen.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    screen.rotation.y = angle;
    screen.userData.phase = index * 1.1;
    group.add(screen);

    // A thin slab behind the screen, so it reads as an object and not a decal.
    const backGeometry = new THREE.BoxGeometry(3.3, 1.9, 0.08);
    const backMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b1d22,
      roughness: 0.6,
      metalness: 0.1,
    });
    const back = new THREE.Mesh(backGeometry, backMaterial);
    back.position.copy(screen.position);
    back.rotation.y = angle;
    back.translateZ(-0.06);
    group.add(back);

    disposables.push(geometry, material, texture, backGeometry, backMaterial);
  });

  scene.add(group);
  camera.position.set(0, 1.1, radius + 4.2);
  camera.lookAt(0, 0, 0);

  const resize = () => {
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight) {
      return;
    }
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let frame = 0;
  const started = performance.now();
  const tick = (now) => {
    const elapsed = (now - started) / 1000;
    group.rotation.y = elapsed * 0.18;
    for (const child of group.children) {
      if (child.userData.phase != null) {
        child.position.y = Math.sin(elapsed * 0.9 + child.userData.phase) * 0.08;
      }
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  dispose = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    for (const item of disposables) {
      item.dispose();
    }
    renderer.dispose();
    renderer.domElement.remove();
  };
})();

return () => {
  disposed = true;
  dispose();
  element.replaceChildren();
};

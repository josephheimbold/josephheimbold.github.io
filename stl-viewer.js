/*
  STL viewer for any element with class "stl-viewer".
    <div class="stl-viewer" data-stl="models/thing.stl" data-color="#7c5cff"></div>
  - data-stl:   path (or data: URL) of an .stl file (optional; a placeholder shape shows until one loads)
  - data-color: model color (optional)
  - data-rim:   rim light color (optional)
  Drag & drop an .stl file onto a viewer to preview it (fires a bubbling "stl-file" event).

  window.StlViewers.init(root)    gets viewers inside root ready to start
  window.StlViewers.dispose(root) stops viewers inside root and frees their WebGL contexts
  Requires an importmap for "three" and "three/addons/" in the page.

  Nothing loads until a viewer comes near the screen: three.js is downloaded for the first
  one, and each viewer only starts (and downloads its .stl) when it's within ~600px of view.
  Viewers in hidden sections never load.
*/
(() => {
  let make = null, loading = null;
  const waiting = new Set();                 // near the screen, waiting for three.js
  const start = el => {
    if (el._stl || !el.isConnected) return;
    if (make) { el._stl = make(el); return; }
    waiting.add(el);
    loading ??= loadThree();
  };
  const near = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { near.unobserve(e.target); start(e.target); }
  }, { rootMargin: '600px 0px' });

  window.StlViewers = {
    init(root = document) {
      root.querySelectorAll('.stl-viewer').forEach(el => {
        if (!el._stl && !el._watched) { el._watched = true; near.observe(el); }
      });
    },
    dispose(root = document) {
      root.querySelectorAll('.stl-viewer').forEach(el => {
        near.unobserve(el);
        el._watched = false;
        waiting.delete(el);
        if (el._stl) { el._stl.dispose(); el._stl = null; }
      });
    },
  };

  // viewers drawn before this script loaded
  window.StlViewers.init();
  addEventListener('DOMContentLoaded', () => window.StlViewers.init());

  async function loadThree() {
    const THREE = await import('three');
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const loader = new STLLoader();

    make = el => {
      let disposed = false;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(3, 5, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(el.dataset.rim || '#ff66cc', 1.2);
      rim.position.set(-4, -1, -3);
      scene.add(rim);

      const material = new THREE.MeshStandardMaterial({
        color: el.dataset.color || '#9b7bff', metalness: 0.2, roughness: 0.35,
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.6;
      controls.minDistance = 1.2;
      controls.maxDistance = 8;
      controls.addEventListener('start', () => (controls.autoRotate = false));

      let mesh;
      function show(geometry, isStl) {
        if (disposed) { geometry.dispose(); return; }
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
        geometry.center();
        geometry.computeBoundingSphere();
        mesh = new THREE.Mesh(geometry, material);
        mesh.scale.setScalar(1 / geometry.boundingSphere.radius);
        if (isStl) mesh.rotation.x = -Math.PI / 2; // STL files are usually Z-up
        scene.add(mesh);
        // start looking down at the model from about 35° above
        const TILT = 35 * Math.PI / 180, DIST = 3.5;
        camera.position.set(0, DIST * Math.sin(TILT), DIST * Math.cos(TILT));
        controls.target.set(0, 0, 0);
        controls.autoRotate = true;
        controls.update();
        renderer.compile(scene, camera);          // get the shaders ready now, not on the first frame shown
      }

      // Placeholder shape until a real model loads
      show(new THREE.TorusKnotGeometry(1, 0.32, 220, 36), false);
      if (el.dataset.stl) {
        loader.load(el.dataset.stl, g => show(g, true), undefined,
          () => console.warn('Could not load', el.dataset.stl.slice(0, 80)));
      }

      // Drag & drop a local .stl
      const onOver = e => { e.preventDefault(); el.classList.add('dragging'); };
      const onLeave = () => el.classList.remove('dragging');
      const onDrop = async e => {
        e.preventDefault();
        el.classList.remove('dragging');
        const file = e.dataTransfer.files[0];
        if (!file || !/\.stl$/i.test(file.name)) return;
        try {
          show(loader.parse(await file.arrayBuffer()), true);
          el.dispatchEvent(new CustomEvent('stl-file', { bubbles: true, detail: file }));
        } catch (err) { console.warn('Invalid STL', err); }
      };
      el.addEventListener('dragover', onOver);
      el.addEventListener('dragleave', onLeave);
      el.addEventListener('drop', onDrop);

      function resize() {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();

      // Only render while on screen
      const loop = () => { controls.update(); renderer.render(scene, camera); };
      const io = new IntersectionObserver(([entry]) => {
        renderer.setAnimationLoop(entry.isIntersecting ? loop : null);
      });
      io.observe(el);

      return {
        dispose() {
          disposed = true;
          renderer.setAnimationLoop(null);
          ro.disconnect();
          io.disconnect();
          controls.dispose();
          el.removeEventListener('dragover', onOver);
          el.removeEventListener('dragleave', onLeave);
          el.removeEventListener('drop', onDrop);
          if (mesh) mesh.geometry.dispose();
          material.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        },
      };
    };

    waiting.forEach(start);
    waiting.clear();
  }
})();

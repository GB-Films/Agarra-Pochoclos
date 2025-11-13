// Lógica del juego Pochoclos Catcher
// Requiere api.js (jsonbinRead/jsonbinWrite)

(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const DPI = Math.min(window.devicePixelRatio || 1, 2);

  const scoreEl      = document.getElementById('score');
  const screenStart  = document.getElementById('screen-start');
  const screenBoard  = document.getElementById('screen-board');
  const screenOver   = document.getElementById('screen-over');
  const finalScoreEl = document.getElementById('finalScore');
  const saveStatusEl = document.getElementById('saveStatus');
  const toastEl      = document.getElementById('toast');
  const hintEl       = document.getElementById('hint');

  const playerNameInput = document.getElementById('playerName');
  const skinSelect      = document.getElementById('skinSelect');
  const btnPlay   = document.getElementById('btnPlay');
  const btnBoard  = document.getElementById('btnBoard');
  const btnBack   = document.getElementById('btnBack');
  const btnReplay = document.getElementById('btnReplay');
  const btnHome   = document.getElementById('btnHome');
  const btnBoard2 = document.getElementById('btnBoard2');

  const boardTableBody = document.querySelector('#boardTable tbody');

  // Imagen trasera común a todas las skins (colocá este archivo en /skins/)
  const BACK_IMAGE_FILE = 'bucket_back.png';

  // ===== UI fail-safe =====
  function show(el){ el.hidden=false; el.style.display='grid'; }
  function hide(el){ el.hidden=true;  el.style.display='none'; }
  show(screenStart); hide(screenBoard); hide(screenOver);

  // ===== Config juego (spawn y gravedad continua) =====
  let running = false;
  let score = 0;
  let startTime = 0;

  let spawnDelay0 = 1400;              // ms inicio
  const minSpawnDelayHardFloor = 120;  // ms piso
  const SPAWN_ACCEL = 0.035;           // ↑ para acelerar más rápido

  const G_BASE = 0.32;
  const G_GROW_RATE = 0.006;           // ↑ para caer más rápido con el tiempo

  let popcorns = [];
  let nextSpawnAt = 0;

  // ===== Usuario =====
  let playerName = (localStorage.getItem('gb_player_name') || '').trim();
  let skinName   = localStorage.getItem('gb_skin') || ''; // sin skin por defecto

  // ===== Canvas scaling =====
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width * DPI);
    canvas.height = Math.round(rect.height * DPI);
  }
  fitCanvas();
  addEventListener('resize', fitCanvas);

  // ===== Utils =====
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
  function escapeHtml(s) {
    return String(s).replace(/[&<>\"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[m]));
  }
  const sleep = (ms)=> new Promise(r => setTimeout(r, ms));

  // ===== Balde cuadrado + capas =====
  const BUCKET_SIZE    = 120 * DPI; // w=h (escalable)
  const BASE_CATCH_H   = 22 * DPI;  // alto mínimo banda de captura
  const CATCH_VY_SCALE = 1.2;       // banda crece con la velocidad (anti-tunneling)
  const INSET_X_RATIO  = 0.06;      // recorte lateral (6% del ancho útil)

  const bucket = {
    x: 0, y: 0, w: BUCKET_SIZE, h: BUCKET_SIZE,
    imgFront: null,        // PNG de skin elegida
    drawBack() {           // interior común
      if (window.bucketBackImg && window.bucketBackImg.complete) {
        ctx.drawImage(window.bucketBackImg, this.x, this.y, this.w, this.h);
      }
      // si no cargó: transparente
    },
    drawFront() {          // diseño frontal de la skin
      if (this.imgFront && this.imgFront.complete) {
        ctx.drawImage(this.imgFront, this.x, this.y, this.w, this.h);
      }
      // si no hay front: transparente
    }
  };

  function loadBucketSkin(name) {
    const front = new Image();
    front.src = `skins/${name}`;
    front.onload  = () => bucket.imgFront = front;
    front.onerror = () => bucket.imgFront = null;
  }

  // Cargar back común una sola vez
  if (!window.bucketBackImg) {
    window.bucketBackImg = new Image();
    window.bucketBackImg.src = `skins/${BACK_IMAGE_FILE}`;
    window.bucketBackImg.onerror = () => { window.bucketBackImg = null; };
  }
  if (skinName) loadBucketSkin(skinName);

  // ===== Pochoclo (imagen) =====
  if (!window.popcornImg) {
    window.popcornImg = new Image();
    window.popcornImg.src = "skins/Pochoclo.png"; // tu PNG del pochoclo
  }

  // ===== Input =====
  let pointerX = null, holding = false;
  function setPointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0])
      pointerX = (e.touches[0].clientX - rect.left) / rect.width * canvas.width;
    else if (e.changedTouches && e.changedTouches[0])
      pointerX = (e.changedTouches[0].clientX - rect.left) / rect.width * canvas.width;
    else if (e.clientX != null)
      pointerX = (e.clientX - rect.left) / rect.width * canvas.width;
  }
  canvas.addEventListener('pointerdown', e => { holding = true; setPointerFromEvent(e); });
  canvas.addEventListener('pointermove', e => { if (holding) setPointerFromEvent(e); });
  addEventListener('pointerup', () => { holding = false; });
  canvas.addEventListener('touchstart', e => { holding = true; setPointerFromEvent(e); });
  canvas.addEventListener('touchmove', e => { if (holding) setPointerFromEvent(e); });
  addEventListener('touchend', () => { holding = false; });

  // ===== Core =====
  function placeBucket() {
    bucket.w = BUCKET_SIZE;
    bucket.h = BUCKET_SIZE;             // cuadrado
    bucket.x = (canvas.width - bucket.w) / 2;
    bucket.y = canvas.height - bucket.h - 20 * DPI;
  }

  function newPopcorn(ts) {
    const tSec = Math.max(0, (ts - startTime) / 1000);
    const p = {
      x: (Math.random()*0.7 + 0.15) * canvas.width,
      y: 20 * DPI,
      r: 14 * DPI,
      vx: 0,
      vy: 0,
      caught: false,
      dead: false
    };
    // Tu vx puede ser custom; dejo un rango con leve boost temporal
    const vxBase  = 2 + Math.random()*6;
    const vxBoost = 1 + Math.min(0.35, 0.08 * Math.log1p(tSec));
    p.vx = (Math.random()<0.5?-1:1) * (vxBase * vxBoost) * DPI;
    p.vy = 0.35 * DPI;
    return p;
  }

  function scheduleNextSpawn(nowTs) {
    const tSec = Math.max(0, (nowTs - startTime) / 1000);
    const delay = Math.max(minSpawnDelayHardFloor, spawnDelay0 * Math.exp(-SPAWN_ACCEL * tSec));
    nextSpawnAt = nowTs + delay;
  }

  function resetGame() {
    score = 0; scoreEl.textContent = score;
    startTime = performance.now();
    placeBucket();
    popcorns = [];
    scheduleNextSpawn(startTime + 300);
  }

  // Colisión rectangular (boca bottom = y + h/8)
  function intersectsBucket(ball, buck, frameFactor) {
    const mouthBottomY = buck.y + buck.h * 0.85; // 1/8 desde arriba
    const bandH = Math.max(BASE_CATCH_H, Math.abs(ball.vy) * frameFactor * CATCH_VY_SCALE);
    const ry = mouthBottomY - bandH;

    const insetX = Math.max(6 * DPI, INSET_X_RATIO * buck.w); // recorte lateral
    const rx = buck.x + insetX;
    const rw = buck.w - insetX * 2;

    // circle vs AABB usando el punto inferior del círculo
    const cx = ball.x;
    const cy = ball.y + ball.r;

    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + bandH));
    const dx = cx - nx, dy = cy - ny;

    return (dx*dx + dy*dy) <= (ball.r * ball.r) && ball.vy > 0;
  }

  function showCatchBurst(x, y) {
    const p = { x, y, r: 2 * DPI, t: 0 };
    const id = setInterval(() => {
      const fade = Math.max(0, 1 - p.t / 12);
      ctx.save(); ctx.globalAlpha = fade;
      ctx.fillStyle = '#ffd782';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.t, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      p.t++; if (fade <= 0) clearInterval(id);
    }, 16);
  }

  let lastTs = performance.now();

  function update(now) {
    if(!running) return;
    requestAnimationFrame(update);
    const ts = now || performance.now();
    const dt = Math.min(40, ts - lastTs);
    lastTs = ts;

    const tSec = Math.max(0, (ts - startTime) / 1000);
    const G = (G_BASE + G_GROW_RATE * tSec) * DPI;

    // spawn continuo
    if (ts >= nextSpawnAt) { popcorns.push(newPopcorn(ts)); scheduleNextSpawn(ts); }

    // fondo simple
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 2*DPI; ctx.strokeRect(2*DPI,2*DPI, canvas.width-4*DPI, canvas.height-4*DPI);

    // mover bucket (directo si hay dedo; easing si no)
    if (pointerX != null) {
      const target = clamp(pointerX - bucket.w/2, 4*DPI, canvas.width - bucket.w - 4*DPI);
      bucket.x += (holding ? (target - bucket.x) : (target - bucket.x) * 0.25);
    }

    // capa trasera del balde (interior)
    bucket.drawBack();

    // update/draw pochoclos
    const f = (dt/16.67);
    const minX = 6*DPI, maxX = canvas.width - 6*DPI, floorY = canvas.height - 8*DPI;

    for (let p of popcorns) {
      if (p.dead) continue;

      p.vy += G * f;
      p.x  += p.vx * f;
      p.y  += p.vy * f;

      const leftBound  = minX + p.r;
      const rightBound = maxX - p.r;
      if(p.x < leftBound){ p.x = leftBound; p.vx *= -0.98; }
      if(p.x > rightBound){ p.x = rightBound; p.vx *= -0.98; }

      if(p.y + p.r >= floorY){ gameOver(); return; }

      if (!p.caught && intersectsBucket(p, bucket, f)) {
        p.caught = true;
        p.dead = true;
        score += 1; scoreEl.textContent = score;
        showCatchBurst(p.x, bucket.y);
      }

      if (window.popcornImg.complete && window.popcornImg.naturalWidth > 0) {
        const size = p.r * 2;
        ctx.drawImage(window.popcornImg, p.x - p.r, p.y - p.r, size, size);
      } else {
        ctx.fillStyle = '#ffe9b3';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#e6c77a'; ctx.lineWidth = 3 * DPI; ctx.stroke();
      }
    }

    // limpieza defensiva
    if (popcorns.length > 150) popcorns = popcorns.filter(p => !p.dead);

    // capa frontal del balde (diseño)
    bucket.drawFront();
  }

  // ===== Leaderboard (lectura simple, ordenado) =====
  async function loadLeaderboard() {
    boardTableBody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
    try {
      const data = await jsonbinRead();
      const list = (data && data.scores) ? data.scores.slice() : [];
      list.sort((a, b) => b.score - a.score || (a.ts || 0) - (b.ts || 0));
      const top = list.slice(0, 50);
      boardTableBody.innerHTML = '';
      if (top.length === 0) {
        boardTableBody.innerHTML = '<tr><td colspan="4">Sin registros aún</td></tr>';
        return;
      }
      top.forEach((row, i) => {
        const tr = document.createElement('tr');
        const date = row.ts ? new Date(row.ts) : new Date();
        tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(row.name || 'Jugador')}</td><td>${row.score | 0}</td><td class="small">${date.toLocaleString()}</td>`;
        boardTableBody.appendChild(tr);
      });
    } catch (err) {
      console.error(err);
      boardTableBody.innerHTML = '<tr><td colspan="4">Error al cargar tabla</td></tr>';
    }
  }

  // ===== Guardado robusto (merge + retries) =====
  async function saveScore(name, score) {
    const MAX_RETRIES = 5;
    let attempt = 0;

    // jitter para desincronizar avalanchas
    await sleep(Math.random() * 250);

    while (attempt < MAX_RETRIES) {
      attempt++;
      let data;
      try { data = await jsonbinRead(); }
      catch (e) { if (attempt===MAX_RETRIES) throw e; await sleep(200*attempt); continue; }

      const existing = Array.isArray(data?.scores) ? data.scores.slice() : [];
      existing.push({ name, score, ts: Date.now() });
      while (existing.length > 1000) existing.shift();

      try { await jsonbinWrite({ scores: existing }); }
      catch (e) { if (attempt===MAX_RETRIES) throw e; await sleep(250*attempt); continue; }

      try {
        const verify = await jsonbinRead();
        const ok = Array.isArray(verify?.scores) && verify.scores.some(s => s.name===name && s.score===score);
        if (ok) return;
        if (attempt===MAX_RETRIES) throw new Error('Race write lost after retries');
        await sleep(300*attempt);
      } catch (e) {
        if (attempt===MAX_RETRIES) throw e;
        await sleep(300*attempt);
      }
    }
  }

  // ===== Validación nombre + skin =====
  function isFormValid() {
    const nameOk = (playerNameInput.value.trim().length >= 1);
    const skinOk  = (skinSelect.value && skinSelect.value.length > 0);
    return nameOk && skinOk;
  }
  function updatePlayEnabled() { btnPlay.disabled = !isFormValid(); }

  // ===== UI (selector de skins) =====
  function populateSkins() {
    // 1) Intentamos leer la lista desde el HTML: data-skins="a.png,b.png,c.png"
    const fromAttr = (skinSelect.dataset.skins || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  
    // 2) Si ya hay <option> en el HTML, sólo limpiamos las labels (quitar ".png").
    //    Si no hay options y tenemos fromAttr, poblamos dinámicamente.
    const hadOptions = skinSelect.options.length > 0;
  
    // Siempre arrancamos dejando un placeholder primero
    skinSelect.innerHTML = "";
    const ph = document.createElement('option');
    ph.value = "";
    ph.textContent = "Elegí un skin…";
    ph.disabled = true;
    ph.selected = !skinName; // si no hay skin guardada, queda de placeholder
    skinSelect.appendChild(ph);
  
    let names = [];
    if (hadOptions) {
      // Tomamos los values existentes del HTML (sin tocar nombres)
      names = Array.from(skinSelect.options).slice(1).map(o => o.value).filter(Boolean);
    } else if (fromAttr.length) {
      names = fromAttr;
    } else {
      // No hay options en HTML ni data-skins -> no podemos adivinar los archivos
      // Dejar sólo el placeholder y salir (el usuario verá la lista vacía)
      return;
    }
  
    // Rellenar opciones con labels sin ".png"
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n.replace(/\.png$/i, "");
      // Si tenías una skin guardada en localStorage, la dejamos seleccionada
      if (n === skinName) opt.selected = true;
      skinSelect.appendChild(opt);
    });
  
    // Si no había skin previa, no selecciones la primera real: que obligue a elegir
    if (!skinName) {
      skinSelect.selectedIndex = 0; // placeholder
    }
  }

  populateSkins();

  // setear nombre guardado (si había)
  playerNameInput.value = playerName;

  // Eventos inputs
  playerNameInput.addEventListener('input', () => {
    playerName = playerNameInput.value.trim();
    updatePlayEnabled();
  });
  skinSelect.addEventListener('change', () => {
    skinName = skinSelect.value;
    localStorage.setItem('gb_skin', skinName);
    if (skinName) loadBucketSkin(skinName);
    updatePlayEnabled();
  });

  // Botones
  btnPlay.addEventListener('click', () => {
    if (!isFormValid()) { showToast('Completá tu nombre y elegí una skin.'); updatePlayEnabled(); return; }
    playerName = playerNameInput.value.trim();
    localStorage.setItem('gb_player_name', playerName);
    showGame();
  });
  btnBoard.addEventListener('click', showBoard);
  btnBack.addEventListener('click', showStart);
  btnReplay.addEventListener('click', showGame);
  btnHome.addEventListener('click', showStart);
  btnBoard2.addEventListener('click', showBoard);

  // ===== Flow =====
  function showStart() {
    running = false; hide(screenOver); hide(screenBoard); show(screenStart);
    hintEl.style.opacity = 0.7; updatePlayEnabled();
  }
  function showBoard() {
    running = false; hide(screenStart); hide(screenOver); show(screenBoard); loadLeaderboard();
  }
  function showGame(){
    hide(screenStart); hide(screenBoard); hide(screenOver);
    resetGame(); running = true; lastTs = performance.now();
    requestAnimationFrame(update);
    setTimeout(()=> hintEl.style.opacity = 0, 2000);
  }
  function showOver() { running = false; hide(screenStart); hide(screenBoard); show(screenOver); }

  async function gameOver() {
    finalScoreEl.textContent = score;
  
    // limpiar inmediatamente el canvas para que no quede “la tapa” a la vista
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    showOver();
    try {
      await saveScore(playerName, score);
      saveStatusEl.textContent = 'Puntaje guardado correctamente.';
      saveStatusEl.style.color = '#b6f0c0';
    } catch (err) {
      console.error(err);
      saveStatusEl.textContent = 'No se pudo guardar el puntaje (revisa JSONBin).';
      saveStatusEl.style.color = '#ff9b9b';
    }
  }


  // Init
  showStart();
  placeBucket();
  updatePlayEnabled();
})();

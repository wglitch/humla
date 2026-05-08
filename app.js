const PHASE_SECONDS = 5;
const SAMPLE_INTERVAL_MS = 90;
const MIN_FREQ = 85;
const MAX_FREQ = 900;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const phaseLabel = document.getElementById("phaseLabel");
const timerLabel = document.getElementById("timerLabel");
const statusText = document.getElementById("statusText");
const progressBar = document.getElementById("progressBar");
const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

let audioCtx;
let analyser;
let micSource;
let micStream;
let dataBuffer;
let running = false;
let phase = "ready";
let currentSamples = [];
let motifMemory = [];
let visualLines = [];
let animationFrame = null;
let sampleTimer = null;
let phaseStart = 0;
let phaseDuration = PHASE_SECONDS * 1000;
let activeOscillators = [];

const creature = {
  mood: "curious",
  warmth: 0.42,
  weirdness: 0.28,
  memory: 0.35
};

const moods = ["curious", "sleepy", "playful", "strange", "tender"];

startBtn.addEventListener("click", startHumla);
stopBtn.addEventListener("click", stopHumla);

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
drawIdle();

async function startHumla() {
  try {
    startBtn.disabled = true;
    statusText.textContent = "Väcker Humla…";

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Viktigt för iOS/Safari: skapa/resume audio från knapptryck.
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.65;

    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(analyser);

    dataBuffer = new Float32Array(analyser.fftSize);

    running = true;
    stopBtn.disabled = false;

    animate();
    beginHumanTurn("Nynna en krok. Fem sekunder.");
  } catch (error) {
    console.error(error);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent =
      "Humla fick inte igång mikrofonen. Kolla mikrofonbehörighet och att sidan körs via https/GitHub Pages.";
  }
}

function stopHumla() {
  running = false;
  phase = "stopped";

  clearInterval(sampleTimer);
  stopAllOscillators();

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
  }

  if (audioCtx && audioCtx.state !== "closed") {
    audioCtx.close();
  }

  cancelAnimationFrame(animationFrame);

  document.body.className = "";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  phaseLabel.textContent = "Stoppad";
  timerLabel.textContent = "0.0";
  progressBar.style.width = "0%";
  statusText.textContent = "Stoppad. Starta igen när du vill nynna vidare.";
  drawIdle();
}

function beginHumanTurn(message = "Din tur.") {
  if (!running) return;

  phase = "listening";
  document.body.className = "listening";
  phaseLabel.textContent = "Din tur";
  statusText.textContent = message;

  currentSamples = [];
  startTimedPhase(PHASE_SECONDS, () => {
    const motif = analyzeHumanPhrase(currentSamples);
    motifMemory.push(motif);
    if (motifMemory.length > 8) motifMemory.shift();

    visualLines.push(makeVisualLine(motif, "human"));
    beginMachineResponse(motif);
  });

  clearInterval(sampleTimer);
  sampleTimer = setInterval(sampleInput, SAMPLE_INTERVAL_MS);
}

function beginMachineResponse(humanMotif) {
  if (!running) return;

  clearInterval(sampleTimer);
  phase = "responding";
  document.body.className = "responding";
  phaseLabel.textContent = "Humla svarar";
  statusText.textContent = responseText("response");

  const response = transformMotif(humanMotif, "response");
  visualLines.push(makeVisualLine(response, "machine"));
  playMotif(response, PHASE_SECONDS, "response");

  startTimedPhase(PHASE_SECONDS, () => {
    beginMachineDevelopment(response);
  });
}

function beginMachineDevelopment(previousMotif) {
  if (!running) return;

  phase = "developing";
  document.body.className = "developing";
  phaseLabel.textContent = "Humla driver";
  statusText.textContent = responseText("development");

  const development = transformMotif(previousMotif, "development");
  visualLines.push(makeVisualLine(development, "machineDevelop"));
  playMotif(development, PHASE_SECONDS, "development");

  startTimedPhase(PHASE_SECONDS, () => {
    mutateCreature();
    beginHumanTurn("Din tur igen. Svara på Humla.");
  });
}

function startTimedPhase(seconds, onDone) {
  phaseStart = performance.now();
  phaseDuration = seconds * 1000;

  function tick(now) {
    if (!running) return;

    const elapsed = now - phaseStart;
    const left = Math.max(0, phaseDuration - elapsed);
    const progress = Math.min(1, elapsed / phaseDuration);

    timerLabel.textContent = (left / 1000).toFixed(1);
    progressBar.style.width = `${progress * 100}%`;

    if (elapsed >= phaseDuration) {
      progressBar.style.width = "100%";
      onDone();
    } else {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

function sampleInput() {
  if (!analyser || phase !== "listening") return;

  analyser.getFloatTimeDomainData(dataBuffer);

  const rms = getRms(dataBuffer);
  const pitch = autoCorrelate(dataBuffer, audioCtx.sampleRate);

  currentSamples.push({
    time: performance.now(),
    volume: rms,
    pitch: pitch || null
  });
}

function analyzeHumanPhrase(samples) {
  const voiced = samples.filter((s) => s.pitch && s.volume > 0.012);
  const usable = voiced.length > 3 ? voiced : samples;

  const pitches = usable
    .map((s) => s.pitch)
    .filter(Boolean)
    .map((p) => clamp(p, MIN_FREQ, MAX_FREQ));

  const volumes = samples.map((s) => s.volume);

  const baseFreq = pitches.length ? median(pitches) : randomBetween(170, 260);
  const energy = clamp(avg(volumes) * 14, 0.08, 1);

  const contour = normalizeContour(samples, baseFreq);

  return {
    baseFreq,
    energy,
    contour,
    density: clamp(pitches.length / Math.max(1, samples.length), 0, 1),
    seed: Math.random()
  };
}

function normalizeContour(samples, baseFreq) {
  const points = [];

  for (const sample of samples) {
    const volume = sample.volume || 0;
    const hasPitch = sample.pitch && volume > 0.012;
    const ratio = hasPitch ? sample.pitch / baseFreq : 1;

    points.push({
      ratio: clamp(ratio, 0.5, 2.0),
      volume: clamp(volume * 18, 0, 1),
      voiced: Boolean(hasPitch)
    });
  }

  if (points.length < 10) {
    for (let i = points.length; i < 48; i++) {
      points.push({
        ratio: 1 + Math.sin(i * 0.4) * 0.08,
        volume: 0.35 + Math.sin(i * 0.22) * 0.15,
        voiced: true
      });
    }
  }

  return resample(points, 56);
}

function transformMotif(motif, mode) {
  const source =
    Math.random() < creature.memory && motifMemory.length > 1
      ? motifMemory[Math.floor(Math.random() * motifMemory.length)]
      : motif;

  const type = chooseTransform(mode);
  const contour = source.contour.map((p, index, arr) => {
    let ratio = p.ratio;
    let volume = p.volume;

    if (type === "echo") {
      ratio *= randomBetween(0.985, 1.015);
    }

    if (type === "invert") {
      ratio = 1 / ratio;
    }

    if (type === "harmonizeUp") {
      ratio *= 1.25;
    }

    if (type === "harmonizeDown") {
      ratio *= 0.75;
    }

    if (type === "question") {
      ratio *= 1 + (index / arr.length) * 0.18;
    }

    if (type === "answer") {
      ratio *= 1.12 - (index / arr.length) * 0.18;
    }

    if (type === "creature") {
      ratio *= 1 + Math.sin(index * 0.55 + source.seed * 10) * creature.weirdness;
      volume *= 0.75 + Math.sin(index * 0.31) * 0.25;
    }

    if (mode === "development") {
      ratio *= 1 + Math.sin(index * 0.21 + performance.now() * 0.001) * 0.08;
      volume = Math.max(volume, 0.18 + Math.sin(index * 0.34) * 0.12);
    }

    return {
      ratio: clamp(ratio, 0.45, 2.2),
      volume: clamp(volume, 0.02, 1),
      voiced: p.voiced || mode === "development"
    };
  });

  return {
    baseFreq: clamp(source.baseFreq * randomBetween(0.92, 1.12), MIN_FREQ, MAX_FREQ),
    energy: clamp(source.energy * randomBetween(0.85, 1.2), 0.08, 1),
    contour,
    density: source.density,
    seed: Math.random(),
    type,
    mode
  };
}

function chooseTransform(mode) {
  if (mode === "development") {
    return weightedChoice([
      ["creature", 4],
      ["question", 2],
      ["answer", 2],
      ["invert", 1],
      ["harmonizeUp", 1]
    ]);
  }

  return weightedChoice([
    ["echo", 3],
    ["invert", 2],
    ["harmonizeUp", 2],
    ["harmonizeDown", 1],
    ["question", 2],
    ["answer", 2],
    ["creature", 1]
  ]);
}

function playMotif(motif, seconds, mode) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime + 0.04;
  const total = seconds;
  const step = total / motif.contour.length;

  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.42, now + 0.08);
  master.gain.exponentialRampToValueAtTime(0.0001, now + total - 0.03);
  master.connect(audioCtx.destination);

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(mode === "development" ? 1100 : 850, now);
  filter.Q.setValueAtTime(3.2, now);
  filter.connect(master);

  const delay = audioCtx.createDelay(0.45);
  delay.delayTime.setValueAtTime(mode === "development" ? 0.22 : 0.16, now);

  const feedback = audioCtx.createGain();
  feedback.gain.setValueAtTime(mode === "development" ? 0.28 : 0.18, now);

  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(master);

  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();

  osc.type = mode === "development" ? "triangle" : "sine";
  osc.frequency.setValueAtTime(motif.baseFreq, now);
  oscGain.gain.setValueAtTime(0.0001, now);

  osc.connect(oscGain);
  oscGain.connect(filter);
  oscGain.connect(delay);

  const hum = audioCtx.createOscillator();
  const humGain = audioCtx.createGain();
  hum.type = "sine";
  hum.frequency.setValueAtTime(motif.baseFreq * 0.5, now);
  humGain.gain.setValueAtTime(0.0001, now);
  hum.connect(humGain);
  humGain.connect(filter);

  motif.contour.forEach((point, i) => {
    const t = now + i * step;
    const freq = clamp(motif.baseFreq * point.ratio, MIN_FREQ, MAX_FREQ);
    const gain = point.voiced ? 0.025 + point.volume * 0.19 * motif.energy : 0.0001;

    osc.frequency.linearRampToValueAtTime(freq, t);
    hum.frequency.linearRampToValueAtTime(freq * 0.5, t);
    oscGain.gain.linearRampToValueAtTime(gain, t);
    humGain.gain.linearRampToValueAtTime(gain * 0.32, t);
  });

  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + total);
  humGain.gain.exponentialRampToValueAtTime(0.0001, now + total);

  osc.start(now);
  hum.start(now);
  osc.stop(now + total + 0.1);
  hum.stop(now + total + 0.1);

  activeOscillators.push(osc, hum);

  osc.onended = () => {
    activeOscillators = activeOscillators.filter((o) => o !== osc && o !== hum);
    safeDisconnect(master);
    safeDisconnect(filter);
    safeDisconnect(delay);
    safeDisconnect(feedback);
  };
}

function stopAllOscillators() {
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch (_) {
      // already stopped
    }
  });
  activeOscillators = [];
}

function responseText(kind) {
  if (kind === "response") {
    const lines = [
      "Humla hörde något. Den svarar försiktigt.",
      "Humla tuggar på din krok och nynnar tillbaka.",
      "Den lilla ljudvarelsen svarar.",
      "Humla speglar dig, men lite fel med flit."
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  const lines = [
    "Humla fortsätter själv en stund.",
    "Nu tar den initiativ och driver melodin vidare.",
    "Humla blir lite modigare.",
    "Den hittade en sidoväg i melodin."
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function mutateCreature() {
  creature.mood = moods[Math.floor(Math.random() * moods.length)];
  creature.warmth = clamp(creature.warmth + randomBetween(-0.08, 0.08), 0.1, 0.9);
  creature.weirdness = clamp(creature.weirdness + randomBetween(-0.08, 0.12), 0.05, 0.65);
  creature.memory = clamp(creature.memory + randomBetween(-0.05, 0.08), 0.15, 0.75);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function animate() {
  if (!running) return;
  draw();
  animationFrame = requestAnimationFrame(animate);
}

function drawIdle() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBase(0.5);
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pulse = 0.5 + Math.sin(performance.now() * 0.003) * 0.5;
  drawBase(pulse);

  if (phase === "listening" && analyser) {
    analyser.getFloatTimeDomainData(dataBuffer);
    drawMicWave(dataBuffer);
  }

  visualLines = visualLines.slice(-9);
  visualLines.forEach((line, index) => {
    drawMotifLine(line, index, visualLines.length);
  });
}

function drawBase(pulse) {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const baseR = rect.width * (0.34 + pulse * 0.015);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1.2;

  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, baseR + i * 18, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? "rgba(143,255,210,0.18)" : "rgba(255,203,112,0.18)";
    ctx.stroke();
  }

  ctx.restore();
}

function drawMicWave(buffer) {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const radius = rect.width * 0.36;

  ctx.save();
  ctx.beginPath();

  for (let i = 0; i < 220; i++) {
    const idx = Math.floor((i / 220) * buffer.length);
    const angle = (i / 220) * Math.PI * 2;
    const amp = buffer[idx] || 0;
    const r = radius + amp * 56;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.closePath();
  ctx.strokeStyle = "rgba(255,203,112,0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255,203,112,0.55)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();
}

function makeVisualLine(motif, owner) {
  return {
    contour: motif.contour,
    owner,
    seed: Math.random(),
    born: performance.now()
  };
}

function drawMotifLine(line, index, total) {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const age = (performance.now() - line.born) / 1000;
  const fade = clamp(1 - age / 38, 0.12, 0.88);
  const radius = rect.width * (0.21 + index * 0.028);
  const wobble = line.owner === "human" ? 18 : 28;

  ctx.save();
  ctx.beginPath();

  line.contour.forEach((point, i) => {
    const t = i / line.contour.length;
    const angle = t * Math.PI * 2 + line.seed * 2 + age * 0.035;
    const melodic = Math.log2(point.ratio) * wobble;
    const energetic = point.volume * 22;
    const r = radius + melodic + energetic;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.closePath();

  if (line.owner === "human") {
    ctx.strokeStyle = `rgba(255,203,112,${fade})`;
    ctx.shadowColor = "rgba(255,203,112,0.45)";
  } else if (line.owner === "machineDevelop") {
    ctx.strokeStyle = `rgba(232,124,255,${fade})`;
    ctx.shadowColor = "rgba(232,124,255,0.42)";
  } else {
    ctx.strokeStyle = `rgba(143,255,210,${fade})`;
    ctx.shadowColor = "rgba(143,255,210,0.42)";
  }

  ctx.lineWidth = line.owner === "machineDevelop" ? 2.2 : 1.7;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
}

function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  const rms = getRms(buffer);

  if (rms < 0.01) return null;

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;

  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }

  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buffer[size - i]) < threshold) {
      r2 = size - i;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const n = trimmed.length;
  const correlations = new Array(n).fill(0);

  for (let lag = 0; lag < n; lag++) {
    for (let i = 0; i < n - lag; i++) {
      correlations[lag] += trimmed[i] * trimmed[i + lag];
    }
  }

  let d = 0;
  while (correlations[d] > correlations[d + 1]) d++;

  let maxValue = -1;
  let maxIndex = -1;

  for (let i = d; i < n; i++) {
    if (correlations[i] > maxValue) {
      maxValue = correlations[i];
      maxIndex = i;
    }
  }

  if (maxIndex <= 0) return null;

  const frequency = sampleRate / maxIndex;

  if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;
  return frequency;
}

function getRms(buffer) {
  let sum = 0;

  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }

  return Math.sqrt(sum / buffer.length);
}

function resample(points, targetLength) {
  const result = [];

  for (let i = 0; i < targetLength; i++) {
    const t = i / (targetLength - 1);
    const sourceIndex = t * (points.length - 1);
    const left = Math.floor(sourceIndex);
    const right = Math.min(points.length - 1, left + 1);
    const mix = sourceIndex - left;

    const a = points[left];
    const b = points[right];

    result.push({
      ratio: lerp(a.ratio, b.ratio, mix),
      volume: lerp(a.volume, b.volume, mix),
      voiced: mix < 0.5 ? a.voiced : b.voiced
    });
  }

  return result;
}

function weightedChoice(items) {
  const total = items.reduce((sum, item) => sum + item[1], 0);
  let roll = Math.random() * total;

  for (const [value, weight] of items) {
    roll -= weight;
    if (roll <= 0) return value;
  }

  return items[0][0];
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch (_) {
    // already disconnected
  }
}
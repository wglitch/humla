const PHASE_SECONDS = 5;
const SAMPLE_INTERVAL_MS = 90;
const MIN_FREQ = 85;
const MAX_FREQ = 900;
const HUM_STORAGE_KEY = "humla_saved_sessions_v1";
const MAX_RINGS = 12;
const DUET_OVERLAP_SECONDS = 0.55;
const RECORD_SPIN_RPS = 0.11;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const revisitBtn = document.getElementById("revisitBtn");
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
let tracks = [];
let activeTrack = null;
let lastHumanMotif = null;
let animationFrame = null;
let sampleTimer = null;
let phaseStart = 0;
let phaseDuration = PHASE_SECONDS * 1000;
let phaseAlmostDoneTimer = null;
let activeOscillators = [];
let sessionStartedAt = Date.now();
let spinStartedAt = performance.now();
let spinBase = 0;
let recordSpinning = false;
let playbackGeneration = 0;

const creature = {
  mood: "curious",
  warmth: 0.45,
  weirdness: 0.28,
  memory: 0.35
};

const moods = ["curious", "sleepy", "playful", "strange", "tender"];

startBtn.addEventListener("click", startHumla);
stopBtn.addEventListener("click", stopHumla);
saveBtn.addEventListener("click", saveLastHumanHum);
revisitBtn.addEventListener("click", revisitSavedHum);

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
drawIdle();
updateRevisitButton();

async function startHumla() {
  try {
    startBtn.disabled = true;
    statusText.textContent = "Väcker Humla…";

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

    sessionStartedAt = Date.now();
    tracks = [];
    motifMemory = [];
    lastHumanMotif = null;

    running = true;
    stopBtn.disabled = false;
    saveBtn.disabled = true;

    animate();
    beginHumanTurn("Nynna en krok. Humla ristar ytterspåret.");
  } catch (error) {
    console.error(error);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent =
      "Humla fick inte igång mikrofonen. Testa via GitHub Pages/https och kolla mikrofonbehörighet.";
  }
}

function stopHumla() {
  running = false;
  phase = "stopped";
  playbackGeneration += 1;
  stopRecordSpin();

  clearInterval(sampleTimer);
  clearTimeout(phaseAlmostDoneTimer);
  stopAllOscillators();

  if (micStream) micStream.getTracks().forEach((track) => track.stop());

  if (audioCtx && audioCtx.state !== "closed") {
    audioCtx.close();
  }

  cancelAnimationFrame(animationFrame);

  document.body.className = "";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  saveBtn.disabled = !lastHumanMotif;
  phaseLabel.textContent = "Stoppad";
  timerLabel.textContent = "0.0";
  progressBar.style.width = "0%";
  statusText.textContent = "Stoppad. Skivan ligger kvar som minne.";
  draw();
}

function beginHumanTurn(message = "Din tur.") {
  if (!running) return;

  clearTimeout(phaseAlmostDoneTimer);
  startRecordSpin();
  phase = "listening";
  document.body.className = "listening";
  phaseLabel.textContent = "Humlan lyssnar";
  statusText.textContent = message;

  currentSamples = [];
  activeTrack = createTrack("human", null);
  tracks.unshift(activeTrack);
  trimTracks();

  startTimedPhase(PHASE_SECONDS, () => {
    const motif = analyzeHumanPhrase(currentSamples);
    lastHumanMotif = motif;
    saveBtn.disabled = false;

    activeTrack.motif = motif;
    activeTrack.contour = motif.contour;
    activeTrack.complete = true;

    motifMemory.push(motif);
    if (motifMemory.length > 8) motifMemory.shift();

    beginMachineResponse(motif);
  });

  clearInterval(sampleTimer);
  sampleTimer = setInterval(sampleInput, SAMPLE_INTERVAL_MS);
}

function beginMachineResponse(humanMotif) {
  if (!running) return;

  clearInterval(sampleTimer);
  clearTimeout(phaseAlmostDoneTimer);
  phase = "responding";
  document.body.className = "responding";
  phaseLabel.textContent = "Humla svarar";
  statusText.textContent = responseText("response");

  const response = transformMotif(humanMotif, "response");
  activeTrack = createTrack("machine", response);
  tracks.unshift(activeTrack);
  trimTracks();

  playTransitionHum(humanMotif, response);
  playMotif(response, PHASE_SECONDS + DUET_OVERLAP_SECONDS * 0.55, "response", {
    fadeIn: 0.22,
    fadeOut: 0.34,
    gain: 0.92,
    lilt: 0.75
  });

  startTimedPhase(PHASE_SECONDS, () => {
    activeTrack.complete = true;
    beginMachineDevelopment(response);
  });
}

function beginMachineDevelopment(previousMotif) {
  if (!running) return;

  clearTimeout(phaseAlmostDoneTimer);
  phase = "developing";
  document.body.className = "developing";
  phaseLabel.textContent = "Humlan surrar";
  statusText.textContent = responseText("development");

  const development = transformMotif(previousMotif, "development");
  activeTrack = createTrack("machineDevelop", development);
  tracks.unshift(activeTrack);
  trimTracks();

  playMotif(development, PHASE_SECONDS + DUET_OVERLAP_SECONDS, "development", {
    fadeIn: 0.38,
    fadeOut: 0.42,
    gain: 0.82,
    lilt: 1.1
  });

  startTimedPhase(PHASE_SECONDS, () => {
    activeTrack.complete = true;
    mutateCreature();
    beginHumanTurn("Din tur igen. Svara på ytterspåret.");
  });
}

function startTimedPhase(seconds, onDone, onAlmostDone) {
  phaseStart = performance.now();
  phaseDuration = seconds * 1000;
  clearTimeout(phaseAlmostDoneTimer);

  if (onAlmostDone) {
    phaseAlmostDoneTimer = setTimeout(
      onAlmostDone,
      Math.max(0, phaseDuration - DUET_OVERLAP_SECONDS * 1000)
    );
  }

  function tick(now) {
    if (!running && phase !== "revisiting") return;

    const elapsed = now - phaseStart;
    const left = Math.max(0, phaseDuration - elapsed);
    const progress = Math.min(1, elapsed / phaseDuration);

    timerLabel.textContent = (left / 1000).toFixed(1);
    progressBar.style.width = `${progress * 100}%`;

    if (activeTrack) activeTrack.progress = progress;

    if (elapsed >= phaseDuration) {
      progressBar.style.width = "100%";
      clearTimeout(phaseAlmostDoneTimer);
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

  const sample = {
    time: performance.now(),
    volume: rms,
    pitch: pitch || null
  };

  currentSamples.push(sample);

  if (activeTrack) {
    activeTrack.liveSamples = currentSamples.slice(-70);
  }
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
  const energy = clamp(avg(volumes) * 16, 0.12, 1);

  const contour = normalizeContour(samples, baseFreq);

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: Date.now(),
    baseFreq,
    energy,
    contour,
    density: clamp(pitches.length / Math.max(1, samples.length), 0, 1),
    mood: creature.mood,
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
      volume: clamp(volume * 20, 0, 1),
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

  return resample(points, 64);
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

    if (type === "echo") ratio *= randomBetween(0.985, 1.015);
    if (type === "invert") ratio = 1 / ratio;
    if (type === "harmonizeUp") ratio *= 1.25;
    if (type === "harmonizeDown") ratio *= 0.75;
    if (type === "question") ratio *= 1 + (index / arr.length) * 0.18;
    if (type === "answer") ratio *= 1.12 - (index / arr.length) * 0.18;

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
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    createdAt: Date.now(),
    baseFreq: clamp(source.baseFreq * randomBetween(0.92, 1.12), MIN_FREQ, MAX_FREQ),
    energy: clamp(source.energy * randomBetween(0.9, 1.35), 0.16, 1),
    contour,
    density: source.density,
    mood: creature.mood,
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

function playMotif(motif, seconds, mode, options = {}) {
  if (!audioCtx) return;

  const now = options.startAt ?? audioCtx.currentTime + (options.delay ?? 0.035);
  const total = seconds;
  const fadeIn = options.fadeIn ?? 0.05;
  const fadeOut = options.fadeOut ?? 0.18;
  const gainScale = options.gain ?? 1;
  const lilt = options.lilt ?? 1;

  const master = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();

  compressor.threshold.setValueAtTime(-18, now);
  compressor.knee.setValueAtTime(16, now);
  compressor.ratio.setValueAtTime(8, now);
  compressor.attack.setValueAtTime(0.006, now);
  compressor.release.setValueAtTime(0.18, now);

  // Kort fade in/out så blocken inte får hårda kanter.
  master.gain.setValueAtTime(0.0001, now);
  master.gain.linearRampToValueAtTime(0.78 * gainScale, now + fadeIn);
  master.gain.linearRampToValueAtTime(0.78 * gainScale, now + Math.max(fadeIn, total - fadeOut));
  master.gain.linearRampToValueAtTime(0.0001, now + total + 0.08);

  master.connect(compressor);
  compressor.connect(audioCtx.destination);

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(mode === "development" ? 1700 : 1300, now);
  filter.Q.setValueAtTime(2.1, now);
  filter.connect(master);

  const delay = audioCtx.createDelay(0.55);
  const feedback = audioCtx.createGain();
  const delayMix = audioCtx.createGain();

  delay.delayTime.setValueAtTime(mode === "development" ? 0.24 : 0.18, now);
  feedback.gain.setValueAtTime(mode === "development" ? 0.24 : 0.16, now);
  delayMix.gain.setValueAtTime(mode === "development" ? 0.24 : 0.16, now);

  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayMix);
  delayMix.connect(master);

  const notes = makeSteppedPhrase(motif, mode, lilt);
  const totalWeight = notes.reduce((sum, note) => sum + note.hold, 0);
  let cursor = now;

  const createdNodes = [master, compressor, filter, delay, feedback, delayMix];

  notes.forEach((note, index) => {
    const duration = (total * note.hold) / totalWeight;
    const start = cursor;
    const end = Math.min(now + total, cursor + duration * 0.94);
    cursor += duration;

    if (note.rest) {
      return;
    }

    const osc = audioCtx.createOscillator();
    const sub = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const subGain = audioCtx.createGain();

    // Sine + triangle ger mer humla/kropp än ren oscillator.
    osc.type = mode === "development" ? "triangle" : "sine";
    sub.type = "sine";

    const previousFreq = index > 0 ? notes[index - 1].freq : note.freq;
    const glideStart = clamp(previousFreq, MIN_FREQ, MAX_FREQ);
    const targetFreq = clamp(note.freq, MIN_FREQ, MAX_FREQ);

    osc.frequency.setValueAtTime(glideStart, start);
    osc.frequency.linearRampToValueAtTime(targetFreq, start + 0.055);

    sub.frequency.setValueAtTime(glideStart * 0.5, start);
    sub.frequency.linearRampToValueAtTime(targetFreq * 0.5, start + 0.055);

    const peak = clamp((0.075 + note.volume * 0.22 * motif.energy) * gainScale, 0.04, 0.34);
    scheduleHumEnvelope(gain.gain, start, end, peak, false);
    scheduleHumEnvelope(subGain.gain, start, end, peak * 0.32, false);

    // Lite kroppslig puls så det blir mer mmmm-MMMM än pip.
    const trem = audioCtx.createOscillator();
    const tremGain = audioCtx.createGain();
    const tremDepth = audioCtx.createGain();

    trem.type = "sine";
    trem.frequency.setValueAtTime(mode === "development" ? 5.2 : 4.1, start);
    tremGain.gain.setValueAtTime(0.5, start);
    tremDepth.gain.setValueAtTime(peak * 0.18, start);

    trem.connect(tremGain);
    tremGain.connect(tremDepth);
    tremDepth.connect(gain.gain);

    osc.connect(gain);
    sub.connect(subGain);
    gain.connect(filter);
    subGain.connect(filter);

    // Bara vissa toner får eko, annars blir det gröt.
    if (index % 3 === 1 || mode === "development") {
      gain.connect(delay);
      subGain.connect(delay);
    }

    osc.start(start);
    sub.start(start);
    trem.start(start);

    osc.stop(end + 0.08);
    sub.stop(end + 0.08);
    trem.stop(end + 0.08);

    activeOscillators.push(osc, sub, trem);
    createdNodes.push(osc, sub, gain, subGain, trem, tremGain, tremDepth);
  });

  // En svag sammanhållande bordun, så blockövergångar inte känns helt döda.
  const drone = audioCtx.createOscillator();
  const droneGain = audioCtx.createGain();

  drone.type = "sine";
  drone.frequency.setValueAtTime(clamp(motif.baseFreq * 0.5, MIN_FREQ, MAX_FREQ), now);
  droneGain.gain.setValueAtTime(0.0001, now);
  droneGain.gain.linearRampToValueAtTime((mode === "development" ? 0.035 : 0.025) * gainScale, now + 0.16);
  droneGain.gain.linearRampToValueAtTime(0.0001, now + total + 0.18);

  drone.connect(droneGain);
  droneGain.connect(master);
  drone.start(now);
  drone.stop(now + total + 0.22);

  activeOscillators.push(drone);
  createdNodes.push(drone, droneGain);

  setTimeout(() => {
    activeOscillators = activeOscillators.filter((osc) => {
      try {
        return osc.playbackState !== osc.FINISHED_STATE;
      } catch {
        return true;
      }
    });

    createdNodes.forEach(safeDisconnect);
  }, (total + 0.8) * 1000);

  return {
    start: now,
    end: now + total
  };
}

function playTransitionHum(fromMotif, toMotif) {
  if (!audioCtx || !fromMotif || !toMotif) return;

  const now = audioCtx.currentTime + 0.012;
  const bridge = {
    ...toMotif,
    baseFreq: clamp((fromMotif.baseFreq + toMotif.baseFreq) * 0.25, MIN_FREQ, MAX_FREQ),
    energy: clamp((fromMotif.energy + toMotif.energy) * 0.32, 0.08, 0.45),
    contour: resample([...fromMotif.contour.slice(-12), ...toMotif.contour.slice(0, 18)], 36),
    type: "bridge",
    mode: "bridge"
  };

  playMotif(bridge, DUET_OVERLAP_SECONDS + 0.32, "bridge", {
    startAt: now,
    fadeIn: 0.18,
    fadeOut: 0.48,
    gain: 0.42,
    lilt: 0.4
  });
}

function saveLastHumanHum() {
  const sessionTracks = tracks
    .filter((track) => track.motif && track.contour && track.contour.length)
    .slice()
    .reverse()
    .map((track) => ({
      owner: track.owner,
      motif: {
        ...track.motif,
        contour: track.motif.contour.map((point) => ({
          ratio: point.ratio,
          volume: point.volume,
          voiced: point.voiced
        }))
      }
    }));

  if (!sessionTracks.length) {
    statusText.textContent = "Det finns ingen skiva att spara ännu.";
    return;
  }

  const saved = getSavedHums();

  const session = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: Date.now(),
    startedAt: sessionStartedAt,
    title: `Skiva ${new Date().toLocaleString("sv-SE", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })}`,
    creature: { ...creature },
    tracks: sessionTracks
  };

  saved.unshift(session);
  localStorage.setItem(HUM_STORAGE_KEY, JSON.stringify(saved.slice(0, 12)));

  statusText.textContent = "Humlan sparade hela skivan. Inte rösten — spåren.";
  saveBtn.disabled = true;
  updateRevisitButton();
}

function revisitSavedHum() {
  const saved = getSavedHums();

  if (!saved.length) {
    statusText.textContent = "Det finns inga sparade skivor ännu.";
    return;
  }

  ensureAudioContextOnly();
  playbackGeneration += 1;
  const generation = playbackGeneration;

  const session = saved[Math.floor(Math.random() * saved.length)];
  const rememberedTracks = session.tracks.map((track) => ({
    owner: track.owner === "human" ? "memory" : track.owner,
    motif: rememberMotif(track.motif)
  }));

  running = false;
  phase = "revisiting";
  document.body.className = "revisiting";
  startRecordSpin();
  phaseLabel.textContent = "Humlan minns";
  statusText.textContent = `Humlan återbesöker: ${session.title || "en gammal skiva"}`;

  tracks = [];
  clearTimeout(phaseAlmostDoneTimer);
  stopAllOscillators();

  const stepSeconds = Math.max(1.8, PHASE_SECONDS - DUET_OVERLAP_SECONDS);
  const visualTimers = [];
  const audioStart = audioCtx.currentTime + 0.08;

  rememberedTracks.forEach((item, index) => {
    const startAt = audioStart + index * stepSeconds;
    playMotif(item.motif, PHASE_SECONDS + DUET_OVERLAP_SECONDS, "development", {
      startAt,
      fadeIn: index === 0 ? 0.16 : 0.7,
      fadeOut: 0.8,
      gain: item.owner === "memory" ? 0.62 : 0.78,
      lilt: 1.35
    });

    const timer = setTimeout(() => {
      if (generation !== playbackGeneration || phase !== "revisiting") return;

      if (activeTrack) activeTrack.complete = true;
      activeTrack = createTrack(item.owner, item.motif);
      tracks.unshift(activeTrack);
      trimTracks();

      phaseStart = performance.now();
      phaseDuration = PHASE_SECONDS * 1000;
    }, Math.max(0, (startAt - audioCtx.currentTime) * 1000));

    visualTimers.push(timer);
  });

  const totalDuration = (rememberedTracks.length - 1) * stepSeconds + PHASE_SECONDS + DUET_OVERLAP_SECONDS;
  const finishedTimer = setTimeout(() => {
    if (generation !== playbackGeneration) return;
    if (activeTrack) activeTrack.complete = true;
    phase = "ready";
    document.body.className = "";
    stopRecordSpin();
    phaseLabel.textContent = "Redo";
    timerLabel.textContent = "5.0";
    progressBar.style.width = "0%";
    statusText.textContent = "Skivan är återbesökt. Minnet ändrade form lite.";
    activeTrack = null;
    updateRevisitButton();
  }, totalDuration * 1000 + 160);

  if (!animationFrame) animateRevisit();
  visualTimers.push(finishedTimer);
}

function ensureAudioContextOnly() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function rememberMotif(motif) {
  return {
    ...motif,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: Date.now(),
    baseFreq: clamp(motif.baseFreq * randomBetween(0.94, 1.08), MIN_FREQ, MAX_FREQ),
    energy: clamp(motif.energy * randomBetween(0.75, 1.05), 0.12, 1),
    contour: motif.contour.map((p, i) => ({
      ratio: clamp(
        p.ratio * (1 + Math.sin(i * 0.29 + Math.random()) * 0.035),
        0.5,
        2
      ),
      volume: clamp(p.volume * randomBetween(0.78, 1.04), 0.03, 1),
      voiced: p.voiced
    })),
    mood: "remembered",
    mode: "memory",
    type: "memory",
    seed: Math.random()
  };
}

function getSavedHums() {
  try {
    return JSON.parse(localStorage.getItem(HUM_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function updateRevisitButton() {
  revisitBtn.disabled = getSavedHums().length === 0;
}

function createTrack(owner, motif) {
  return {
    owner,
    motif,
    contour: motif ? motif.contour : [],
    liveSamples: [],
    born: performance.now(),
    progress: 0,
    complete: false,
    seed: Math.random()
  };
}

function trimTracks() {
  tracks = tracks.slice(0, MAX_RINGS);
}

function stopAllOscillators() {
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch (_) {}
  });
  activeOscillators = [];
}

function responseText(kind) {
  if (kind === "response") {
    return randomFrom([
      "Humlan surrar vidare i små toner.",
      "Humlan hittar en krok och nynnar runt den.",
      "Humlan minns formen och surrar om den.",
      "Humlan lämnar små pauser åt dig."
    ]);
  }

  return randomFrom([
    "Humlan surrar vidare.",
    "Humlan hittar en sidoväg i melodin.",
    "Humlan minns formen och surrar om den.",
    "Humlan stannar kvar i spåret en stund."
  ]);
}

function mutateCreature() {
  creature.mood = randomFrom(moods);
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

function animateRevisit() {
  updateRevisitMeter();
  draw();
  if (phase === "revisiting") {
    animationFrame = requestAnimationFrame(animateRevisit);
  } else {
    animationFrame = null;
  }
}

function updateRevisitMeter() {
  if (phase !== "revisiting" || !activeTrack) return;

  const elapsed = performance.now() - phaseStart;
  const progress = Math.min(1, elapsed / phaseDuration);
  activeTrack.progress = progress;
  if (progress >= 0.995) activeTrack.complete = true;

  timerLabel.textContent = (Math.max(0, phaseDuration - elapsed) / 1000).toFixed(1);
  progressBar.style.width = `${progress * 100}%`;
}

function drawIdle() {
  draw();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  drawMeadowHalo();
  drawRecordBase();
  drawAllTracks();
  drawEngravingPoint();
}

function drawMeadowHalo() {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const spin = currentRecordRotation() * 0.18;
  const flowers = [
    [0.04, 0.18, 8, "#fff5cf", "#e6a62d"],
    [0.78, 0.17, 7, "#f18bb1", "#7c4722"],
    [0.12, 0.77, 6, "#f7d95f", "#6d401d"],
    [0.86, 0.72, 8, "#fff8e7", "#d49b21"],
    [0.68, 0.88, 7, "#d98df0", "#5b3a76"]
  ];

  ctx.save();
  ctx.globalAlpha = 0.62;

  flowers.forEach(([px, py, petals, petal, middle], index) => {
    const x = px * rect.width + Math.sin(spin + index) * 5;
    const y = py * rect.height + Math.cos(spin * 0.9 + index) * 4;
    const size = rect.width * (0.018 + index * 0.0015);
    drawCanvasFlower(x, y, size, petals, petal, middle, spin + index);
  });

  ctx.restore();
}

function drawCanvasFlower(x, y, size, petals, petalColor, middleColor, angleOffset) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleOffset);

  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(size * 0.82, 0, size * 0.65, size * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = petalColor;
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, size * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = middleColor;
  ctx.fill();
  ctx.restore();
}

function startRecordSpin() {
  if (recordSpinning) return;
  spinStartedAt = performance.now();
  recordSpinning = true;
}

function stopRecordSpin() {
  if (!recordSpinning) return;
  spinBase = currentRecordRotation();
  recordSpinning = false;
}

function currentRecordRotation() {
  if (!recordSpinning) return spinBase;
  const elapsedSeconds = (performance.now() - spinStartedAt) / 1000;
  return spinBase + elapsedSeconds * Math.PI * 2 * RECORD_SPIN_RPS;
}

function drawRecordBase() {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const maxR = rect.width * 0.44;
  const rotation = currentRecordRotation();

  ctx.save();

  const gradient = ctx.createRadialGradient(cx, cy, rect.width * 0.06, cx, cy, maxR);
  gradient.addColorStop(0, "rgba(255,247,232,0.13)");
  gradient.addColorStop(0.48, "rgba(255,247,232,0.045)");
  gradient.addColorStop(1, "rgba(255,247,232,0.018)");

  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);

  for (let r = rect.width * 0.13; r <= maxR; r += rect.width * 0.032) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,247,232,0.34)";
    ctx.stroke();
  }

  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const inner = rect.width * randomScratchRadius(i, 0.18, 0.39);
    const outer = inner + rect.width * 0.018;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle + 0.018) * outer, cy + Math.sin(angle + 0.018) * outer);
    ctx.strokeStyle = i % 5 === 0 ? "rgba(255,211,107,0.46)" : "rgba(255,247,232,0.24)";
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rect.width * 0.052, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,203,112,0.28)";
  ctx.fill();

  ctx.restore();
}

function drawAllTracks() {
  const rect = canvas.getBoundingClientRect();
  const rotation = currentRecordRotation();

  tracks.forEach((track, index) => {
    const age = index;
    const outerRadius = rect.width * 0.43;
    const ringGap = rect.width * 0.032;
    const radius = outerRadius - age * ringGap;

    if (radius < rect.width * 0.12) return;

    const progress = track.complete ? 1 : track.progress;
    const contour = track.contour.length
      ? track.contour
      : contourFromLiveSamples(track.liveSamples);

    drawTrack(track, contour, radius, progress, age, rotation);
  });
}

function drawTrack(track, contour, radius, progress, age, rotation) {
  if (!contour.length) return;

  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const visiblePoints = Math.max(2, Math.floor(contour.length * progress));
  const color = trackColor(track.owner, age);
  const alpha = age === 0 ? 0.96 : clamp(0.72 - age * 0.06, 0.16, 0.72);
  const grooveNoise = track.owner === "human" ? 10 : 14;

  ctx.save();

  ctx.beginPath();

  for (let i = 0; i < visiblePoints; i++) {
    const point = contour[i];
    const t = i / contour.length;

    // Toppen är alltid gaddens punkt.
    // Spåret ristas medurs under fem sekunder.
    const angle = -Math.PI / 2 + t * Math.PI * 2 + rotation;

    const melodic = Math.log2(point.ratio || 1) * grooveNoise;
    const energetic = (point.volume || 0) * 7;
    const r = radius + melodic + energetic;

    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  if (progress >= 0.995) ctx.closePath();

  ctx.strokeStyle = color.stroke(alpha);
  ctx.lineWidth = age === 0 ? 2.8 : 1.35;
  ctx.shadowColor = color.shadow;
  ctx.shadowBlur = age === 0 ? 16 : 0;
  ctx.stroke();

  // Basgroove/minnesspår
  ctx.globalAlpha = age === 0 ? 0.18 : clamp(0.32 + age * 0.018, 0.32, 0.52);
  ctx.lineWidth = 0.8;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,247,232,0.42)";
  ctx.stroke();

  ctx.restore();
}

function contourFromLiveSamples(samples) {
  if (!samples || samples.length < 2) return [];

  const pitches = samples.map((s) => s.pitch).filter(Boolean);
  const baseFreq = pitches.length ? median(pitches) : 220;

  return normalizeContour(samples, baseFreq);
}

function trackColor(owner, age) {
  if (age > 0) {
    return {
      stroke: (a) => `rgba(210,216,198,${a})`,
      shadow: "rgba(255,248,220,0.14)"
    };
  }

  if (owner === "human") {
    return {
      stroke: (a) => `rgba(255,211,107,${a})`,
      shadow: "rgba(255,211,107,0.55)"
    };
  }

  if (owner === "machineDevelop") {
    return {
      stroke: (a) => `rgba(183,240,107,${a})`,
      shadow: "rgba(183,240,107,0.45)"
    };
  }

  if (owner === "memory") {
    return {
      stroke: (a) => `rgba(240,107,154,${a})`,
      shadow: "rgba(240,107,154,0.45)"
    };
  }

  return {
    stroke: (a) => `rgba(142,230,168,${a})`,
    shadow: "rgba(142,230,168,0.45)"
  };
}

function drawEngravingPoint() {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const outerR = rect.width * 0.43;

  const x = cx;
  const y = cy - outerR;

  let fill = "rgba(255,248,220,0.35)";

  if (phase === "listening") fill = "rgba(255,211,107,0.92)";
  if (phase === "responding") fill = "rgba(142,230,168,0.92)";
  if (phase === "developing") fill = "rgba(183,240,107,0.92)";
  if (phase === "revisiting") fill = "rgba(240,107,154,0.92)";

  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.shadowBlur = 20;
  ctx.shadowColor = fill;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x, y - 4);
  ctx.strokeStyle = "rgba(255,248,220,0.42)";
  ctx.lineWidth = 1.4;
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
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
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

function makeSteppedPhrase(motif, mode, lilt = 1) {
  const noteCount = mode === "development" ? 14 : mode === "bridge" ? 8 : 12;
  const source = resample(motif.contour, noteCount);

  const scale = [0, 2, 3, 5, 7, 9, 10]; // mjuk minor/pentatonisk-ish färg
  const rootFreq = clamp(motif.baseFreq, MIN_FREQ, MAX_FREQ);

  return source.map((point, index) => {
    const rawSemitones = Math.round(12 * Math.log2(point.ratio || 1));
    const snapped = snapToScale(rawSemitones, scale);
    const phraseWave = Math.sin((index / Math.max(1, noteCount - 1)) * Math.PI);

    let shouldRest = false;

    // Små andningar. Mer i "surrar" än "svarar".
    if (mode === "bridge") {
      shouldRest = Math.random() < 0.05;
    } else if (mode === "development") {
      shouldRest = Math.random() < 0.16 || (index === 5 && Math.random() < 0.55);
    } else {
      shouldRest = Math.random() < 0.09;
    }

    // Första och sista tonen bör oftast finnas.
    if (index === 0 || index === noteCount - 1) shouldRest = false;

    const octaveNudge =
      mode === "development" && index > noteCount * 0.55 && Math.random() < 0.22
        ? 12
        : 0;

    const semitones = snapped + octaveNudge;
    const freq = clamp(rootFreq * Math.pow(2, semitones / 12), MIN_FREQ, MAX_FREQ);

    return {
      freq,
      volume: clamp(0.22 + point.volume * 0.78 + phraseWave * 0.12, 0.08, 1),
      rest: shouldRest || !point.voiced,
      hold:
        (mode === "development" && index % 4 === 3 ? 1.22 : 1) *
        randomBetween(1 - 0.11 * lilt, 1 + 0.14 * lilt)
    };
  });
}

function snapToScale(semitones, scale) {
  const octave = Math.floor(semitones / 12);
  const within = ((semitones % 12) + 12) % 12;

  let best = scale[0];
  let bestDistance = Infinity;

  for (const step of scale) {
    const distance = Math.abs(step - within);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }

  return octave * 12 + best;
}

function scheduleHumEnvelope(gainParam, start, end, peak, rest = false) {
  gainParam.cancelScheduledValues(start);
  gainParam.setValueAtTime(0.0001, start);

  if (rest) {
    gainParam.linearRampToValueAtTime(0.0001, end);
    return;
  }

  const attack = Math.min(0.08, (end - start) * 0.22);
  const release = Math.min(0.16, (end - start) * 0.34);

  gainParam.linearRampToValueAtTime(peak, start + attack);
  gainParam.linearRampToValueAtTime(peak * 0.82, Math.max(start + attack, end - release));
  gainParam.linearRampToValueAtTime(0.0001, end);
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

function randomFrom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomScratchRadius(index, min, max) {
  const n = Math.sin(index * 127.1 + 11.7) * 43758.5453;
  return min + (n - Math.floor(n)) * (max - min);
}

function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch (_) {}
}

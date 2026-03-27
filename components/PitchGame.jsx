"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MIDI_MIN = 21;
const MIDI_MAX = 108;
const WHITE_W = 28;
const BLACK_W = 18;

/** Served from /public — same nested folder name as the FreePats pack. */
const PIANO_PACK_BASE =
  "/UprightPianoKW-SFZ+FLAC-20220221/UprightPianoKW-SFZ+FLAC-20220221/";
const PIANO_PACK_BASE_FALLBACK = "/UprightPianoKW-SFZ+FLAC-20220221/";

const SFZ_REGIONS_VL = [
  { lo: 21, hi: 22, center: 21, file: "samples/A0vL.flac" },
  { lo: 23, hi: 25, center: 24, file: "samples/C1vL.flac" },
  { lo: 26, hi: 28, center: 27, file: "samples/D#1vL.flac" },
  { lo: 29, hi: 31, center: 30, file: "samples/F#1vL.flac" },
  { lo: 32, hi: 34, center: 33, file: "samples/A1vL.flac" },
  { lo: 35, hi: 37, center: 36, file: "samples/C2vL.flac" },
  { lo: 38, hi: 40, center: 39, file: "samples/D#2vL.flac" },
  { lo: 41, hi: 43, center: 42, file: "samples/F#2vL.flac" },
  { lo: 44, hi: 46, center: 45, file: "samples/A2vL.flac" },
  { lo: 47, hi: 49, center: 48, file: "samples/C3vL.flac" },
  { lo: 50, hi: 52, center: 51, file: "samples/D#3vL.flac" },
  { lo: 53, hi: 55, center: 54, file: "samples/F#3vL.flac" },
  { lo: 56, hi: 58, center: 57, file: "samples/A3vL.flac" },
  { lo: 59, hi: 61, center: 60, file: "samples/C4vL.flac" },
  { lo: 62, hi: 64, center: 63, file: "samples/D#4vL.flac" },
  { lo: 65, hi: 67, center: 66, file: "samples/F#4vL.flac" },
  { lo: 68, hi: 70, center: 69, file: "samples/A4vL.flac" },
  { lo: 71, hi: 73, center: 72, file: "samples/C5vL.flac" },
  { lo: 74, hi: 76, center: 75, file: "samples/D#5vL.flac" },
  { lo: 77, hi: 79, center: 78, file: "samples/F#5vL.flac" },
  { lo: 80, hi: 82, center: 81, file: "samples/A5vL.flac" },
  { lo: 83, hi: 85, center: 84, file: "samples/C6vL.flac" },
  { lo: 86, hi: 88, center: 87, file: "samples/D#6vL.flac" },
  { lo: 89, hi: 91, center: 90, file: "samples/F#6vL.flac" },
  { lo: 92, hi: 94, center: 93, file: "samples/A6vL.flac" },
  { lo: 95, hi: 97, center: 96, file: "samples/C7vL.flac" },
  { lo: 98, hi: 100, center: 99, file: "samples/D#7vL.flac" },
  { lo: 101, hi: 103, center: 102, file: "samples/F#7vL.flac" },
  { lo: 104, hi: 106, center: 105, file: "samples/A7vL.flac" },
  { lo: 107, hi: 108, center: 108, file: "samples/C8vL.flac" },
];

const UNIQUE_FLAC_FILES = Array.from(
  new Set(SFZ_REGIONS_VL.map((r) => r.file))
);

function regionForMidi(midi) {
  for (let i = 0; i < SFZ_REGIONS_VL.length; i++) {
    const r = SFZ_REGIONS_VL[i];
    if (midi >= r.lo && midi <= r.hi) return r;
  }
  return null;
}

function isBlackKey(midi) {
  const n = midi % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

function noteLabel(midi) {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const oct = Math.floor(midi / 12) - 1;
  return names[midi % 12] + oct;
}

function whiteIndexBefore(midi) {
  let idx = 0;
  for (let i = MIDI_MIN; i < midi; i++) {
    if (!isBlackKey(i)) idx++;
  }
  return idx;
}

function leftWhiteMidiForBlack(midi) {
  let x = midi - 1;
  while (x >= MIDI_MIN && isBlackKey(x)) x--;
  return x;
}

function encodePathSegments(relPath) {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

function candidateUrlsForPackFile(relPath) {
  const encoded = encodePathSegments(relPath);
  const doubleEncodedHash = encoded.replaceAll("%23", "%2523");
  const apiPath = encodeURIComponent(relPath);
  return [
    PIANO_PACK_BASE + encoded,
    PIANO_PACK_BASE + doubleEncodedHash,
    PIANO_PACK_BASE_FALLBACK + encoded,
    PIANO_PACK_BASE_FALLBACK + doubleEncodedHash,
    `/api/piano-sample?path=${apiPath}`,
  ];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const WHITE_MIDIS = [];
const BLACK_MIDIS = [];
for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
  if (isBlackKey(m)) BLACK_MIDIS.push(m);
  else WHITE_MIDIS.push(m);
}

const BLACK_LEFT = new Map();
BLACK_MIDIS.forEach((m) => {
  const lw = leftWhiteMidiForBlack(m);
  const wi = whiteIndexBefore(lw);
  BLACK_LEFT.set(m, wi * WHITE_W + WHITE_W * 0.68 - BLACK_W / 2);
});

const PIANO_WIDTH = WHITE_MIDIS.length * WHITE_W;

export default function PitchGame() {
  const audioCtxRef = useRef(null);
  const bufferCacheRef = useRef(new Map());
  const activeSourceRef = useRef(null);
  const feedbackTimerRef = useRef(0);
  const phaseRef = useRef("idle");

  const [screen, setScreen] = useState("intro");
  const [samplesReady, setSamplesReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState({
    text: `Loading ${UNIQUE_FLAC_FILES.length} piano samples…`,
    kind: null,
  });

  const [secretMidi, setSecretMidi] = useState(MIDI_MIN);
  const [roundLabel, setRoundLabel] = useState("listen");
  const [playHint, setPlayHint] = useState("Get ready…");
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [feedback, setFeedback] = useState(null);
  const [gameOverHtml, setGameOverHtml] = useState("");

  phaseRef.current = phase;

  useEffect(() => {
    document.body.classList.add("app-ready");
    return () => document.body.classList.remove("app-ready");
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  }, []);

  const decodeBuffer = useCallback(
    async (ab) => {
      const ctx = getAudioContext();
      const copy = ab.slice(0);
      return await ctx.decodeAudioData(copy);
    },
    [getAudioContext]
  );

  const loadOneFlac = useCallback(
    async (relPath) => {
      const cache = bufferCacheRef.current;
      if (cache.has(relPath)) return;
      const urls = candidateUrlsForPackFile(relPath);
      let lastErr = null;

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
          const res = await fetch(url);
          if (!res.ok) {
            lastErr = new Error(`HTTP ${res.status} for ${relPath} via ${url}`);
            continue;
          }
          const ab = await res.arrayBuffer();
          const buf = await decodeBuffer(ab);
          cache.set(relPath, buf);
          return;
        } catch (err) {
          lastErr = err;
        }
      }

      throw lastErr ?? new Error(`Could not load ${relPath}`);
    },
    [decodeBuffer]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all(UNIQUE_FLAC_FILES.map((f) => loadOneFlac(f)));
        if (!cancelled) {
          setSamplesReady(true);
          setLoadStatus({
            text: `Piano samples ready (${UNIQUE_FLAC_FILES.length} files).`,
            kind: "ok",
          });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setLoadStatus({
            text: `Could not load FLAC samples. Put the full pack under public${PIANO_PACK_BASE} (with samples/*.flac). ${
              err?.message ?? ""
            }`,
            kind: "err",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOneFlac]);

  const playFlacNote = useCallback(
    (midi) => {
      const ctx = getAudioContext();
      const region = regionForMidi(midi);
      if (!region) return 1.4;

      const buf = bufferCacheRef.current.get(region.file);
      if (!buf) return 1.4;

      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch (_) {}
        activeSourceRef.current = null;
      }

      const rate = Math.pow(2, (midi - region.center) / 12);
      const t0 = ctx.currentTime;
      const maxWallSec = 3;
      /** Full buffer length as heard through speakers (seconds). */
      const naturalWallSec = buf.duration / rate;
      /** Hard cap on output length: never more than maxWallSec wall-clock. */
      const wallDur = Math.min(maxWallSec, naturalWallSec);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

      const g = ctx.createGain();
      src.connect(g);
      g.connect(ctx.destination);

      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.95, t0 + 0.012);
      if (wallDur > 0.08) {
        g.gain.setValueAtTime(0.95, t0 + wallDur - 0.06);
        g.gain.linearRampToValueAtTime(0.0001, t0 + wallDur);
      }

      src.start(t0, 0);
      src.stop(t0 + wallDur);
      activeSourceRef.current = src;
      src.onended = () => {
        if (activeSourceRef.current === src) activeSourceRef.current = null;
      };

      return wallDur;
    },
    [getAudioContext]
  );

  const scrollMidiIntoView = useCallback((midi) => {
    document
      .querySelector(`[data-piano-midi="${midi}"]`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
  }, []);

  const runRound = useCallback(async () => {
    const nextSecret =
      MIDI_MIN + Math.floor(Math.random() * (MIDI_MAX - MIDI_MIN + 1));
    setSecretMidi(nextSecret);
    setFeedback(null);
    setPhase("countdown");
    phaseRef.current = "countdown";

    setPlayHint("Get ready…");
    setKeyboardVisible(false);
    setShowCountdown(true);
    setRoundLabel("get ready");

    for (let n = 3; n >= 1; n--) {
      setCountdownNum(n);
      await sleep(1000);
    }

    setShowCountdown(false);
    setRoundLabel("listen");
    setPlayHint("Listen…");

    await getAudioContext().resume().catch(() => {});
    const heardSec = playFlacNote(nextSecret);
    await sleep(Math.ceil(heardSec * 1000) + 50);

    setPhase("guess");
    phaseRef.current = "guess";
    setRoundLabel("your turn");
    setKeyboardVisible(true);
  }, [getAudioContext, playFlacNote]);

  const startGame = useCallback(async () => {
    if (!samplesReady) return;
    await getAudioContext().resume().catch(() => {});
    setScreen("play");
    await runRound();
  }, [samplesReady, getAudioContext, runRound]);

  const playAgain = useCallback(() => {
    window.clearTimeout(feedbackTimerRef.current);
    setScreen("play");
    runRound();
  }, [runRound]);

  const onKeyClick = useCallback(
    (midi) => {
      if (phaseRef.current !== "guess") return;
      setPhase("feedback");
      phaseRef.current = "feedback";

      if (midi === secretMidi) {
        setFeedback({ type: "correct", midi: secretMidi });
      } else {
        setFeedback({ type: "wrong", guess: midi, answer: secretMidi });
      }

      setTimeout(() => scrollMidiIntoView(secretMidi), 0);
      if (midi !== secretMidi) {
        setTimeout(() => scrollMidiIntoView(midi), 0);
      }

      feedbackTimerRef.current = window.setTimeout(() => {
        const won = midi === secretMidi;
        setScreen("over");
        if (won) {
          setGameOverHtml(
            `You nailed it — <span style="color:#fff">${noteLabel(
              secretMidi
            )}</span>. That’s either talent or luck. We’re not judging.`
          );
        } else {
          setGameOverHtml(
            `You picked <span style="color:#ff5c5c">${noteLabel(
              midi
            )}</span>. The note was <span style="color:#fff">${noteLabel(
              secretMidi
            )}</span>. The piano remembers everything.`
          );
        }
      }, 2200);
    },
    [secretMidi, scrollMidiIntoView]
  );

  const keyClass = useCallback(
    (m) => {
      if (!feedback) return "";
      if (feedback.type === "correct" && m === feedback.midi) {
        return "feedback-correct";
      }
      if (feedback.type === "wrong") {
        if (m === feedback.guess) return "feedback-wrong";
        if (m === feedback.answer) return "feedback-answer";
      }
      return "";
    },
    [feedback]
  );

  const keysDisabled = useMemo(() => {
    if (screen !== "play") return true;
    return phase !== "guess";
  }, [screen, phase]);

  return (
    <div id="app">
      <section
        id="screen-intro"
        className={`screen${screen === "intro" ? " active" : ""}`}
        aria-hidden={screen !== "intro"}
        aria-label="Intro"
      >
        <h1 id="intro-title">pitch</h1>
        <div id="intro-body">
          <p>
            We’ll play one note from the Upright Piano KW sample set. After you
            hear it, tap the key you think it was.
          </p>
          <p>No pressure. It’s only every musician’s worst nightmare.</p>
        </div>
        <p
          className={`load-status${loadStatus.kind === "ok" ? " is-ok" : ""}${
            loadStatus.kind === "err" ? " is-err" : ""
          }`}
          aria-live="polite"
        >
          {loadStatus.text}
        </p>
        <div className="intro-actions">
          <button
            type="button"
            className="intro-mode-btn"
            aria-label="Start game"
            disabled={!samplesReady}
            onClick={startGame}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        </div>
        <footer id="intro-credit">
          <span className="credit-muted">Piano samples</span>
          <a
            className="credit-link"
            href="http://freepats.zenvoid.org/Piano/acoustic-grand-piano.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            FreePats (CC0)
          </a>
          <span className="credit-muted">· UI inspired by</span>
          <a
            className="credit-link"
            href="https://dialed.gg"
            target="_blank"
            rel="noopener noreferrer"
          >
            Dialed.
          </a>
          <span className="credit-version">Pitch v1.2</span>
        </footer>
      </section>

      <section
        id="screen-play"
        className={`screen${screen === "play" ? " active" : ""}`}
        aria-hidden={screen !== "play"}
        aria-label="Round"
      >
        <div className="round-indicator" aria-live="polite">
          {roundLabel}
        </div>
        {showCountdown ? (
          <div className="countdown-overlay">
            <span key={countdownNum} className="countdown-num">
              {countdownNum}
            </span>
          </div>
        ) : null}
        <div className="play-hint">{playHint}</div>
        <div className={`keyboard-wrap${!keyboardVisible ? " is-hidden" : ""}`}>
          <p className="keyboard-prompt">Which key was it?</p>
          <div className="piano-scroll">
            <div
              className="piano"
              role="group"
              aria-label="Piano keyboard"
              style={{ width: PIANO_WIDTH }}
            >
              <div className="piano-layer-white">
                {WHITE_MIDIS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-piano-midi={m}
                    className={`key white ${keyClass(m)}`}
                    aria-label={noteLabel(m)}
                    disabled={keysDisabled}
                    onClick={() => onKeyClick(m)}
                  >
                    {m % 12 === 0 ? "C" : ""}
                  </button>
                ))}
              </div>
              {BLACK_MIDIS.map((m) => (
                <button
                  key={m}
                  type="button"
                  data-piano-midi={m}
                  className={`key black ${keyClass(m)}`}
                  style={{ left: BLACK_LEFT.get(m) }}
                  aria-label={noteLabel(m)}
                  disabled={keysDisabled}
                  onClick={() => onKeyClick(m)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="screen-over"
        className={`screen${screen === "over" ? " active" : ""}`}
        aria-hidden={screen !== "over"}
        aria-label="Game over"
      >
        <h2 className="over-title">game over</h2>
        <p
          className="over-summary"
          dangerouslySetInnerHTML={{ __html: gameOverHtml }}
        />
        <div className="over-actions">
          <button type="button" className="pill-btn" onClick={playAgain}>
            Play again
          </button>
        </div>
        <footer className="over-footer">
          <a
            className="credit-link"
            href="https://dialed.gg"
            target="_blank"
            rel="noopener noreferrer"
          >
            Dialed.
          </a>
          <span className="credit-version">Pitch v1.2</span>
        </footer>
      </section>
    </div>
  );
}

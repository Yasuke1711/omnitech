import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  Mic,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Zap,
  FileText,
  ScanEye,
  ListChecks,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

/* =========================
  CONFIG
========================= */
// App will automatically fall back to demo outputs on 429.
const DEMO_MODE = true;

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY; // real key from Vercel/Vite env
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

// Anti-spam / rate protection (helps prevent 429 from user tapping)
const COOLDOWN_MS = 2500; // minimum time between requests
const MAX_CALLS_PER_MIN = 8; // soft cap (client-side)

// Firebase from env (Vercel)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Optional: stable appId for Firestore paths
const appId = import.meta.env.VITE_FIREBASE_APP_ID || "default-app-id";

/* =========================
  FIREBASE INIT
========================= */
let auth, db;
try {
  if (firebaseConfig?.apiKey) {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } else {
    console.warn("Firebase env vars missing. App will run without auth/logging.");
  }
} catch (e) {
  console.error("Firebase init error:", e);
}

/* =========================
  TTS
========================= */
let OMNI_VOICE = null;

const pickBestVoice = () => {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;

  const preferred = [
    /Google (US )?English/i,
    /Microsoft (Aria|Jenny|Guy|Ryan|Zira|David)/i,
    /Natural/i,
    /Neural/i,
    /English/i,
  ];

  const englishVoices = voices.filter(
    (v) => /^en(-|_)?/i.test(v.lang) || /english/i.test(v.name)
  );

  const pool = englishVoices.length ? englishVoices : voices;

  for (const rx of preferred) {
    const match = pool.find((v) => rx.test(v.name));
    if (match) return match;
  }
  return pool[0] || null;
};

const ensureVoiceReady = () => {
  if (!window.speechSynthesis) return;
  if (!OMNI_VOICE) OMNI_VOICE = pickBestVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    OMNI_VOICE = pickBestVoice();
  };
};

const speak = (text, opts = {}) => {
  if (!window.speechSynthesis || !text) return;

  ensureVoiceReady();
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(
    String(text).replace(/\.\s+/g, ". … ")
  );

  if (OMNI_VOICE) u.voice = OMNI_VOICE;

  u.rate = opts.rate ?? 1.02;
  u.pitch = opts.pitch ?? 0.88;
  u.volume = opts.volume ?? 1.0;

  window.speechSynthesis.speak(u);
};

/* =========================
  TOAST UI
========================= */
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const bg =
    type === "error"
      ? "bg-red-600/90 border-red-500"
      : "bg-emerald-600/90 border-emerald-500";
  const Icon = type === "error" ? AlertTriangle : CheckCircle2;

  return (
    <div
      className={`fixed top-20 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-auto md:min-w-[300px] z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl border text-white backdrop-blur-md animate-in slide-in-from-top-2 fade-in duration-300 ${bg}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm font-medium flex-1">{message}</span>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/* =========================
  DEMO FALLBACK (for recording)
========================= */
const getDemoResult = (mode, step = 0) => {
  const demo = [
    {
      status: "DANGER",
      headline: "Liquid Hazard Near Electronics",
      reasoning:
        "A container of liquid is placed close to exposed electronics, increasing spill and short-circuit risk.",
      action_required:
        "Move the liquid away and dry the area before continuing.",
      repair_steps: [],
    },
    {
      status: "UNCERTAIN",
      headline: "Image Quality Too Poor",
      reasoning:
        "The image is too blurry/low-detail to confirm cable condition or hazards.",
      action_required:
        "Move closer, improve lighting, and hold still for a clear frame.",
      repair_steps: [],
    },
    {
      status: "SAFE",
      headline: "Environment Appears Clear",
      reasoning:
        "No immediate hazards are visible; workspace looks stable and dry.",
      action_required:
        "Proceed with diagnosis. Keep hands dry and avoid exposed contacts.",
      repair_steps: [
        "Power off the device and unplug it (if safe).",
        "Inspect connectors for looseness or debris.",
        "Reseat the cable firmly and check for damage.",
        "Power on and re-test the system behavior.",
        "If issue persists, replace the cable/component.",
      ],
    },
  ];

  const pick = demo[step % demo.length];

  if (mode === "repair_guide") {
    return {
      status: "SAFE",
      headline: "Repair Protocol Ready",
      reasoning: "Safety confirmed. Providing step-by-step repair guidance.",
      action_required: "Follow steps carefully. Stop if heat/smoke appears.",
      repair_steps: pick.repair_steps?.length
        ? pick.repair_steps
        : demo[2].repair_steps,
    };
  }

  if (mode === "diagnosis") {
    // Slightly different “diagnosis” flavor
    return {
      ...pick,
      headline:
        pick.status === "SAFE"
          ? "Fault Likely: Loose Connection"
          : pick.headline,
      reasoning:
        pick.status === "SAFE"
          ? "Visual cues suggest an intermittent connection; reseating and inspection is recommended."
          : pick.reasoning,
    };
  }

  // safety_check
  return pick;
};

/* =========================
  MAIN APP
========================= */
export default function App() {
  const [user, setUser] = useState(null);

  const [isStreamActive, setIsStreamActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [systemState, setSystemState] = useState("IDLE");
  const [logs, setLogs] = useState([]);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);

  const [repairSteps, setRepairSteps] = useState(null);
  const [showRepairModal, setShowRepairModal] = useState(false);

  const [generatedReport, setGeneratedReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  const [activeTab, setActiveTab] = useState("safety");
  const [demoStep, setDemoStep] = useState(0);

  const [userContext, setUserContext] = useState("");
  const [isListening, setIsListening] = useState(false);

  const [toast, setToast] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);

  // Anti-spam refs
  const inFlightRef = useRef(false);
  const lastCallAtRef = useRef(0);
  const callTimestampsRef = useRef([]); // for MAX_CALLS_PER_MIN

  // Ensure voices load
  useEffect(() => {
    if (!window.speechSynthesis) return;
    ensureVoiceReady();
    window.speechSynthesis.getVoices();
  }, []);

  /* -------------------------
    AUTH INIT
  ------------------------- */
  useEffect(() => {
    if (!auth) return;

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth init error:", e);
      }
    };

    initAuth();
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  /* -------------------------
    LOGGING
  ------------------------- */
  const addLog = (source, message, type = "info") => {
    setLogs((prev) => [
      { source, message, time: new Date().toLocaleTimeString() },
      ...prev,
    ]);

    if (type === "error" || source === "ERROR") {
      setToast({ message, type: "error" });
    }
  };

  /* -------------------------
    CAMERA
  ------------------------- */
  const startCamera = async () => {
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreamActive(true);

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() || {};
        if (
          capabilities.focusMode &&
          Array.isArray(capabilities.focusMode) &&
          capabilities.focusMode.includes("continuous")
        ) {
          try {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
          } catch {}
        }
      }
    } catch (err) {
      console.error("Camera Error:", err);
      addLog("ERROR", "Camera access denied. Check permissions.", "error");
    }
  };

  const handleTapToFocus = async (e) => {
    const tag = e?.target?.tagName?.toLowerCase();
    if (tag === "button" || tag === "input" || tag === "svg" || tag === "path") return;
    if (!streamRef.current) return;

    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (!capabilities.focusMode) return;

    try {
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch {}
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  /* -------------------------
    VOICE INPUT
  ------------------------- */
  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setToast({ message: "Voice input not supported in this browser.", type: "error" });
      return;
    }

    if (isListening) {
      setIsListening(false);
      try { recognitionRef.current?.stop?.(); } catch {}
      return;
    }

    setIsListening(true);
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = (event.results?.[0]?.[0]?.transcript || "").trim();
      if (!transcript) return;

      setToast({ message: `Heard: "${transcript}"`, type: "success" });
      callOmniTech("diagnosis", transcript);

      setIsListening(false);
      setUserContext("");
    };

    recognition.onerror = () => {
      setIsListening(false);
      setToast({ message: "Voice input failed. Try again.", type: "error" });
    };

    recognition.onend = () => setIsListening(false);

    try { recognition.start(); } catch { setIsListening(false); }
  };

  /* -------------------------
    CLIENT-SIDE RATE GUARD
  ------------------------- */
  const canCallNow = () => {
    const now = Date.now();

    // In-flight lock: prevent double-tap flooding
    if (inFlightRef.current) return { ok: false, reason: "Request in progress..." };

    // Cooldown
    const delta = now - lastCallAtRef.current;
    if (delta < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - delta) / 1000);
      return { ok: false, reason: `Cooldown: wait ${wait}s` };
    }

    // Per-minute soft cap
    const oneMinAgo = now - 60_000;
    callTimestampsRef.current = callTimestampsRef.current.filter((t) => t > oneMinAgo);

    if (callTimestampsRef.current.length >= MAX_CALLS_PER_MIN) {
      return { ok: false, reason: "Rate limit: too many requests/min" };
    }

    return { ok: true };
  };

  /* -------------------------
    GEMINI CALL
  ------------------------- */
  const callOmniTech = async (mode = "safety_check", manualContext = "") => {
    // Rate guard first
    const guard = canCallNow();
    if (!guard.ok) {
      setToast({ message: guard.reason, type: "error" });
      return;
    }

    lastCallAtRef.current = Date.now();
    callTimestampsRef.current.push(lastCallAtRef.current);

    setAnalyzing(true);
    inFlightRef.current = true;

    // If no key, demo fallback (helps recording)
    if (!API_KEY) {
      addLog("ERROR", "Missing VITE_GEMINI_API_KEY. Using demo output.", "error");
      const demo = getDemoResult(mode, demoStep);
      setDemoStep((s) => s + 1);
      handleAnalysisResult(demo, mode, { skipSave: true });
      setAnalyzing(false);
      inFlightRef.current = false;
      return;
    }

    const imageBase64 = captureFrame();
    if (!imageBase64) {
      addLog("ERROR", "Camera not ready yet. Wait 1–2 seconds after Initialize Optics.", "error");
      setAnalyzing(false);
      inFlightRef.current = false;
      return;
    }

    const finalContext = (manualContext || userContext || "").trim();

    let systemInstruction = `
You are OmniTech, an autonomous field agent responsible for human safety and system diagnosis.

CORE PROTOCOLS:
1. REFUSAL AUTHORITY: If a hazard is present (water, live wires, fire), you MUST refuse repair instructions.
2. EPISTEMIC HUMILITY: If image is blurry/dark/obstructed, return status "UNCERTAIN". Do not guess.

OUTPUT FORMAT (JSON ONLY):
{
  "status": "SAFE" | "DANGER" | "UNCERTAIN",
  "headline": "Short 3-5 word alert",
  "reasoning": "One concise sentence on visual evidence.",
  "action_required": "Direct instruction to user.",
  "repair_steps": ["Step 1", "Step 2"]
}
`.trim();

    if (mode === "safety_check") {
      systemInstruction += `\nTASK: Scan for immediate hazards.`;
    } else if (mode === "diagnosis") {
      systemInstruction += `\nTASK: Diagnose likely failure. If hazard seen -> DANGER and stop.`;
    } else if (mode === "repair_guide") {
      systemInstruction += `\nTASK: Provide step-by-step repair guide. Assume safety confirmed.`;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: finalContext ? `User Context: ${finalContext}` : "Analyze this scene." },
                { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 1000,
            temperature: 0.4,
          },
          systemInstruction: { parts: [{ text: systemInstruction }] },
        }),
      });

      // If quota/rate limit hit — switch to demo so recording still looks alive
      if (response.status === 429) {
        const errText = await response.text().catch(() => "");
        addLog("ERROR", `Gemini HTTP 429 (quota/rate limit). Switching to demo output.`, "error");
        addLog("SYSTEM", `Tip: reduce clicks / disable report / or increase quota in Google billing.`, "info");

        if (DEMO_MODE) {
          const demo = getDemoResult(mode, demoStep);
          setDemoStep((s) => s + 1);
          handleAnalysisResult(demo, mode, { skipSave: true });
          setToast({ message: "Quota hit — demo fallback enabled.", type: "success" });
          setAnalyzing(false);
          inFlightRef.current = false;
          return;
        }

        // If not demo mode, still show readable error
        addLog("ERROR", `Gemini HTTP 429 details: ${errText.slice(0, 160)}`, "error");
        setAnalyzing(false);
        inFlightRef.current = false;
        return;
      }

      if (!response.ok) {
        const errText = await response.text();
        addLog("ERROR", `Gemini HTTP ${response.status}: ${errText.slice(0, 180)}`, "error");
        setAnalyzing(false);
        inFlightRef.current = false;
        return;
      }

      const data = await response.json();

      if (data?.error) {
        addLog("ERROR", `Gemini error: ${data.error.message || "Unknown error"}`, "error");
        setAnalyzing(false);
        inFlightRef.current = false;
        return;
      }

      const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!resultText) {
        addLog("ERROR", "No response from AI. Try again.", "error");
        setAnalyzing(false);
        inFlightRef.current = false;
        return;
      }

      const cleanText = String(resultText).replace(/```json\s*|```/g, "").trim();

      let result;
      try {
        result = JSON.parse(cleanText);
      } catch (parseErr) {
        console.error("JSON Parse Error:", parseErr, "Raw:", resultText);
        addLog("ERROR", "AI response corrupted (bad JSON). Try again.", "error");
        setAnalyzing(false);
        inFlightRef.current = false;
        return;
      }

      handleAnalysisResult(result, mode);
      setUserContext("");
    } catch (e) {
      console.error(e);
      addLog("ERROR", "Connection to OmniTech Core failed. Check network.", "error");
    } finally {
      setAnalyzing(false);
      inFlightRef.current = false;
    }
  };

  const handleAnalysisResult = (result, mode, opts = {}) => {
    if (mode === "repair_guide" && result?.repair_steps) {
      setRepairSteps(result.repair_steps);
      setShowRepairModal(true);
      return;
    }

    setCurrentAnalysis(result);
    setSystemState(result?.status || "UNCERTAIN");

    speak(`${result?.headline || "Update"}. ${result?.action_required || ""}`);
    addLog("OMNITECH", result?.reasoning || "No reasoning returned.");

    if (!opts.skipSave && user && db) {
      try {
        addDoc(collection(db, "artifacts", appId, "users", user.uid, "safety_events"), {
          timestamp: serverTimestamp(),
          mode,
          ...result,
        });
      } catch (e) {
        console.error("Save failed", e);
      }
    }
  };

  /* -------------------------
    REPORT GENERATION
  ------------------------- */
  const generateFieldReport = async () => {
    if (logs.length === 0) return;

    // If API is missing or demo mode, generate local report (no tokens)
    if (!API_KEY || DEMO_MODE) {
      const local = [
        "FIELD INCIDENT REPORT",
        "--------------------",
        `Generated: ${new Date().toLocaleString()}`,
        "",
        "SESSION LOGS:",
        ...logs
          .slice(0, 30)
          .reverse()
          .map((l) => `[${l.time}] ${l.source}: ${l.message}`),
        "",
        "Summary:",
        "- OmniTech recorded safety/diagnostic events.",
        "- Review recommended actions before proceeding.",
      ].join("\n");

      setGeneratedReport(local);
      setShowReportModal(true);
      addLog("SYSTEM", "Local report generated (demo / no-quota mode).");
      return;
    }

    setGeneratingReport(true);
    const logText = logs.map((l) => `[${l.time}] ${l.source}: ${l.message}`).join("\n");

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: `Generate a professional Field Incident Report based on these raw logs:\n\n${logText}` }] },
          ],
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
          systemInstruction: {
            parts: [{ text: "You are a Senior Field Supervisor. Format the output as a clean report." }],
          },
        }),
      });

      if (response.status === 429) {
        addLog("ERROR", "Report HTTP 429 (quota). Using local report instead.", "error");
        const local = [
          "FIELD INCIDENT REPORT (LOCAL FALLBACK)",
          "-------------------------------------",
          `Generated: ${new Date().toLocaleString()}`,
          "",
          "SESSION LOGS:",
          ...logs
            .slice(0, 30)
            .reverse()
            .map((l) => `[${l.time}] ${l.source}: ${l.message}`),
        ].join("\n");

        setGeneratedReport(local);
        setShowReportModal(true);
        setGeneratingReport(false);
        return;
      }

      if (!response.ok) {
        const errText = await response.text();
        addLog("ERROR", `Report HTTP ${response.status}: ${errText.slice(0, 180)}`, "error");
        setGeneratingReport(false);
        return;
      }

      const data = await response.json();
      const report = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      setGeneratedReport(report || "No report generated.");
      setShowReportModal(true);
      addLog("SYSTEM", "Field Report generated.");
    } catch (e) {
      console.error(e);
      addLog("ERROR", "Failed to generate report.", "error");
    } finally {
      setGeneratingReport(false);
    }
  };

  /* -------------------------
    UI helpers
  ------------------------- */
  const getStatusColor = () => {
    switch (systemState) {
      case "DANGER":
        return "border-red-500 shadow-[0_0_80px_rgba(239,68,68,0.6)]";
      case "SAFE":
        return "border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.4)]";
      case "UNCERTAIN":
        return "border-amber-500 shadow-[0_0_80px_rgba(245,158,11,0.4)]";
      default:
        return "border-slate-800";
    }
  };

  const getStatusText = () => {
    switch (systemState) {
      case "DANGER":
        return "HAZARD DETECTED";
      case "SAFE":
        return "SYSTEM SECURE";
      case "UNCERTAIN":
        return "ANALYSIS INCONCLUSIVE";
      default:
        return "STANDBY";
    }
  };

  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-full font-bold tracking-widest uppercase transition-all duration-200 ease-out select-none shadow-[0_10px_30px_-10px_rgba(34,211,238,0.5)] bg-cyan-600 hover:bg-cyan-500 text-white px-10 py-4";
  const sheen =
    "relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2),transparent_60%)]";

  const submitTextDiagnosis = () => {
    const clean = userContext.trim();
    if (!clean) return;
    setToast({ message: "Context sent.", type: "success" });
    callOmniTech("diagnosis", clean);
    setUserContext("");
  };

  /* =========================
    RENDER
========================= */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex flex-col relative selection:bg-cyan-500/30">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />
        <div
          className={`absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] mix-blend-screen animate-pulse opacity-20 transition-colors duration-1000 ${
            systemState === "DANGER" ? "bg-red-600" : "bg-cyan-600"
          }`}
        />
        <div
          className={`absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] mix-blend-screen animate-pulse opacity-20 delay-1000 transition-colors duration-1000 ${
            systemState === "DANGER" ? "bg-orange-600" : "bg-emerald-600"
          }`}
        />
        {isStreamActive && !analyzing && (
          <div className="absolute inset-0 z-0 pointer-events-none">
            <div className="w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent absolute top-0 animate-[scan_3s_linear_infinite] will-change-transform" />
          </div>
        )}
      </div>

      {/* HUD */}
      <div className={`absolute inset-0 pointer-events-none border-[12px] transition-all duration-500 z-20 ${getStatusColor()} opacity-80`} />

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-30 p-4 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-cyan-400 flex items-center gap-2 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
            <Activity className="w-6 h-6 animate-pulse" /> OMNI<span className="text-white">TECH</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            UNIT: {user ? user.uid.slice(0, 6) : "OFFLINE"} // V.3.3.2
          </p>
        </div>

        <div
          className={`px-4 py-2 rounded-sm border backdrop-blur-md font-mono font-bold tracking-widest shadow-lg ${
            systemState === "DANGER"
              ? "bg-red-900/50 border-red-500 text-red-100 animate-pulse shadow-red-500/20"
              : systemState === "SAFE"
              ? "bg-emerald-900/50 border-emerald-500 text-emerald-100 shadow-emerald-500/20"
              : systemState === "UNCERTAIN"
              ? "bg-amber-900/50 border-amber-500 text-amber-100 shadow-amber-500/20"
              : "bg-slate-900/50 border-slate-700 text-slate-400"
          }`}
        >
          {getStatusText()}
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden z-10" onClick={handleTapToFocus}>
        {!isStreamActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900/80 backdrop-blur-sm">
            <div className="relative">
              <button onClick={startCamera} className={btnPrimary + " " + sheen}>
                <Camera className="w-6 h-6" /> Initialize Optics
              </button>
            </div>
            <p className="mt-4 text-slate-500 font-mono text-sm">Waiting for visual input...</p>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-700 ${isStreamActive ? "opacity-100" : "opacity-20"}`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {analyzing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-cyan-900/10 backdrop-blur-[2px]">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-cyan-300 animate-pulse">
                ANALYZING
              </div>
            </div>
          </div>
        )}

        {currentAnalysis && !analyzing && (
          <div className="absolute top-1/4 left-4 right-4 md:left-auto md:right-10 md:w-80 bg-black/80 border border-slate-600 backdrop-blur-md p-4 z-30 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-400">ANALYSIS_RESULT</span>
              {currentAnalysis.status === "DANGER" && <ShieldAlert className="w-5 h-5 text-red-500" />}
              {currentAnalysis.status === "SAFE" && <ShieldCheck className="w-5 h-5 text-emerald-500" />}
              {currentAnalysis.status === "UNCERTAIN" && <ScanEye className="w-5 h-5 text-amber-500" />}
            </div>

            <h3 className="text-lg font-bold text-white mb-1 leading-tight">{currentAnalysis.headline}</h3>
            <p className="text-sm text-slate-300 mb-3">{currentAnalysis.reasoning}</p>

            <div
              className={`p-3 rounded border-l-4 mb-3 ${
                currentAnalysis.status === "DANGER"
                  ? "bg-red-900/30 border-red-500"
                  : currentAnalysis.status === "UNCERTAIN"
                  ? "bg-amber-900/30 border-amber-500"
                  : "bg-cyan-900/30 border-cyan-500"
              }`}
            >
              <span className="block text-xs font-bold uppercase opacity-70 mb-1">Recommended Action</span>
              <p className="text-sm font-medium text-white">{currentAnalysis.action_required}</p>
            </div>

            {currentAnalysis.status === "SAFE" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  callOmniTech("repair_guide");
                }}
                className="w-full py-2 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-700 rounded text-emerald-100 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <ListChecks className="w-4 h-4" /> ✨ View Repair Steps
              </button>
            )}
          </div>
        )}
      </div>

      {/* Control Deck */}
      <div className="z-30 bg-slate-950 border-t border-slate-800 p-4 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Logs (mobile visible) */}
          <div className="flex flex-col h-32 md:h-40 bg-slate-900/50 p-2 rounded border border-slate-800 backdrop-blur-md order-3 md:order-1">
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
              <span className="text-xs font-mono text-slate-500">SESSION LOGS</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  generateFieldReport();
                }}
                disabled={logs.length < 2 || generatingReport}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {generatingReport ? <Activity className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}{" "}
                Report
              </button>
            </div>

            <div className="flex-1 overflow-y-auto font-mono text-xs text-slate-400 space-y-1">
              {logs.map((log, i) => (
                <div key={i}>
                  <span className="text-slate-600">[{log.time}]</span>{" "}
                  <span className={log.source === "OMNITECH" ? "text-cyan-400" : "text-slate-300"}>
                    {log.source}:
                  </span>{" "}
                  {log.message}
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3 order-1 md:order-2">
            <div className="relative flex w-full h-16 bg-slate-900/80 rounded-full p-1 ring-1 ring-white/10 backdrop-blur-md overflow-hidden shadow-inner shadow-black/50">
              <div
                className={`absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-300 ease-out z-0 shadow-lg shadow-cyan-900/50 bg-cyan-600 ${
                  activeTab === "safety" ? "translate-x-0" : "translate-x-full"
                }`}
              />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("safety");
                  callOmniTech("safety_check");
                }}
                disabled={!isStreamActive || analyzing}
                className={`flex-1 relative z-10 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors duration-200 ${
                  activeTab === "safety" ? "text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ShieldCheck className="w-5 h-5" /> SAFETY
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("diagnose");
                  callOmniTech("diagnosis");
                }}
                disabled={!isStreamActive || analyzing || systemState === "DANGER" || systemState === "UNCERTAIN"}
                className={`flex-1 relative z-10 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors duration-200 ${
                  systemState === "DANGER" || systemState === "UNCERTAIN"
                    ? "opacity-30 cursor-not-allowed"
                    : activeTab === "diagnose"
                    ? "text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {systemState === "DANGER" ? <ShieldAlert className="w-5 h-5 text-red-400" /> : <Zap className="w-5 h-5" />}
                DIAGNOSE
              </button>
            </div>

            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={userContext}
                onChange={(e) => setUserContext(e.target.value)}
                placeholder={isListening ? "Listening..." : "Describe issue (or use voice)..." }
                className={`w-full bg-slate-900 border ${
                  isListening ? "border-emerald-500 animate-pulse" : "border-slate-700"
                } rounded px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors shadow-inner`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitTextDiagnosis();
                }}
              />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleListening();
                }}
                className={`absolute right-2 top-2 p-1 rounded-full hover:bg-slate-800 transition-colors ${
                  isListening ? "text-emerald-500" : "text-slate-500 hover:text-cyan-400"
                }`}
                aria-label="Voice input"
              >
                {isListening ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Metrics */}
          <div className="hidden md:flex flex-col gap-2 justify-center pl-4 border-l border-slate-800 order-2 md:order-3">
            <div className="flex items-center justify-between text-xs font-mono text-slate-500">
              <span>INFERENCE</span>
              <span className="text-cyan-400 animate-pulse">LIVE REAL-TIME</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-500">
              <span>PROTECTION</span>
              <span className="text-emerald-500">ACTIVE GUARD</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-500">
              <span>VOICE</span>
              <span className="text-slate-400">{isListening ? "LISTENING" : "READY"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {systemState === "DANGER" && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none z-50">
          <div className="bg-red-600/90 text-white px-6 py-3 rounded-md font-bold text-sm shadow-[0_0_30px_rgba(220,38,38,0.5)] flex items-center gap-3 max-w-md text-center animate-bounce">
            <ShieldAlert className="w-6 h-6 flex-shrink-0" />
            <span>PROTOCOL LOCKED: {currentAnalysis?.action_required || "Resolve hazard before proceeding."}</span>
          </div>
        </div>
      )}

      {/* Repair Modal */}
      {showRepairModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-emerald-400" /> Repair Protocol
              </h3>
              <button onClick={() => setShowRepairModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {repairSteps?.map((step, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-900 text-cyan-300 flex items-center justify-center font-mono text-xs border border-cyan-700">
                    {idx + 1}
                  </div>
                  <p className="text-slate-300 text-sm">{step}</p>
                </div>
              ))}
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 text-xs text-center text-slate-500 font-mono">
              GENERATED BY OMNITECH CORE // VERIFY BEFORE ACTING
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" /> Incident Report Preview
              </h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-white text-slate-900 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {generatedReport}
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowReportModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedReport || "");
                  alert("Report copied to clipboard");
                }}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Animation Styles */}
      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

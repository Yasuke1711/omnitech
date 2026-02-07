import React, { useState, useEffect, useRef } from 'react';
import { Camera, Mic, ShieldAlert, ShieldCheck, Activity, Zap, FileText, ScanEye, ListChecks, X } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

// --- Configuration & Constants ---
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY; 
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

// --- Firebase Setup ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let auth, db;
try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init error:", e);
}

// --- Helper: Text to Speech ---
const speak = (text) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => v.name.includes("Google US English")) || voices[0];
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.rate = 1.1;
  utterance.pitch = 0.9;
  window.speechSynthesis.speak(utterance);
};

// --- Main Application Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [systemState, setSystemState] = useState('IDLE'); // IDLE, SCANNING, DANGER, SAFE, UNCERTAIN
  const [logs, setLogs] = useState([]);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  
  // New State for LLM Features
  const [repairSteps, setRepairSteps] = useState(null);
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [generatedReport, setGeneratedReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [activeTab, setActiveTab] = useState("safety"); 

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // --- Auth & Init ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Camera Logic ---
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreamActive(true);
      }
    } catch (err) {
      console.error("Camera Error:", err);
      addLog("SYSTEM", "Camera access denied or unavailable.");
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  };

  // --- Gemini Integration ---
  const callOmniTech = async (mode = "safety_check", userContext = "") => {
    setAnalyzing(true);
    const imageBase64 = captureFrame();
    if (!imageBase64) {
      setAnalyzing(false);
      return;
    }

    // Dynamic System Prompt
    let systemInstruction = `
      You are OmniTech, an autonomous field agent responsible for human safety and system diagnosis.
      
      CORE PROTOCOLS:
      1. REFUSAL AUTHORITY: If a hazard is present (water, live wires, fire), you MUST refuse to give repair instructions. State clearly: "For your safety, I cannot proceed until [hazard] is resolved."
      2. EPISTEMIC HUMILITY: If the image is blurry, too dark, or the component is obstructed, return status "UNCERTAIN". Do not guess.
      
      OUTPUT FORMAT (JSON ONLY):
      {
        "status": "SAFE" | "DANGER" | "UNCERTAIN",
        "headline": "Short 3-5 word alert",
        "reasoning": "One concise sentence on visual evidence.",
        "action_required": "Direct instruction to user.",
        "repair_steps": ["Step 1", "Step 2"] // Only populate this in 'repair_guide' mode
      }
    `;

    if (mode === "safety_check") {
      systemInstruction += `TASK: Scan for immediate hazards. If unsure/blocked -> UNCERTAIN. If safe -> SAFE. If hazardous -> DANGER.`;
    } else if (mode === "diagnosis") {
      systemInstruction += `TASK: Diagnose failure. CRITICAL: If safety hazard seen -> DANGER and stop.`;
    } else if (mode === "repair_guide") {
      systemInstruction += `TASK: Provide step-by-step repair guide. Assume safety confirmed. Populate 'repair_steps'.`;
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: userContext ? `User Note: ${userContext}` : "Analyze this scene." },
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 600,
            temperature: 0.4
          },
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });

      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (resultText) {
        const result = JSON.parse(resultText);
        handleAnalysisResult(result, mode);
      }
    } catch (e) {
      console.error(e);
      addLog("ERROR", "Connection to OmniTech Core failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const generateFieldReport = async () => {
    if (logs.length === 0) return;
    setGeneratingReport(true);
    const logText = logs.map(l => `[${l.time}] ${l.source}: ${l.message}`).join("\n");
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate a professional Field Incident Report based on these raw system logs:\n\n${logText}` }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
          systemInstruction: { parts: [{ text: "You are a Senior Field Supervisor. Format the output as a clean, professional report." }] }
        })
      });
      const data = await response.json();
      const report = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setGeneratedReport(report);
      setShowReportModal(true);
      addLog("SYSTEM", "Field Report generated.");
    } catch (e) {
      console.error(e);
      addLog("ERROR", "Failed to generate report.");
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleAnalysisResult = (result, mode) => {
    if (mode === "repair_guide" && result.repair_steps) {
      setRepairSteps(result.repair_steps);
      setShowRepairModal(true);
      return;
    }
    setCurrentAnalysis(result);
    setSystemState(result.status);
    speak(`${result.headline}. ${result.action_required}`);
    addLog("OMNITECH", result.reasoning);

    if (user && db) {
      try {
        addDoc(collection(db, 'artifacts', 'omnitech', 'users', user.uid, 'safety_events')
                , {
          timestamp: serverTimestamp(),
          mode: mode,
          ...result
        });
      } catch (e) { console.error("Save failed", e); }
    }
  };

  const addLog = (source, message) => {
    setLogs(prev => [{ source, message, time: new Date().toLocaleTimeString() }, ...prev]);
  };

  // --- Render Helpers ---
  const getStatusColor = () => {
    switch(systemState) {
      case 'DANGER': return 'border-red-500 shadow-[0_0_80px_rgba(239,68,68,0.6)]';
      case 'SAFE': return 'border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.4)]';
      case 'UNCERTAIN': return 'border-amber-500 shadow-[0_0_80px_rgba(245,158,11,0.4)]';
      default: return 'border-slate-800';
    }
  };

  const getStatusText = () => {
    switch(systemState) {
      case 'DANGER': return 'HAZARD DETECTED';
      case 'SAFE': return 'SYSTEM SECURE';
      case 'UNCERTAIN': return 'ANALYSIS INCONCLUSIVE';
      default: return 'STANDBY';
    }
  };

  // Styles
  const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-full font-bold tracking-widest uppercase transition-all duration-200 ease-out select-none shadow-[0_10px_30px_-10px_rgba(34,211,238,0.5)] bg-cyan-600 hover:bg-cyan-500 text-white px-10 py-4";
  const sheen = "relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2),transparent_60%)]";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex flex-col relative selection:bg-cyan-500/30">
      
      {/* --- BACKGROUND EFFECTS (New!) --- */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {/* 1. Cyberpunk Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />
        
        {/* 2. Energy Surges (Pulsing Orbs) */}
        <div className={`absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] mix-blend-screen animate-pulse opacity-20 transition-colors duration-1000 ${
          systemState === 'DANGER' ? 'bg-red-600' : 'bg-cyan-600'
        }`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] mix-blend-screen animate-pulse opacity-20 delay-1000 transition-colors duration-1000 ${
          systemState === 'DANGER' ? 'bg-orange-600' : 'bg-emerald-600'
        }`} />

        {/* 3. The Scanner Beam (Moves down the screen) */}
        {isStreamActive && !analyzing && (
           <div className="absolute inset-0 z-0 pointer-events-none">
             <div className="w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent absolute top-0 animate-[scan_3s_linear_infinite]" />
           </div>
        )}
      </div>

      {/* --- HUD Overlay --- */}
      <div className={`absolute inset-0 pointer-events-none border-[12px] transition-all duration-500 z-20 ${getStatusColor()} opacity-80`} />
      
      {/* --- Header --- */}
      <div className="absolute top-0 left-0 right-0 z-30 p-4 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-cyan-400 flex items-center gap-2 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
            <Activity className="w-6 h-6 animate-pulse" /> OMNI<span className="text-white">TECH</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">UNIT: {user ? user.uid.slice(0,6) : 'OFFLINE'} // V.3.2.0</p>
        </div>
        <div className={`px-4 py-2 rounded-sm border backdrop-blur-md font-mono font-bold tracking-widest shadow-lg ${
          systemState === 'DANGER' ? 'bg-red-900/50 border-red-500 text-red-100 animate-pulse shadow-red-500/20' :
          systemState === 'SAFE' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-100 shadow-emerald-500/20' :
          systemState === 'UNCERTAIN' ? 'bg-amber-900/50 border-amber-500 text-amber-100 shadow-amber-500/20' :
          'bg-slate-900/50 border-slate-700 text-slate-400'
        }`}>
          {getStatusText()}
        </div>
      </div>

      {/* --- Main Viewport --- */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden z-10">
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
        
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover transition-opacity duration-700 ${isStreamActive ? 'opacity-100' : 'opacity-20'}`} />
        <canvas ref={canvasRef} className="hidden" />

        {/* --- Scanning Overlay --- */}
        {analyzing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-cyan-900/10 backdrop-blur-[2px]">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-cyan-300 animate-pulse">ANALYZING</div>
            </div>
          </div>
        )}

        {/* --- Analysis Result --- */}
        {currentAnalysis && !analyzing && (
          <div className="absolute top-1/4 left-4 right-4 md:left-auto md:right-10 md:w-80 bg-black/80 border border-slate-600 backdrop-blur-md p-4 z-30 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-400">ANALYSIS_RESULT</span>
              {currentAnalysis.status === 'DANGER' && <ShieldAlert className="w-5 h-5 text-red-500" />}
              {currentAnalysis.status === 'SAFE' && <ShieldCheck className="w-5 h-5 text-emerald-500" />}
              {currentAnalysis.status === 'UNCERTAIN' && <ScanEye className="w-5 h-5 text-amber-500" />}
            </div>
            <h3 className="text-lg font-bold text-white mb-1 leading-tight">{currentAnalysis.headline}</h3>
            <p className="text-sm text-slate-300 mb-3">{currentAnalysis.reasoning}</p>
            <div className={`p-3 rounded border-l-4 mb-3 ${
              currentAnalysis.status === 'DANGER' ? 'bg-red-900/30 border-red-500' : 
              currentAnalysis.status === 'UNCERTAIN' ? 'bg-amber-900/30 border-amber-500' :
              'bg-cyan-900/30 border-cyan-500'
            }`}>
              <span className="block text-xs font-bold uppercase opacity-70 mb-1">Recommended Action</span>
              <p className="text-sm font-medium text-white">{currentAnalysis.action_required}</p>
            </div>
            {currentAnalysis.status === 'SAFE' && (
               <button onClick={() => callOmniTech("repair_guide")} className="w-full py-2 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-700 rounded text-emerald-100 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                 <ListChecks className="w-4 h-4" /> ✨ View Repair Steps
               </button>
            )}
          </div>
        )}
      </div>

      {/* --- Control Deck --- */}
      <div className="z-30 bg-slate-950 border-t border-slate-800 p-4 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Logs */}
          <div className="hidden md:flex flex-col h-40 bg-slate-900/50 p-2 rounded border border-slate-800 backdrop-blur-md">
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
              <span className="text-xs font-mono text-slate-500">SESSION LOGS</span>
              <button onClick={generateFieldReport} disabled={logs.length < 2 || generatingReport} className="text-xs bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50">
                {generatingReport ? <Activity className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Report
              </button>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-xs text-slate-400 space-y-1">
              {logs.map((log, i) => (
                <div key={i}><span className="text-slate-600">[{log.time}]</span> <span className={log.source === 'OMNITECH' ? 'text-cyan-400' : 'text-slate-300'}>{log.source}:</span> {log.message}</div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3">
            
            {/* GOOGLE PLAY STYLE SLIDING CONTROLS */}
            <div className="relative flex w-full h-16 bg-slate-900/80 rounded-full p-1 ring-1 ring-white/10 backdrop-blur-md overflow-hidden shadow-inner shadow-black/50">
              
              {/* Sliding Background */}
              <div 
                className={`absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-300 ease-out z-0 shadow-lg shadow-cyan-900/50 bg-cyan-600 ${
                  activeTab === 'safety' ? 'translate-x-0' : 'translate-x-full'
                }`} 
              />

              {/* Safety Button */}
              <button 
                onClick={() => { setActiveTab('safety'); callOmniTech("safety_check"); }}
                disabled={!isStreamActive || analyzing}
                className={`flex-1 relative z-10 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors duration-200 ${activeTab === 'safety' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <ShieldCheck className="w-5 h-5" /> SAFETY
              </button>

              {/* Diagnose Button */}
              <button 
                onClick={() => { setActiveTab('diagnose'); callOmniTech("diagnosis"); }}
                disabled={!isStreamActive || analyzing || systemState === 'DANGER' || systemState === 'UNCERTAIN'}
                className={`flex-1 relative z-10 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors duration-200 ${
                  systemState === 'DANGER' || systemState === 'UNCERTAIN' ? 'opacity-30 cursor-not-allowed' :
                  activeTab === 'diagnose' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {systemState === 'DANGER' ? <ShieldAlert className="w-5 h-5 text-red-400" /> : <Zap className="w-5 h-5" />}
                DIAGNOSE
              </button>
            </div>

            {/* Input */}
            <div className="relative">
              <input 
                type="text" 
                placeholder="Describe issue (or use voice)..." 
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors shadow-inner"
                onKeyDown={(e) => { if (e.key === 'Enter') { callOmniTech("diagnosis", e.target.value); e.target.value = ''; } }}
              />
              <Mic className="absolute right-3 top-3 w-5 h-5 text-slate-500 hover:text-cyan-400 cursor-pointer" />
            </div>
          </div>

          {/* Metrics */}
          <div className="hidden md:flex flex-col gap-2 justify-center pl-4 border-l border-slate-800">
             <div className="flex items-center justify-between text-xs font-mono text-slate-500"><span>INFERENCE</span><span className="text-cyan-400 animate-pulse">LIVE REAL-TIME</span></div>
             <div className="flex items-center justify-between text-xs font-mono text-slate-500"><span>PROTECTION</span><span className="text-emerald-500">ACTIVE GUARD</span></div>
             <div className="flex items-center justify-between text-xs font-mono text-slate-500"><span>VOICE MODULE</span><span className="text-slate-400">READY</span></div>
          </div>

        </div>
      </div>
      
      {/* Alert Banners */}
      {systemState === 'DANGER' && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none z-50">
          <div className="bg-red-600/90 text-white px-6 py-3 rounded-md font-bold text-sm shadow-[0_0_30px_rgba(220,38,38,0.5)] flex items-center gap-3 max-w-md text-center animate-bounce">
            <ShieldAlert className="w-6 h-6 flex-shrink-0" /> 
            <span>PROTOCOL LOCKED: {currentAnalysis?.action_required || "Resolve hazard before proceeding."}</span>
          </div>
        </div>
      )}
      {systemState === 'UNCERTAIN' && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none z-50">
          <div className="bg-amber-600/90 text-white px-6 py-3 rounded-md font-bold text-sm shadow-[0_0_30px_rgba(217,119,6,0.5)] flex items-center gap-3 max-w-md text-center">
             <ScanEye className="w-6 h-6 flex-shrink-0" />
            <span>VISUALS UNCLEAR: {currentAnalysis?.action_required || "Move closer or adjust lighting."}</span>
          </div>
        </div>
      )}

      {/* Repair Modal */}
      {showRepairModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2"><ListChecks className="w-5 h-5 text-emerald-400" /> Repair Protocol</h3>
              <button onClick={() => setShowRepairModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {repairSteps?.map((step, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-900 text-cyan-300 flex items-center justify-center font-mono text-xs border border-cyan-700">{idx + 1}</div>
                  <p className="text-slate-300 text-sm">{step}</p>
                </div>
              ))}
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 text-xs text-center text-slate-500 font-mono">GENERATED BY OMNITECH CORE // VERIFY BEFORE ACTING</div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2"><FileText className="w-5 h-5 text-cyan-400" /> Incident Report Preview</h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto bg-white text-slate-900 font-mono text-sm leading-relaxed whitespace-pre-wrap">{generatedReport}</div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
               <button onClick={() => setShowReportModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Close</button>
               <button onClick={() => { navigator.clipboard.writeText(generatedReport); alert("Report copied to clipboard"); }} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded">Copy to Clipboard</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Global Animation Styles */}
    

    </div>
  );
}
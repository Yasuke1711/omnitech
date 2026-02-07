#  OmniTech

**OmniTech** is an AI-powered **field safety and diagnostics assistant** designed to help technicians, engineers, and operators make safer decisions when working with real-world equipment and environments.

Using **live camera input**, OmniTech can detect hazards, diagnose faults, and—when safe—provide guided repair steps, all in real time.

> Built for rapid deployment, real-world use, and safety-first decision making.

---

##  Key Features

*  **Live Camera Analysis**
  Real-time visual input from device cameras

*  **AI Safety Scanning**
  Detects hazards such as exposed wiring, water risks, fire danger
  Includes **refusal logic** when conditions are unsafe

*  **System Diagnosis**
  Identifies likely faults and failure causes

*  **Step-by-Step Repair Guidance**
  Only unlocked when the environment is confirmed **SAFE**

*  **Voice Feedback (Text-to-Speech)**
  Spoken alerts and instructions for hands-free operation

*  **Cloud-Backed Logging**
  Secure session logs and incident records stored in Firebase

*  **Secure Environment Configuration**
  No hard-coded secrets — all keys handled via `.env`

---

##  Why OmniTech?

In many real-world field environments, technicians are forced to make high-risk decisions with incomplete information—often under time pressure, poor visibility, or unsafe conditions. OmniTech was built to **reduce human error**, not replace human judgment. By combining live visual analysis with strict safety-first AI protocols, OmniTech ensures that dangerous actions are **blocked**, uncertainty is clearly communicated, and guidance is only provided when conditions are verified as safe. This makes OmniTech especially valuable in regions with limited access to expert supervision, enabling safer, smarter decision-making at the point of action.

---

##  How OmniTech Works

1. The user initializes the camera
2. OmniTech analyzes the scene using **Google Gemini Vision**
3. The system classifies the environment as:

   * ✅ **SAFE**
   * 🚨 **DANGER**
   * ❓ **UNCERTAIN**
4. Based on the classification:

   * Unsafe actions are **blocked**
   * Safe actions are **enabled**
   * Clear instructions or warnings are issued
5. Events and outcomes are logged securely in Firebase

This ensures **safety-first AI behavior**, not blind automation.

---

##  Tech Stack

* **Frontend:** React + Vite + Tailwind CSS
* **AI:** Google Gemini (Multimodal Vision)
* **Backend / Cloud:** Firebase (Anonymous Auth + Firestore)
* **Deployment:** Vercel

---

##  Environment Variables

Create a `.env` file in the project root:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

 **Important:**

* Never commit `.env` to GitHub
* Ensure `.env` is listed in `.gitignore`

---

##  Local Development

```bash
npm install
npm run dev
```

Then open:

```
http://localhost:5173
```

---

##  Deployment

OmniTech is designed to be deployed securely using **Vercel**.

Steps:

1. Push the project to GitHub
2. Import the repo into Vercel
3. Add the same environment variables in Vercel settings
4. Deploy
5. Open the live HTTPS link (camera access works on mobile)

---

##  Note

OmniTech focuses on **practical safety, responsible AI behavior, and real-world usability** rather than speculative features.
The system prioritizes **human safety over completion**, making it suitable for industrial, engineering, and field-service contexts.


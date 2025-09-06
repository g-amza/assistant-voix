import express from "express";
import bodyParser from "body-parser";
import { twiml as Twiml } from "twilio";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Base de connaissances simple ---
const KB = {
  companyName: "Cabinet Santé Active",
  address: "12 rue de Paris, 75010 Paris",
  phone: "+33 1 23 45 67 89",
  hours: "Lundi–Samedi, 9h–19h",
  pricing: "Séance: 50€; Bilan initial: 65€",
  policies: "Annulation 24h à l'avance sans frais. En cas d'urgence, appelez le 112."
};

const SYSTEM_PROMPT = `
Tu es l'assistant téléphonique professionnel d'une petite entreprise.
Objectif: répondre utilement, poliment, en une ou deux phrases max.
Si on demande horaires/adresse/tarifs/politiques, utilise STRICTEMENT ces données:
- Nom: ${KB.companyName}
- Adresse: ${KB.address}
- Téléphone: ${KB.phone}
- Horaires: ${KB.hours}
- Tarifs: ${KB.pricing}
- Politique: ${KB.policies}
Si la question sort du cadre, réponds brièvement que tu vas transmettre la demande à un humain.
Langue: FR. Ton: chaleureux, pro. Pas de roman. Pas d'inventions.
`;

// --- Health check ---
app.get("/", (req, res) => res.send("Assistant vocal en ligne ✅"));
app.get("/health", (req, res) => res.json({ status: "up" }));

// --- Route Voice: accueil + Gather Speech ---
app.post("/voice", (req, res) => {
  const twiml = new Twiml.VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    language: "fr-FR",
    speechTimeout: "auto",
    action: "/ai",
    method: "POST"
  });

  gather.say(
    { language: "fr-FR", voice: "alice" },
    "Bonjour, vous êtes bien au standard du cabinet. Dites-moi en quelques mots ce dont vous avez besoin."
  );

  twiml.redirect({ method: "POST" }, "/voice");
  res.type("text/xml").send(twiml.toString());
});

// --- Route AI: GPT -> voix ElevenLabs ---
app.post("/ai", async (req, res) => {
  const userText = (req.body.SpeechResult || "").trim();
  const twiml = new Twiml.VoiceResponse();

  try {
    if (!userText) {
      twiml.say({ language: "fr-FR", voice: "alice" },
        "Je n'ai pas bien saisi. Pouvez-vous répéter, s'il vous plaît ?");
      twiml.redirect({ method: "POST" }, "/voice");
      return res.type("text/xml").send(twiml.toString());
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() ||
      "Je transmets votre demande à un collègue et nous vous recontactons très vite.";

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const ttsUrl = `${baseUrl}/tts?text=${encodeURIComponent(reply)}`;

    twiml.play(ttsUrl);

    // Urgences -> transfert
    if (/urgence|urgent|fuite|accident|douleur|immédiat/i.test(userText)) {
      twiml.pause({ length: 1 });
      twiml.say({ language: "fr-FR", voice: "alice" }, "Je vous transfère immédiatement.");
      // twiml.dial("+33XXXXXXXXX"); // mets le numéro humain
    }

    twiml.pause({ length: 1 });
    twiml.say({ language: "fr-FR", voice: "alice" }, "Merci pour votre appel. Bonne journée.");
    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("AI error:", err);
    twiml.say({ language: "fr-FR", voice: "alice" },
      "Désolé, un souci technique est survenu. Je vous propose de rappeler dans quelques instants.");
    return res.type("text/xml").send(twiml.toString());
  }
});

// --- Route TTS ElevenLabs ---
app.get("/tts", async (req, res) => {
  try {
    const text = (req.query.text || "").toString();
    if (!text) return res.status(400).send("Missing text");

    const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(500).send("Missing ELEVENLABS_API_KEY");

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=3`;

    const payload = {
      text,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true
      }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok || !r.body) {
      const errTxt = await r.text().catch(() => "");
      console.error("ElevenLabs error:", r.status, errTxt);
      return res.status(502).send("TTS upstream error");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    r.body.pipe(res);
  } catch (e) {
    console.error("TTS route error:", e);
    res.status(500).send("TTS error");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("🚀 Serveur écoute sur", port));

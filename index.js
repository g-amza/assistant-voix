import express from "express";
import bodyParser from "body-parser";
import { twiml as Twiml } from "twilio";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- petite base de connaissances (exemple générique cabinet/kiosque/conciergerie) ---
const KB = {
  companyName: "Cabinet Santé Active",
  address: "12 rue de Paris, 75010 Paris",
  phone: "+33 1 23 45 67 89",
  hours: "Lundi–Samedi, 9h–19h",
  pricing: "Séance: 50€; Bilan initial: 65€",
  policies:
    "Annulation 24h à l'avance sans frais. En cas d'urgence, appelez le 112.",
};

// Prompt système (sécurisé, concis)
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

// --- santé / debug ---
app.get("/", (req, res) => res.send("Assistant vocal en ligne ✅"));
app.get("/health", (req, res) => res.json({ status: "up" }));

// --- Accueil téléphonique: Gather (speech) et action vers /ai ---
app.post("/voice", (req, res) => {
  const twiml = new Twiml.VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    language: "fr-FR",
    speechTimeout: "auto",
    action: "/ai",     // Twilio postera la transcription ici
    method: "POST"
  });

  gather.say(
    { language: "fr-FR", voice: "alice" },
    "Bonjour, vous êtes bien au standard du cabinet. Dites-moi en quelques mots ce dont vous avez besoin."
  );

  // Si rien n'est dit
  twiml.redirect({ method: "POST" }, "/voice");

  res.type("text/xml").send(twiml.toString());
});

// --- Route IA: prend SpeechResult -> GPT -> répond en <Say> (fallback robuste) ---
app.post("/ai", async (req, res) => {
  const userText = (req.body.SpeechResult || "").trim();
  const twiml = new Twiml.VoiceResponse();

  try {
    // si rien entendu, on relance
    if (!userText) {
      twiml.say({ language: "fr-FR", voice: "alice" },
        "Je n'ai pas bien saisi. Pouvez-vous répéter, s'il vous plaît ?");
      twiml.redirect({ method: "POST" }, "/voice");
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Appel GPT (réponse courte et utile)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText }
      ]
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Je transmets votre demande à un collègue et nous vous recontactons très vite.";

    // Répondre en TTS Twilio (simple). On passera sur ElevenLabs ensuite (Play MP3).
    twiml.say({ language: "fr-FR", voice: "alice" }, reply);

    // Option: si mots-clés urgence -> transfert humain
    if (/urgence|urgent|fuite|accident|douleur|immédiat/i.test(userText)) {
      twiml.pause({ length: 1 });
      twiml.say({ language: "fr-FR", voice: "alice" }, "Je vous transfère immédiatement.");
      // twiml.dial("+33XXXXXXXXX"); // décommente et mets le numéro du client
    }

    // Option: fin d'appel
    twiml.pause({ length: 1 });
    twiml.say({ language: "fr-FR", voice: "alice" }, "Merci pour votre appel. Bonne journée.");
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("AI error:", err);
    twiml.say({ language: "fr-FR", voice: "alice" },
      "Désolé, un souci technique est survenu. Je vous propose de rappeler dans quelques instants.");
    res.type("text/xml").send(twiml.toString());
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("🚀 Serveur écoute sur", port));

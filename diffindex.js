import express from "express";
import bodyParser from "body-parser";
import { twiml as Twiml } from "twilio";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Route test
app.get("/", (req, res) => {
  res.send("Assistant vocal en ligne ✅");
});

// Webhook pour les appels Twilio
app.post("/voice", (req, res) => {
  const twiml = new Twiml.VoiceResponse();

  twiml.say(
    { language: "fr-FR", voice: "alice" },
    "Bonjour, vous êtes bien sur l'assistant vocal de démonstration. Comment puis-je vous aider ?"
  );

  res.type("text/xml");
  res.send(twiml.toString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Serveur en ligne sur le port ${port}`);
});

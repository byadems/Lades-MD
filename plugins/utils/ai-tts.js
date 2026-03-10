const axios = require("axios");
const FormData = require("form-data");

const VOICES = Object.freeze([
  "nova",
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "sage",
  "shimmer",
]);

function getVoice(voice) {
  if (!voice) return "coral";
  const v = voice.toLowerCase();
  return VOICES.includes(v) ? v : "coral";
}

async function aiTTS(text, voice = "coral", speed = "1.00") {
  if (!text) return { error: "Metin sağlanmadı" };
  const selectedVoice = getVoice(voice);
  const formData = new FormData();
  formData.append("msg", text);
  formData.append("lang", selectedVoice);
  formData.append("speed", speed);
  formData.append("source", "ttsmp3");
  try {
    const { data } = await axios.post(
      "https://ttsmp3.com/makemp3_ai.php",
      formData,
      { headers: formData.getHeaders() }
    );
    if (data?.Error === "Usage Limit exceeded") {
      return { error: "TTS API kullanım limiti aşıldı", response: data };
    }
    if (data?.Error === 0 && data?.URL) {
      return { url: data.URL };
    }
    return { error: "TTS oluşturma başarısız", response: data };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = aiTTS;

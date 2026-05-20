import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Gemini Setup
  let aiInstance: GoogleGenAI | null = null;
  const getAI = () => {
    if (!aiInstance) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "null" || apiKey === "" || apiKey === "undefined") {
          throw new Error("GEMINI_API_KEY is not set.");
      }
      aiInstance = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return aiInstance;
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.post("/api/analyze-trip", async (req, res) => {
    console.log(`[Trip] Request received. size: ${Math.round(JSON.stringify(req.body).length / 1024)} KB`);
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "Image is required" });

      const mimeTypeMatch = image.match(/^data:([^;]+);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
      const imageData = image.split(',')[1] || image;
      const ai = getAI();

      const prompt = "Analyze this motorcycle trip computer photo. Extract: kmsSinceLastRefill (number), totalKms (number), ridingMode (string), calculatedConsumption (number, km/L), time (string, HH:mm). Response MUST be JSON.";

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: {
          parts: [
            { inlineData: { mimeType, data: imageData } },
            { text: prompt }
          ]
        },
        config: {
          systemInstruction: "You are an expert at reading motorcycle dashboard displays (BMW Motorrad TFT). Extract trip data accurately from photos.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              kmsSinceLastRefill: { type: Type.NUMBER },
              totalKms: { type: Type.NUMBER },
              ridingMode: { type: Type.STRING },
              calculatedConsumption: { type: Type.NUMBER },
              time: { type: Type.STRING }
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response text from Gemini");
      console.log("[Trip] Gemini success:", text);
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Trip] Error:", error);
      res.status(500).json({ 
        error: `Gemini Analysis Error: ${error.message}`,
        details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
      });
    }
  });

  app.post("/api/analyze-receipts", async (req, res) => {
    console.log(`[Receipts] Request received. Count: ${req.body.images?.length}`);
    try {
      const { images } = req.body;
      if (!images || !Array.isArray(images)) return res.status(400).json({ error: "Images required" });

      const ai = getAI();

      const parts = images.map((img: string) => {
        const mimeTypeMatch = img.match(/^data:([^;]+);base64,/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
        const base64Data = img.split(',')[1] || img;
        return {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        };
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: {
          parts: [
            ...parts,
            { text: "Extract total quantity and cost from these receipts." }
          ]
        },
        config: {
          systemInstruction: "Extract fuel receipt data: date (YYYY-MM-DD), time (HH:mm), quantity (L), fuelType, totalCost, pricePerLiter. Response MUST be JSON.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              time: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              fuelType: { type: Type.STRING },
              totalCost: { type: Type.NUMBER },
              pricePerLiter: { type: Type.NUMBER },
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response text from Gemini");
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Receipts] Error:", error);
      res.status(500).json({ error: `Receipt Analysis Error: ${error.message}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

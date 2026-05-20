import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiServerPlugin = (env: Record<string, string>) => ({
  name: 'api-server',
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const url = req.url?.split('?')[0];
      if (req.method === 'POST' && (url === '/api/analyze-trip' || url === '/api/analyze-receipts')) {
        try {
          // Parse JSON body
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          const parsedBody = JSON.parse(body || '{}');

          const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
          if (!apiKey || apiKey === "null" || apiKey === "" || apiKey === "undefined") {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "GEMINI_API_KEY is not set." }));
            return;
          }

          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });

          if (url === '/api/analyze-trip') {
            const { image } = parsedBody;
            if (!image) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: "Image is required" }));
              return;
            }

            const mimeTypeMatch = image.match(/^data:([^;]+);base64,/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
            const imageData = image.split(',')[1] || image;

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
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          } else if (url === '/api/analyze-receipts') {
            const { images } = parsedBody;
            if (!images || !Array.isArray(images)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: "Images required" }));
              return;
            }

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
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          }
        } catch (error: any) {
          console.error("[Vite API Server] Error:", error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Gemini Analysis Error: ${error.message}` }));
        }
      } else {
        next();
      }
    });
  }
});

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), apiServerPlugin(env)],
    base: '/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      strictPort: true,
      allowedHosts: true,
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
      },
      fs: {
        strict: false
      },
      hmr: process.env.DISABLE_HMR === 'true' ? false : { overlay: false },
    },
  };
});

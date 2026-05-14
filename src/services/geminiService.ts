import { GoogleGenAI, Type } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    aiInstance = new GoogleGenAI({ apiKey: apiKey || "" });
  }
  return aiInstance;
}

export interface TripData {
  kmsSinceLastRefill: number;
  totalKms: number;
  ridingMode: string;
  calculatedConsumption: number;
  time?: string; // HH:mm format
}

export interface ReceiptData {
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  quantity?: number;
  fuelType?: string;
  totalCost?: number;
  pricePerLiter?: number;
}

export async function analyzeTripPhoto(base64Image: string): Promise<TripData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not defined");
    return null;
  }
  try {
    const ai = getAI();
    const prompt = "Analyze this BMW R1300GS trip computer photo. Extract the following values: \n1. Kilometers done since last refill (Trip 1 or Trip 2, usually labeled 'Trip').\n2. Total kilometers (Odometer).\n3. Current riding mode (e.g., Road, Dynamic, Eco, Rain, Enduro).\n4. Calculated fuel consumption (usually in km/L). If it's in L/100km, convert it to km/L (100 divided by the value).\n5. The current time shown on the dashboard (usually in HH:mm format).\nReturn the data in JSON format.";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(',')[1] || base64Image
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            kmsSinceLastRefill: { type: Type.NUMBER },
            totalKms: { type: Type.NUMBER },
            ridingMode: { type: Type.STRING },
            calculatedConsumption: { type: Type.NUMBER },
            time: { type: Type.STRING }
          },
          required: ["kmsSinceLastRefill", "totalKms", "ridingMode", "calculatedConsumption"]
        }
      }
    });

    const text = response.text;
    if (text) {
      return JSON.parse(text) as TripData;
    }
    return null;
  } catch (error) {
    console.error("Error analyzing photo:", error);
    return null;
  }
}

export async function analyzeReceipts(base64Images: string[]): Promise<ReceiptData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not defined");
    return null;
  }
  try {
    const ai = getAI();
    const parts = base64Images.map(img => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: img.split(',')[1] || img,
      },
    }));

    const prompt = "Analyze these fuel receipts. Extract the following values: \n1. Date of filling (YYYY-MM-DD). Note: The date on the receipt is in DD/MM/YY or DD/MM/YYYY format.\n2. Time of filling (HH:mm).\n3. Quantity filled (Liters).\n4. Fuel grade (e.g., Standard, Premium, 95, 98).\n5. Total cost paid.\n6. Price per liter.\nIf there are multiple receipts, sum the quantity and total cost. Use the date/time from the most recent receipt. Return the data in JSON format.";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          ...parts,
          { text: prompt }
        ]
      },
      config: {
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
    if (text) {
      return JSON.parse(text) as ReceiptData;
    }
    return null;
  } catch (error) {
    console.error("Error analyzing receipts:", error);
    return null;
  }
}

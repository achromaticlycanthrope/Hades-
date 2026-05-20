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
  console.log('Sending trip photo for analysis. Image length:', base64Image.length);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch("/api/analyze-trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log('Trip analysis response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Trip analysis server error text:', errorText);
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        errorMessage = errorText.slice(0, 300) || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('Trip analysis result:', result);
    return result;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Analysis timed out (60s). Please check your internet connection.');
    }
    console.error("Error analyzing photo:", error);
    throw new Error(`Analysis Error: ${error.message || String(error)}`);
  }
}

export async function analyzeReceipts(base64Images: string[]): Promise<ReceiptData | null> {
  console.log('Sending receipts for analysis. Count:', base64Images.length);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s for multiple images

    const response = await fetch("/api/analyze-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: base64Images }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log('Receipt analysis response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Receipt analysis server error text:', errorText);
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        errorMessage = errorText.slice(0, 300) || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('Receipt analysis result:', result);
    return result;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Receipt analysis timed out. Please try fewer images or check your connection.');
    }
    console.error("Error analyzing receipts:", error);
    throw new Error(`Receipt Analysis Error: ${error.message || String(error)}`);
  }
}

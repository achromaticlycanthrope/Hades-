import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function compressImage(source: File | string, maxWidth = 1200, quality = 0.7): Promise<string> {
  console.log('Starting image compression...', { maxWidth, quality, type: typeof source });
  
  if (!(source instanceof File)) {
    return source; // Already data URL or string path
  }

  // Define helper to read file contents as Data URL without parsing images/allocating uncompressed canvases
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolveRaw, rejectRaw) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          resolveRaw(ev.target.result);
        } else {
          rejectRaw(new Error('FileReader resulted in an invalid data type'));
        }
      };
      reader.onerror = () => rejectRaw(reader.error || new Error('FileReader upload failure'));
      reader.readAsDataURL(file);
    });
  };

  try {
    // Attempt standard/optimized canvas resizing in a safe wrapper
    const resultBase64 = await new Promise<string>(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image processing timed out (45s)')), 45000);
      
      try {
        let bitmap: ImageBitmap | null = null;

        // Try modern createImageBitmap first
        try {
          console.log('Attempting createImageBitmap probing...');
          const tempBitmap = await window.createImageBitmap(source);
          const originalW = tempBitmap.width;
          const originalH = tempBitmap.height;
          
          let targetW = originalW;
          let targetH = originalH;
          if (originalW > maxWidth || originalH > maxWidth) {
            const ratio = Math.min(maxWidth / originalW, maxWidth / originalH);
            targetW = Math.round(originalW * ratio);
            targetH = Math.round(originalH * ratio);
            
            tempBitmap.close(); // free massive full-res bitmap memory immediately
            
            console.log('Scaling down image via native resize...', { targetW, targetH });
            bitmap = await window.createImageBitmap(source, {
              resizeWidth: targetW,
              resizeHeight: targetH,
              resizeQuality: 'high'
            });
          } else {
            bitmap = tempBitmap;
          }
        } catch (bitmapErr) {
          console.warn('createImageBitmap failed/unsupported. Falling back to FileReader Canvas scaling...', bitmapErr);
          
          // FileReader fallback for older browsers
          const dataUrl = await readFileAsDataUrl(source);

          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error('Failed to load image element from data URL'));
            img.src = dataUrl;
          });

          // Draw directly via traditional canvas
          const canvas = document.createElement('canvas');
          let targetW = img.width;
          let targetH = img.height;
          if (targetW > maxWidth || targetH > maxWidth) {
            const ratio = Math.min(maxWidth / targetW, maxWidth / targetH);
            targetW = Math.round(targetW * ratio);
            targetH = Math.round(targetH * ratio);
          }

          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get 2D context for manual resize');
          
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetW, targetH);
          
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          clearTimeout(timeout);
          resolve(compressedBase64);
          return;
        }

        if (!bitmap) {
          throw new Error('Image decoding returned empty result');
        }

        clearTimeout(timeout);
        
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        ctx.drawImage(bitmap, 0, 0);
        
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        
        // Cleanup
        bitmap.close();
        
        console.log('Compression complete. Output length:', compressedBase64.length);
        resolve(compressedBase64);

      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    return resultBase64;

  } catch (err: any) {
    // -----------------------------------------------------------------------------------
    // ULTIMATE HEALING FALLBACK:
    // If anything fails (e.g. OOM, HEIC/HEIF unsupported file decoding), do not fail!
    // Instead of displaying error toasts, we simply read the exact file bytes as a Base64 URL 
    // and deliver them straight to the server! This takes virtually zero additional CPU or RAM, 
    // never triggers OOM, bypasses browser Canvas/UI limitation, and passes raw content to 
    // Gemini API (which natively decodes high-res images perfectly with extreme precision).
    // -----------------------------------------------------------------------------------
    console.warn('Image resizing/compression failed on device. Falling back to original image bytes transmission...', err);
    try {
      const rawDataUrl = await readFileAsDataUrl(source);
      console.log('Successfully completed fallback to original image. Size:', Math.round(rawDataUrl.length / 1024), 'KB');
      return rawDataUrl;
    } catch (fallbackErr: any) {
      console.error('Critical FileReader fallback error:', fallbackErr);
      throw new Error(`Failed to read selected file: ${fallbackErr.message || fallbackErr}`);
    }
  }
}

import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { removeBackground, Config } from '@imgly/background-removal';
import { Upload, Image as ImageIcon, Download, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Cleanup object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      if (originalImage) URL.revokeObjectURL(originalImage);
      if (processedImage) URL.revokeObjectURL(processedImage);
    };
  }, [originalImage, processedImage]);

  const processImage = async (file: File, objectUrl: string) => {
    try {
      setIsProcessing(true);
      setError(null);
      setProgressText('Initializing AI model...');

      const config: Config = {
        debug: true,
        device: 'cpu', // Force CPU to avoid WebGL/WebGPU iframe restrictions
        model: 'isnet_quint8', // Use quantized model for faster CPU processing
        output: {
          format: 'image/png',
        },
        progress: (key, current, total) => {
          if (key.includes('fetch')) {
            const percent = Math.round((current / total) * 100);
            setProgressText(`Downloading AI model: ${percent}%`);
          } else if (key.includes('compute')) {
            setProgressText('Processing image...');
          }
        },
      };

      console.log('Starting background removal for:', file.name, file.type, file.size);
      const blob = await removeBackground(objectUrl, config);
      console.log('Background removal complete. Result blob size:', blob.size);
      
      const url = URL.createObjectURL(blob);
      setProcessedImage(url);
      setProgressText('');
    } catch (err: any) {
      console.error('Error removing background:', err);
      setError(err.message || 'Failed to remove background. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    // Create a local URL for the original image
    const objectUrl = URL.createObjectURL(file);
    setOriginalImage(objectUrl);
    setProcessedImage(null);
    
    // Start processing immediately
    processImage(file, objectUrl);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    maxFiles: 1,
    disabled: isProcessing
  } as any);

  const handleDownload = () => {
    if (!processedImage) return;
    const a = document.createElement('a');
    a.href = processedImage;
    a.download = 'background-removed.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleReset = () => {
    if (originalImage) URL.revokeObjectURL(originalImage);
    if (processedImage) URL.revokeObjectURL(processedImage);
    setOriginalImage(null);
    setProcessedImage(null);
    setError(null);
    setProgressText('');
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <ImageIcon className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              Local Background Remover
            </h1>
          </div>
          <div className="text-sm font-medium text-zinc-500 bg-zinc-100 px-3 py-1 rounded-full">
            100% Private & Local
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl mb-4">
            Remove backgrounds <span className="text-indigo-600">instantly</span>.
          </h2>
          <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
            High-precision AI background removal running entirely in your browser. 
            No cloud uploads, no server processing, complete privacy.
          </p>
        </div>

        {error && (
          <div className="mb-8 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium">Error processing image</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {!originalImage ? (
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all duration-200 ease-in-out bg-white",
              isDragActive 
                ? "border-indigo-500 bg-indigo-50/50 scale-[1.02]" 
                : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50",
              isProcessing && "opacity-50 cursor-not-allowed pointer-events-none"
            )}
          >
            <input {...getInputProps()} />
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Upload className="w-10 h-10 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-zinc-900 mb-2">
              {isDragActive ? "Drop your image here" : "Click or drag an image"}
            </h3>
            <p className="text-zinc-500 max-w-sm mx-auto">
              Supports JPG, PNG, and WebP. High resolution images may take a few seconds to process locally.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-sm border border-zinc-200 overflow-hidden">
              <div className="relative rounded-2xl overflow-hidden bg-zinc-100 aspect-[4/3] sm:aspect-[16/9] flex items-center justify-center">
                
                {/* Checkerboard background for transparency visibility */}
                <div className="absolute inset-0 z-0 opacity-20" 
                     style={{
                       backgroundImage: 'repeating-linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), repeating-linear-gradient(45deg, #ccc 25%, #fff 25%, #fff 75%, #ccc 75%, #ccc)',
                       backgroundPosition: '0 0, 10px 10px',
                       backgroundSize: '20px 20px'
                     }} 
                />

                {processedImage ? (
                  <div className="relative z-10 w-full h-full flex items-center justify-center">
                    <img 
                      src={processedImage} 
                      alt="Processed" 
                      className="max-w-full max-h-full object-contain drop-shadow-xl" 
                    />
                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-700 shadow-sm border border-zinc-200/50">
                      Background Removed
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 w-full h-full flex items-center justify-center">
                    <img 
                      src={originalImage} 
                      alt="Original" 
                      className="max-w-full max-h-full object-contain opacity-50 blur-sm transition-all duration-500" 
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-sm">
                      <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                      <p className="text-lg font-medium text-zinc-900">{progressText || 'Processing...'}</p>
                      <p className="text-sm text-zinc-600 mt-2 max-w-xs text-center">
                        First run downloads the AI model (~40MB). Subsequent runs are instant.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={handleReset}
                disabled={isProcessing}
                className="w-full sm:w-auto px-6 py-3 rounded-xl font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <RefreshCw className="w-5 h-5" />
                Try Another Image
              </button>
              
              <button
                onClick={handleDownload}
                disabled={!processedImage || isProcessing}
                className="w-full sm:w-auto px-8 py-3 rounded-xl font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-indigo-200"
              >
                <Download className="w-5 h-5" />
                Download HD Image
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

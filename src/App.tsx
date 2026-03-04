import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { removeBackground, Config } from '@imgly/background-removal';
import { Upload, Image as ImageIcon, Download, RefreshCw, Loader2, AlertCircle, CheckCircle2, Trash2, Settings2, FileArchive, Sparkles, Maximize, Link as LinkIcon, DownloadCloud } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GoogleGenAI } from '@google/genai';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ProcessingStatus = 'idle' | 'processing' | 'success' | 'error';

interface ImageItem {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl: string | null;
  status: ProcessingStatus;
  progressText: string;
  error: string | null;
}

const upscaleImage = async (blob: Blob, scale: number): Promise<Blob> => {
  if (scale === 1) return blob;
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(blob);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((scaledBlob) => {
        if (scaledBlob) resolve(scaledBlob);
        else resolve(blob);
      }, 'image/png');
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
};

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [modelType, setModelType] = useState<'isnet' | 'isnet_quint8' | 'u2net' | 'gemini'>('isnet');
  const [upscale, setUpscale] = useState<number>(1);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);

  // Cleanup object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      images.forEach(img => {
        URL.revokeObjectURL(img.originalUrl);
        if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
      });
    };
  }, []);

  const processImage = async (item: ImageItem, currentModel: string) => {
    setImages(prev => prev.map(img => 
      img.id === item.id 
        ? { ...img, status: 'processing', progressText: currentModel === 'gemini' ? 'Uploading to Gemini AI...' : 'Initializing AI model...', error: null } 
        : img
    ));

    try {
      let url: string;

      if (currentModel === 'gemini') {
        // Convert file to base64
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(item.file);
        });

        setImages(prev => prev.map(img => 
          img.id === item.id 
            ? { ...img, progressText: 'AI is analyzing and removing background...' } 
            : img
        ));

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: item.file.type,
                },
              },
              {
                text: 'Remove the background from this image. Make the background completely transparent. Keep only the main subjects. Output a transparent PNG.',
              },
            ],
          },
        });

        let imageUrl = null;
        if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              const base64EncodeString = part.inlineData.data;
              const mimeType = part.inlineData.mimeType || 'image/png';
              const blob = await (await fetch(`data:${mimeType};base64,${base64EncodeString}`)).blob();
              imageUrl = URL.createObjectURL(blob);
              break;
            }
          }
        }

        if (!imageUrl) {
          throw new Error('Gemini AI failed to return an image. It might have returned text instead.');
        }
        url = imageUrl;
      } else {
        const config: Config = {
          debug: false,
          device: 'cpu', // Force CPU to avoid WebGL/WebGPU iframe restrictions
          model: currentModel as any, // Use selected model ('isnet' is higher quality)
          output: {
            format: 'image/png',
          },
          progress: (key, current, total) => {
            if (key.includes('fetch')) {
              const percent = Math.round((current / total) * 100);
              setImages(prev => prev.map(img => 
                img.id === item.id 
                  ? { ...img, progressText: `Downloading AI model: ${percent}%` } 
                  : img
              ));
            } else if (key.includes('compute')) {
              setImages(prev => prev.map(img => 
                img.id === item.id 
                  ? { ...img, progressText: 'Processing image...' } 
                  : img
              ));
            }
          },
        };

        const blob = await removeBackground(item.originalUrl, config);
        url = URL.createObjectURL(blob);
      }
      
      setImages(prev => prev.map(img => 
        img.id === item.id 
          ? { ...img, status: 'success', processedUrl: url, progressText: '' } 
          : img
      ));
    } catch (err: any) {
      console.error('Error removing background:', err);
      setImages(prev => prev.map(img => 
        img.id === item.id 
          ? { ...img, status: 'error', error: err.message || 'Failed to remove background.', progressText: '' } 
          : img
      ));
    }
  };

  const processBatch = async (itemsToProcess: ImageItem[], currentModel: string) => {
    setIsProcessingBatch(true);
    // Process sequentially to avoid memory overload on CPU
    for (const item of itemsToProcess) {
      // Check if it's still in the list (user might have deleted it)
      const stillExists = await new Promise<boolean>(resolve => {
        setImages(currentImages => {
          resolve(currentImages.some(i => i.id === item.id));
          return currentImages;
        });
      });
      
      if (stillExists && (item.status === 'idle' || item.status === 'error')) {
        await processImage(item, currentModel);
      }
    }
    setIsProcessingBatch(false);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const newItems: ImageItem[] = acceptedFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      originalUrl: URL.createObjectURL(file),
      processedUrl: null,
      status: 'idle',
      progressText: '',
      error: null
    }));

    setImages(prev => [...prev, ...newItems]);
    
    // Start processing the new items
    processBatch(newItems, modelType);
  }, [modelType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDrop as any,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    disabled: isProcessingBatch
  } as any);

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput) return;
    
    setIsFetchingUrl(true);
    try {
      const response = await fetch(imageUrlInput);
      const blob = await response.blob();
      
      const filename = imageUrlInput.split('/').pop()?.split('?')[0] || 'image-from-url.jpg';
      const file = new File([blob], filename, { type: blob.type });
      
      const newItem: ImageItem = {
        id: Math.random().toString(36).substring(7),
        file,
        originalUrl: URL.createObjectURL(file),
        processedUrl: null,
        status: 'idle',
        progressText: '',
        error: null
      };

      setImages(prev => [...prev, newItem]);
      setImageUrlInput('');
      processBatch([newItem], modelType);
    } catch (err) {
      alert('Failed to load image from URL. It might be protected by CORS.');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleDownload = async (item: ImageItem) => {
    if (!item.processedUrl) return;
    
    let downloadUrl = item.processedUrl;
    
    if (upscale > 1) {
      try {
        const response = await fetch(item.processedUrl);
        const blob = await response.blob();
        const scaledBlob = await upscaleImage(blob, upscale);
        downloadUrl = URL.createObjectURL(scaledBlob);
      } catch (e) {
        console.error("Upscaling failed", e);
      }
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `nobg-${item.file.name.replace(/\\.[^/.]+$/, "")}${upscale > 1 ? `-x${upscale}` : ''}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    if (upscale > 1) {
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  };

  const handleDownloadAllIndividual = async () => {
    const processedItems = images.filter(img => img.status === 'success' && img.processedUrl);
    if (processedItems.length === 0) return;

    for (const item of processedItems) {
      await handleDownload(item);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  };

  const handleDownloadAll = async () => {
    const processedItems = images.filter(img => img.status === 'success' && img.processedUrl);
    if (processedItems.length === 0) return;

    if (processedItems.length === 1) {
      handleDownload(processedItems[0]);
      return;
    }

    const zip = new JSZip();
    
    // Fetch all blobs and add to zip
    await Promise.all(processedItems.map(async (item) => {
      if (!item.processedUrl) return;
      const response = await fetch(item.processedUrl);
      const blob = await response.blob();
      const finalBlob = upscale > 1 ? await upscaleImage(blob, upscale) : blob;
      zip.file(`nobg-${item.file.name.replace(/\\.[^/.]+$/, "")}${upscale > 1 ? `-x${upscale}` : ''}.png`, finalBlob);
    }));

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'backgrounds-removed.zip');
  };

  const handleRemoveItem = (id: string) => {
    setImages(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        URL.revokeObjectURL(item.originalUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
      }
      return prev.filter(i => i.id !== id);
    });
  };

  const handleReset = () => {
    images.forEach(img => {
      URL.revokeObjectURL(img.originalUrl);
      if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
    });
    setImages([]);
  };

  const handleRetry = (item: ImageItem) => {
    processBatch([item], modelType);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value as any;
    setModelType(newModel);
  };

  const processedCount = images.filter(img => img.status === 'success').length;
  const hasImages = images.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <ImageIcon className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              Pro Background Remover
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <Maximize className="w-4 h-4 hidden sm:block" />
              <select 
                value={upscale} 
                onChange={(e) => setUpscale(Number(e.target.value))}
                className="bg-zinc-100 border-none rounded-md py-1.5 px-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              >
                <option value={1}>1x (Original)</option>
                <option value={2}>2x Upscale</option>
                <option value={4}>4x Upscale</option>
                <option value={8}>8x Upscale</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <Settings2 className="w-4 h-4 hidden sm:block" />
              <select 
                value={modelType} 
                onChange={handleModelChange}
                className="bg-zinc-100 border-none rounded-md py-1.5 px-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                disabled={isProcessingBatch}
              >
                <option value="isnet">High Quality (Local ISNet)</option>
                <option value="isnet_quint8">Fast (Local Quantized)</option>
                <option value="u2net">Alternative (Local U2Net)</option>
                <option value="gemini">✨ Gemini AI (Cloud - Best for Complex)</option>
              </select>
            </div>
            <div className="text-sm font-medium text-zinc-500 bg-zinc-100 px-3 py-1 rounded-full hidden sm:block">
              {modelType === 'gemini' ? 'Cloud Processing' : '100% Private & Local'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl mb-4">
            Remove backgrounds <span className="text-indigo-600">in batch</span>.
          </h2>
          <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
            Production-ready AI background removal. Use local models for complete privacy, 
            or switch to <span className="font-semibold text-indigo-600">Gemini AI</span> for complex images.
          </p>
        </div>

        {!hasImages ? (
          <div className="max-w-3xl mx-auto">
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-3xl p-16 text-center cursor-pointer transition-all duration-200 ease-in-out bg-white",
                isDragActive 
                  ? "border-indigo-500 bg-indigo-50/50 scale-[1.02]" 
                  : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50",
                isProcessingBatch && "opacity-50 cursor-not-allowed pointer-events-none"
              )}
            >
              <input {...getInputProps()} />
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="w-12 h-12 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-semibold text-zinc-900 mb-3">
                {isDragActive ? "Drop your images here" : "Click or drag multiple images"}
              </h3>
              <p className="text-zinc-500 max-w-sm mx-auto text-lg">
                Supports JPG, PNG, and WebP. Process as many images as you need.
              </p>
            </div>

            <div className="mt-8">
              <div className="relative flex items-center py-4">
                <div className="flex-grow border-t border-zinc-300"></div>
                <span className="flex-shrink-0 mx-4 text-zinc-400 text-sm font-medium">OR</span>
                <div className="flex-grow border-t border-zinc-300"></div>
              </div>
              
              <form onSubmit={handleAddUrl} className="flex gap-2">
                <input 
                  type="url" 
                  value={imageUrlInput}
                  onChange={e => setImageUrlInput(e.target.value)}
                  placeholder="Paste an image URL here..."
                  className="flex-1 px-4 py-3 rounded-xl border border-zinc-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white shadow-sm"
                  disabled={isFetchingUrl || isProcessingBatch}
                />
                <button 
                  type="submit"
                  disabled={!imageUrlInput || isFetchingUrl || isProcessingBatch}
                  className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm"
                >
                  {isFetchingUrl ? <Loader2 className="w-5 h-5 animate-spin" /> : <LinkIcon className="w-5 h-5" />}
                  Add URL
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-zinc-200">
              <div className="flex items-center gap-4">
                <div className="text-sm font-medium text-zinc-600">
                  Processed: <span className="text-zinc-900 font-bold">{processedCount}</span> / {images.length}
                </div>
                {isProcessingBatch && (
                  <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing batch...
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors cursor-pointer flex items-center justify-center gap-2",
                    isProcessingBatch && "opacity-50 cursor-not-allowed pointer-events-none"
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-4 h-4" />
                  Add More
                </div>
                
                <button
                  onClick={handleReset}
                  disabled={isProcessingBatch}
                  className="px-4 py-2 rounded-lg font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-4 h-4" />
                  Clear All
                </button>
                
                <button
                  onClick={handleDownloadAllIndividual}
                  disabled={processedCount === 0}
                  className="px-4 py-2 rounded-lg font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download files individually"
                >
                  <DownloadCloud className="w-4 h-4" />
                  <span className="hidden sm:inline">Download All</span>
                </button>

                <button
                  onClick={handleDownloadAll}
                  disabled={processedCount === 0}
                  className="px-5 py-2 rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  title="Download all files as a ZIP archive"
                >
                  <FileArchive className="w-4 h-4" />
                  <span className="hidden sm:inline">Save as ZIP</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {images.map((item) => (
                <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden flex flex-col group">
                  <div className="relative aspect-square bg-zinc-100 flex items-center justify-center overflow-hidden">
                    {/* Checkerboard background for transparency visibility */}
                    <div className="absolute inset-0 z-0 opacity-20" 
                         style={{
                           backgroundImage: 'repeating-linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), repeating-linear-gradient(45deg, #ccc 25%, #fff 25%, #fff 75%, #ccc 75%, #ccc)',
                           backgroundPosition: '0 0, 10px 10px',
                           backgroundSize: '20px 20px'
                         }} 
                    />

                    {item.status === 'success' && item.processedUrl ? (
                      <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
                        <img 
                          src={item.processedUrl} 
                          alt="Processed" 
                          className="max-w-full max-h-full object-contain drop-shadow-xl" 
                        />
                        <div className="absolute top-3 left-3 bg-green-500 text-white p-1 rounded-full shadow-sm">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      </div>
                    ) : (
                      <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
                        <img 
                          src={item.originalUrl} 
                          alt="Original" 
                          className={cn(
                            "max-w-full max-h-full object-contain transition-all duration-500",
                            item.status === 'processing' ? "opacity-30 blur-sm" : "opacity-100"
                          )} 
                        />
                        
                        {item.status === 'processing' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-sm p-4 text-center">
                            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
                            <p className="text-sm font-medium text-zinc-900">{item.progressText || 'Processing...'}</p>
                          </div>
                        )}
                        
                        {item.status === 'error' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm p-4 text-center">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                            <p className="text-sm font-medium text-red-700 mb-3">{item.error}</p>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleRetry(item)}
                                className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
                              >
                                Retry
                              </button>
                              {modelType !== 'gemini' && (
                                <button 
                                  onClick={() => {
                                    setModelType('gemini');
                                    processBatch([item], 'gemini');
                                  }}
                                  className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-200 transition-colors flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Try Gemini AI
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {item.status === 'idle' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/10 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 shadow-sm">
                              Waiting in queue...
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Delete button (visible on hover) */}
                    <button 
                      onClick={() => handleRemoveItem(item.id)}
                      className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm text-zinc-500 hover:text-red-500 hover:bg-red-50 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-all z-20"
                      title="Remove image"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="p-4 border-t border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                    <div className="truncate text-sm font-medium text-zinc-700 pr-4" title={item.file.name}>
                      {item.file.name}
                    </div>
                    <button
                      onClick={() => handleDownload(item)}
                      disabled={item.status !== 'success'}
                      className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex-shrink-0"
                      title="Download"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


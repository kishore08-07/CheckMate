import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Eye, AlertTriangle, ShieldCheck } from 'lucide-react';
import axios from 'axios';

declare global {
    interface Window {
        tmImage: any;
    }
}

interface DrowsyDetectorProps {
    vehicleId: string;
    darkMode: boolean;
    onDrowsinessDetected?: (event: { detected: boolean; confidence: number }) => void;
}

const URL = "/my_model/";
const DROWSY_THRESHOLD = 0.95;
const COOLDOWN_MS = 5000;

export const DrowsyDetector: React.FC<DrowsyDetectorProps> = ({
    vehicleId,
    darkMode,
    onDrowsinessDetected
}) => {
    const isDetectingRef = useRef(false);
    const [status, setStatus] = useState<'Normal' | 'Drowsy' | 'Loading...'>('Normal');
    const [confidence, setConfidence] = useState<number>(0);
    const [hasAlert, setHasAlert] = useState(false);

    const videoContainerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const modelRef = useRef<any>(null);
    const webcamRef = useRef<any>(null);
    const animationFrameId = useRef<number | null>(null);
    const lastDrowsyTimeRef = useRef<number>(0);

    useEffect(() => {
        audioRef.current = new Audio('/alert.mp3');
        initModel(); // Automatically start detection
        return () => stopDetection(); // Cleanup on unmount
    }, []);

    const initModel = async () => {
        try {
            setStatus('Loading...');
            const modelURL = URL + "model.json";
            const metadataURL = URL + "metadata.json";

            if (!window.tmImage) {
                console.error("Teachable Machine library not loaded!");
                setStatus('Normal');
                return;
            }

            modelRef.current = await window.tmImage.load(modelURL, metadataURL);

            const flip = true;
            webcamRef.current = new window.tmImage.Webcam(200, 200, flip);
            await webcamRef.current.setup();
            await webcamRef.current.play();

            if (videoContainerRef.current) {
                videoContainerRef.current.innerHTML = '';
                videoContainerRef.current.appendChild(webcamRef.current.canvas);

                // Add styling to canvas
                const canvas = videoContainerRef.current.querySelector('canvas');
                if (canvas) {
                    canvas.className = 'rounded-xl shadow-lg border-2 border-gray-300 dark:border-gray-600 w-full h-auto max-w-[200px] mx-auto';
                }
            }

            isDetectingRef.current = true;
            setStatus('Normal');
            window.requestAnimationFrame(loop);
        } catch (err) {
            console.error("Error initializing model:", err);
            setStatus('Normal');
        }
    };

    const stopDetection = useCallback(() => {
        if (animationFrameId.current) {
            window.cancelAnimationFrame(animationFrameId.current);
        }
        if (webcamRef.current) {
            webcamRef.current.stop();
        }
        if (videoContainerRef.current) {
            videoContainerRef.current.innerHTML = '';
        }
        stopAlert();
        isDetectingRef.current = false;
        setStatus('Normal');
        setConfidence(0);
    }, []);

    const loop = async () => {
        if (webcamRef.current) {
            webcamRef.current.update();
            await predict();
        }
        if (isDetectingRef.current) {
            animationFrameId.current = window.requestAnimationFrame(loop);
        }
    };

    const stopAlert = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setHasAlert(false);
    };

    const predict = async () => {
        if (!modelRef.current || !webcamRef.current) return;

        try {
            const prediction = await modelRef.current.predict(webcamRef.current.canvas);
            let drowsyProb = 0;

            for (let i = 0; i < prediction.length; i++) {
                if (prediction[i].className === "Drowsy") {
                    drowsyProb = prediction[i].probability;
                }
            }

            setConfidence(drowsyProb);

            if (drowsyProb > DROWSY_THRESHOLD) {
                setStatus('Drowsy');
                const now = Date.now();
                if (now - lastDrowsyTimeRef.current > COOLDOWN_MS) {
                    triggerAlert(drowsyProb);
                    lastDrowsyTimeRef.current = now;
                }
            } else {
                setStatus('Normal');
            }
        } catch (err) {
            console.error("Prediction error:", err);
        }
    };

    const triggerAlert = async (prob: number) => {
        // Play alert sound
        if (audioRef.current) {
            audioRef.current.play().catch(e => console.log('Audio play failed', e));
            setHasAlert(true);
        }

        const eventData = { detected: true, confidence: prob };

        // Trigger local callback
        if (onDrowsinessDetected) {
            onDrowsinessDetected(eventData);
        }

        // Call backend API
        try {
            await axios.post('http://localhost:3000/predict/drowsiness', {
                vehicle_id: vehicleId,
                drowsiness_event: eventData
            });
        } catch (err) {
            console.error("Failed to POST drowsiness event:", err);
        }
    };

    return (
        <div className="mb-4">
            <h3 className={`text-lg font-bold flex items-center space-x-2 mb-4 ${darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                <Eye className="w-5 h-5 text-purple-500" />
                <span>Driver Attention Monitor</span>
            </h3>

            <div className="flex flex-col md:flex-row items-stretch gap-6">
                <div className="relative flex flex-col items-center justify-center shrink-0">
                    <div
                        className={`w-[200px] h-[200px] rounded-xl flex items-center justify-center border-2 overflow-hidden bg-black ${!isDetectingRef.current ? (darkMode ? 'border-gray-600' : 'border-gray-300') : 'border-gray-700'
                            }`}
                    >
                        <div ref={videoContainerRef} className="absolute inset-0 flex items-center justify-center z-10 w-full h-full [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:object-cover"></div>
                        {!isDetectingRef.current && (
                            <div className="text-center z-20"> {/* Added z-20 to ensure it's above the videoContainerRef div */}
                                <Camera className={`w-12 h-12 mx-auto mb-2 opacity-50 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                                <p className={`text-sm opacity-50 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Camera Offline</p>
                            </div>
                        )}
                    </div>
                    {status === 'Loading...' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl text-white text-sm font-medium z-30">
                            Loading Model...
                        </div>
                    )}
                </div>

                <div className="flex-1 w-full flex flex-col justify-center">
                    <div className={`p-6 rounded-2xl border-2 transition-colors flex flex-col justify-center ${status === 'Drowsy'
                        ? 'bg-[#edd8d8] border-red-200 dark:bg-[#341a1a] dark:border-red-900/50'
                        : 'bg-green-50 border-green-100 dark:bg-green-900/10 dark:border-green-800/30'
                        }`}>
                        <div className="flex items-center space-x-3 mb-6">
                            {status === 'Drowsy' ? (
                                <AlertTriangle className="w-5 h-5 text-[#ff4c4c] dark:text-[#ff6b6b]" />
                            ) : (
                                <ShieldCheck className="w-5 h-5 text-green-500" />
                            )}
                            <h4 className={`text-lg font-medium ${status === 'Drowsy'
                                ? 'text-[#ff4c4c] dark:text-[#ff6b6b]'
                                : 'text-green-600 dark:text-green-400'
                                }`}>
                                {status === 'Drowsy' ? 'Drowsiness Detected' : 'Operator Attentive'}
                            </h4>
                        </div>
                        {isDetectingRef.current && (
                            <div className="w-full">
                                <div className="flex justify-between text-xs mb-2">
                                    <span className={`font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Drowsiness Confidence</span>
                                    <span className="font-bold tracking-tight" style={{ color: confidence > DROWSY_THRESHOLD ? '#ff4c4c' : (darkMode ? '#d1d5db' : '#4b5563') }}>
                                        {(confidence * 100).toFixed(1)}%
                                    </span>
                                </div>
                                <div className="w-full bg-[#cbd5e1] dark:bg-gray-700/50 rounded-full h-3">
                                    <div
                                        className={`h-3 rounded-full transition-all duration-200 ease-out ${status === 'Drowsy' ? 'bg-[#ff4c4c]' : 'bg-green-500'}`}
                                        style={{ width: `${Math.min(confidence * 100, 100)}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}

                    </div>

                    {hasAlert && (
                        <button
                            onClick={stopAlert}
                            className="w-full py-3 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-bold rounded-xl border border-red-300 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors flex justify-center items-center space-x-2 animate-pulse"
                        >
                            <AlertTriangle className="w-5 h-5" />
                            <span>Acknowledge Alert / Stop Alarm</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DrowsyDetector;
